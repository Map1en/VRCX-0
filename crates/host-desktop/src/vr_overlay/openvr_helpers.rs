use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::time::{Duration, Instant};

use openvr::{
    button_id, pose::Matrix3x4, ControllerState, TrackedControllerRole, TrackedDeviceClass,
    TrackedDeviceIndex,
};
use vrcx_0_vr_overlay::{
    ray_quad_intersection, OverlayQuadSize, OverlaySurfaceId, OverlayTransform, Ray3, RgbaFrame,
    UvPoint, FRIENDS_PANEL_ID, FRIENDS_PANEL_LASER_LEFT_SURFACE_ID,
    FRIENDS_PANEL_LASER_RIGHT_SURFACE_ID, FRIENDS_PANEL_SURFACE_ID, LEGACY_DUMMY_PANEL_ID,
};

use super::types::{
    OverlayActivationButton, OverlayHand, OverlayInputEvent, OverlayInputKind, OverlayPlacement,
    OverlaySurfaceConfig, VrDeviceStatus,
};

pub(super) const TRIGGER_PRESS_THRESHOLD: f32 = 0.6;
pub(super) const SCROLL_AXIS_THRESHOLD: f32 = 0.55;
pub(super) const GRIP_AXIS_PRESS_THRESHOLD: f32 = 0.6;
pub(super) const SCROLL_REPEAT_INTERVAL: Duration = Duration::from_millis(120);
pub(super) const HOVER_UV_EPSILON: f32 = 0.01;
pub(super) const TRIGGER_DRAG_SCROLL_UV_PER_STEP: f32 = 0.055;
pub(super) const POINTER_PITCH_OFFSET_RADIANS: f32 = 35.0_f32.to_radians();
pub(super) const POINTER_LASER_START_OFFSET_METERS: f32 = 0.08;
pub(super) const POINTER_LASER_MISS_LENGTH_METERS: f32 = 0.35;
pub(super) const POINTER_LASER_MIN_LENGTH_METERS: f32 = 0.12;
pub(super) const POINTER_LASER_MAX_LENGTH_METERS: f32 = 2.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct FrameFingerprint {
    width: u32,
    height: u32,
    byte_len: usize,
    hash: u64,
}

#[derive(Clone)]
pub(super) struct InteractiveSurfaceCandidate {
    pub(super) surface_id: OverlaySurfaceId,
    pub(super) panel_id: String,
    pub(super) quad_size: OverlayQuadSize,
    pub(super) transform: OverlayTransform,
}

#[derive(Clone)]
pub(super) struct InteractiveHit {
    pub(super) surface_id: OverlaySurfaceId,
    pub(super) panel_id: String,
    pub(super) uv: UvPoint,
    pub(super) distance: f32,
    pub(super) transform: OverlayTransform,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct InteractiveTarget {
    pub(super) surface_id: OverlaySurfaceId,
    pub(super) panel_id: String,
}

impl InteractiveHit {
    pub(super) fn event(&self, hand: OverlayHand, kind: OverlayInputKind) -> OverlayInputEvent {
        OverlayInputEvent {
            surface_id: self.surface_id.clone(),
            panel_id: self.panel_id.clone(),
            hand,
            uv: self.uv,
            kind,
        }
    }

    pub(super) fn target(&self) -> InteractiveTarget {
        InteractiveTarget {
            surface_id: self.surface_id.clone(),
            panel_id: self.panel_id.clone(),
        }
    }
}

impl InteractiveTarget {
    pub(super) fn matches_hit(&self, hit: &InteractiveHit) -> bool {
        self.surface_id == hit.surface_id && self.panel_id == hit.panel_id
    }

