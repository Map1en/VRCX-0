use std::collections::HashMap;
use std::time::{Duration, Instant};

use openvr::{
    button_id,
    overlay::OverlayHandle,
    pose::Matrix3x4,
    property::{
        ControllerRoleHint_Int32, DeviceBatteryPercentage_Float, DeviceIsCharging_Bool,
        DeviceProvidesBatteryStatus_Bool, ModelNumber_String, SerialNumber_String,
        TrackingSystemName_String,
    },
    tracked_device_index, ApplicationType, Context, Overlay, TrackedControllerRole,
    TrackedDeviceClass, TrackedDeviceIndex, TrackingUniverseOrigin, MAX_TRACKED_DEVICE_COUNT,
};
use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame};

use super::{
    actor::OverlayBackend,
    types::{
        OverlayActivationButton, OverlayPlacement, OverlaySurfaceConfig, VrDeviceSnapshot,
        VrDeviceStatus,
    },
};

const WRIST_OVERLAY_VISIBLE_DURATION: Duration = Duration::from_secs(10);
const VISIBLE_FRAME_UPLOAD_INTERVAL: Duration = Duration::from_secs(2);

pub struct OpenVrOverlayBackend {
    context: Option<Context>,
    overlay: Option<Overlay>,
    surfaces: HashMap<OverlaySurfaceId, OpenVrSurface>,
}

struct OpenVrSurface {
    handle: OverlayHandle,
    config: OverlaySurfaceConfig,
    transform_device: Option<TrackedDeviceIndex>,
    opened_until: Option<Instant>,
    visible: bool,
    active: bool,
    pending_frame: Option<RgbaFrame>,
    last_visible_frame_upload_at: Option<Instant>,
}

#[derive(Clone)]
struct SurfaceUpdateCandidate {
    surface_id: OverlaySurfaceId,
    handle: OverlayHandle,
    config: OverlaySurfaceConfig,
    transform_device: Option<TrackedDeviceIndex>,
    opened_until: Option<Instant>,
}

impl OpenVrOverlayBackend {
    pub fn new() -> Self {
        Self {
            context: None,
            overlay: None,
            surfaces: HashMap::new(),
        }
    }
}

impl Default for OpenVrOverlayBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl OverlayBackend for OpenVrOverlayBackend {
    fn start(&mut self) -> Result<(), String> {
        if self.context.is_some() && self.overlay.is_some() {
            return Ok(());
        }

        let context = unsafe { openvr::init(ApplicationType::Background) }
            .map_err(|error| format!("OpenVR init failed: {error:?}"))?;
        let overlay = context
            .overlay()
            .map_err(|error| format!("OpenVR overlay interface failed: {error:?}"))?;
        self.context = Some(context);
        self.overlay = Some(overlay);
        Ok(())
    }

    fn register_surface(&mut self, config: OverlaySurfaceConfig) -> Result<(), String> {
        self.start()?;
        let surface_id = config.surface_id.clone();
        if self.surfaces.contains_key(&surface_id) {
            self.apply_config(&config)?;
            if let Some(surface) = self.surfaces.get_mut(&surface_id) {
                surface.config = config;
                surface.active = true;
            }
            return Ok(());
        }

        let overlay = self
            .overlay
            .as_mut()
            .ok_or_else(|| "OpenVR overlay is not started".to_string())?;
        let handle = overlay
            .create_overlay(
                &format!("vrcx.{}\0", config.surface_id.as_str()),
                &format!("VRCX {} Overlay\0", config.surface_id.as_str()),
            )
            .map_err(|error| format!("create overlay failed: {error:?}"))?;
        self.surfaces.insert(
            surface_id,
            OpenVrSurface {
                handle,
                config: config.clone(),
                transform_device: None,
                opened_until: None,
                visible: false,
                active: true,
                pending_frame: None,
                last_visible_frame_upload_at: None,
            },
        );
        self.apply_config(&config)
    }

