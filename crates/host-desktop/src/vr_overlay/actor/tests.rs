use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use super::*;

#[test]
fn send_with_timeout_returns_timeout_for_wedged_backend() {
    let release = Arc::new(AtomicBool::new(false));
    let actor = OverlayActorHandle::spawn_with_backend(BlockingCommandBackend {
        release: Arc::clone(&release),
    });

    let result = actor.send_with_timeout_for_test(
        OverlayServiceCommand::Show(OverlaySurfaceId::new("wrist")),
        Duration::from_millis(25),
    );

    assert!(matches!(
        result,
        Err(OverlayCommandError::Timeout {
            command: "show",
            waited
        }) if waited == Duration::from_millis(25)
    ));
    release.store(true, Ordering::Release);
    actor
        .send(OverlayServiceCommand::Stop)
        .expect("stop overlay actor");
}

#[test]
fn wedged_start_leaves_phase_starting_after_timeout() {
    let release = Arc::new(AtomicBool::new(false));
    let actor = OverlayActorHandle::spawn_with_backend(BlockingStartBackend {
        release: Arc::clone(&release),
    });

    let result =
        actor.send_with_timeout_for_test(OverlayServiceCommand::Start, Duration::from_millis(25));

    assert!(matches!(
        result,
        Err(OverlayCommandError::Timeout {
            command: "start",
            ..
        })
    ));
    assert_eq!(actor.status().phase, OverlayServicePhase::Starting);
    release.store(true, Ordering::Release);
    actor
        .send(OverlayServiceCommand::Stop)
        .expect("stop overlay actor");
}

#[test]
fn timeout_error_display_names_command_and_wait() {
    let error = OverlayCommandError::Timeout {
        command: "show",
        waited: Duration::from_millis(25),
    };

    assert_eq!(
        error.to_string(),
        "overlay command timed out after 25ms: show"
    );
}

struct BlockingCommandBackend {
    release: Arc<AtomicBool>,
}

impl OverlayBackend for BlockingCommandBackend {
    fn start(&mut self) -> Result<(), BackendStartError> {
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
        while !self.release.load(Ordering::Acquire) {
            thread::sleep(Duration::from_millis(5));
        }
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
