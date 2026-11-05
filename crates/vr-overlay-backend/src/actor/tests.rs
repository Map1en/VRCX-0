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
fn handle_reports_surfaces_the_backend_shows() {
    let wrist = OverlaySurfaceId::new("wrist-left");
    let actor = OverlayActorHandle::spawn_with_backend(VisibilityBackend::default());
    let wait_for_visibility = |expected: bool| {
        let deadline = Instant::now() + Duration::from_secs(2);
        while actor.is_surface_visible(&wrist) != expected && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        actor.is_surface_visible(&wrist)
    };

    assert!(!actor.is_surface_visible(&wrist));
    actor
        .send(OverlayServiceCommand::Show(wrist.clone()))
        .expect("show wrist");
    assert!(wait_for_visibility(true));
    actor
        .send(OverlayServiceCommand::Hide(wrist.clone()))
        .expect("hide wrist");
    assert!(!wait_for_visibility(false));
    actor
        .send(OverlayServiceCommand::Stop)
        .expect("stop overlay actor");
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

#[derive(Default)]
struct VisibilityBackend {
    visible: Vec<OverlaySurfaceId>,
}

impl OverlayBackend for VisibilityBackend {
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

    fn show(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        self.visible.push(surface_id.clone());
        Ok(())
    }

    fn hide(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        self.visible.retain(|visible| visible != surface_id);
        Ok(())
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        Ok(Vec::new())
    }

    fn visible_surface_ids(&self) -> Vec<OverlaySurfaceId> {
        self.visible.clone()
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
