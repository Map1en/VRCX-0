use std::cell::RefCell;
use std::rc::Rc;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

use vrcx_0_host::vr_overlay::{
    BackendStartError, OverlayActivationButton, OverlayActorHandle, OverlayBackend,
    OverlayCommandError, OverlayPlacement, OverlayServiceCommand, OverlayServicePhase,
    OverlaySurfaceConfig, VrDeviceSnapshot,
};
use vrcx_0_vr_overlay::{OverlaySize, OverlaySurfaceId, RgbaFrame};

use super::{
    apply_surface_config_change, condemned_probe_due, is_running_phase, quit_cooldown_remaining,
    retire_outcome_for_stop_result, HostVrOverlayService, RetireOutcome, VrOverlayServiceControl,
};

#[test]
fn quit_cooldown_remaining_respects_ten_second_boundary() {
    let now = Instant::now();
    let recent = now
        .checked_sub(Duration::from_secs(10) - Duration::from_millis(100))
        .expect("recent instant");
    let old = now
        .checked_sub(Duration::from_secs(10) + Duration::from_millis(100))
        .expect("old instant");

    assert_eq!(
        quit_cooldown_remaining(Some(recent), now),
        Some(Duration::from_millis(100))
    );
    assert_eq!(quit_cooldown_remaining(Some(old), now), None);
    assert_eq!(quit_cooldown_remaining(None, now), None);
}

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
            Ok(())
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
            Ok::<(), String>(())
        },
    )
    .expect("config apply");

    assert_eq!(result, vec![surface_id("wrist-left")]);
    assert_eq!(unregistered.borrow().as_slice(), ["wrist-right"]);
}

#[test]
fn surface_config_change_returns_unregister_error() {
    let current = vec![surface_id("wrist-left"), surface_id("wrist-right")];
    let next = vec![surface_config("wrist-left")];

    let result = apply_surface_config_change(
        &current,
        &next,
        |configs| {
            Ok(configs
                .iter()
                .map(|config| config.surface_id.clone())
                .collect())
        },
        |_surface_id| Err("unregister failed".to_string()),
    );

    assert_eq!(result, Err("unregister failed".to_string()));
}

#[test]
fn running_phase_excludes_starting() {
    assert!(is_running_phase(OverlayServicePhase::Running));
    assert!(!is_running_phase(OverlayServicePhase::Starting));
    assert!(!is_running_phase(OverlayServicePhase::Stopped));
    assert!(!is_running_phase(OverlayServicePhase::Error));
}

#[test]
fn start_with_starting_actor_returns_transient_without_respawn() {
    let release = Arc::new(AtomicBool::new(false));
    let actor = OverlayActorHandle::spawn_with_backend(BlockingStartBackend {
        release: Arc::clone(&release),
    });
    let start_actor = actor.clone();
    let starter = thread::spawn(move || start_actor.send(OverlayServiceCommand::Start));
    wait_until(Duration::from_secs(1), || {
        actor.status().phase == OverlayServicePhase::Starting
    });

    let mut service = HostVrOverlayService::new_noop(Vec::new());
    service.actor = Some(actor.clone());
    let result = service.start();

    assert_eq!(
        result,
        Err(super::OverlayServiceStartError::transient(
            "previous overlay start attempt is still in flight"
        ))
    );
    assert!(service.actor.is_some());
    assert!(service.condemned.is_empty());

    release.store(true, Ordering::Release);
    starter.join().expect("start thread").expect("start actor");
    actor
        .send(OverlayServiceCommand::Stop)
        .expect("stop overlay actor");
}

#[test]
fn starting_actor_needs_stop_when_ineligible_without_being_running() {
    let release = Arc::new(AtomicBool::new(false));
    let actor = OverlayActorHandle::spawn_with_backend(BlockingStartBackend {
        release: Arc::clone(&release),
    });
    let start_actor = actor.clone();
    let starter = thread::spawn(move || start_actor.send(OverlayServiceCommand::Start));
    wait_until(Duration::from_secs(1), || {
        actor.status().phase == OverlayServicePhase::Starting
    });

    let mut service = HostVrOverlayService::new_noop(Vec::new());
    service.actor = Some(actor.clone());

    assert!(!service.is_running());
    assert!(service.should_stop_when_ineligible());

    release.store(true, Ordering::Release);
    starter.join().expect("start thread").expect("start actor");
    actor
        .send(OverlayServiceCommand::Stop)
        .expect("stop overlay actor");
}

