// Keep the historical test namespace stable while production session ownership lives in ports.
#[cfg(test)]
mod tests {
    use crate::ports::{HostSessionGameProcessStatus as GameProcessStatus, HostSessionRuntime};
    use vrcx_0_core::realtime::RealtimeSessionContext;

    #[test]
    fn tracks_game_process_generation_and_times() {
        let runtime = HostSessionRuntime::new();

        let initial = runtime.apply_game_process_status(GameProcessStatus {
            is_game_running: false,
            is_steamvr_running: false,
            changed_at: "2026-05-15T00:00:00Z".into(),
        });
        assert!(!initial.game_changed);
        assert_eq!(initial.generation, 0);
        assert_eq!(initial.last_game_state_changed_at, None);

        let started = runtime.apply_game_process_status(GameProcessStatus {
            is_game_running: true,
            is_steamvr_running: true,
            changed_at: "2026-05-15T00:01:00Z".into(),
        });
        assert!(started.game_changed);
        assert!(started.steamvr_changed);
        assert_eq!(started.generation, 1);
        assert_eq!(
            started.last_game_started_at.as_deref(),
            Some("2026-05-15T00:01:00Z")
        );
        assert_eq!(
            started.last_game_state_changed_at.as_deref(),
            Some("2026-05-15T00:01:00Z")
        );
        let snapshot = runtime.projection_snapshot();
        assert_eq!(snapshot.is_game_running, started.is_game_running);
        assert_eq!(snapshot.is_steamvr_running, started.is_steamvr_running);
        assert_eq!(snapshot.generation, started.generation);
        assert_eq!(snapshot.last_game_started_at, started.last_game_started_at);
        assert_eq!(
            snapshot.last_game_state_changed_at,
            started.last_game_state_changed_at
        );
        assert!(!snapshot.game_changed);
        assert!(!snapshot.steamvr_changed);
        assert_eq!(snapshot.changed_at, "2026-05-15T00:01:00Z");
        let payload = serde_json::to_value(&started).expect("projection serializes");
        assert_eq!(payload["isSteamVRRunning"], serde_json::json!(true));
        assert!(payload.get("isSteamvrRunning").is_none());

        let stopped = runtime.apply_game_process_status(GameProcessStatus {
            is_game_running: false,
            is_steamvr_running: true,
            changed_at: "2026-05-15T00:10:00Z".into(),
        });
        assert!(stopped.game_changed);
        assert_eq!(stopped.generation, 2);
        assert_eq!(
            stopped.last_game_started_at.as_deref(),
            Some("2026-05-15T00:01:00Z")
        );
        assert_eq!(
            stopped.last_game_state_changed_at.as_deref(),
            Some("2026-05-15T00:10:00Z")
        );
    }

    #[test]
    fn tracks_realtime_context_generation() {
        let runtime = HostSessionRuntime::new();
        let generation = runtime.set_realtime_context(RealtimeSessionContext::new(
            " usr_1 ".into(),
            " https://api.example.test ".into(),
            " wss://pipeline.example.test ".into(),
        ));

        assert_eq!(generation, 1);
        assert!(runtime.is_realtime_generation_active(generation));
        let snapshot = runtime.snapshot();
        let context = snapshot.realtime_context.expect("context should exist");
        assert_eq!(context.user_id, "usr_1");
        assert_eq!(context.endpoint, "https://api.example.test");
        assert_eq!(context.websocket, "wss://pipeline.example.test");

        let stopped_generation = runtime.clear_realtime_context();
        assert_eq!(stopped_generation, 2);
        assert!(!runtime.is_realtime_generation_active(generation));
        assert!(runtime.snapshot().realtime_context.is_none());
    }

    #[test]
    fn clears_realtime_context_only_for_matching_generation() {
        let runtime = HostSessionRuntime::new();
        let generation = runtime.set_realtime_context(RealtimeSessionContext::new(
            "usr_1".into(),
            "https://api.example.test".into(),
            "wss://pipeline.example.test".into(),
        ));

        assert!(!runtime.clear_realtime_context_if_generation(generation + 1));
        assert!(runtime.is_realtime_generation_active(generation));
        assert!(runtime.clear_realtime_context_if_generation(generation));
        assert!(!runtime.is_realtime_generation_active(generation));
        assert!(runtime.snapshot().realtime_context.is_none());
    }
}
