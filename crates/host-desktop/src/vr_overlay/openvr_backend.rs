use std::collections::HashMap;
use std::time::{Duration, Instant};

use openvr::{
    overlay::OverlayHandle,
    property::{
        ControllerRoleHint_Int32, DeviceBatteryPercentage_Float, DeviceIsCharging_Bool,
        DeviceProvidesBatteryStatus_Bool, ModelNumber_String, SerialNumber_String,
        TrackingSystemName_String,
    },
    system::event::Event,
    tracked_device_index, ApplicationType, Context, ControllerState, Overlay, System,
    TrackedControllerRole, TrackedDeviceClass, TrackedDeviceIndex, TrackingUniverseOrigin,
    MAX_TRACKED_DEVICE_COUNT,
};
use vrcx_0_vr_overlay::{
    grab_follow_transform_facing, recenter_transform, OverlaySurfaceId, OverlayTransform,
    RgbaFrame, UvPoint, FRIENDS_PANEL_ID, MAIN_SURFACE_ID,
};

#[cfg(windows)]
use super::gpu_presenter::GpuPresenter;
use super::openvr_helpers::*;
use super::{
    actor::{OverlayBackend, TickOutcome},
    policy::WristVisibilityPolicy,
    types::{
        BackendStartError, OverlayActivationButton, OverlayHand, OverlayInputEvent,
        OverlayInputEventSink, OverlayInputKind, OverlayPlacement, OverlaySurfaceConfig,
        VrDeviceSnapshot,
    },
};

const WRIST_VISIBLE_FRAME_UPLOAD_INTERVAL: Duration = Duration::from_secs(2);
const MAIN_VISIBLE_FRAME_UPLOAD_INTERVAL: Duration = Duration::from_millis(100);
const INTERACTIVE_VISIBLE_FRAME_UPLOAD_INTERVAL: Duration = Duration::from_millis(16);
const SURFACE_FADE_DURATION: Duration = Duration::from_millis(240);
const DEFAULT_PANEL_RECENTER_DISTANCE_METERS: f32 = 1.0;
const DEFAULT_PANEL_RECENTER_VERTICAL_OFFSET_METERS: f32 = -0.1;
const SUMMON_HOLD_DURATION: Duration = Duration::from_secs(2);
const PANEL_SUMMON_HAND: OverlayHand = OverlayHand::Right;
const PANEL_SUMMON_PANEL_ID: &str = FRIENDS_PANEL_ID;
const FRIENDS_PANEL_INPUT_ENABLED: bool = false;

pub struct OpenVrOverlayBackend {
    context: Option<Context>,
    overlay: Option<Overlay>,
    system: Option<System>,
    surfaces: HashMap<OverlaySurfaceId, OpenVrSurface>,
    input_events: OverlayInputEventSink,
    panel_summon_state: PanelSummonGestureState,
    controller_states: HashMap<OverlayHand, ControllerInputState>,
    grab_state: Option<GrabState>,
    #[cfg(windows)]
    gpu: Option<GpuPresenter>,
    #[cfg(windows)]
    gpu_init_attempted: bool,
    #[cfg(windows)]
    gpu_retry_after_present_failure: bool,
}

struct OpenVrSurface {
    handle: OverlayHandle,
    config: OverlaySurfaceConfig,
    transform_device: Option<TrackedDeviceIndex>,
    policy: WristVisibilityPolicy,
    visible: bool,
    active: bool,
    pending_frame: Option<RgbaFrame>,
    last_uploaded_frame_fingerprint: Option<FrameFingerprint>,
    last_visible_frame_upload_at: Option<Instant>,
    current_alpha: f32,
    target_alpha: f32,
    fade: Option<SurfaceFade>,
    hide_after_fade: bool,
}

#[derive(Clone, Copy)]
struct SurfaceFade {
    from: f32,
    to: f32,
    started_at: Instant,
}

#[derive(Clone, Debug, Default)]
struct PanelSummonGestureState {
    pressed_since: Option<Instant>,
    emitted: bool,
}

#[derive(Clone, Debug, Default)]
struct ControllerInputState {
    trigger_pressed: bool,
    grip_pressed: bool,
    hovered_target: Option<InteractiveTarget>,
    hovered_uv: Option<UvPoint>,
    pressed_target: Option<InteractiveTarget>,
    pressed_uv: Option<UvPoint>,
    drag_scroll_last_uv: Option<UvPoint>,
    drag_scroll_remainder_y: f32,
    trigger_drag_scrolled: bool,
    last_scroll_at: Option<Instant>,
}

#[derive(Clone, Debug)]
struct GrabState {
    surface_id: OverlaySurfaceId,
    panel_id: String,
    hand: OverlayHand,
    uv: UvPoint,
    panel_start: OverlayTransform,
    controller_start: OverlayTransform,
}