    fn update_frame(
        &mut self,
        surface_id: &OverlaySurfaceId,
        frame: RgbaFrame,
    ) -> Result<(), String> {
        let (handle, visible_upload) = {
            let surface = self.surfaces.get_mut(surface_id).ok_or_else(|| {
                format!(
                    "overlay surface '{}' is not registered",
                    surface_id.as_str()
                )
            })?;
            if surface.visible {
                let now = Instant::now();
                let can_upload = surface
                    .last_visible_frame_upload_at
                    .map(|last| now.saturating_duration_since(last) >= VISIBLE_FRAME_UPLOAD_INTERVAL)
                    .unwrap_or(true);
                if !can_upload {
                    surface.pending_frame = Some(frame);
                    return Ok(());
                }
                surface.pending_frame = None;
                surface.last_visible_frame_upload_at = Some(now);
                (surface.handle, true)
            } else {
                surface.pending_frame = None;
                (surface.handle, false)
            }
        };

        if let Err(error) = self.upload_frame(handle, &frame) {
            if let Some(surface) = self.surfaces.get_mut(surface_id) {
                surface.pending_frame = Some(frame);
                if visible_upload {
                    surface.last_visible_frame_upload_at = None;
                }
            }
            return Err(error);
        }
        Ok(())
    }

    fn show(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        self.set_visibility(surface_id, true)
    }

    fn hide(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        self.set_visibility(surface_id, false)
    }

    fn unregister_surface(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        if !self.surfaces.contains_key(surface_id) {
            return Ok(());
        }
        self.set_visibility(surface_id, false)?;
        if let Some(surface) = self.surfaces.get_mut(surface_id) {
            surface.active = false;
            surface.opened_until = None;
        }
        Ok(())
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        self.start()?;
        let context = self
            .context
            .as_ref()
            .ok_or_else(|| "OpenVR context is not started".to_string())?;
        let system = context
            .system()
            .map_err(|error| format!("OpenVR system interface failed: {error:?}"))?;
        Ok(snapshot_openvr_devices(&system))
    }

    fn tick(&mut self) {
        if let Err(error) = self.update_button_visibility() {
            tracing::warn!(error = %error, "failed to update VR overlay button visibility");
        }
    }

    fn stop(&mut self) {
        let surface_ids = self.surfaces.keys().cloned().collect::<Vec<_>>();
        for surface_id in surface_ids {
            let _ = self.set_visibility(&surface_id, false);
        }
        self.surfaces.clear();
        self.overlay = None;
        self.context = None;
    }
}

impl OpenVrOverlayBackend {
    fn update_button_visibility(&mut self) -> Result<(), String> {
        if self.surfaces.is_empty() {
            return Ok(());
        }
        let context = self
            .context
            .as_ref()
            .ok_or_else(|| "OpenVR context is not started".to_string())?;
        let system = context
            .system()
            .map_err(|error| format!("OpenVR system interface failed: {error:?}"))?;
        let candidates = self
            .surfaces
            .iter()
            .filter(|(_, surface)| surface.active)
            .map(|(surface_id, surface)| SurfaceUpdateCandidate {
                surface_id: surface_id.clone(),
                handle: surface.handle,
                config: surface.config.clone(),
                transform_device: surface.transform_device,
                opened_until: surface.opened_until,
            })
            .collect::<Vec<_>>();

        let overlay = self
            .overlay
            .as_mut()
            .ok_or_else(|| "OpenVR overlay is not started".to_string())?;
        let now = Instant::now();
        let mut surface_updates = Vec::new();
        let mut visibility_updates = Vec::new();
        for candidate in candidates {
            let mut transform_device = candidate.transform_device;
            let mut opened_until = candidate.opened_until;

            if let Ok(device) = resolve_device(&system, &candidate.config.placement) {
                if transform_device != Some(device) {
                    overlay
                        .set_transform_tracked_device_relative(
                            candidate.handle,
                            device,
                            &wrist_transform(&candidate.config.placement),
                        )
                        .map_err(|error| format!("set overlay transform failed: {error:?}"))?;
                    tracing::debug!(
                        surface_id = candidate.surface_id.as_str(),
                        device_index = device.0,
                        placement = ?candidate.config.placement,
                        "resolved VR overlay tracked device"
                    );
                }
                transform_device = Some(device);
                if device_button_pressed(&system, device, candidate.config.activation_button) {
                    opened_until = Some(now + WRIST_OVERLAY_VISIBLE_DURATION);
                }
            }

            let visible = transform_device.is_some() && opened_until.is_some_and(|until| now <= until);
            if !visible && opened_until.is_some_and(|until| now > until) {
                opened_until = None;
            }
            surface_updates.push((candidate.surface_id.clone(), transform_device, opened_until));
            visibility_updates.push((candidate.surface_id, visible));
        }

        for (surface_id, transform_device, opened_until) in surface_updates {
            if let Some(surface) = self.surfaces.get_mut(&surface_id) {
                surface.transform_device = transform_device;
                surface.opened_until = opened_until;
            }
        }
        for (surface_id, visible) in visibility_updates {
            self.set_visibility(&surface_id, visible)?;
        }
        Ok(())
    }

