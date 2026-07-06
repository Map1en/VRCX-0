use std::collections::HashMap;
use std::time::{Duration, Instant};

use vrcx_0_host::vr_overlay::{
    OverlayActorHandle, OverlayCommandError, OverlayInputEvent, OverlayServiceCommand,
    OverlayServicePhase, OverlaySurfaceConfig, VrDeviceSnapshot,
};
use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame};

const RUNTIME_QUIT_RESTART_COOLDOWN: Duration = Duration::from_secs(10);
const PREVIOUS_START_IN_FLIGHT_MESSAGE: &str = "previous overlay start attempt is still in flight";
const PREVIOUS_BACKEND_NOT_RESPONDING_MESSAGE: &str = "previous overlay backend is not responding";
const CONDEMNED_REPROBE_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OverlayServiceStartError {
    pub message: String,
    pub permanent: bool,
}

impl OverlayServiceStartError {
    pub fn transient(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            permanent: false,
        }
    }

    pub fn permanent(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            permanent: true,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum OverlayBackendPreference {
    #[default]
    Auto,
    OpenVr,
    OpenXr,
}

impl OverlayBackendPreference {
    pub fn from_config(value: &str) -> Self {
        match value.trim() {
            "openvr" => Self::OpenVr,
            "openxr" => Self::OpenXr,
            _ => Self::Auto,
        }
    }
}

pub trait VrOverlayServiceControl {
    fn start(&mut self) -> Result<(), OverlayServiceStartError>;
    fn update_frame(&mut self, frame: RgbaFrame) -> Result<(), String>;
    fn update_surface_frame(
        &mut self,
        _surface_id: &OverlaySurfaceId,
        frame: RgbaFrame,
    ) -> Result<(), String> {
        self.update_frame(frame)
    }
    fn show(&mut self) -> Result<(), String>;
    fn show_surface(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
        self.show()
    }
    fn hide_surface(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
        Ok(())
    }
    fn set_surface_alpha(
        &mut self,
        _surface_id: &OverlaySurfaceId,
        _alpha: f32,
    ) -> Result<(), String> {
        Ok(())
    }
    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String>;
    fn drain_input_events(&mut self) -> Vec<OverlayInputEvent> {
        Vec::new()
    }
    fn set_interaction_active(&mut self, _active: bool) -> Result<(), String> {
        Ok(())
    }
    fn set_surface_configs(&mut self, configs: Vec<OverlaySurfaceConfig>) -> Result<(), String>;
    fn set_backend_preference(&mut self, _preference: OverlayBackendPreference) {}
    fn active_backend(&self) -> Option<&'static str> {
        None
    }
    fn should_stop_when_ineligible(&self) -> bool {
        self.is_running()
    }
    fn stop(&mut self);
    fn is_running(&self) -> bool;
}

pub struct HostVrOverlayService {
    configs: Vec<OverlaySurfaceConfig>,
    surface_ids: Vec<OverlaySurfaceId>,
    surfaces_registered: bool,
    actor: Option<OverlayActorHandle>,
    condemned: Vec<CondemnedActor>,
    backend: OverlayBackendKind,
    preference: OverlayBackendPreference,
    active_backend: Option<&'static str>,
    interaction_active: bool,
    last_frame: Option<RgbaFrame>,
    last_surface_frames: HashMap<OverlaySurfaceId, RgbaFrame>,
    frame_dirty: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OverlayBackendKind {
    Auto,
    Noop,
}

impl HostVrOverlayService {
    pub fn new(configs: Vec<OverlaySurfaceConfig>) -> Self {
        Self::new_with_backend(configs, OverlayBackendKind::Auto)
    }

    pub fn new_with_preference(
        configs: Vec<OverlaySurfaceConfig>,
        preference: OverlayBackendPreference,
    ) -> Self {
        let mut service = Self::new_with_backend(configs, OverlayBackendKind::Auto);
        service.preference = preference;
        service
    }