#[derive(Clone)]
struct SurfaceUpdateCandidate {
    surface_id: OverlaySurfaceId,
    handle: OverlayHandle,
    config: OverlaySurfaceConfig,
    transform_device: Option<TrackedDeviceIndex>,
    policy: WristVisibilityPolicy,
}

struct ControllerTickInput {
    hand: OverlayHand,
    transform: OverlayTransform,
    state: ControllerState,
    grip_pressed: bool,
    hit: Option<InteractiveHit>,
}

struct PointerLaserState {
    transform: OverlayTransform,
    width_meters: f32,
}

impl OpenVrOverlayBackend {
    pub fn new() -> Self {
        Self {
            context: None,
            overlay: None,
            system: None,
            surfaces: HashMap::new(),
            input_events: OverlayInputEventSink::default(),
            panel_summon_state: PanelSummonGestureState::default(),
            controller_states: HashMap::new(),
            grab_state: None,
            #[cfg(windows)]
            gpu: None,
            #[cfg(windows)]
            gpu_init_attempted: false,
            #[cfg(windows)]
            gpu_retry_after_present_failure: true,
        }
    }
}

impl Default for OpenVrOverlayBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl OverlayBackend for OpenVrOverlayBackend {
    fn set_input_event_sink(&mut self, sink: OverlayInputEventSink) {
        self.input_events = sink;
    }

    fn start(&mut self) -> Result<(), BackendStartError> {
        if self.context.is_some() && self.overlay.is_some() && self.system.is_some() {
            return Ok(());
        }

        let context = unsafe { openvr::init(ApplicationType::Background) }
            .map_err(|error| init_start_error("OpenVR init failed", error))?;
        let overlay = context
            .overlay()
            .map_err(|error| init_start_error("OpenVR overlay interface failed", error))?;
        let system = context
            .system()
            .map_err(|error| init_start_error("OpenVR system interface failed", error))?;
        self.context = Some(context);
        self.overlay = Some(overlay);
        self.system = Some(system);
        #[cfg(windows)]
        self.ensure_gpu_presenter();
        Ok(())
    }

    fn register_surface(&mut self, config: OverlaySurfaceConfig) -> Result<(), String> {
        self.start().map_err(|error| error.message)?;
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
                policy: WristVisibilityPolicy::default(),
                visible: false,
                active: true,
                pending_frame: None,
                last_uploaded_frame_fingerprint: None,
                last_visible_frame_upload_at: None,
                current_alpha: 1.0,
                target_alpha: 1.0,
                fade: None,
                hide_after_fade: false,
            },
        );
        self.apply_config(&config)
    }

    fn update_frame(
        &mut self,
        surface_id: &OverlaySurfaceId,
        frame: RgbaFrame,
    ) -> Result<(), String> {
        let fingerprint = frame_fingerprint(&frame);
        let handle = {
            let surface = self.surfaces.get_mut(surface_id).ok_or_else(|| {
                format!(
                    "overlay surface '{}' is not registered",
                    surface_id.as_str()
                )
            })?;
            if surface.last_uploaded_frame_fingerprint == Some(fingerprint) {
                surface.pending_frame = None;
                return Ok(());
            }
            if surface.visible {
                let now = Instant::now();
                let can_upload = surface
                    .last_visible_frame_upload_at
                    .map(|last| {
                        now.saturating_duration_since(last)
                            >= visible_frame_upload_interval(surface)
                    })
                    .unwrap_or(true);
                if !can_upload {
                    surface.pending_frame = Some(frame);
                    return Ok(());
                }
                surface.pending_frame = None;
                surface.last_visible_frame_upload_at = Some(now);
                surface.handle
            } else {
                surface.pending_frame = Some(frame);
                return Ok(());
            }
        };

        if let Err(error) = self.upload_frame(surface_id, handle, &frame) {
            if let Some(surface) = self.surfaces.get_mut(surface_id) {
                surface.pending_frame = Some(frame);
                surface.last_visible_frame_upload_at = None;
            }
            return Err(error);
        }
        if let Some(surface) = self.surfaces.get_mut(surface_id) {
            surface.last_uploaded_frame_fingerprint = Some(fingerprint);
        }
        Ok(())
    }

    fn show(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        if surface_fades(surface_id) {
            return self.show_with_fade(surface_id);
        }
        self.set_visibility(surface_id, true)
    }

    fn hide(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        if surface_fades(surface_id) {
            return self.hide_with_fade(surface_id);
        }
        self.set_visibility(surface_id, false)
    }

    fn set_alpha(&mut self, surface_id: &OverlaySurfaceId, alpha: f32) -> Result<(), String> {
        let alpha = alpha.clamp(0.0, 1.0);
        let apply_now = {
            let surface = self.surfaces.get_mut(surface_id).ok_or_else(|| {
                format!(
                    "overlay surface '{}' is not registered",
                    surface_id.as_str()
                )
            })?;
            surface.target_alpha = alpha;
            match surface.fade.as_mut() {
                Some(fade) if !surface.hide_after_fade => {
                    fade.to = alpha;
                    false
                }
                Some(_) => false,
                None => true,
            }
        };
        if !apply_now {
            return Ok(());
        }
        self.apply_alpha(surface_id, alpha)
    }

    fn unregister_surface(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        if !self.surfaces.contains_key(surface_id) {
            return Ok(());
        }
        self.set_visibility(surface_id, false)?;
        #[cfg(windows)]
        if let Some(gpu) = self.gpu.as_mut() {
            gpu.unregister_surface(surface_id);
        }
        if let Some(surface) = self.surfaces.get_mut(surface_id) {
            surface.active = false;
            surface.policy.close();
        }
        Ok(())
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        self.start().map_err(|error| error.message)?;
        let system = self
            .system
            .as_ref()
            .ok_or_else(|| "OpenVR system interface is not started".to_string())?;
        Ok(snapshot_openvr_devices(system))
    }

    fn tick(&mut self) -> TickOutcome {
        if self.poll_runtime_quit() {
            self.clear_runtime_handles();
            return TickOutcome::RuntimeQuit;
        }
        if let Err(error) = self.update_button_visibility() {
            tracing::warn!(error = %error, "failed to update VR overlay button visibility");
        }
        if FRIENDS_PANEL_INPUT_ENABLED {
            if let Err(error) = self.update_interactive_input() {
                tracing::debug!(error = %error, "failed to update VR overlay input");
            }
        }
        if let Err(error) = self.advance_fades() {
            tracing::warn!(error = %error, "failed to advance VR overlay fade");
        }
        TickOutcome::Continue
    }

    fn stop(&mut self) {
        let surface_ids = self.surfaces.keys().cloned().collect::<Vec<_>>();
        for surface_id in surface_ids {
            let _ = self.set_visibility(&surface_id, false);
        }
        self.clear_runtime_handles();
        self.controller_states.clear();
        self.grab_state = None;
    }
}

