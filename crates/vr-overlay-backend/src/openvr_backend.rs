use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use openvr::{
    button_id,
    overlay::OverlayHandle,
    property::{
        ControllerRoleHint_Int32, ModelNumber_String, SerialNumber_String,
        TrackingSystemName_String,
    },
    system::event::{Event, EventInfo},
    tracked_device_index, ApplicationType, Context, Overlay, System, TrackedControllerRole,
    TrackedDeviceClass, TrackedDeviceIndex, MAX_TRACKED_DEVICE_COUNT,
};
use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame, MAIN_SURFACE_ID};

use super::openvr_helpers::{
    frame_fingerprint, load_overlay_fn_table, overlay_button_mask, set_overlay_premultiplied_alpha,
    surface_transform, FrameFingerprint,
};
use super::{
    actor::{OverlayBackend, TickOutcome},
    policy::WristVisibilityPolicy,
    types::{
        BackendStartError, OverlayActivationButton, OverlayPlacement, OverlaySurfaceConfig,
        VrDeviceSnapshot,
    },
};
use openvr_devices::{snapshot_openvr_devices, string_property, BatteryReadingState};

const WRIST_VISIBLE_FRAME_UPLOAD_INTERVAL: Duration = Duration::from_secs(1);
const MAIN_VISIBLE_FRAME_UPLOAD_INTERVAL: Duration = Duration::from_millis(16);
const SURFACE_FADE_DURATION: Duration = Duration::from_millis(240);
const OPENVR_CONTEXT_IN_USE_MESSAGE: &str =
    "OpenVR context is still owned by another overlay actor";
static OPENVR_CONTEXT_OWNED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, PartialEq, Eq)]
enum TrackedDeviceResolutionError {
    UnknownHint {
        device_hint: String,
    },
    Unavailable {
        device_hint: String,
        left: String,
        right: String,
        connected: String,
    },
}

impl std::fmt::Display for TrackedDeviceResolutionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownHint { device_hint } => {
                write!(formatter, "unknown tracked device hint '{device_hint}'")
            }
            Self::Unavailable {
                device_hint,
                left,
                right,
                connected,
            } => write!(
                formatter,
                "tracked device '{device_hint}' is unavailable; controller_roles={{left:{left}, right:{right}}}; connected_devices=[{connected}]"
            ),
        }
    }
}

type PollNextOverlayEvent =
    unsafe extern "C" fn(openvr_sys::VROverlayHandle_t, *mut openvr_sys::VREvent_t, u32) -> bool;

mod openvr_devices;

pub struct OpenVrOverlayBackend {
    context: Option<Context>,
    context_lease: Option<OpenVrContextLease>,
    overlay: Option<Overlay>,
    poll_next_overlay_event: Option<PollNextOverlayEvent>,
    system: Option<System>,
    surfaces: HashMap<OverlaySurfaceId, OpenVrSurface>,
    hmd_battery_readings: HashMap<String, BatteryReadingState>,
    hmd_user_present: Option<bool>,
    outstanding_raw_frames: u64,
}

#[derive(Debug)]
struct OpenVrContextLease;

impl OpenVrContextLease {
    fn acquire() -> Result<Self, BackendStartError> {
        OPENVR_CONTEXT_OWNED
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| BackendStartError::transient(OPENVR_CONTEXT_IN_USE_MESSAGE))
    }
}

impl Drop for OpenVrContextLease {
    fn drop(&mut self) {
        OPENVR_CONTEXT_OWNED.store(false, Ordering::Release);
    }
}

struct OpenVrSurface {
    handles: [OverlayHandle; 2],
    front: usize,
    back_loading: bool,
    config: OverlaySurfaceConfig,
    transform_device: Option<TrackedDeviceIndex>,
    policy: WristVisibilityPolicy,
    visible: bool,
    active: bool,
    pending_frame: Option<PendingFrame>,
    last_uploaded_frame_fingerprint: Option<FrameFingerprint>,
    last_visible_frame_upload_at: Option<Instant>,
    current_alpha: f32,
    target_alpha: f32,
    fade: Option<SurfaceFade>,
    hide_after_fade: bool,
}

struct PendingFrame {
    frame: RgbaFrame,
    fingerprint: FrameFingerprint,
}