    pub fn new_noop(configs: Vec<OverlaySurfaceConfig>) -> Self {
        Self::new_with_backend(configs, OverlayBackendKind::Noop)
    }

    fn new_with_backend(configs: Vec<OverlaySurfaceConfig>, backend: OverlayBackendKind) -> Self {
        let surface_ids = configs
            .iter()
            .map(|config| config.surface_id.clone())
            .collect();
        Self {
            configs,
            surface_ids,
            surfaces_registered: false,
            actor: None,
            condemned: Vec::new(),
            backend,
            preference: OverlayBackendPreference::Auto,
            active_backend: None,
            interaction_active: false,
            last_frame: None,
            last_surface_frames: HashMap::new(),
            frame_dirty: true,
        }
    }

    pub fn backend_available() -> bool {
        cfg!(all(
            any(feature = "steamvr-overlay", feature = "openxr-overlay"),
            any(windows, target_os = "linux")
        ))
    }

    fn register_surface_configs(
        actor: &OverlayActorHandle,
        configs: &[OverlaySurfaceConfig],
    ) -> Result<Vec<OverlaySurfaceId>, OverlayCommandError> {
        if configs.is_empty() {
            return Ok(Vec::new());
        }
        let mut registered_surface_ids = Vec::new();
        let allow_partial = configs.len() > 1;
        for config in configs {
            let command = if allow_partial {
                OverlayServiceCommand::RegisterOptionalSurface(config.clone())
            } else {
                OverlayServiceCommand::RegisterSurface(config.clone())
            };
            match actor.send(command) {
                Ok(()) => registered_surface_ids.push(config.surface_id.clone()),
                Err(error) if allow_partial && !is_timeout_error(&error) => {
                    tracing::warn!(
                        error = %error,
                        surface_id = config.surface_id.as_str(),
                        "skipping unavailable VR overlay surface"
                    );
                }
                Err(error) => return Err(error),
            }
        }
        if registered_surface_ids.is_empty() {
            return Err(OverlayCommandError::Backend(
                "no VR overlay surfaces were registered".to_string(),
            ));
        }
        Ok(registered_surface_ids)
    }

    fn active_actor(&self) -> Result<OverlayActorHandle, String> {
        self.actor
            .as_ref()
            .cloned()
            .ok_or_else(|| "overlay actor is not started".to_string())
    }

    fn map_actor_error(&mut self, error: OverlayCommandError) -> String {
        let message = error.to_string();
        if is_timeout_error(&error) {
            self.condemn_active_actor();
        }
        message
    }

    fn clear_active_state(&mut self) {
        self.last_frame = None;
        self.last_surface_frames.clear();
        self.active_backend = None;
        self.surfaces_registered = false;
        self.frame_dirty = true;
    }

    fn condemn_active_actor(&mut self) {
        if let Some(actor) = self.actor.take() {
            self.condemned.push(CondemnedActor {
                actor,
                last_probe_timed_out_at: None,
            });
        }
        self.clear_active_state();
    }

    fn stop_active_actor(&mut self) -> RetireOutcome {
        let Some(actor) = self.actor.take() else {
            self.clear_active_state();
            return RetireOutcome::Retired;
        };
        let outcome = retire_outcome_for_stop_result(actor.send(OverlayServiceCommand::Stop));
        if outcome == RetireOutcome::Condemn {
            self.condemned.push(CondemnedActor {
                actor,
                last_probe_timed_out_at: Some(Instant::now()),
            });
        }
        self.clear_active_state();
        outcome
    }

    fn retire_current_actor_for_restart(&mut self) -> Result<(), OverlayServiceStartError> {
        match self.stop_active_actor() {
            RetireOutcome::Retired => Ok(()),
            RetireOutcome::Condemn => Err(OverlayServiceStartError::transient(
                PREVIOUS_BACKEND_NOT_RESPONDING_MESSAGE,
            )),
        }
    }