    fn apply_config(&mut self, config: &OverlaySurfaceConfig) -> Result<(), String> {
        let context = self
            .context
            .as_ref()
            .ok_or_else(|| "OpenVR context is not started".to_string())?;
        let handle = self.surface_handle(&config.surface_id)?;
        let overlay = self
            .overlay
            .as_mut()
            .ok_or_else(|| "OpenVR overlay is not started".to_string())?;

        overlay
            .set_width(handle, config.physical_width_meters)
            .map_err(|error| format!("set overlay width failed: {error:?}"))?;
        overlay
            .set_texel_aspect(handle, 1.0)
            .map_err(|error| format!("set overlay texel aspect failed: {error:?}"))?;

        let system = context
            .system()
            .map_err(|error| format!("OpenVR system interface failed: {error:?}"))?;
        let transform_device = match resolve_device(&system, &config.placement) {
            Ok(device) => {
                tracing::debug!(
                    surface_id = config.surface_id.as_str(),
                    device_index = device.0,
                    placement = ?config.placement,
                    "resolved VR overlay tracked device"
                );
                overlay
                    .set_transform_tracked_device_relative(
                        handle,
                        device,
                        &wrist_transform(&config.placement),
                    )
                    .map_err(|error| format!("set overlay transform failed: {error:?}"))?;
                Some(device)
            }
            Err(error) if is_tracked_device_unavailable(&error) => {
                tracing::warn!(
                    error = %error,
                    surface_id = config.surface_id.as_str(),
                    "VR overlay surface will wait for tracked device"
                );
                None
            }
            Err(error) => return Err(error),
        };
        if let Some(surface) = self.surfaces.get_mut(&config.surface_id) {
            surface.transform_device = transform_device;
        }
        Ok(())
    }