impl OpenVrSurface {
    fn front_handle(&self) -> OverlayHandle {
        self.handles[self.front]
    }

    fn back_handle(&self) -> OverlayHandle {
        self.handles[1 - self.front]
    }

    fn take_pending_frame_if_due(&mut self, now: Instant) -> Option<(OverlayHandle, PendingFrame)> {
        if !self.visible || self.back_loading {
            return None;
        }
        if self.last_visible_frame_upload_at.is_some_and(|last| {
            now.saturating_duration_since(last) < visible_frame_upload_interval(self)
        }) {
            return None;
        }
        let pending_frame = self.pending_frame.take()?;
        self.last_visible_frame_upload_at = Some(now);
        Some((self.back_handle(), pending_frame))
    }
}

#[derive(Clone, Copy)]
struct SurfaceFade {
    from: f32,
    to: f32,
    started_at: Instant,
}

#[derive(Clone)]
struct SurfaceUpdateCandidate {
    surface_id: OverlaySurfaceId,
    handles: [OverlayHandle; 2],
    config: OverlaySurfaceConfig,
    transform_device: Option<TrackedDeviceIndex>,
    policy: WristVisibilityPolicy,
}

impl OpenVrOverlayBackend {
    pub fn new() -> Self {
        Self {
            context: None,
            context_lease: None,
            overlay: None,
            poll_next_overlay_event: None,
            system: None,
            surfaces: HashMap::new(),
            hmd_battery_readings: HashMap::new(),
            hmd_user_present: None,
            outstanding_raw_frames: 0,
        }
    }
}

impl Default for OpenVrOverlayBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl OverlayBackend for OpenVrOverlayBackend {
    fn needs_high_frequency_tick(&self) -> bool {
        self.outstanding_raw_frames > 0
            || self.surfaces.values().any(|surface| {
                surface.visible
                    && surface.pending_frame.is_some()
                    && visible_frame_upload_interval(surface) <= MAIN_VISIBLE_FRAME_UPLOAD_INTERVAL
            })
    }

