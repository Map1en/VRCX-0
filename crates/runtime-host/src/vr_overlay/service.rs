use vrcx_0_host::vr_overlay::{
    OverlayActorHandle, OverlayServiceCommand, OverlayServicePhase, OverlaySurfaceConfig,
    VrDeviceSnapshot,
};
use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame};

pub trait VrOverlayServiceControl {
    fn start(&mut self) -> Result<(), String>;
    fn update_frame(&mut self, frame: RgbaFrame) -> Result<(), String>;
    fn show(&mut self) -> Result<(), String>;
    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String>;
    fn set_surface_configs(&mut self, configs: Vec<OverlaySurfaceConfig>) -> Result<(), String>;
    fn stop(&mut self);
    fn is_running(&self) -> bool;
}

pub struct HostVrOverlayService {
    configs: Vec<OverlaySurfaceConfig>,
    surface_ids: Vec<OverlaySurfaceId>,
    actor: Option<OverlayActorHandle>,
    backend: OverlayBackendKind,
    last_frame: Option<RgbaFrame>,
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
            actor: None,
            backend,
            last_frame: None,
            frame_dirty: true,
        }
    }

    pub fn backend_available() -> bool {
        cfg!(all(
            feature = "steamvr-overlay",
            any(windows, target_os = "linux")
        ))
    }

    fn register_surface_configs(
        actor: &OverlayActorHandle,
        configs: &[OverlaySurfaceConfig],
    ) -> Result<Vec<OverlaySurfaceId>, String> {
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
                Err(error) if allow_partial => {
                    tracing::warn!(
                        error = %error,
                        surface_id = config.surface_id.as_str(),
                        "skipping unavailable VR overlay surface"
                    );
                }
                Err(error) => return Err(error.to_string()),
            }
        }
        if registered_surface_ids.is_empty() {
            return Err("no VR overlay surfaces were registered".to_string());
        }
        Ok(registered_surface_ids)
    }
}

impl VrOverlayServiceControl for HostVrOverlayService {
    fn start(&mut self) -> Result<(), String> {
        if self.actor.as_ref().is_some_and(actor_is_active) {
            return Ok(());
        }
        self.stop();

        let actor = spawn_overlay_actor(self.backend);
        if let Err(error) = actor.send(OverlayServiceCommand::Start) {
            let _ = actor.send(OverlayServiceCommand::Stop);
            return Err(error.to_string());
        }
        let registered_surface_ids = match Self::register_surface_configs(&actor, &self.configs) {
            Ok(surface_ids) => surface_ids,
            Err(error) => {
                let _ = actor.send(OverlayServiceCommand::Stop);
                return Err(error);
            }
        };
        if registered_surface_ids.is_empty() {
            let _ = actor.send(OverlayServiceCommand::Stop);
            return Err("no VR overlay surfaces were registered".to_string());
        }
        self.surface_ids = registered_surface_ids;
        self.actor = Some(actor);
        self.frame_dirty = true;
        Ok(())
    }

    fn update_frame(&mut self, frame: RgbaFrame) -> Result<(), String> {
        if !self.frame_dirty && self.last_frame.as_ref() == Some(&frame) {
            return Ok(());
        }
        let actor = self
            .actor
            .as_ref()
            .ok_or_else(|| "overlay actor is not started".to_string())?;
        for surface_id in &self.surface_ids {
            actor
                .send(OverlayServiceCommand::UpdateFrame {
                    surface_id: surface_id.clone(),
                    frame: frame.clone(),
                })
                .map_err(|error| error.to_string())?;
        }
        self.last_frame = Some(frame);
        self.frame_dirty = false;
        Ok(())
    }