    fn set_visibility(
        &mut self,
        surface_id: &OverlaySurfaceId,
        visible: bool,
    ) -> Result<(), String> {
        let (handle, current_visible, pending_before_show) = {
            let surface = self.surfaces.get_mut(surface_id).ok_or_else(|| {
                format!(
                    "overlay surface '{}' is not registered",
                    surface_id.as_str()
                )
            })?;
            (
                surface.handle,
                surface.visible,
                if visible && !surface.visible {
                    surface.pending_frame.take()
                } else {
                    None
                },
            )
        };
        if current_visible == visible {
            return Ok(());
        }
        if let Some(frame) = pending_before_show {
            if let Err(error) = self.upload_frame(handle, &frame) {
                if let Some(surface) = self.surfaces.get_mut(surface_id) {
                    surface.pending_frame = Some(frame);
                }
                return Err(error);
            }
        }
        let overlay = self
            .overlay
            .as_mut()
            .ok_or_else(|| "OpenVR overlay is not started".to_string())?;
        overlay
            .set_visibility(handle, visible)
            .map_err(|error| format!("set overlay visibility failed: {error:?}"))?;
        if let Some(surface) = self.surfaces.get_mut(surface_id) {
            surface.visible = visible;
            if visible {
                surface.last_visible_frame_upload_at = Some(Instant::now());
            }
        }
        if !visible {
            let pending_after_hide = self
                .surfaces
                .get_mut(surface_id)
                .and_then(|surface| surface.pending_frame.take());
            if let Some(frame) = pending_after_hide {
                if let Err(error) = self.upload_frame(handle, &frame) {
                    if let Some(surface) = self.surfaces.get_mut(surface_id) {
                        surface.pending_frame = Some(frame);
                    }
                    return Err(error);
                }
            }
            if let Some(surface) = self.surfaces.get_mut(surface_id) {
                surface.last_visible_frame_upload_at = None;
            }
        }
        Ok(())
    }

    fn upload_frame(&mut self, handle: OverlayHandle, frame: &RgbaFrame) -> Result<(), String> {
        let overlay = self
            .overlay
            .as_mut()
            .ok_or_else(|| "OpenVR overlay is not started".to_string())?;
        upload_raw_frame(overlay, handle, frame)
    }

    fn surface_handle(&self, surface_id: &OverlaySurfaceId) -> Result<OverlayHandle, String> {
        self.surfaces
            .get(surface_id)
            .map(|surface| surface.handle)
            .ok_or_else(|| {
                format!(
                    "overlay surface '{}' is not registered",
                    surface_id.as_str()
                )
            })
    }
}

fn upload_raw_frame(
    overlay: &mut Overlay,
    handle: OverlayHandle,
    frame: &RgbaFrame,
) -> Result<(), String> {
    overlay
        .set_raw_data(
            handle,
            &frame.data,
            frame.size.width as usize,
            frame.size.height as usize,
            4,
        )
        .map_err(|error| format!("set raw overlay data failed: {error:?}"))
}

fn device_button_pressed(
    system: &openvr::System,
    device: TrackedDeviceIndex,
    button: OverlayActivationButton,
) -> bool {
    let Some(state) = system.controller_state(device) else {
        return false;
    };
    let tracking_system_name = string_property(system, device, TrackingSystemName_String);
    let mask = overlay_button_mask(button, tracking_system_name.as_deref());
    state.button_pressed & mask != 0
}

fn overlay_button_mask(button: OverlayActivationButton, tracking_system_name: Option<&str>) -> u64 {
    let button_id = match button {
        OverlayActivationButton::Grip if is_oculus_tracking_system(tracking_system_name) => {
            button_id::A
        }
        OverlayActivationButton::Grip => button_id::GRIP,
        OverlayActivationButton::Menu => button_id::APPLICATION_MENU,
    };
    1u64 << button_id
}

fn is_oculus_tracking_system(value: Option<&str>) -> bool {
    value
        .map(|value| value.to_ascii_lowercase().contains("oculus"))
        .unwrap_or(false)
}

fn resolve_device(
    system: &openvr::System,
    placement: &OverlayPlacement,
) -> Result<TrackedDeviceIndex, String> {
    match placement {
        OverlayPlacement::TrackedDeviceRelative { device_hint } => {
            let role = match device_hint.as_str() {
                "right-hand" => Some(TrackedControllerRole::RightHand),
                "left-hand" => Some(TrackedControllerRole::LeftHand),
                "hmd" | "head" => return Ok(tracked_device_index::HMD),
                _ => return Err(format!("unknown tracked device hint '{device_hint}'")),
            };
            resolve_controller_device(system, role.unwrap())
                .ok_or_else(|| tracked_device_unavailable_error(system, device_hint))
        }
    }
}