    fn start(&mut self) -> Result<(), BackendStartError> {
        if self.context.is_some()
            && self.overlay.is_some()
            && self.poll_next_overlay_event.is_some()
            && self.system.is_some()
        {
            return Ok(());
        }

        let context_lease = OpenVrContextLease::acquire()?;
        let context = unsafe { openvr::init(ApplicationType::Background) }
            .map_err(|error| init_start_error("OpenVR init failed", error))?;
        let overlay = context
            .overlay()
            .map_err(|error| init_start_error("OpenVR overlay interface failed", error))?;
        let system = context
            .system()
            .map_err(|error| init_start_error("OpenVR system interface failed", error))?;
        let poll_next_overlay_event = load_overlay_fn_table()
            .map_err(BackendStartError::permanent)?
            .PollNextOverlayEvent
            .ok_or_else(|| {
                BackendStartError::permanent("OpenVR PollNextOverlayEvent is unavailable")
            })?;
        self.context = Some(context);
        self.context_lease = Some(context_lease);
        self.overlay = Some(overlay);
        self.poll_next_overlay_event = Some(poll_next_overlay_event);
        self.system = Some(system);
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
        let mut handles = [OverlayHandle(0); 2];
        for (slot, handle) in handles.iter_mut().enumerate() {
            *handle = overlay
                .create_overlay(
                    &format!("vrcx.{}.{slot}\0", config.surface_id.as_str()),
                    &format!("VRCX {} Overlay\0", config.surface_id.as_str()),
                )
                .map_err(|error| format!("create overlay failed: {error:?}"))?;
            set_overlay_premultiplied_alpha(*handle)?;
        }
        self.surfaces.insert(
            surface_id,
            OpenVrSurface {
                handles,
                front: 0,
                back_loading: false,
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
        let pending = {
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
            surface.pending_frame = Some(PendingFrame { frame, fingerprint });
            surface.take_pending_frame_if_due(Instant::now())
        };
        let Some((handle, pending_frame)) = pending else {
            return Ok(());
        };
        self.upload_to_back(surface_id, handle, pending_frame)
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
        Ok(snapshot_openvr_devices(
            system,
            &mut self.hmd_battery_readings,
        ))
    }

    fn hmd_user_present(&self) -> Option<bool> {
        self.hmd_user_present
    }

    fn visible_surface_ids(&self) -> Vec<OverlaySurfaceId> {
        self.surfaces
            .iter()
            .filter(|(_, surface)| surface.visible)
            .map(|(surface_id, _)| surface_id.clone())
            .collect()
    }

    fn tick(&mut self) -> TickOutcome {
        if self.poll_runtime_quit() || self.poll_overlay_events() {
            self.clear_runtime_handles();
            return TickOutcome::RuntimeQuit;
        }
        self.refresh_hmd_user_present();
        if let Err(error) = self.update_button_visibility() {
            tracing::warn!(error = %error, "failed to update VR overlay button visibility");
        }
        if let Err(error) = self.advance_fades() {
            tracing::warn!(error = %error, "failed to advance VR overlay fade");
        }
        if let Err(error) = self.flush_pending_frames(Instant::now()) {
            tracing::warn!(error = %error, "failed to flush pending VR overlay frame");
        }
        TickOutcome::Continue
    }

    fn stop(&mut self) {
        let surface_ids = self.surfaces.keys().cloned().collect::<Vec<_>>();
        for surface_id in surface_ids {
            let _ = self.set_visibility(&surface_id, false);
        }
        self.clear_runtime_handles();
    }
}

fn surface_fades(surface_id: &OverlaySurfaceId) -> bool {
    surface_id.as_str() == MAIN_SURFACE_ID
}

fn surface_uses_wrist_policy(config: &OverlaySurfaceConfig) -> bool {
    matches!(
        config.placement,
        OverlayPlacement::TrackedDeviceRelative { .. }
    )
}

fn visible_frame_upload_interval(surface: &OpenVrSurface) -> Duration {
    if surface.config.surface_id.as_str() == MAIN_SURFACE_ID {
        MAIN_VISIBLE_FRAME_UPLOAD_INTERVAL
    } else {
        WRIST_VISIBLE_FRAME_UPLOAD_INTERVAL
    }
}

impl OpenVrOverlayBackend {
    fn refresh_hmd_user_present(&mut self) {
        let Some(state) = self
            .system
            .as_ref()
            .and_then(|system| system.controller_state(tracked_device_index::HMD))
        else {
            return;
        };
        self.hmd_user_present =
            Some(state.button_pressed & (1u64 << button_id::PROXIMITY_SENSOR) != 0);
    }

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

    fn poll_overlay_events(&mut self) -> bool {
        let Some(poll_next_overlay_event) = self.poll_next_overlay_event else {
            return false;
        };
        let surfaces = self
            .surfaces
            .iter()
            .flat_map(|(surface_id, surface)| {
                surface.handles.map(|handle| (surface_id.clone(), handle))
            })
            .collect::<Vec<_>>();
        for (surface_id, handle) in surfaces {
            loop {
                let mut event = std::mem::MaybeUninit::<openvr_sys::VREvent_t>::uninit();
                let has_event = unsafe {
                    poll_next_overlay_event(
                        handle.0,
                        event.as_mut_ptr(),
                        std::mem::size_of::<openvr_sys::VREvent_t>() as u32,
                    )
                };
                if !has_event {
                    break;
                }
                let event = EventInfo::from(unsafe { event.assume_init() });
                if self.handle_overlay_event(&surface_id, handle, event) {
                    if let Some(system) = &self.system {
                        system.acknowledge_quit_exiting();
                    }
                    return true;
                }
            }
        }
        false
    }

    fn handle_overlay_event(
        &mut self,
        surface_id: &OverlaySurfaceId,
        handle: OverlayHandle,
        event: EventInfo,
    ) -> bool {
        let loading_back = self
            .surfaces
            .get(surface_id)
            .is_some_and(|surface| surface.back_loading && surface.back_handle() == handle);
        match event.event {
            Event::ImageLoaded => {
                self.outstanding_raw_frames = self.outstanding_raw_frames.saturating_sub(1);
                if loading_back {
                    if let Err(error) = self.swap_loaded_back(surface_id) {
                        tracing::warn!(
                            error = %error,
                            surface_id = surface_id.as_str(),
                            "failed to swap VR overlay buffers"
                        );
                    }
                }
                false
            }
            Event::ImageFailed => {
                self.outstanding_raw_frames = self.outstanding_raw_frames.saturating_sub(1);
                if loading_back {
                    if let Some(surface) = self.surfaces.get_mut(surface_id) {
                        surface.back_loading = false;
                    }
                }
                tracing::warn!(
                    surface_id = surface_id.as_str(),
                    event_age_seconds = event.age,
                    outstanding_raw_frames = self.outstanding_raw_frames,
                    "SteamVR failed to load raw overlay frame"
                );
                false
            }
            Event::Quit(_) => true,
            _ => false,
        }
    }

    fn clear_runtime_handles(&mut self) {
        self.surfaces.clear();
        self.hmd_battery_readings.clear();
        self.hmd_user_present = None;
        self.overlay = None;
        self.poll_next_overlay_event = None;
        self.system = None;
        self.context = None;
        self.context_lease = None;
        self.outstanding_raw_frames = 0;
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
                handles: surface.handles,
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
                    for handle in candidate.handles {
                        overlay
                            .set_transform_tracked_device_relative(
                                handle,
                                device,
                                &surface_transform(&candidate.config.placement),
                            )
                            .map_err(|error| format!("set overlay transform failed: {error:?}"))?;
                    }
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

            let device_present = transform_device.is_some();
            let visible = policy.evaluate(now, device_present)
                || (candidate.config.force_visible && device_present);
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
        let handles = self.surface_handles(&config.surface_id)?;
        let overlay = self
            .overlay
            .as_mut()
            .ok_or_else(|| "OpenVR overlay is not started".to_string())?;

        for handle in handles {
            overlay
                .set_width(handle, config.physical_width_meters)
                .map_err(|error| format!("set overlay width failed: {error:?}"))?;
            overlay
                .set_texel_aspect(handle, 1.0)
                .map_err(|error| format!("set overlay texel aspect failed: {error:?}"))?;
        }

        let transform_device = match resolve_device(system, &config.placement) {
            Ok(device) => {
                tracing::debug!(
                    surface_id = config.surface_id.as_str(),
                    device_index = device.0,
                    placement = ?config.placement,
                    "resolved VR overlay tracked device"
                );
                for handle in handles {
                    overlay
                        .set_transform_tracked_device_relative(
                            handle,
                            device,
                            &surface_transform(&config.placement),
                        )
                        .map_err(|error| format!("set overlay transform failed: {error:?}"))?;
                }
                Some(device)
            }
            Err(error @ TrackedDeviceResolutionError::Unavailable { .. }) => {
                tracing::warn!(
                    error = %error,
                    surface_id = config.surface_id.as_str(),
                    "VR overlay surface will wait for tracked device"
                );
                None
            }
            Err(error) => return Err(error.to_string()),
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
        let (handle, back_handle, current_visible, pending_before_show) = {
            let surface = self.surfaces.get_mut(surface_id).ok_or_else(|| {
                format!(
                    "overlay surface '{}' is not registered",
                    surface_id.as_str()
                )
            })?;
            (
                surface.front_handle(),
                surface.back_handle(),
                surface.visible,
                if visible && !surface.visible && !surface.back_loading {
                    surface.pending_frame.take()
                } else {
                    None
                },
            )
        };
        if current_visible == visible {
            return Ok(());
        }
        if let Some(pending_frame) = pending_before_show {
            self.upload_to_back(surface_id, back_handle, pending_frame)?;
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
        let handles = self.surface_handles(surface_id)?;
        let overlay = self
            .overlay
            .as_mut()
            .ok_or_else(|| "OpenVR overlay is not started".to_string())?;
        for handle in handles {
            overlay
                .set_opacity(handle, alpha)
                .map_err(|error| format!("set overlay alpha failed: {error:?}"))?;
        }
        if let Some(surface) = self.surfaces.get_mut(surface_id) {
            surface.current_alpha = alpha;
        }
        Ok(())
    }

    fn upload_frame(&mut self, handle: OverlayHandle, frame: &RgbaFrame) -> Result<(), String> {
        validate_frame(frame)?;
        let overlay = self
            .overlay
            .as_mut()
            .ok_or_else(|| "OpenVR overlay is not started".to_string())?;
        overlay
            .set_raw_data(
                handle,
                &frame.data,
                frame.size.width as usize,
                frame.size.height as usize,
                4,
            )
            .map_err(|error| format!("set raw overlay data failed: {error:?}"))?;
        self.outstanding_raw_frames = self.outstanding_raw_frames.saturating_add(1);
        Ok(())
    }

    fn flush_pending_frames(&mut self, now: Instant) -> Result<(), String> {
        let surface_ids = self.surfaces.keys().cloned().collect::<Vec<_>>();
        for surface_id in surface_ids {
            let pending = self
                .surfaces
                .get_mut(&surface_id)
                .and_then(|surface| surface.take_pending_frame_if_due(now));
            let Some((handle, pending_frame)) = pending else {
                continue;
            };
            self.upload_to_back(&surface_id, handle, pending_frame)?;
        }
        Ok(())
    }

    fn upload_to_back(
        &mut self,
        surface_id: &OverlaySurfaceId,
        handle: OverlayHandle,
        pending_frame: PendingFrame,
    ) -> Result<(), String> {
        let uploaded = self.upload_frame(handle, &pending_frame.frame);
        if let Some(surface) = self.surfaces.get_mut(surface_id) {
            match uploaded {
                Ok(()) => {
                    surface.back_loading = true;
                    surface.last_uploaded_frame_fingerprint = Some(pending_frame.fingerprint);
                }
                Err(_) => {
                    surface.pending_frame = Some(pending_frame);
                    surface.last_visible_frame_upload_at = None;
                }
            }
        }
        uploaded
    }

    fn swap_loaded_back(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        let Some(surface) = self.surfaces.get_mut(surface_id) else {
            return Ok(());
        };
        surface.back_loading = false;
        let (back, front, visible) = (
            surface.back_handle(),
            surface.front_handle(),
            surface.visible,
        );
        surface.front = 1 - surface.front;
        if !visible {
            return Ok(());
        }
        let overlay = self
            .overlay
            .as_mut()
            .ok_or_else(|| "OpenVR overlay is not started".to_string())?;
        overlay
            .set_visibility(back, true)
            .map_err(|error| format!("set overlay visibility failed: {error:?}"))?;
        overlay
            .set_visibility(front, false)
            .map_err(|error| format!("set overlay visibility failed: {error:?}"))
    }

    fn surface_handles(&self, surface_id: &OverlaySurfaceId) -> Result<[OverlayHandle; 2], String> {
        self.surfaces
            .get(surface_id)
            .map(|surface| surface.handles)
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
    if error == openvr::InitError::Init_NoServerForBackgroundApp {
        return BackendStartError::runtime_unavailable(message);
    }
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

fn validate_frame(frame: &RgbaFrame) -> Result<(), String> {
    let expected_len = RgbaFrame::expected_byte_len(frame.size)
        .ok_or_else(|| "overlay frame byte length overflow".to_string())?;
    if frame.data.len() == expected_len {
        Ok(())
    } else {
        Err(format!(
            "overlay frame byte length mismatch: got {}, expected {expected_len}",
            frame.data.len()
        ))
    }
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

fn resolve_device(
    system: &openvr::System,
    placement: &OverlayPlacement,
) -> Result<TrackedDeviceIndex, TrackedDeviceResolutionError> {
    match placement {
        OverlayPlacement::TrackedDeviceRelative { device_hint } => {
            let role = match device_hint.as_str() {
                "right-hand" => Some(TrackedControllerRole::RightHand),
                "left-hand" => Some(TrackedControllerRole::LeftHand),
                _ => {
                    return Err(TrackedDeviceResolutionError::UnknownHint {
                        device_hint: device_hint.clone(),
                    })
                }
            };
            resolve_controller_device(system, role.unwrap())
                .ok_or_else(|| tracked_device_unavailable_error(system, device_hint))
        }
        OverlayPlacement::HeadLocked { .. } => Ok(tracked_device_index::HMD),
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

fn tracked_device_unavailable_error(
    system: &openvr::System,
    device_hint: &str,
) -> TrackedDeviceResolutionError {
    let left = controller_role_index(system, TrackedControllerRole::LeftHand);
    let right = controller_role_index(system, TrackedControllerRole::RightHand);
    let connected = tracked_device_diagnostics(system);
    TrackedDeviceResolutionError::Unavailable {
        device_hint: device_hint.to_string(),
        left,
        right,
        connected,
    }
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

#[cfg(test)]
mod tests;