    fn retire_condemned(&mut self) -> Result<(), OverlayServiceStartError> {
        let mut remaining = Vec::new();
        let mut blocked_by_start = false;
        let mut blocked_by_timeout = false;
        for mut entry in self.condemned.drain(..) {
            let phase = entry.actor.status().phase;
            if phase == OverlayServicePhase::Starting {
                remaining.push(entry);
                blocked_by_start = true;
                continue;
            }
            if !condemned_probe_due(phase, entry.last_probe_timed_out_at, Instant::now()) {
                remaining.push(entry);
                blocked_by_timeout = true;
                continue;
            }
            match retire_outcome_for_stop_result(entry.actor.send(OverlayServiceCommand::Stop)) {
                RetireOutcome::Retired => {}
                RetireOutcome::Condemn => {
                    entry.last_probe_timed_out_at = Some(Instant::now());
                    remaining.push(entry);
                    blocked_by_timeout = true;
                }
            }
        }
        self.condemned = remaining;
        if blocked_by_start {
            return Err(OverlayServiceStartError::transient(
                PREVIOUS_START_IN_FLIGHT_MESSAGE,
            ));
        }
        if blocked_by_timeout {
            return Err(OverlayServiceStartError::transient(
                PREVIOUS_BACKEND_NOT_RESPONDING_MESSAGE,
            ));
        }
        Ok(())
    }

    fn send_startup_command(
        &mut self,
        actor: &OverlayActorHandle,
        command: OverlayServiceCommand,
    ) -> Result<(), OverlayServiceStartError> {
        if let Err(error) = actor.send(command) {
            let message = error.to_string();
            if is_timeout_error(&error) {
                self.condemn_active_actor();
            } else {
                let _ = self.stop_active_actor();
            }
            return Err(OverlayServiceStartError::transient(message));
        }
        Ok(())
    }
}

impl VrOverlayServiceControl for HostVrOverlayService {
    fn start(&mut self) -> Result<(), OverlayServiceStartError> {
        if let Some(actor) = self.actor.as_ref() {
            match actor.status().phase {
                OverlayServicePhase::Running => return Ok(()),
                OverlayServicePhase::Starting => {
                    return Err(OverlayServiceStartError::transient(
                        PREVIOUS_START_IN_FLIGHT_MESSAGE,
                    ));
                }
                OverlayServicePhase::Stopped | OverlayServicePhase::Error => {}
            }
        }
        if let Some(remaining) = quit_cooldown_remaining(
            self.actor
                .as_ref()
                .and_then(|actor| actor.runtime_quit_at()),
            Instant::now(),
        ) {
            let elapsed = RUNTIME_QUIT_RESTART_COOLDOWN - remaining;
            return Err(OverlayServiceStartError::transient(format!(
                "VR runtime quit {}ms ago; cooling down",
                elapsed.as_millis()
            )));
        }
        self.retire_current_actor_for_restart()?;
        self.retire_condemned()?;

        let (actor, backend_kind) = spawn_overlay_actor(self.backend, self.preference);
        self.actor = Some(actor.clone());
        self.active_backend = Some(backend_kind);
        if let Err(error) = actor.send(OverlayServiceCommand::Start) {
            let message = error.to_string();
            let permanent = matches!(error, OverlayCommandError::BackendUnsupported(_));
            if !is_timeout_error(&error) {
                let _ = self.stop_active_actor();
            }
            if permanent {
                return Err(OverlayServiceStartError::permanent(message));
            }
            return Err(OverlayServiceStartError::transient(message));
        }
        self.send_startup_command(
            &actor,
            OverlayServiceCommand::SetInteractionActive(self.interaction_active),
        )?;
        let registered_surface_ids = match Self::register_surface_configs(&actor, &self.configs) {
            Ok(surface_ids) => surface_ids,
            Err(error) => {
                let message = error.to_string();
                if is_timeout_error(&error) {
                    self.condemn_active_actor();
                } else {
                    let _ = self.stop_active_actor();
                }
                return Err(OverlayServiceStartError::transient(message));
            }
        };
        self.surface_ids = registered_surface_ids;
        self.surfaces_registered = true;
        self.frame_dirty = true;
        tracing::info!(backend = backend_kind, "VR overlay service started");
        Ok(())
    }

