use std::sync::{Arc, Mutex};

use vrcx_0_host::vr_overlay::{
    OverlayActivationButton, OverlayActorHandle, OverlayBackend, OverlayCommandError,
    OverlayPlacement, OverlayServiceCommand, OverlayServicePhase, OverlaySurfaceConfig,
    VrDeviceSnapshot,
};
use vrcx_0_vr_overlay::{OverlaySize, OverlaySurfaceId, RgbaFrame};

#[test]
fn overlay_actor_serializes_commands_until_stop() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let backend = RecordingBackend {
        calls: Arc::clone(&calls),
    };
    let actor = OverlayActorHandle::spawn_with_backend(backend);

    actor
        .send(OverlayServiceCommand::Start)
        .expect("start overlay actor");
    actor
        .send(OverlayServiceCommand::RegisterSurface(make_wrist_config()))
        .expect("register wrist surface");
    actor
        .send(OverlayServiceCommand::UpdateFrame {
            surface_id: wrist_surface_id(),
            frame: RgbaFrame::new(OverlaySize::new(16, 8), vec![255; 16 * 8 * 4]),
        })
        .expect("update frame");
    actor
        .send(OverlayServiceCommand::Show(wrist_surface_id()))
        .expect("show overlay");
    actor
        .send(OverlayServiceCommand::Hide(wrist_surface_id()))
        .expect("hide overlay");
    actor
        .send(OverlayServiceCommand::Stop)
        .expect("stop overlay");

    assert_eq!(
        calls.lock().unwrap().as_slice(),
        [
            "start",
            "register:wrist",
            "frame:wrist:16x8",
            "show:wrist",
            "hide:wrist",
            "stop"
        ]
    );
    assert_eq!(actor.status().phase, OverlayServicePhase::Stopped);
}

#[test]
fn overlay_actor_reports_backend_errors_without_panicking() {
    let actor = OverlayActorHandle::spawn_with_backend(FailingBackend);

    let result = actor.send(OverlayServiceCommand::Show(wrist_surface_id()));

    assert!(matches!(result, Err(OverlayCommandError::Backend(_))));
    let status = actor.status();
    assert_eq!(status.phase, OverlayServicePhase::Error);
    assert!(status
        .last_error
        .as_deref()
        .unwrap_or_default()
        .contains("show failed"));
}

#[test]
fn overlay_actor_optional_surface_errors_do_not_poison_running_status() {
    let actor = OverlayActorHandle::spawn_with_backend(FailingRegisterBackend);

    actor
        .send(OverlayServiceCommand::Start)
        .expect("start overlay actor");
    let result = actor.send(OverlayServiceCommand::RegisterOptionalSurface(
        make_wrist_config(),
    ));

    assert!(matches!(result, Err(OverlayCommandError::Backend(_))));
    assert_eq!(actor.status().phase, OverlayServicePhase::Running);

    actor
        .send(OverlayServiceCommand::Stop)
        .expect("stop overlay");
}

#[test]
fn overlay_actor_rejects_invalid_frame_lengths_before_backend() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let backend = RecordingBackend {
        calls: Arc::clone(&calls),
    };
    let actor = OverlayActorHandle::spawn_with_backend(backend);

    actor
        .send(OverlayServiceCommand::Start)
        .expect("start overlay actor");
    actor
        .send(OverlayServiceCommand::RegisterSurface(make_wrist_config()))
        .expect("register wrist surface");
    let result = actor.send(OverlayServiceCommand::UpdateFrame {
        surface_id: wrist_surface_id(),
        frame: RgbaFrame::new(OverlaySize::new(16, 8), vec![255; 7]),
    });

    assert!(matches!(
        result,
        Err(OverlayCommandError::InvalidFrameLength {
            expected: 512,
            actual: 7
        })
    ));
    assert_eq!(
        calls.lock().unwrap().as_slice(),
        ["start", "register:wrist"]
    );
    assert_eq!(actor.status().phase, OverlayServicePhase::Error);

    actor
        .send(OverlayServiceCommand::Stop)
        .expect("stop overlay");
}

#[test]
fn overlay_actor_cleans_backend_after_start_failure() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let backend = FailingStartBackend {
        calls: Arc::clone(&calls),
    };
    let actor = OverlayActorHandle::spawn_with_backend(backend);

    let result = actor.send(OverlayServiceCommand::Start);

    assert!(matches!(result, Err(OverlayCommandError::Backend(_))));
    assert_eq!(calls.lock().unwrap().as_slice(), ["start", "stop"]);
    assert_eq!(actor.status().phase, OverlayServicePhase::Error);
}

fn make_wrist_config() -> OverlaySurfaceConfig {
    OverlaySurfaceConfig {
        surface_id: wrist_surface_id(),
        size: OverlaySize::new(16, 8),
        physical_width_meters: 0.22,
        placement: OverlayPlacement::TrackedDeviceRelative {
            device_hint: "left-hand".to_string(),
        },
        activation_button: OverlayActivationButton::Grip,
    }
}

fn wrist_surface_id() -> OverlaySurfaceId {
    OverlaySurfaceId::new("wrist")
}

struct RecordingBackend {
    calls: Arc<Mutex<Vec<String>>>,
}

impl OverlayBackend for RecordingBackend {
    fn start(&mut self) -> Result<(), String> {
        self.calls.lock().unwrap().push("start".to_string());
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
        surface_id: &OverlaySurfaceId,
        frame: RgbaFrame,
    ) -> Result<(), String> {
        self.calls.lock().unwrap().push(format!(
            "frame:{}:{}x{}",
            surface_id.as_str(),
            frame.size.width,
            frame.size.height
        ));
        Ok(())
    }

    fn show(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("show:{}", surface_id.as_str()));
        Ok(())
    }

    fn hide(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("hide:{}", surface_id.as_str()));
        Ok(())
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        Ok(Vec::new())
    }

    fn stop(&mut self) {
        self.calls.lock().unwrap().push("stop".to_string());
    }
}

struct FailingBackend;

impl OverlayBackend for FailingBackend {
    fn start(&mut self) -> Result<(), String> {
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
        Err("show failed".to_string())
    }

    fn hide(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
        Ok(())
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        Ok(Vec::new())
    }

    fn stop(&mut self) {}
}

struct FailingRegisterBackend;

impl OverlayBackend for FailingRegisterBackend {
    fn start(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn register_surface(&mut self, _config: OverlaySurfaceConfig) -> Result<(), String> {
        Err("register failed".to_string())
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

struct FailingStartBackend {
    calls: Arc<Mutex<Vec<String>>>,
}

impl OverlayBackend for FailingStartBackend {
    fn start(&mut self) -> Result<(), String> {
        self.calls.lock().unwrap().push("start".to_string());
        Err("start failed".to_string())
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

    fn stop(&mut self) {
        self.calls.lock().unwrap().push("stop".to_string());
    }
}