    pub(super) fn event(
        &self,
        hand: OverlayHand,
        uv: UvPoint,
        kind: OverlayInputKind,
    ) -> OverlayInputEvent {
        OverlayInputEvent {
            surface_id: self.surface_id.clone(),
            panel_id: self.panel_id.clone(),
            hand,
            uv,
            kind,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct ScrollDelta {
    pub(super) delta: Option<f32>,
    pub(super) last_scroll_at: Option<Instant>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct DragScrollDelta {
    pub(super) delta: Option<f32>,
    pub(super) remainder_y: f32,
}

pub(super) fn frame_fingerprint(frame: &RgbaFrame) -> FrameFingerprint {
    let mut hasher = DefaultHasher::new();
    frame.size.width.hash(&mut hasher);
    frame.size.height.hash(&mut hasher);
    frame.data.len().hash(&mut hasher);
    frame.data.hash(&mut hasher);
    FrameFingerprint {
        width: frame.size.width,
        height: frame.size.height,
        byte_len: frame.data.len(),
        hash: hasher.finish(),
    }
}

pub(super) fn overlay_button_mask(
    button: OverlayActivationButton,
    tracking_system_name: Option<&str>,
) -> u64 {
    let button_id = match button {
        OverlayActivationButton::Grip if is_oculus_tracking_system(tracking_system_name) => {
            button_id::A
        }
        OverlayActivationButton::Grip => button_id::GRIP,
        OverlayActivationButton::Menu => button_id::APPLICATION_MENU,
    };
    1u64 << button_id
}

pub(super) fn is_oculus_tracking_system(value: Option<&str>) -> bool {
    value
        .map(|value| value.to_ascii_lowercase().contains("oculus"))
        .unwrap_or(false)
}

pub(super) fn surface_transform(placement: &OverlayPlacement) -> Matrix3x4 {
    match placement {
        OverlayPlacement::Absolute { transform } => overlay_transform_to_matrix(*transform),
        OverlayPlacement::TrackedDeviceRelative { device_hint } if device_hint == "left-hand" => {
            Matrix3x4([
                [0.0, 0.0, -1.0, -0.07],
                [0.0, -1.0, 0.0, -0.05],
                [-1.0, 0.0, 0.0, 0.06],
            ])
        }
        OverlayPlacement::TrackedDeviceRelative { device_hint } if device_hint == "right-hand" => {
            Matrix3x4([
                [0.0, 0.0, 1.0, 0.07],
                [0.0, -1.0, 0.0, -0.05],
                [1.0, 0.0, 0.0, 0.06],
            ])
        }
        OverlayPlacement::TrackedDeviceRelative { device_hint }
            if device_hint.starts_with("hmd") =>
        {
            hmd_transform(device_hint)
        }
        OverlayPlacement::TrackedDeviceRelative { .. } => Matrix3x4([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.035],
            [0.0, 0.0, 1.0, 0.055],
        ]),
    }
}

pub(super) fn overlay_transform_to_matrix(transform: OverlayTransform) -> Matrix3x4 {
    Matrix3x4([
        [
            transform.rotation[0][0],
            transform.rotation[0][1],
            transform.rotation[0][2],
            transform.translation[0],
        ],
        [
            transform.rotation[1][0],
            transform.rotation[1][1],
            transform.rotation[1][2],
            transform.translation[1],
        ],
        [
            transform.rotation[2][0],
            transform.rotation[2][1],
            transform.rotation[2][2],
            transform.translation[2],
        ],
    ])
}

pub(super) fn matrix_to_overlay_transform(matrix: &[[f32; 4]; 3]) -> OverlayTransform {
    OverlayTransform::from_translation_rotation(
        [matrix[0][3], matrix[1][3], matrix[2][3]],
        [
            [matrix[0][0], matrix[0][1], matrix[0][2]],
            [matrix[1][0], matrix[1][1], matrix[1][2]],
            [matrix[2][0], matrix[2][1], matrix[2][2]],
        ],
    )
}

pub(super) fn pose_transform(
    poses: &openvr::TrackedDevicePoses,
    device: TrackedDeviceIndex,
) -> Option<OverlayTransform> {
    let pose = poses.get(device.0 as usize)?;
    if !pose.device_is_connected() || !pose.pose_is_valid() {
        return None;
    }
    Some(matrix_to_overlay_transform(
        pose.device_to_absolute_tracking(),
    ))
}

pub(super) fn overlay_quad_size(config: &OverlaySurfaceConfig) -> OverlayQuadSize {
    let aspect = config.size.height as f32 / config.size.width.max(1) as f32;
    OverlayQuadSize::new(
        config.physical_width_meters,
        config.physical_width_meters * aspect,
    )
}

pub(super) fn nearest_interactive_hit(
    controller_transform: OverlayTransform,
    surfaces: &[InteractiveSurfaceCandidate],
) -> Option<InteractiveHit> {
    let ray = Ray3::new(
        controller_transform.translation,
        aim_direction(controller_transform),
    );
    surfaces
        .iter()
        .filter_map(|surface| {
            ray_quad_intersection(ray, surface.transform, surface.quad_size).map(|hit| {
                InteractiveHit {
                    surface_id: surface.surface_id.clone(),
                    panel_id: surface.panel_id.clone(),
                    uv: hit.uv,
                    distance: hit.distance,
                    transform: surface.transform,
                }
            })
        })
        .min_by(|left, right| left.distance.total_cmp(&right.distance))
}

pub(super) fn aim_direction(controller_transform: OverlayTransform) -> [f32; 3] {
    let forward = controller_transform.forward();
    let up = controller_transform.up();
    let cos = POINTER_PITCH_OFFSET_RADIANS.cos();
    let sin = POINTER_PITCH_OFFSET_RADIANS.sin();
    [
        forward[0] * cos - up[0] * sin,
        forward[1] * cos - up[1] * sin,
        forward[2] * cos - up[2] * sin,
    ]
}

pub(super) fn pointer_laser_width(hit: Option<&InteractiveHit>) -> f32 {
    hit.map(|hit| hit.distance - POINTER_LASER_START_OFFSET_METERS)
        .unwrap_or(POINTER_LASER_MISS_LENGTH_METERS)
        .clamp(
            POINTER_LASER_MIN_LENGTH_METERS,
            POINTER_LASER_MAX_LENGTH_METERS,
        )
}

pub(super) fn pointer_laser_transform(
    controller_transform: OverlayTransform,
    hmd_transform: Option<OverlayTransform>,
    width_meters: f32,
) -> OverlayTransform {
    let right = normalize_vec3_or(
        aim_direction(controller_transform),
        controller_transform.forward(),
    );
    let center = vec3_add(
        controller_transform.translation,
        vec3_scale(
            right,
            POINTER_LASER_START_OFFSET_METERS + width_meters * 0.5,
        ),
    );
    let facing = hmd_transform
        .map(|hmd| vec3_sub(hmd.translation, center))
        .unwrap_or_else(|| controller_transform.up());
    let normal = perpendicular_axis(facing, right, controller_transform.up());
    let up = normalize_vec3_or(vec3_cross(normal, right), controller_transform.up());
    let normal = normalize_vec3_or(vec3_cross(right, up), normal);
    OverlayTransform::from_translation_rotation(
        center,
        [
            [right[0], up[0], normal[0]],
            [right[1], up[1], normal[1]],
            [right[2], up[2], normal[2]],
        ],
    )
}

pub(super) fn pointer_laser_surface_id_for_hand(hand: OverlayHand) -> OverlaySurfaceId {
    match hand {
        OverlayHand::Left => OverlaySurfaceId::new(FRIENDS_PANEL_LASER_LEFT_SURFACE_ID),
        OverlayHand::Right => OverlaySurfaceId::new(FRIENDS_PANEL_LASER_RIGHT_SURFACE_ID),
    }
}

pub(super) fn click_up_event_for_release(
    hand: OverlayHand,
    hit: Option<&InteractiveHit>,
    pressed_target: Option<&InteractiveTarget>,
) -> Option<OverlayInputEvent> {
    if let Some(pressed_target) = pressed_target {
        if let Some(hit) = hit.filter(|hit| pressed_target.matches_hit(hit)) {
            return Some(hit.event(hand, OverlayInputKind::ClickUp));
        }
        return Some(pressed_target.event(hand, pointer_miss_uv(), OverlayInputKind::ClickUp));
    }
    hit.map(|hit| hit.event(hand, OverlayInputKind::ClickUp))
}

pub(super) fn trigger_pressed(state: &ControllerState) -> bool {
    state.button_pressed & (1u64 << button_id::STEAM_VR_TRIGGER) != 0
        || state
            .axis
            .get(1)
            .is_some_and(|axis| axis.x >= TRIGGER_PRESS_THRESHOLD)
}

pub(super) fn grip_pressed_for_state(
    state: &ControllerState,
    tracking_system_name: Option<&str>,
) -> bool {
    let remapped_mask = overlay_button_mask(OverlayActivationButton::Grip, tracking_system_name);
    state.button_pressed & remapped_mask != 0
        || state.button_pressed & (1u64 << button_id::GRIP) != 0
        || state.axis.get(2).is_some_and(|axis| {
            axis.x >= GRIP_AXIS_PRESS_THRESHOLD || axis.y >= GRIP_AXIS_PRESS_THRESHOLD
        })
}

pub(super) fn scroll_delta_for_state(
    scroll_value: f32,
    last_scroll_at: Option<Instant>,
    now: Instant,
) -> ScrollDelta {
    if scroll_value.abs() < SCROLL_AXIS_THRESHOLD * 0.5 {
        return ScrollDelta {
            delta: None,
            last_scroll_at: None,
        };
    }
    if scroll_value.abs() < SCROLL_AXIS_THRESHOLD {
        return ScrollDelta {
            delta: None,
            last_scroll_at,
        };
    }
    let should_emit = last_scroll_at
        .map(|last| now.saturating_duration_since(last) >= SCROLL_REPEAT_INTERVAL)
        .unwrap_or(true);
    ScrollDelta {
        delta: should_emit.then_some(-scroll_value.signum()),
        last_scroll_at: if should_emit {
            Some(now)
        } else {
            last_scroll_at
        },
    }
}

pub(super) fn trigger_drag_scroll_delta(
    previous_uv: Option<UvPoint>,
    current_uv: UvPoint,
    remainder_y: f32,
) -> DragScrollDelta {
    let Some(previous_uv) = previous_uv else {
        return DragScrollDelta {
            delta: None,
            remainder_y,
        };
    };
    let mut remainder_y = remainder_y + current_uv.y - previous_uv.y;
    let steps = (remainder_y / TRIGGER_DRAG_SCROLL_UV_PER_STEP).trunc();
    if steps == 0.0 {
        return DragScrollDelta {
            delta: None,
            remainder_y,
        };
    }
    remainder_y -= steps * TRIGGER_DRAG_SCROLL_UV_PER_STEP;
    DragScrollDelta {
        delta: Some(-steps),
        remainder_y,
    }
}

pub(super) fn should_emit_hover(
    previous_target: Option<&InteractiveTarget>,
    previous_uv: Option<UvPoint>,
    hit: &InteractiveHit,
) -> bool {
    if !previous_target.is_some_and(|target| target.matches_hit(hit)) {
        return true;
    }
    previous_uv
        .map(|uv| {
            (uv.x - hit.uv.x).abs() >= HOVER_UV_EPSILON
                || (uv.y - hit.uv.y).abs() >= HOVER_UV_EPSILON
        })
        .unwrap_or(true)
}

pub(super) fn pointer_miss_uv() -> UvPoint {
    UvPoint::new(-1.0, -1.0)
}

pub(super) fn perpendicular_axis(
    candidate: [f32; 3],
    axis: [f32; 3],
    fallback: [f32; 3],
) -> [f32; 3] {
    let projected = reject_axis(candidate, axis);
    if vec3_len(projected) > 0.0001 {
        return normalize_vec3_or(projected, [0.0, 1.0, 0.0]);
    }
    let fallback = reject_axis(fallback, axis);
    if vec3_len(fallback) > 0.0001 {
        return normalize_vec3_or(fallback, [0.0, 1.0, 0.0]);
    }
    let base = if axis[1].abs() < 0.9 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };
    normalize_vec3_or(vec3_cross(axis, base), [0.0, 0.0, 1.0])
}

pub(super) fn reject_axis(value: [f32; 3], axis: [f32; 3]) -> [f32; 3] {
    vec3_sub(value, vec3_scale(axis, vec3_dot(value, axis)))
}

pub(super) fn vec3_add(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

pub(super) fn vec3_sub(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

pub(super) fn vec3_scale(value: [f32; 3], scalar: f32) -> [f32; 3] {
    [value[0] * scalar, value[1] * scalar, value[2] * scalar]
}

pub(super) fn vec3_dot(left: [f32; 3], right: [f32; 3]) -> f32 {
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

pub(super) fn vec3_cross(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ]
}

pub(super) fn vec3_len(value: [f32; 3]) -> f32 {
    vec3_dot(value, value).sqrt()
}

pub(super) fn normalize_vec3_or(value: [f32; 3], fallback: [f32; 3]) -> [f32; 3] {
    let len = vec3_len(value);
    if len <= 0.0001 {
        return fallback;
    }
    vec3_scale(value, 1.0 / len)
}

pub(super) fn surface_id_for_panel_id(panel_id: &str) -> OverlaySurfaceId {
    if matches!(panel_id, FRIENDS_PANEL_ID | LEGACY_DUMMY_PANEL_ID) {
        OverlaySurfaceId::new(FRIENDS_PANEL_SURFACE_ID)
    } else {
        OverlaySurfaceId::new(format!("interactive-{panel_id}"))
    }
}

pub(super) fn panel_id_for_surface(surface_id: &OverlaySurfaceId) -> String {
    if surface_id.as_str() == FRIENDS_PANEL_SURFACE_ID {
        return FRIENDS_PANEL_ID.to_string();
    }
    surface_id
        .as_str()
        .strip_prefix("interactive-")
        .unwrap_or_else(|| surface_id.as_str())
        .to_string()
}

pub(super) fn hmd_transform(device_hint: &str) -> Matrix3x4 {
    let (x, y) = match device_hint {
        "hmd:top" => (0.0, 0.38),
        "hmd:left" => (-0.52, -0.12),
        "hmd:right" => (0.52, -0.12),
        _ => (0.0, -0.38),
    };
    Matrix3x4([
        [1.0, 0.0, 0.0, x],
        [0.0, 1.0, 0.0, y],
        [0.0, 0.0, 1.0, -1.15],
    ])
}

pub(super) fn is_display_device_class(class: TrackedDeviceClass) -> bool {
    matches!(
        class,
        TrackedDeviceClass::HMD
            | TrackedDeviceClass::Controller
            | TrackedDeviceClass::GenericTracker
    )
}

pub(super) fn device_sort_key(
    class: TrackedDeviceClass,
    role: Option<TrackedControllerRole>,
    tracker_index: usize,
) -> (u8, usize) {
    match class {
        TrackedDeviceClass::HMD => (0, 0),
        TrackedDeviceClass::Controller => match role {
            Some(TrackedControllerRole::LeftHand) => (1, 0),
            Some(TrackedControllerRole::RightHand) => (2, 0),
            _ => (3, 0),
        },
        TrackedDeviceClass::GenericTracker => (4, tracker_index),
        _ => (9, 0),
    }
}

pub(super) fn device_status(
    battery_percent: Option<u8>,
    charging: bool,
    pose_valid: bool,
) -> VrDeviceStatus {
    if charging {
        return VrDeviceStatus::Charging;
    }
    if !pose_valid {
        return VrDeviceStatus::TrackingWarning;
    }
    match battery_percent {
        Some(percent) if percent <= 10 => VrDeviceStatus::CriticalBattery,
        Some(percent) if percent <= 25 => VrDeviceStatus::LowBattery,
        _ => VrDeviceStatus::Normal,
    }
}

pub(super) fn short_device_label(
    model: Option<&str>,
    serial: Option<&str>,
    fallback: &str,
) -> String {
    let raw = model
        .filter(|value| !value.trim().is_empty())
        .or_else(|| serial.filter(|value| !value.trim().is_empty()))
        .unwrap_or(fallback)
        .trim();
    raw.split_whitespace()
        .next()
        .unwrap_or(fallback)
        .chars()
        .take(6)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn button_mask_uses_oculus_a_for_grip() {
        assert_eq!(
            overlay_button_mask(OverlayActivationButton::Grip, Some("oculus")),
            1u64 << (button_id::A as u32)
        );
    }

    #[test]
    fn button_mask_uses_grip_for_non_oculus_grip() {
        assert_eq!(
            overlay_button_mask(OverlayActivationButton::Grip, Some("lighthouse")),
            1u64 << (button_id::GRIP as u32)
        );
    }

    #[test]
    fn button_mask_uses_application_menu_for_menu() {
        assert_eq!(
            overlay_button_mask(OverlayActivationButton::Menu, Some("oculus")),
            1u64 << (button_id::APPLICATION_MENU as u32)
        );
        assert_eq!(
            overlay_button_mask(OverlayActivationButton::Menu, Some("lighthouse")),
            1u64 << (button_id::APPLICATION_MENU as u32)
        );
    }

    #[test]
    fn click_up_release_without_hit_targets_pressed_panel_with_miss_uv() {
        let pressed = InteractiveTarget {
            surface_id: OverlaySurfaceId::new("interactive-dummy"),
            panel_id: "dummy".to_string(),
        };

        let event = click_up_event_for_release(OverlayHand::Left, None, Some(&pressed))
            .expect("click up event");

        assert_eq!(event.surface_id.as_str(), "interactive-dummy");
        assert_eq!(event.panel_id, "dummy");
        assert_eq!(event.uv, pointer_miss_uv());
        assert!(matches!(event.kind, OverlayInputKind::ClickUp));
    }

    #[test]
    fn click_up_release_on_pressed_target_uses_current_hit_uv() {
        let hit = InteractiveHit {
            surface_id: OverlaySurfaceId::new("interactive-dummy"),
            panel_id: "dummy".to_string(),
            uv: UvPoint::new(0.4, 0.6),
            distance: 1.0,
            transform: OverlayTransform::identity(),
        };
        let pressed = hit.target();

        let event = click_up_event_for_release(OverlayHand::Left, Some(&hit), Some(&pressed))
            .expect("click up event");

        assert_eq!(event.uv, UvPoint::new(0.4, 0.6));
        assert!(matches!(event.kind, OverlayInputKind::ClickUp));
    }

    #[test]
    fn grip_pressed_uses_oculus_remap_and_grip_axis() {
        let mut state = controller_state();
        state.button_pressed = 1u64 << (button_id::A as u32);
        assert!(grip_pressed_for_state(&state, Some("oculus")));

        let mut axis_state = controller_state();
        axis_state.axis[2].x = 0.8;
        assert!(grip_pressed_for_state(&axis_state, Some("lighthouse")));
    }

    #[test]
    fn aim_direction_applies_pitch_offset_to_grip_forward() {
        let controller = OverlayTransform::identity();

        let aim = aim_direction(controller);

        assert!(aim[1] < -0.5);
        assert!(aim[2] < -0.7 && aim[2] > -1.0);
        assert!(aim[0].abs() < 0.001);
    }

    #[test]
    fn pointer_laser_width_uses_hit_distance_or_short_miss_length() {
        let hit = InteractiveHit {
            surface_id: OverlaySurfaceId::new("interactive-dummy"),
            panel_id: "dummy".to_string(),
            uv: UvPoint::new(0.5, 0.5),
            distance: 1.2,
            transform: OverlayTransform::identity(),
        };

        assert!(
            (pointer_laser_width(Some(&hit)) - (1.2 - POINTER_LASER_START_OFFSET_METERS)).abs()
                < 0.001
        );
        assert!((pointer_laser_width(None) - POINTER_LASER_MISS_LENGTH_METERS).abs() < 0.001);
    }

    #[test]
    fn pointer_laser_transform_spans_aim_axis_and_faces_hmd() {
        let controller = OverlayTransform::identity();
        let hmd = OverlayTransform::from_translation([0.0, 0.0, 0.5]);
        let width_meters = 0.5;

        let transform = pointer_laser_transform(controller, Some(hmd), width_meters);
        let aim = aim_direction(controller);
        let expected_center = vec3_add(
            controller.translation,
            vec3_scale(aim, POINTER_LASER_START_OFFSET_METERS + width_meters * 0.5),
        );

        assert!((transform.right()[0] - aim[0]).abs() < 0.001);
        assert!((transform.right()[1] - aim[1]).abs() < 0.001);
        assert!((transform.right()[2] - aim[2]).abs() < 0.001);
        assert!((transform.translation[0] - expected_center[0]).abs() < 0.001);
        assert!((transform.translation[1] - expected_center[1]).abs() < 0.001);
        assert!((transform.translation[2] - expected_center[2]).abs() < 0.001);
        assert!(vec3_dot(transform.right(), transform.up()).abs() < 0.001);
        assert!(
            vec3_dot(
                transform.normal(),
                vec3_sub(hmd.translation, transform.translation)
            ) > 0.0
        );
    }

    #[test]
    fn scroll_repeat_reemits_after_interval_while_axis_is_held() {
        let started = Instant::now();

        let first = scroll_delta_for_state(1.0, None, started);
        assert_eq!(first.delta, Some(-1.0));
        let second = scroll_delta_for_state(
            1.0,
            first.last_scroll_at,
            started + SCROLL_REPEAT_INTERVAL / 2,
        );
        assert_eq!(second.delta, None);
        let third =
            scroll_delta_for_state(1.0, first.last_scroll_at, started + SCROLL_REPEAT_INTERVAL);
        assert_eq!(third.delta, Some(-1.0));
        let reset = scroll_delta_for_state(0.0, third.last_scroll_at, started);
        assert_eq!(reset.last_scroll_at, None);
    }

    #[test]
    fn trigger_drag_scroll_maps_vertical_uv_motion_to_scroll_steps() {
        let start = UvPoint::new(0.5, 0.6);

        let small = trigger_drag_scroll_delta(Some(start), UvPoint::new(0.5, 0.57), 0.0);
        assert_eq!(small.delta, None);

        let up = trigger_drag_scroll_delta(Some(start), UvPoint::new(0.5, 0.48), 0.0);
        assert_eq!(up.delta, Some(2.0));

        let down = trigger_drag_scroll_delta(Some(start), UvPoint::new(0.5, 0.72), 0.0);
        assert_eq!(down.delta, Some(-2.0));
    }

    #[test]
    fn hover_emit_requires_target_change_or_meaningful_uv_delta() {
        let hit = InteractiveHit {
            surface_id: OverlaySurfaceId::new("interactive-dummy"),
            panel_id: "dummy".to_string(),
            uv: UvPoint::new(0.4, 0.6),
            distance: 1.0,
            transform: OverlayTransform::identity(),
        };
        let target = hit.target();

        assert!(!should_emit_hover(Some(&target), Some(hit.uv), &hit));
        let moved = InteractiveHit {
            uv: UvPoint::new(0.5, 0.6),
            ..hit.clone()
        };
        assert!(should_emit_hover(Some(&target), Some(hit.uv), &moved));
    }

    fn controller_state() -> ControllerState {
        ControllerState {
            packet_num: 0,
            button_pressed: 0,
            button_touched: 0,
            axis: [openvr::ControllerAxis { x: 0.0, y: 0.0 }; 5],
        }
    }
}