    fn update_frame(&mut self, frame: RgbaFrame) -> Result<(), String> {
        if !self.frame_dirty && self.last_frame.as_ref() == Some(&frame) {
            return Ok(());
        }
        let actor = self.active_actor()?;
        let surface_ids = self.surface_ids.clone();
        for surface_id in surface_ids {
            if let Err(error) = actor.send(OverlayServiceCommand::UpdateFrame {
                surface_id,
                frame: frame.clone(),
            }) {
                return Err(self.map_actor_error(error));
            }
        }
        self.last_frame = Some(frame);
        self.frame_dirty = false;
        Ok(())
    }

    fn show(&mut self) -> Result<(), String> {
        let actor = self.active_actor()?;
        let surface_ids = self.surface_ids.clone();
        for surface_id in surface_ids {
            if let Err(error) = actor.send(OverlayServiceCommand::Show(surface_id)) {
                return Err(self.map_actor_error(error));
            }
        }
        Ok(())
    }

    fn update_surface_frame(
        &mut self,
        surface_id: &OverlaySurfaceId,
        frame: RgbaFrame,
    ) -> Result<(), String> {
        if !self.surface_ids.contains(surface_id) {
            return Err(format!(
                "overlay surface '{}' is not registered",
                surface_id.as_str()
            ));
        }
        if self.last_surface_frames.get(surface_id) == Some(&frame) {
            return Ok(());
        }
        let actor = self.active_actor()?;
        if let Err(error) = actor.send(OverlayServiceCommand::UpdateFrame {
            surface_id: surface_id.clone(),
            frame: frame.clone(),
        }) {
            return Err(self.map_actor_error(error));
        }
        self.last_surface_frames.insert(surface_id.clone(), frame);
        Ok(())
    }

    fn show_surface(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        if !self.surface_ids.contains(surface_id) {
            return Err(format!(
                "overlay surface '{}' is not registered",
                surface_id.as_str()
            ));
        }
        let actor = self.active_actor()?;
        actor
            .send(OverlayServiceCommand::Show(surface_id.clone()))
            .map_err(|error| self.map_actor_error(error))
    }

    fn hide_surface(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        if !self.surface_ids.contains(surface_id) {
            return Ok(());
        }
        let actor = self.active_actor()?;
        actor
            .send(OverlayServiceCommand::Hide(surface_id.clone()))
            .map_err(|error| self.map_actor_error(error))
    }

    fn set_surface_alpha(
        &mut self,
        surface_id: &OverlaySurfaceId,
        alpha: f32,
    ) -> Result<(), String> {
        if !self.surface_ids.contains(surface_id) {
            return Err(format!(
                "overlay surface '{}' is not registered",
                surface_id.as_str()
            ));
        }
        let actor = self.active_actor()?;
        actor
            .send(OverlayServiceCommand::SetAlpha {
                surface_id: surface_id.clone(),
                alpha,
            })
            .map_err(|error| self.map_actor_error(error))
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        let actor = self.active_actor()?;
        actor
            .snapshot_devices()
            .map_err(|error| self.map_actor_error(error))
    }

    fn drain_input_events(&mut self) -> Vec<OverlayInputEvent> {
        self.actor
            .as_ref()
            .map(OverlayActorHandle::drain_input_events)
            .unwrap_or_default()
    }

    fn set_interaction_active(&mut self, active: bool) -> Result<(), String> {
        self.interaction_active = active;
        let Some(actor) = self
            .actor
            .as_ref()
            .filter(|actor| actor_is_running(actor))
            .cloned()
        else {
            return Ok(());
        };
        actor
            .send(OverlayServiceCommand::SetInteractionActive(active))
            .map_err(|error| self.map_actor_error(error))
    }