fn resolve_controller_device(
    system: &openvr::System,
    role: TrackedControllerRole,
) -> Option<TrackedDeviceIndex> {
    system
        .tracked_device_index_for_controller_role(role)
        .or_else(|| infer_controller_device_for_role(system, role))
}

fn infer_controller_device_for_role(
    system: &openvr::System,
    role: TrackedControllerRole,
) -> Option<TrackedDeviceIndex> {
    for index in 0..MAX_TRACKED_DEVICE_COUNT {
        let device = TrackedDeviceIndex(index as u32);
        if !system.is_tracked_device_connected(device)
            || system.tracked_device_class(device) != TrackedDeviceClass::Controller
        {
            continue;
        }
        if controller_role(system, device) == Some(role) {
            return Some(device);
        }
    }
    None
}

fn controller_role(
    system: &openvr::System,
    device: TrackedDeviceIndex,
) -> Option<TrackedControllerRole> {
    let role = system.get_controller_role_for_tracked_device_index(device);
    if matches!(
        role,
        Some(TrackedControllerRole::LeftHand | TrackedControllerRole::RightHand)
    ) {
        return role;
    }
    controller_role_hint(system, device)
}

fn controller_role_hint(
    system: &openvr::System,
    device: TrackedDeviceIndex,
) -> Option<TrackedControllerRole> {
    let value = system
        .int32_tracked_device_property(device, ControllerRoleHint_Int32)
        .ok()?;
    if value == TrackedControllerRole::LeftHand as i32 {
        Some(TrackedControllerRole::LeftHand)
    } else if value == TrackedControllerRole::RightHand as i32 {
        Some(TrackedControllerRole::RightHand)
    } else {
        None
    }
}

fn is_tracked_device_unavailable(error: &str) -> bool {
    error.starts_with("tracked device '")
}

fn tracked_device_unavailable_error(system: &openvr::System, device_hint: &str) -> String {
    let left = controller_role_index(system, TrackedControllerRole::LeftHand);
    let right = controller_role_index(system, TrackedControllerRole::RightHand);
    let connected = tracked_device_diagnostics(system);
    format!(
        "tracked device '{device_hint}' is unavailable; controller_roles={{left:{left}, right:{right}}}; connected_devices=[{connected}]"
    )
}

fn controller_role_index(system: &openvr::System, role: TrackedControllerRole) -> String {
    system
        .tracked_device_index_for_controller_role(role)
        .map(|device| device.0.to_string())
        .unwrap_or_else(|| "none".to_string())
}

fn tracked_device_diagnostics(system: &openvr::System) -> String {
    let mut rows = Vec::new();
    for index in 0..MAX_TRACKED_DEVICE_COUNT {
        let device = TrackedDeviceIndex(index as u32);
        if !system.is_tracked_device_connected(device) {
            continue;
        }
        let class = system.tracked_device_class(device);
        let raw_role = system
            .get_controller_role_for_tracked_device_index(device)
            .map(|role| format!("{role:?}"))
            .unwrap_or_else(|| "none".to_string());
        let role_hint = system
            .int32_tracked_device_property(device, ControllerRoleHint_Int32)
            .map(|value| value.to_string())
            .unwrap_or_else(|_| "none".to_string());
        let inferred_role = controller_role(system, device)
            .map(|role| format!("{role:?}"))
            .unwrap_or_else(|| "none".to_string());
        let serial =
            string_property(system, device, SerialNumber_String).unwrap_or_else(|| "-".to_string());
        let model =
            string_property(system, device, ModelNumber_String).unwrap_or_else(|| "-".to_string());
        let tracking = string_property(system, device, TrackingSystemName_String)
            .unwrap_or_else(|| "-".to_string());
        rows.push(format!(
            "{{index:{index}, class:{class:?}, role:{raw_role}, role_hint:{role_hint}, resolved_role:{inferred_role}, serial:{serial}, model:{model}, tracking:{tracking}}}"
        ));
    }
    if rows.is_empty() {
        "none".to_string()
    } else {
        rows.join(", ")
    }
}

