use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

use vrcx_0_host::vr_overlay::{
    BackendStartError, OverlayActivationButton, OverlayActorHandle, OverlayBackend,
    OverlayCommandError, OverlayHand, OverlayInputEvent, OverlayInputEventSink, OverlayInputKind,
    OverlayPlacement, OverlayServiceCommand, OverlayServicePhase, OverlaySurfaceConfig,
    TickOutcome, VrDeviceSnapshot,
};
use vrcx_0_vr_overlay::{OverlaySize, OverlaySurfaceId, OverlayTransform, RgbaFrame, UvPoint};

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
        .send(OverlayServiceCommand::SetAlpha {
            surface_id: wrist_surface_id(),
            alpha: 0.42,
        })
        .expect("set alpha");
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
            "alpha:wrist:0.42",
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
fn overlay_actor_maps_permanent_start_failure_to_backend_unsupported() {
    let actor = OverlayActorHandle::spawn_with_backend(UnsupportedStartBackend);

    let result = actor.send(OverlayServiceCommand::Start);

    assert!(matches!(
        result,
        Err(OverlayCommandError::BackendUnsupported(_))
    ));
    let status = actor.status();
    assert_eq!(status.phase, OverlayServicePhase::Error);
    assert!(status
        .last_error
        .as_deref()
        .unwrap_or_default()
        .contains("runtime unsupported"));

    actor
        .send(OverlayServiceCommand::Stop)
        .expect("stop overlay");
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

#[test]
fn overlay_actor_stops_and_records_runtime_quit() {
    let actor = OverlayActorHandle::spawn_with_backend(RuntimeQuitBackend::default());

    actor
        .send(OverlayServiceCommand::Start)
        .expect("start overlay actor");

    wait_until(Duration::from_secs(1), || {
        actor.status().phase == OverlayServicePhase::Stopped
    });

    let status = actor.status();
    assert_eq!(status.phase, OverlayServicePhase::Stopped);
    assert!(status
        .last_error
        .as_deref()
        .unwrap_or_default()
        .contains("runtime requested quit"));
    assert!(actor.runtime_quit_at().is_some());
    assert!(matches!(
        actor.send(OverlayServiceCommand::Show(wrist_surface_id())),
        Err(OverlayCommandError::Stopped)
    ));
}

#[test]
fn overlay_actor_runtime_quit_does_not_stop_backend_again() {
    let stops = Arc::new(AtomicUsize::new(0));
    let backend = RuntimeQuitBackend {
        stops: Arc::clone(&stops),
    };
    let actor = OverlayActorHandle::spawn_with_backend(backend);

    actor
        .send(OverlayServiceCommand::Start)
        .expect("start overlay actor");
    wait_until(Duration::from_secs(1), || {
        actor.status().phase == OverlayServicePhase::Stopped
    });

    assert_eq!(stops.load(Ordering::Acquire), 0);
}

#[test]
fn overlay_actor_ticks_between_dense_commands() {
    let ticks = Arc::new(AtomicUsize::new(0));
    let backend = TickCountingBackend {
        ticks: Arc::clone(&ticks),
    };
    let actor = OverlayActorHandle::spawn_with_backend(backend);

    actor
        .send(OverlayServiceCommand::Start)
        .expect("start overlay actor");
    let sender = actor.clone();
    let worker = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_millis(650);
        while Instant::now() < deadline {
            sender
                .send(OverlayServiceCommand::UpdateFrame {
                    surface_id: wrist_surface_id(),
                    frame: RgbaFrame::new(OverlaySize::new(16, 8), vec![0; 16 * 8 * 4]),
                })
                .expect("update frame");
        }
    });
    worker.join().expect("dense command worker");
    actor
        .send(OverlayServiceCommand::Stop)
        .expect("stop overlay");

    assert!(ticks.load(Ordering::Acquire) >= 3);
}

#[test]
fn overlay_actor_does_not_tick_before_start() {
    let ticks = Arc::new(AtomicUsize::new(0));
    let backend = TickCountingBackend {
        ticks: Arc::clone(&ticks),
    };
    let actor = OverlayActorHandle::spawn_with_backend(backend);

    thread::sleep(Duration::from_millis(250));

    assert_eq!(ticks.load(Ordering::Acquire), 0);
    actor
        .send(OverlayServiceCommand::Stop)
        .expect("stop overlay");
}

#[test]
fn overlay_actor_drains_input_events_pushed_by_backend_tick() {
    let actor = OverlayActorHandle::spawn_with_backend(InputPushingBackend {
        sink: OverlayInputEventSink::default(),
        pushed: false,
    });

    actor
        .send(OverlayServiceCommand::Start)
        .expect("start overlay actor");
    actor
        .send(OverlayServiceCommand::SetInteractionActive(true))
        .expect("enable interaction mode");

    wait_until(Duration::from_secs(1), || {
        !actor.drain_input_events().is_empty()
    });
    assert!(actor.drain_input_events().is_empty());

    actor
        .send(OverlayServiceCommand::Stop)
        .expect("stop overlay");
}