    fn set_surface_configs(&mut self, configs: Vec<OverlaySurfaceConfig>) -> Result<(), String> {
        let surface_ids = configs
            .iter()
            .map(|config| config.surface_id.clone())
            .collect::<Vec<_>>();
        let configs_unchanged = self.configs == configs;
        let actor_running = self.actor.as_ref().is_some_and(actor_is_running);
        if configs_unchanged && (!actor_running || self.surfaces_registered) {
            return Ok(());
        }
        if let Some(actor) = self
            .actor
            .as_ref()
            .filter(|actor| actor_is_running(actor))
            .cloned()
        {
            let current_surface_ids = self.surface_ids.clone();
            let registered_surface_ids = match apply_surface_config_change(
                &current_surface_ids,
                &configs,
                |configs| Self::register_surface_configs(&actor, configs),
                |surface_id| match actor
                    .send(OverlayServiceCommand::UnregisterSurface(surface_id.clone()))
                {
                    Ok(()) => Ok(()),
                    Err(error) if is_timeout_error(&error) => Err(error),
                    Err(error) => {
                        tracing::warn!(
                            error = %error,
                            surface_id = surface_id.as_str(),
                            "failed to unregister removed VR overlay surface"
                        );
                        Ok(())
                    }
                },
            ) {
                Ok(surface_ids) => surface_ids,
                Err(error) => return Err(self.map_actor_error(error)),
            };
            self.configs = configs;
            self.surface_ids = registered_surface_ids;
            self.surfaces_registered = true;
            self.last_surface_frames
                .retain(|surface_id, _| self.surface_ids.contains(surface_id));
            self.frame_dirty = true;
            return Ok(());
        }
        self.configs = configs;
        self.surface_ids = surface_ids;
        self.surfaces_registered = false;
        self.last_surface_frames
            .retain(|surface_id, _| self.surface_ids.contains(surface_id));
        self.frame_dirty = true;
        Ok(())
    }

    fn set_backend_preference(&mut self, preference: OverlayBackendPreference) {
        if self.preference == preference {
            return;
        }
        self.preference = preference;
        if self.actor.is_some() {
            self.stop();
        }
    }

    fn active_backend(&self) -> Option<&'static str> {
        if self.is_running() {
            self.active_backend
        } else {
            None
        }
    }

    fn stop(&mut self) {
        let _ = self.stop_active_actor();
    }

    fn should_stop_when_ineligible(&self) -> bool {
        self.actor.as_ref().is_some_and(|actor| {
            matches!(
                actor.status().phase,
                OverlayServicePhase::Starting
                    | OverlayServicePhase::Running
                    | OverlayServicePhase::Error
            )
        })
    }

    fn is_running(&self) -> bool {
        self.actor.as_ref().is_some_and(actor_is_running)
    }
}

fn apply_surface_config_change<Register, Unregister, Error>(
    current_surface_ids: &[OverlaySurfaceId],
    next_configs: &[OverlaySurfaceConfig],
    mut register: Register,
    mut unregister: Unregister,
) -> Result<Vec<OverlaySurfaceId>, Error>
where
    Register: FnMut(&[OverlaySurfaceConfig]) -> Result<Vec<OverlaySurfaceId>, Error>,
    Unregister: FnMut(&OverlaySurfaceId) -> Result<(), Error>,
{
    let next_surface_ids = next_configs
        .iter()
        .map(|config| config.surface_id.clone())
        .collect::<Vec<_>>();
    let registered_surface_ids = register(next_configs)?;
    for surface_id in current_surface_ids
        .iter()
        .filter(|surface_id| !next_surface_ids.contains(surface_id))
    {
        unregister(surface_id)?;
    }
    Ok(registered_surface_ids)
}