fn wrist_transform(placement: &OverlayPlacement) -> Matrix3x4 {
    match placement {
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
        OverlayPlacement::TrackedDeviceRelative { .. } => Matrix3x4([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.035],
            [0.0, 0.0, 1.0, 0.055],
        ]),
    }
}

fn snapshot_openvr_devices(system: &openvr::System) -> Vec<VrDeviceSnapshot> {
    let poses = system.device_to_absolute_tracking_pose(TrackingUniverseOrigin::Standing, 0.0);
    let mut rows = Vec::new();
    let mut tracker_index = 0usize;

    for index in 0..MAX_TRACKED_DEVICE_COUNT {
        let device = TrackedDeviceIndex(index as u32);
        if !system.is_tracked_device_connected(device) {
            continue;
        }
        let class = system.tracked_device_class(device);
        if !is_display_device_class(class) {
            continue;
        }

        let role = controller_role(system, device);
        let serial = string_property(system, device, SerialNumber_String);
        let model = string_property(system, device, ModelNumber_String);
        let label = match class {
            TrackedDeviceClass::HMD => "HMD".to_string(),
            TrackedDeviceClass::Controller => match role {
                Some(TrackedControllerRole::LeftHand) => "L".to_string(),
                Some(TrackedControllerRole::RightHand) => "R".to_string(),
                _ => short_device_label(model.as_deref(), serial.as_deref(), "C"),
            },
            TrackedDeviceClass::GenericTracker => {
                tracker_index += 1;
                format!("T{tracker_index}")
            }
            _ => short_device_label(model.as_deref(), serial.as_deref(), "VR"),
        };
        let battery_percent = battery_percent(system, device);
        let charging = bool_property(system, device, DeviceIsCharging_Bool).unwrap_or(false);
        let pose_valid = poses
            .get(index)
            .is_some_and(|pose| pose.device_is_connected() && pose.pose_is_valid());
        let status = device_status(battery_percent, charging, pose_valid);
        rows.push(DeviceRow {
            sort_key: device_sort_key(class, role, tracker_index),
            snapshot: VrDeviceSnapshot {
                label,
                serial,
                status,
                battery_percent,
            },
        });
    }

    rows.sort_by_key(|row| row.sort_key);
    rows.into_iter().map(|row| row.snapshot).collect()
}

struct DeviceRow {
    sort_key: (u8, usize),
    snapshot: VrDeviceSnapshot,
}

fn is_display_device_class(class: TrackedDeviceClass) -> bool {
    matches!(
        class,
        TrackedDeviceClass::HMD
            | TrackedDeviceClass::Controller
            | TrackedDeviceClass::GenericTracker
    )
}

fn device_sort_key(
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

fn string_property(
    system: &openvr::System,
    device: TrackedDeviceIndex,
    property: openvr::TrackedDeviceProperty,
) -> Option<String> {
    system
        .string_tracked_device_property(device, property)
        .ok()
        .and_then(|value| value.into_string().ok())
        .map(|value| value.trim_matches(char::from(0)).trim().to_string())
        .filter(|value| !value.is_empty())
}

fn bool_property(
    system: &openvr::System,
    device: TrackedDeviceIndex,
    property: openvr::TrackedDeviceProperty,
) -> Option<bool> {
    system.bool_tracked_device_property(device, property).ok()
}

fn battery_percent(system: &openvr::System, device: TrackedDeviceIndex) -> Option<u8> {
    if bool_property(system, device, DeviceProvidesBatteryStatus_Bool) == Some(false) {
        return None;
    }
    system
        .float_tracked_device_property(device, DeviceBatteryPercentage_Float)
        .ok()
        .map(|value| (value.clamp(0.0, 1.0) * 100.0).round() as u8)
}

fn device_status(battery_percent: Option<u8>, charging: bool, pose_valid: bool) -> VrDeviceStatus {
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

fn short_device_label(model: Option<&str>, serial: Option<&str>, fallback: &str) -> String {
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
}