fn surface_fades(surface_id: &OverlaySurfaceId) -> bool {
    surface_id.as_str() == MAIN_SURFACE_ID
}

fn surface_uses_wrist_policy(config: &OverlaySurfaceConfig) -> bool {
    if config.interactive {
        return false;
    }
    match &config.placement {
        OverlayPlacement::TrackedDeviceRelative { device_hint } => !device_hint.starts_with("hmd"),
        OverlayPlacement::Absolute { .. } => false,
    }
}

fn visible_frame_upload_interval(surface: &OpenVrSurface) -> Duration {
    if surface.config.interactive {
        INTERACTIVE_VISIBLE_FRAME_UPLOAD_INTERVAL
    } else if surface.config.surface_id.as_str() == MAIN_SURFACE_ID {
        MAIN_VISIBLE_FRAME_UPLOAD_INTERVAL
    } else {
        WRIST_VISIBLE_FRAME_UPLOAD_INTERVAL
    }
}

impl OpenVrOverlayBackend {
    fn poll_runtime_quit(&self) -> bool {
        let Some(system) = &self.system else {
            return false;
        };
        while let Some(info) = system.poll_next_event() {
            if let Event::Quit(_) = info.event {
                system.acknowledge_quit_exiting();
                return true;
            }
        }
        false
    }

    fn clear_runtime_handles(&mut self) {
        #[cfg(windows)]
        {
            self.gpu = None;
            self.gpu_init_attempted = false;
            self.gpu_retry_after_present_failure = true;
        }
        self.surfaces.clear();
        self.overlay = None;
        self.system = None;
        self.context = None;
    }