#[test]
fn overlay_input_event_sink_caps_backlog_and_keeps_latest_events() {
    let sink = OverlayInputEventSink::default();
    for index in 0..600 {
        sink.push(OverlayInputEvent {
            surface_id: OverlaySurfaceId::new("interactive-dummy"),
            panel_id: format!("dummy-{index}"),
            hand: OverlayHand::Left,
            uv: UvPoint::new(0.5, 0.5),
            kind: OverlayInputKind::Hover,
        });
    }

    let drained = sink.drain();

    assert_eq!(drained.len(), 512);
    assert_eq!(
        drained.first().map(|event| event.panel_id.as_str()),
        Some("dummy-88")
    );
    assert_eq!(
        drained.last().map(|event| event.panel_id.as_str()),
        Some("dummy-599")
    );
}

#[test]
fn overlay_actor_ticks_faster_while_interaction_active() {
    let ticks = Arc::new(AtomicUsize::new(0));
    let actor = OverlayActorHandle::spawn_with_backend(TickCountingBackend {
        ticks: Arc::clone(&ticks),
    });

    actor
        .send(OverlayServiceCommand::Start)
        .expect("start overlay actor");
    actor
        .send(OverlayServiceCommand::SetInteractionActive(true))
        .expect("enable interaction mode");

    wait_until(Duration::from_secs(2), || {
        ticks.load(Ordering::Acquire) >= 3
    });

    actor
        .send(OverlayServiceCommand::SetInteractionActive(false))
        .expect("disable interaction mode");
    actor
        .send(OverlayServiceCommand::Stop)
        .expect("stop overlay");
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
        interactive: false,
    }
}

fn wrist_surface_id() -> OverlaySurfaceId {
    OverlaySurfaceId::new("wrist")
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

struct RecordingBackend {
    calls: Arc<Mutex<Vec<String>>>,
}

impl OverlayBackend for RecordingBackend {
    fn start(&mut self) -> Result<(), BackendStartError> {
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

    fn set_alpha(&mut self, surface_id: &OverlaySurfaceId, alpha: f32) -> Result<(), String> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("alpha:{}:{alpha:.2}", surface_id.as_str()));
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
    fn start(&mut self) -> Result<(), BackendStartError> {
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

struct UnsupportedStartBackend;

impl OverlayBackend for UnsupportedStartBackend {
    fn start(&mut self) -> Result<(), BackendStartError> {
        Err(BackendStartError::permanent("runtime unsupported"))
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

struct FailingStartBackend {
    calls: Arc<Mutex<Vec<String>>>,
}

impl OverlayBackend for FailingStartBackend {
    fn start(&mut self) -> Result<(), BackendStartError> {
        self.calls.lock().unwrap().push("start".to_string());
        Err(BackendStartError::transient("start failed"))
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

#[derive(Default)]
struct RuntimeQuitBackend {
    stops: Arc<AtomicUsize>,
}

impl OverlayBackend for RuntimeQuitBackend {
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
        Ok(())
    }

    fn hide(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
        Ok(())
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        Ok(Vec::new())
    }

    fn tick(&mut self) -> TickOutcome {
        TickOutcome::RuntimeQuit
    }

    fn stop(&mut self) {
        self.stops.fetch_add(1, Ordering::AcqRel);
    }
}

struct TickCountingBackend {
    ticks: Arc<AtomicUsize>,
}

impl OverlayBackend for TickCountingBackend {
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
        Ok(())
    }

    fn hide(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
        Ok(())
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        Ok(Vec::new())
    }

    fn tick(&mut self) -> TickOutcome {
        self.ticks.fetch_add(1, Ordering::AcqRel);
        TickOutcome::Continue
    }

    fn stop(&mut self) {}
}

struct InputPushingBackend {
    sink: OverlayInputEventSink,
    pushed: bool,
}

impl OverlayBackend for InputPushingBackend {
    fn set_input_event_sink(&mut self, sink: OverlayInputEventSink) {
        self.sink = sink;
    }

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
        Ok(())
    }

    fn hide(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
        Ok(())
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        Ok(Vec::new())
    }

    fn tick(&mut self) -> TickOutcome {
        if !self.pushed {
            self.sink.push(OverlayInputEvent {
                surface_id: OverlaySurfaceId::new("interactive-dummy"),
                panel_id: "dummy".to_string(),
                hand: OverlayHand::Left,
                uv: UvPoint::new(0.5, 0.5),
                kind: OverlayInputKind::Summon {
                    transform: OverlayTransform::identity(),
                },
            });
            self.pushed = true;
        }
        TickOutcome::Continue
    }

    fn stop(&mut self) {}
}
