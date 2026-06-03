use vrcx_0_application::{GameLogEvent, GameLogEventSink, GameProcessEvent, GameProcessEventSink};
use vrcx_0_core::log_watcher::GameLogEventKind;
use vrcx_0_runtime_host::vr_overlay::VrOverlayRuntime;

#[test]
fn runtime_keeps_overlay_service_stopped_until_user_and_vr_state_are_enabled() {
    let runtime = VrOverlayRuntime::new_for_test();

    runtime
        .on_game_process_event(GameProcessEvent {
            is_game_running: true,
            is_steamvr_running: true,
            game_changed: true,
        })
        .expect("record process status");
    assert!(!runtime.is_running());

    runtime.set_enabled(true);
    assert!(!runtime.is_running());

    runtime
        .ingest_game_log_event(&game_log_event(GameLogEventKind::OpenVrInit))
        .expect("record vr mode");
    assert!(runtime.is_running());

    runtime
        .ingest_game_log_event(&game_log_event(GameLogEventKind::DesktopMode))
        .expect("record desktop mode");
    assert!(!runtime.is_running());

    runtime
        .ingest_game_log_event(&game_log_event(GameLogEventKind::OpenVrInit))
        .expect("record vr mode");
    assert!(runtime.is_running());

    runtime
        .on_game_process_event(GameProcessEvent {
            is_game_running: false,
            is_steamvr_running: true,
            game_changed: true,
        })
        .expect("record process status");
    assert!(!runtime.is_running());
}

#[test]
fn runtime_does_not_start_noop_overlay_when_backend_is_unavailable() {
    let runtime = VrOverlayRuntime::new_for_test_with_backend_available(false);

    runtime
        .on_game_process_event(GameProcessEvent {
            is_game_running: true,
            is_steamvr_running: true,
            game_changed: true,
        })
        .expect("record process status");
    runtime
        .ingest_game_log_event(&game_log_event(GameLogEventKind::OpenVrInit))
        .expect("record vr mode");
    runtime.set_enabled(true);

    assert!(runtime.is_enabled());
    assert!(!runtime.is_running());
}

fn game_log_event(kind: GameLogEventKind) -> GameLogEvent {
    GameLogEvent {
        file_name: "output_log.txt".to_string(),
        created_at: "2026-06-01T12:34:56.000Z".to_string(),
        kind,
    }
}