    fn update_button_visibility(&mut self) -> Result<(), String> {
        if self.surfaces.is_empty() {
            return Ok(());
        }
        let system = self
            .system
            .as_ref()
            .ok_or_else(|| "OpenVR system interface is not started".to_string())?;
        let candidates = self
            .surfaces
            .iter()
            .filter(|(_, surface)| surface.active && surface_uses_wrist_policy(&surface.config))
            .map(|(surface_id, surface)| SurfaceUpdateCandidate {
                surface_id: surface_id.clone(),
                handle: surface.handle,
                config: surface.config.clone(),
                transform_device: surface.transform_device,
                policy: surface.policy,
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
            let mut policy = candidate.policy;

            if let Ok(device) = resolve_device(system, &candidate.config.placement) {
                if transform_device != Some(device) {
                    overlay
                        .set_transform_tracked_device_relative(
                            candidate.handle,
                            device,
                            &surface_transform(&candidate.config.placement),
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
                if device_button_pressed(system, device, candidate.config.activation_button) {
                    policy.open(now);
                }
            }

            let visible = policy.evaluate(now, transform_device.is_some());
            surface_updates.push((candidate.surface_id.clone(), transform_device, policy));
            visibility_updates.push((candidate.surface_id, visible));
        }

        for (surface_id, transform_device, policy) in surface_updates {
            if let Some(surface) = self.surfaces.get_mut(&surface_id) {
                surface.transform_device = transform_device;
                surface.policy = policy;
            }
        }
        for (surface_id, visible) in visibility_updates {
            self.set_visibility(&surface_id, visible)?;
        }
        Ok(())
    }

    fn apply_config(&mut self, config: &OverlaySurfaceConfig) -> Result<(), String> {
        let system = self
            .system
            .as_ref()
            .ok_or_else(|| "OpenVR system interface is not started".to_string())?;
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

        if let OverlayPlacement::Absolute { transform } = config.placement {
            overlay
                .set_transform_absolute(
                    handle,
                    TrackingUniverseOrigin::Standing,
                    &overlay_transform_to_matrix(transform),
                )
                .map_err(|error| format!("set absolute overlay transform failed: {error:?}"))?;
            if let Some(surface) = self.surfaces.get_mut(&config.surface_id) {
                surface.transform_device = None;
            }
            return Ok(());
        }

        let transform_device = match resolve_device(system, &config.placement) {
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
                        &surface_transform(&config.placement),
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

    fn update_interactive_input(&mut self) -> Result<(), String> {
        let (has_interactive_surfaces, hmd_transform, inputs) = {
            let system = self
                .system
                .as_ref()
                .ok_or_else(|| "OpenVR system interface is not started".to_string())?;
            let poses =
                system.device_to_absolute_tracking_pose(TrackingUniverseOrigin::Standing, 0.0);
            let hmd_transform = pose_transform(&poses, tracked_device_index::HMD);
            update_panel_summon_events(
                system,
                &poses,
                &mut self.panel_summon_state,
                &self.input_events,
            );

            let interactive_surfaces = self
                .surfaces
                .iter()
                .filter(|(_, surface)| {
                    surface.active && surface.visible && surface.config.interactive
                })
                .filter_map(|(surface_id, surface)| {
                    let OverlayPlacement::Absolute { transform } = surface.config.placement else {
                        return None;
                    };
                    Some(InteractiveSurfaceCandidate {
                        surface_id: surface_id.clone(),
                        panel_id: panel_id_for_surface(surface_id),
                        quad_size: overlay_quad_size(&surface.config),
                        transform,
                    })
                })
                .collect::<Vec<_>>();

            if interactive_surfaces.is_empty() {
                (false, hmd_transform, Vec::new())
            } else {
                (
                    true,
                    hmd_transform,
                    [OverlayHand::Left, OverlayHand::Right]
                        .into_iter()
                        .filter_map(|hand| {
                            let device = controller_device_for_hand(system, hand)?;
                            let transform = pose_transform(&poses, device)?;
                            let state = system.controller_state(device)?;
                            let grip_pressed = grip_pressed(system, device, &state);
                            let hit = nearest_interactive_hit(transform, &interactive_surfaces);
                            Some(ControllerTickInput {
                                hand,
                                transform,
                                state,
                                grip_pressed,
                                hit,
                            })
                        })
                        .collect::<Vec<_>>(),
                )
            }
        };
        if let Err(error) =
            self.update_pointer_laser_surfaces(has_interactive_surfaces, hmd_transform, &inputs)
        {
            tracing::debug!(error = %error, "failed to update VR interactive pointer laser");
        }
        if !has_interactive_surfaces {
            self.clear_interactive_pointer_state();
            return Ok(());
        }

        for input in inputs {
            self.update_controller_edge_events(
                input.hand,
                input.transform,
                &input.state,
                input.grip_pressed,
                input.hit,
                hmd_transform,
            )?;
        }

        Ok(())
    }

    fn update_controller_edge_events(
        &mut self,
        hand: OverlayHand,
        controller_transform: OverlayTransform,
        state: &ControllerState,
        grip_pressed: bool,
        hit: Option<InteractiveHit>,
        hmd_transform: Option<OverlayTransform>,
    ) -> Result<(), String> {
        let trigger_pressed = trigger_pressed(state);
        let scroll_value = state.axis[0].y;
        let previous = self
            .controller_states
            .get(&hand)
            .cloned()
            .unwrap_or_default();
        let mut next = previous.clone();

        match &hit {
            Some(hit) => {
                if let Some(target) = previous
                    .hovered_target
                    .as_ref()
                    .filter(|target| !target.matches_hit(hit))
                {
                    self.input_events.push(target.event(
                        hand,
                        pointer_miss_uv(),
                        OverlayInputKind::Hover,
                    ));
                }
                if should_emit_hover(previous.hovered_target.as_ref(), previous.hovered_uv, hit) {
                    self.input_events
                        .push(hit.event(hand, OverlayInputKind::Hover));
                }
                next.hovered_target = Some(hit.target());
                next.hovered_uv = Some(hit.uv);
            }
            None => {
                if let Some(target) = previous.hovered_target.as_ref() {
                    self.input_events.push(target.event(
                        hand,
                        pointer_miss_uv(),
                        OverlayInputKind::Hover,
                    ));
                }
                next.hovered_target = None;
                next.hovered_uv = None;
            }
        }

        if let Some(hit) = hit.as_ref() {
            if trigger_pressed && !previous.trigger_pressed {
                self.input_events
                    .push(hit.event(hand, OverlayInputKind::ClickDown));
                next.pressed_target = Some(hit.target());
                next.pressed_uv = Some(hit.uv);
                next.drag_scroll_last_uv = Some(hit.uv);
                next.drag_scroll_remainder_y = 0.0;
                next.trigger_drag_scrolled = false;
            } else if trigger_pressed
                && previous.trigger_pressed
                && previous
                    .pressed_target
                    .as_ref()
                    .is_some_and(|target| target.matches_hit(hit))
            {
                let drag_scroll = trigger_drag_scroll_delta(
                    previous.drag_scroll_last_uv,
                    hit.uv,
                    previous.drag_scroll_remainder_y,
                );
                next.drag_scroll_last_uv = Some(hit.uv);
                next.drag_scroll_remainder_y = drag_scroll.remainder_y;
                if let Some(delta) = drag_scroll.delta {
                    if let (Some(target), Some(uv)) =
                        (previous.pressed_target.as_ref(), previous.pressed_uv)
                    {
                        self.input_events.push(target.event(
                            hand,
                            uv,
                            OverlayInputKind::Scroll { delta },
                        ));
                        next.trigger_drag_scrolled = true;
                    }
                }
            }
            let scroll_delta =
                scroll_delta_for_state(scroll_value, previous.last_scroll_at, Instant::now());
            next.last_scroll_at = scroll_delta.last_scroll_at;
            if let Some(delta) = scroll_delta.delta {
                self.input_events
                    .push(hit.event(hand, OverlayInputKind::Scroll { delta }));
            }
            if grip_pressed && !previous.grip_pressed {
                self.grab_state = Some(GrabState {
                    surface_id: hit.surface_id.clone(),
                    panel_id: hit.panel_id.clone(),
                    hand,
                    uv: hit.uv,
                    panel_start: hit.transform,
                    controller_start: controller_transform,
                });
                self.input_events
                    .push(hit.event(hand, OverlayInputKind::GrabStart));
            }
        }

        if !trigger_pressed && previous.trigger_pressed {
            let event = if previous.trigger_drag_scrolled {
                previous
                    .pressed_target
                    .as_ref()
                    .map(|target| target.event(hand, pointer_miss_uv(), OverlayInputKind::ClickUp))
            } else {
                click_up_event_for_release(hand, hit.as_ref(), previous.pressed_target.as_ref())
            };
            if let Some(event) = event {
                self.input_events.push(event);
            }
            next.pressed_target = None;
            next.pressed_uv = None;
            next.drag_scroll_last_uv = None;
            next.drag_scroll_remainder_y = 0.0;
            next.trigger_drag_scrolled = false;
        }

        if let Some(grab) = self.grab_state.clone().filter(|grab| grab.hand == hand) {
            if grip_pressed {
                let transform = grab_follow_transform_facing(
                    grab.panel_start,
                    grab.controller_start,
                    controller_transform,
                    hmd_transform,
                );
                self.apply_absolute_transform(&grab.surface_id, transform)?;
                self.input_events.push(OverlayInputEvent {
                    surface_id: grab.surface_id,
                    panel_id: grab.panel_id,
                    hand,
                    uv: grab.uv,
                    kind: OverlayInputKind::GrabMove { transform },
                });
            } else if previous.grip_pressed {
                let transform = grab_follow_transform_facing(
                    grab.panel_start,
                    grab.controller_start,
                    controller_transform,
                    hmd_transform,
                );
                self.apply_absolute_transform(&grab.surface_id, transform)?;
                self.input_events.push(OverlayInputEvent {
                    surface_id: grab.surface_id,
                    panel_id: grab.panel_id,
                    hand,
                    uv: grab.uv,
                    kind: OverlayInputKind::GrabEnd { transform },
                });
                self.grab_state = None;
            }
        }

        next.trigger_pressed = trigger_pressed;
        next.grip_pressed = grip_pressed;
        self.controller_states.insert(hand, next);
        Ok(())
    }

    fn clear_interactive_pointer_state(&mut self) {
        for state in self.controller_states.values_mut() {
            state.hovered_target = None;
            state.hovered_uv = None;
            state.pressed_target = None;
            state.pressed_uv = None;
            state.drag_scroll_last_uv = None;
            state.drag_scroll_remainder_y = 0.0;
            state.trigger_drag_scrolled = false;
            state.last_scroll_at = None;
        }
        self.grab_state = None;
    }

    fn update_pointer_laser_surfaces(
        &mut self,
        has_interactive_surfaces: bool,
        hmd_transform: Option<OverlayTransform>,
        inputs: &[ControllerTickInput],
    ) -> Result<(), String> {
        for hand in [OverlayHand::Left, OverlayHand::Right] {
            let surface_id = pointer_laser_surface_id_for_hand(hand);
            let Some(input) = inputs.iter().find(|input| input.hand == hand) else {
                self.hide_pointer_laser_surface(&surface_id)?;
                continue;
            };
            if !has_interactive_surfaces {
                self.hide_pointer_laser_surface(&surface_id)?;
                continue;
            }
            let state = pointer_laser_state(input, hmd_transform);
            self.apply_pointer_laser_surface(&surface_id, state)?;
        }
        Ok(())
    }

    fn hide_pointer_laser_surface(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        if !self.surfaces.contains_key(surface_id) {
            return Ok(());
        }
        self.set_visibility(surface_id, false)
    }

    fn apply_pointer_laser_surface(
        &mut self,
        surface_id: &OverlaySurfaceId,
        state: PointerLaserState,
    ) -> Result<(), String> {
        if !self.surfaces.contains_key(surface_id) {
            return Ok(());
        }
        let handle = self.surface_handle(surface_id)?;
        let overlay = self
            .overlay
            .as_mut()
            .ok_or_else(|| "OpenVR overlay is not started".to_string())?;
        overlay
            .set_width(handle, state.width_meters)
            .map_err(|error| format!("set laser overlay width failed: {error:?}"))?;
        overlay
            .set_transform_absolute(
                handle,
                TrackingUniverseOrigin::Standing,
                &overlay_transform_to_matrix(state.transform),
            )
            .map_err(|error| format!("set laser overlay transform failed: {error:?}"))?;
        if let Some(surface) = self.surfaces.get_mut(surface_id) {
            surface.config.physical_width_meters = state.width_meters;
            surface.config.placement = OverlayPlacement::Absolute {
                transform: state.transform,
            };
            surface.transform_device = None;
        }
        self.set_visibility(surface_id, true)
    }

    fn apply_absolute_transform(
        &mut self,
        surface_id: &OverlaySurfaceId,
        transform: OverlayTransform,
    ) -> Result<(), String> {
        let handle = self.surface_handle(surface_id)?;
        let overlay = self
            .overlay
            .as_mut()
            .ok_or_else(|| "OpenVR overlay is not started".to_string())?;
        overlay
            .set_transform_absolute(
                handle,
                TrackingUniverseOrigin::Standing,
                &overlay_transform_to_matrix(transform),
            )
            .map_err(|error| format!("set absolute overlay transform failed: {error:?}"))?;
        if let Some(surface) = self.surfaces.get_mut(surface_id) {
            surface.config.placement = OverlayPlacement::Absolute { transform };
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
            let fingerprint = frame_fingerprint(&frame);
            if let Err(error) = self.upload_frame(surface_id, handle, &frame) {
                if let Some(surface) = self.surfaces.get_mut(surface_id) {
                    surface.pending_frame = Some(frame);
                }
                return Err(error);
            }
            if let Some(surface) = self.surfaces.get_mut(surface_id) {
                surface.last_uploaded_frame_fingerprint = Some(fingerprint);
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
            if let Some(surface) = self.surfaces.get_mut(surface_id) {
                surface.last_visible_frame_upload_at = None;
            }
        }
        Ok(())
    }

    fn show_with_fade(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        let (already_visible, target_alpha) = {
            let surface = self.surfaces.get(surface_id).ok_or_else(|| {
                format!(
                    "overlay surface '{}' is not registered",
                    surface_id.as_str()
                )
            })?;
            (
                surface.visible && !surface.hide_after_fade,
                surface.target_alpha,
            )
        };
        if already_visible {
            return Ok(());
        }
        self.apply_alpha(surface_id, 0.0)?;
        self.set_visibility(surface_id, true)?;
        if let Some(surface) = self.surfaces.get_mut(surface_id) {
            surface.hide_after_fade = false;
            surface.fade = Some(SurfaceFade {
                from: surface.current_alpha,
                to: target_alpha,
                started_at: Instant::now(),
            });
        }
        Ok(())
    }

    fn hide_with_fade(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        let surface = self.surfaces.get_mut(surface_id).ok_or_else(|| {
            format!(
                "overlay surface '{}' is not registered",
                surface_id.as_str()
            )
        })?;
        if !surface.visible || surface.hide_after_fade {
            return Ok(());
        }
        surface.hide_after_fade = true;
        surface.fade = Some(SurfaceFade {
            from: surface.current_alpha,
            to: 0.0,
            started_at: Instant::now(),
        });
        Ok(())
    }

    fn advance_fades(&mut self) -> Result<(), String> {
        let now = Instant::now();
        let mut alpha_updates = Vec::new();
        let mut hide_updates = Vec::new();
        for (surface_id, surface) in &mut self.surfaces {
            let Some(fade) = surface.fade else {
                continue;
            };
            let progress = (now.saturating_duration_since(fade.started_at).as_secs_f32()
                / SURFACE_FADE_DURATION.as_secs_f32())
            .clamp(0.0, 1.0);
            let alpha = fade.from + (fade.to - fade.from) * progress;
            alpha_updates.push((surface_id.clone(), alpha));
            if progress >= 1.0 {
                surface.fade = None;
                if surface.hide_after_fade {
                    surface.hide_after_fade = false;
                    hide_updates.push(surface_id.clone());
                }
            }
        }
        for (surface_id, alpha) in alpha_updates {
            self.apply_alpha(&surface_id, alpha)?;
        }
        for surface_id in hide_updates {
            self.set_visibility(&surface_id, false)?;
        }
        Ok(())
    }

    fn apply_alpha(&mut self, surface_id: &OverlaySurfaceId, alpha: f32) -> Result<(), String> {
        let handle = self.surface_handle(surface_id)?;
        let overlay = self
            .overlay
            .as_mut()
            .ok_or_else(|| "OpenVR overlay is not started".to_string())?;
        overlay
            .set_opacity(handle, alpha)
            .map_err(|error| format!("set overlay alpha failed: {error:?}"))?;
        if let Some(surface) = self.surfaces.get_mut(surface_id) {
            surface.current_alpha = alpha;
        }
        Ok(())
    }

    fn upload_frame(
        &mut self,
        surface_id: &OverlaySurfaceId,
        handle: OverlayHandle,
        frame: &RgbaFrame,
    ) -> Result<(), String> {
        #[cfg(not(windows))]
        let _ = surface_id;

        #[cfg(windows)]
        {
            self.ensure_gpu_presenter();
            if let Some(gpu) = self.gpu.as_mut() {
                match gpu.present(surface_id, handle, frame) {
                    Ok(()) => return Ok(()),
                    Err(error) => {
                        tracing::warn!(
                            error = %error,
                            "VR overlay GPU presenter failed; falling back to SetOverlayRaw"
                        );
                        self.gpu = None;
                        if self.gpu_retry_after_present_failure {
                            self.gpu_retry_after_present_failure = false;
                            self.gpu_init_attempted = false;
                        } else {
                            self.gpu_init_attempted = true;
                        }
                    }
                }
            }
        }
        let overlay = self
            .overlay
            .as_mut()
            .ok_or_else(|| "OpenVR overlay is not started".to_string())?;
        upload_raw_frame(overlay, handle, frame)
    }

    #[cfg(windows)]
    fn ensure_gpu_presenter(&mut self) {
        if self.gpu.is_some() || self.gpu_init_attempted {
            return;
        }
        self.gpu_init_attempted = true;
        match GpuPresenter::new() {
            Ok(gpu) => {
                self.gpu = Some(gpu);
            }
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    "VR overlay GPU presenter unavailable; using SetOverlayRaw fallback"
                );
            }
        }
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

fn init_start_error(context: &str, error: openvr::InitError) -> BackendStartError {
    let message = format!("{context}: {error:?}");
    let permanent = matches!(
        error,
        openvr::InitError::Init_InterfaceNotFound
            | openvr::InitError::Init_InvalidInterface
            | openvr::InitError::Init_InstallationNotFound
            | openvr::InitError::Init_InstallationCorrupt
            | openvr::InitError::Init_VRClientDLLNotFound
            | openvr::InitError::Init_FactoryNotFound
            | openvr::InitError::Init_PathRegistryNotFound
    );
    if permanent {
        BackendStartError::permanent(message)
    } else {
        BackendStartError::transient(message)
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

fn update_panel_summon_events(
    system: &openvr::System,
    poses: &openvr::TrackedDevicePoses,
    state: &mut PanelSummonGestureState,
    input_events: &OverlayInputEventSink,
) {
    let Some(hmd_transform) = pose_transform(poses, tracked_device_index::HMD) else {
        return;
    };
    let now = Instant::now();
    let pressed = panel_summon_grip_pressed(system);
    if !update_panel_summon_hold(state, pressed, now) {
        return;
    }
    let transform = recenter_transform(
        hmd_transform,
        DEFAULT_PANEL_RECENTER_DISTANCE_METERS,
        DEFAULT_PANEL_RECENTER_VERTICAL_OFFSET_METERS,
    );
    input_events.push(OverlayInputEvent {
        surface_id: surface_id_for_panel_id(PANEL_SUMMON_PANEL_ID),
        panel_id: PANEL_SUMMON_PANEL_ID.to_string(),
        hand: PANEL_SUMMON_HAND,
        uv: UvPoint::new(0.5, 0.5),
        kind: OverlayInputKind::Summon { transform },
    });
}

fn panel_summon_grip_pressed(system: &openvr::System) -> bool {
    let Some(device) = controller_device_for_hand(system, PANEL_SUMMON_HAND) else {
        return false;
    };
    let Some(controller_state) = system.controller_state(device) else {
        return false;
    };
    let tracking_system_name = string_property(system, device, TrackingSystemName_String);
    grip_pressed_for_state(&controller_state, tracking_system_name.as_deref())
}

fn update_panel_summon_hold(
    state: &mut PanelSummonGestureState,
    pressed: bool,
    now: Instant,
) -> bool {
    if !pressed {
        state.pressed_since = None;
        state.emitted = false;
        return false;
    }
    let pressed_since = *state.pressed_since.get_or_insert(now);
    if state.emitted || now.saturating_duration_since(pressed_since) < SUMMON_HOLD_DURATION {
        return false;
    }
    state.emitted = true;
    true
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
                value if value.starts_with("hmd:") => return Ok(tracked_device_index::HMD),
                _ => return Err(format!("unknown tracked device hint '{device_hint}'")),
            };
            resolve_controller_device(system, role.unwrap())
                .ok_or_else(|| tracked_device_unavailable_error(system, device_hint))
        }
        OverlayPlacement::Absolute { .. } => {
            Err("absolute overlay placement is not tracked-device relative".to_string())
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

fn controller_device_for_hand(
    system: &openvr::System,
    hand: OverlayHand,
) -> Option<TrackedDeviceIndex> {
    let role = match hand {
        OverlayHand::Left => TrackedControllerRole::LeftHand,
        OverlayHand::Right => TrackedControllerRole::RightHand,
    };
    resolve_controller_device(system, role)
}

fn pointer_laser_state(
    input: &ControllerTickInput,
    hmd_transform: Option<OverlayTransform>,
) -> PointerLaserState {
    let width_meters = pointer_laser_width(input.hit.as_ref());
    PointerLaserState {
        transform: pointer_laser_transform(input.transform, hmd_transform, width_meters),
        width_meters,
    }
}

fn grip_pressed(
    system: &openvr::System,
    device: TrackedDeviceIndex,
    state: &ControllerState,
) -> bool {
    let tracking_system_name = string_property(system, device, TrackingSystemName_String);
    grip_pressed_for_state(state, tracking_system_name.as_deref())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_summon_uses_fixed_right_hand_friends_grip_hold() {
        assert_eq!(PANEL_SUMMON_HAND, OverlayHand::Right);
        assert_eq!(PANEL_SUMMON_PANEL_ID, FRIENDS_PANEL_ID);
        assert_eq!(SUMMON_HOLD_DURATION, Duration::from_secs(2));
    }

    #[test]
    fn friends_panel_input_path_is_disabled_by_default() {
        assert!(!FRIENDS_PANEL_INPUT_ENABLED);
    }

    #[test]
    fn panel_summon_hold_emits_once_and_resets_after_release() {
        let started = Instant::now();
        let mut state = PanelSummonGestureState::default();

        assert!(!update_panel_summon_hold(&mut state, false, started));
        assert!(!update_panel_summon_hold(&mut state, true, started));
        assert!(!update_panel_summon_hold(
            &mut state,
            true,
            started + SUMMON_HOLD_DURATION - Duration::from_millis(1)
        ));
        assert!(update_panel_summon_hold(
            &mut state,
            true,
            started + SUMMON_HOLD_DURATION
        ));
        assert!(!update_panel_summon_hold(
            &mut state,
            true,
            started + SUMMON_HOLD_DURATION + Duration::from_secs(1)
        ));

        assert!(!update_panel_summon_hold(
            &mut state,
            false,
            started + SUMMON_HOLD_DURATION + Duration::from_secs(2)
        ));
        let restarted = started + SUMMON_HOLD_DURATION + Duration::from_secs(3);
        assert!(!update_panel_summon_hold(&mut state, true, restarted));
        assert!(update_panel_summon_hold(
            &mut state,
            true,
            restarted + SUMMON_HOLD_DURATION
        ));
    }
}