    fn show(&mut self) -> Result<(), String> {
        let actor = self
            .actor
            .as_ref()
            .ok_or_else(|| "overlay actor is not started".to_string())?;
        for surface_id in &self.surface_ids {
            actor
                .send(OverlayServiceCommand::Show(surface_id.clone()))
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        let actor = self
            .actor
            .as_ref()
            .ok_or_else(|| "overlay actor is not started".to_string())?;
        actor.snapshot_devices().map_err(|error| error.to_string())
    }

    fn set_surface_configs(&mut self, configs: Vec<OverlaySurfaceConfig>) -> Result<(), String> {
        let surface_ids = configs
            .iter()
            .map(|config| config.surface_id.clone())
            .collect::<Vec<_>>();
        if self.configs == configs {
            return Ok(());
        }
        if let Some(actor) = self
            .actor
            .as_ref()
            .filter(|actor| actor_is_active(actor))
            .cloned()
        {
            let current_surface_ids = self.surface_ids.clone();
            let registered_surface_ids = apply_surface_config_change(
                &current_surface_ids,
                &configs,
                |configs| Self::register_surface_configs(&actor, configs),
                |surface_id| {
                    if let Err(error) =
                        actor.send(OverlayServiceCommand::UnregisterSurface(surface_id.clone()))
                    {
                        tracing::warn!(
                            error = %error,
                            surface_id = surface_id.as_str(),
                            "failed to unregister removed VR overlay surface"
                        );
                    }
                },
            )?;
            self.configs = configs;
            self.surface_ids = registered_surface_ids;
            self.frame_dirty = true;
            return Ok(());
        }
        self.configs = configs;
        self.surface_ids = surface_ids;
        self.frame_dirty = true;
        Ok(())
    }

    fn stop(&mut self) {
        if let Some(actor) = self.actor.take() {
            let _ = actor.send(OverlayServiceCommand::Stop);
        }
        self.frame_dirty = true;
    }

    fn is_running(&self) -> bool {
        self.actor.as_ref().is_some_and(actor_is_active)
    }
}

fn apply_surface_config_change<Register, Unregister>(
    current_surface_ids: &[OverlaySurfaceId],
    next_configs: &[OverlaySurfaceConfig],
    mut register: Register,
    mut unregister: Unregister,
) -> Result<Vec<OverlaySurfaceId>, String>
where
    Register: FnMut(&[OverlaySurfaceConfig]) -> Result<Vec<OverlaySurfaceId>, String>,
    Unregister: FnMut(&OverlaySurfaceId),
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
        unregister(surface_id);
    }
    Ok(registered_surface_ids)
}

fn actor_is_active(actor: &OverlayActorHandle) -> bool {
    matches!(
        actor.status().phase,
        OverlayServicePhase::Starting | OverlayServicePhase::Running
    )
}

fn spawn_overlay_actor(kind: OverlayBackendKind) -> OverlayActorHandle {
    match kind {
        OverlayBackendKind::Noop => OverlayActorHandle::spawn_noop(),
        OverlayBackendKind::Auto => spawn_auto_overlay_actor(),
    }
}

fn spawn_auto_overlay_actor() -> OverlayActorHandle {
    #[cfg(all(feature = "steamvr-overlay", any(windows, target_os = "linux")))]
    {
        OverlayActorHandle::spawn_openvr()
    }

    #[cfg(not(all(feature = "steamvr-overlay", any(windows, target_os = "linux"))))]
    {
        OverlayActorHandle::spawn_noop()
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use vrcx_0_host::vr_overlay::{
        OverlayActivationButton, OverlayPlacement, OverlaySurfaceConfig,
    };
    use vrcx_0_vr_overlay::{OverlaySize, OverlaySurfaceId};

    use super::apply_surface_config_change;

    #[test]
    fn surface_config_change_does_not_unregister_or_commit_when_registration_fails() {
        let current = vec![surface_id("wrist-left")];
        let next = vec![surface_config("wrist-right")];
        let unregistered = Rc::new(RefCell::new(Vec::new()));
        let unregistered_for_call = Rc::clone(&unregistered);

        let result = apply_surface_config_change(
            &current,
            &next,
            |_configs| Err("register failed".to_string()),
            |surface_id| {
                unregistered_for_call
                    .borrow_mut()
                    .push(surface_id.as_str().to_string());
            },
        );

        assert!(result.is_err());
        assert!(unregistered.borrow().is_empty());
    }

    #[test]
    fn surface_config_change_unregisters_removed_surfaces_after_registration_succeeds() {
        let current = vec![surface_id("wrist-left"), surface_id("wrist-right")];
        let next = vec![surface_config("wrist-left")];
        let unregistered = Rc::new(RefCell::new(Vec::new()));
        let unregistered_for_call = Rc::clone(&unregistered);

        let result = apply_surface_config_change(
            &current,
            &next,
            |configs| {
                Ok(configs
                    .iter()
                    .map(|config| config.surface_id.clone())
                    .collect())
            },
            |surface_id| {
                unregistered_for_call
                    .borrow_mut()
                    .push(surface_id.as_str().to_string());
            },
        )
        .expect("config apply");

        assert_eq!(result, vec![surface_id("wrist-left")]);
        assert_eq!(unregistered.borrow().as_slice(), ["wrist-right"]);
    }

    fn surface_id(value: &str) -> OverlaySurfaceId {
        OverlaySurfaceId::new(value)
    }

    fn surface_config(value: &str) -> OverlaySurfaceConfig {
        OverlaySurfaceConfig {
            surface_id: surface_id(value),
            size: OverlaySize::new(16, 8),
            physical_width_meters: 0.22,
            placement: OverlayPlacement::TrackedDeviceRelative {
                device_hint: "left-hand".to_string(),
            },
            activation_button: OverlayActivationButton::Grip,
        }
    }
}