#[test]
fn stop_timeout_retirement_condemns_actor() {
    let result = Err(OverlayCommandError::Timeout {
        command: "stop",
        waited: Duration::from_millis(25),
    });

    assert_eq!(
        retire_outcome_for_stop_result(result),
        RetireOutcome::Condemn
    );
}

#[test]
fn condemned_probe_gate_skips_recent_timeout_unless_stopped() {
    let now = Instant::now();
    let recent = now
        .checked_sub(Duration::from_secs(5))
        .expect("recent instant");
    let stale = now
        .checked_sub(Duration::from_secs(31))
        .expect("stale instant");

    assert!(!condemned_probe_due(
        OverlayServicePhase::Running,
        Some(recent),
        now
    ));
    assert!(condemned_probe_due(
        OverlayServicePhase::Running,
        Some(stale),
        now
    ));
    assert!(condemned_probe_due(OverlayServicePhase::Running, None, now));
    assert!(condemned_probe_due(
        OverlayServicePhase::Stopped,
        Some(recent),
        now
    ));
}

#[test]
fn unchanged_configs_register_when_running_actor_has_no_registered_surfaces() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let actor = OverlayActorHandle::spawn_with_backend(RecordingBackend {
        calls: Arc::clone(&calls),
    });
    actor
        .send(OverlayServiceCommand::Start)
        .expect("start actor");
    let configs = vec![surface_config("wrist-left")];
    let mut service = HostVrOverlayService::new_noop(configs.clone());
    service.actor = Some(actor.clone());
    service.surface_ids = configs
        .iter()
        .map(|config| config.surface_id.clone())
        .collect();
    service.surfaces_registered = false;

    service
        .set_surface_configs(configs)
        .expect("register unchanged configs");

    assert_eq!(calls.lock().unwrap().as_slice(), ["register:wrist-left"]);
    actor
        .send(OverlayServiceCommand::Stop)
        .expect("stop overlay actor");
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
        interactive: false,
    }
}

fn wait_until(timeout: Duration, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if condition() {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert!(condition());
}

struct BlockingStartBackend {
    release: Arc<AtomicBool>,
}

impl OverlayBackend for BlockingStartBackend {
    fn start(&mut self) -> Result<(), BackendStartError> {
        while !self.release.load(Ordering::Acquire) {
            thread::sleep(Duration::from_millis(5));
        }
        Ok(())
    }

    fn register_surface(&mut self, _config: OverlaySurfaceConfig) -> Result<(), String> {
        Ok(())
    }

    fn update_frame(
        &mut self,
        _surface_id: &OverlaySurfaceId,
        _frame: RgbaFrame,
    ) -> Result<(), String> {
        Ok(())
    }

    fn show(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
        Ok(())
    }

    fn hide(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
        Ok(())
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        Ok(Vec::new())
    }

    fn stop(&mut self) {}
}

struct RecordingBackend {
    calls: Arc<Mutex<Vec<String>>>,
}

impl OverlayBackend for RecordingBackend {
    fn start(&mut self) -> Result<(), BackendStartError> {
        Ok(())
    }

    fn register_surface(&mut self, config: OverlaySurfaceConfig) -> Result<(), String> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("register:{}", config.surface_id.as_str()));
        Ok(())
    }

    fn update_frame(
        &mut self,
        _surface_id: &OverlaySurfaceId,
        _frame: RgbaFrame,
    ) -> Result<(), String> {
        Ok(())
    }

    fn show(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
        Ok(())
    }

    fn hide(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
        Ok(())
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        Ok(Vec::new())
    }

    fn stop(&mut self) {}
}