struct CondemnedActor {
    actor: OverlayActorHandle,
    last_probe_timed_out_at: Option<Instant>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RetireOutcome {
    Retired,
    Condemn,
}

fn condemned_probe_due(
    phase: OverlayServicePhase,
    last_probe_timed_out_at: Option<Instant>,
    now: Instant,
) -> bool {
    if phase == OverlayServicePhase::Stopped {
        return true;
    }
    last_probe_timed_out_at
        .is_none_or(|at| now.saturating_duration_since(at) >= CONDEMNED_REPROBE_INTERVAL)
}

fn retire_outcome_for_stop_result(result: Result<(), OverlayCommandError>) -> RetireOutcome {
    match result {
        Ok(()) | Err(OverlayCommandError::Stopped) => RetireOutcome::Retired,
        Err(error) if is_timeout_error(&error) => RetireOutcome::Condemn,
        Err(_) => RetireOutcome::Retired,
    }
}

fn actor_is_running(actor: &OverlayActorHandle) -> bool {
    is_running_phase(actor.status().phase)
}

fn is_running_phase(phase: OverlayServicePhase) -> bool {
    phase == OverlayServicePhase::Running
}

fn is_timeout_error(error: &OverlayCommandError) -> bool {
    matches!(error, OverlayCommandError::Timeout { .. })
}

fn quit_cooldown_remaining(quit_at: Option<Instant>, now: Instant) -> Option<Duration> {
    let quit_at = quit_at?;
    let elapsed = now.saturating_duration_since(quit_at);
    if elapsed >= RUNTIME_QUIT_RESTART_COOLDOWN {
        return None;
    }
    Some(RUNTIME_QUIT_RESTART_COOLDOWN - elapsed)
}

fn spawn_overlay_actor(
    kind: OverlayBackendKind,
    preference: OverlayBackendPreference,
) -> (OverlayActorHandle, &'static str) {
    match kind {
        OverlayBackendKind::Noop => (OverlayActorHandle::spawn_noop(), "noop"),
        OverlayBackendKind::Auto => spawn_auto_overlay_actor(preference),
    }
}

fn spawn_auto_overlay_actor(
    preference: OverlayBackendPreference,
) -> (OverlayActorHandle, &'static str) {
    let spawned = match preference {
        OverlayBackendPreference::OpenVr => spawn_openvr_actor(),
        OverlayBackendPreference::OpenXr => spawn_openxr_actor(),
        OverlayBackendPreference::Auto => {
            let openxr_supported = openxr_runtime_supported();
            if cfg!(target_os = "linux") && openxr_supported {
                spawn_openxr_actor()
            } else {
                spawn_openvr_actor().or_else(|| openxr_supported.then(spawn_openxr_actor).flatten())
            }
        }
    };
    spawned.unwrap_or_else(|| {
        tracing::warn!(
            preference = ?preference,
            "no VR overlay backend is available in this build; using noop backend"
        );
        (OverlayActorHandle::spawn_noop(), "noop")
    })
}

fn spawn_openvr_actor() -> Option<(OverlayActorHandle, &'static str)> {
    #[cfg(all(feature = "steamvr-overlay", any(windows, target_os = "linux")))]
    {
        Some((OverlayActorHandle::spawn_openvr(), "openvr"))
    }
    #[cfg(not(all(feature = "steamvr-overlay", any(windows, target_os = "linux"))))]
    {
        None
    }
}

fn spawn_openxr_actor() -> Option<(OverlayActorHandle, &'static str)> {
    #[cfg(all(feature = "openxr-overlay", any(windows, target_os = "linux")))]
    {
        Some((OverlayActorHandle::spawn_openxr(), "openxr"))
    }
    #[cfg(not(all(feature = "openxr-overlay", any(windows, target_os = "linux"))))]
    {
        None
    }
}

fn openxr_runtime_supported() -> bool {
    #[cfg(all(feature = "openxr-overlay", any(windows, target_os = "linux")))]
    {
        match vrcx_0_host::vr_overlay::probe_openxr_runtime() {
            Ok(()) => true,
            Err(error) => {
                tracing::debug!(error = %error, "OpenXR overlay runtime probe failed");
                false
            }
        }
    }
    #[cfg(not(all(feature = "openxr-overlay", any(windows, target_os = "linux"))))]
    {
        false
    }
}

#[cfg(test)]
#[path = "../../tests/vr_overlay/service_tests.rs"]
mod tests;
