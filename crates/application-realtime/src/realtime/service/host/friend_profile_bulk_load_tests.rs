use super::friend_profile_bulk_load::{
    friend_profile_bulk_load_backoff_delay_ms, friend_profile_bulk_load_initial_progress,
    reserve_friend_profile_bulk_load_request_slot, select_friend_profile_bulk_load_targets,
    should_emit_friend_profile_bulk_load_progress, FriendProfileBulkLoadStatus,
};
use super::state::ActiveRealtimeContext;
use super::test_support::*;
use super::*;
use vrcx_0_application_core::{RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle};

#[derive(Clone, Copy)]
struct DiscardTaskExecutor;

struct FinishedTaskHandle;

impl RuntimeTaskExecutor for DiscardTaskExecutor {
    fn spawn(&self, _task: RuntimeTask) -> Box<dyn RuntimeTaskHandle> {
        Box::new(FinishedTaskHandle)
    }
}

impl RuntimeTaskHandle for FinishedTaskHandle {
    fn abort(&self) {}

    fn is_finished(&self) -> bool {
        true
    }

    fn join_or_abort(&mut self, _timeout: Duration) {}
}

fn friend_record(extra: serde_json::Value) -> FriendRecord {
    let mut value = extra;
    value["id"] = json!(value["id"].as_str().unwrap_or("usr_test"));
    serde_json::from_value(value).unwrap()
}

#[test]
fn select_targets_includes_friends_missing_date_joined() {
    let mut friends_by_id = HashMap::new();
    friends_by_id.insert(
        "usr_a".to_string(),
        friend_record(json!({"id": "usr_a", "displayName": "A"})),
    );
    friends_by_id.insert(
        "usr_b".to_string(),
        friend_record(json!({"id": "usr_b", "displayName": "B", "date_joined": ""})),
    );
    friends_by_id.insert(
        "usr_c".to_string(),
        friend_record(json!({"id": "usr_c", "displayName": "C", "date_joined": "2026-01-01"})),
    );

    let targets = select_friend_profile_bulk_load_targets(&friends_by_id);
    assert_eq!(targets, vec!["usr_a".to_string(), "usr_b".to_string()]);
}

#[test]
fn select_targets_excludes_fully_loaded_roster() {
    let mut friends_by_id = HashMap::new();
    friends_by_id.insert(
        "usr_a".to_string(),
        friend_record(json!({"id": "usr_a", "date_joined": "2026-01-01"})),
    );
    assert!(select_friend_profile_bulk_load_targets(&friends_by_id).is_empty());
}

#[test]
fn backoff_delay_grows_exponentially_from_base() {
    assert_eq!(friend_profile_bulk_load_backoff_delay_ms(0), 500);
    assert_eq!(friend_profile_bulk_load_backoff_delay_ms(1), 1_000);
    assert_eq!(friend_profile_bulk_load_backoff_delay_ms(2), 2_000);
    assert_eq!(friend_profile_bulk_load_backoff_delay_ms(3), 4_000);
}

#[test]
fn initial_progress_counts_preloaded_friends_in_the_full_roster() {
    assert_eq!(
        friend_profile_bulk_load_initial_progress(170, 118),
        (170, 52)
    );
}

#[test]
fn request_slots_are_globally_spaced_across_workers() {
    let start = tokio::time::Instant::now();
    let mut next_request_at = start;
    assert_eq!(
        reserve_friend_profile_bulk_load_request_slot(start, &mut next_request_at),
        start
    );
    assert_eq!(
        reserve_friend_profile_bulk_load_request_slot(
            start + Duration::from_millis(10),
            &mut next_request_at,
        ),
        start + Duration::from_millis(1_000)
    );
    assert_eq!(next_request_at, start + Duration::from_millis(2_000));
}

#[test]
fn progress_throttle_always_emits_terminal_and_first_events() {
    assert!(should_emit_friend_profile_bulk_load_progress(
        true, 1, 0, 1_000, 900
    ));
    assert!(should_emit_friend_profile_bulk_load_progress(
        false, 1, 0, 1_000, 0
    ));
}

#[test]
fn progress_throttle_gates_on_interval_or_processed_delta() {
    // Neither the 250ms interval nor the 10-item delta has elapsed: skip.
    assert!(!should_emit_friend_profile_bulk_load_progress(
        false, 5, 0, 1_100, 1_000
    ));
    // Interval elapsed: emit.
    assert!(should_emit_friend_profile_bulk_load_progress(
        false, 5, 0, 1_260, 1_000
    ));
    // Processed delta elapsed: emit.
    assert!(should_emit_friend_profile_bulk_load_progress(
        false, 10, 0, 1_100, 1_000
    ));
}

#[test]
fn start_requires_active_realtime_session() -> Result<()> {
    let dir = TestDir::new("friend-profile-bulk-load-no-session");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let storage = StorageService::new(&dir.path.join("storage.json"))?;
    let web = Arc::new(WebClient::new(
        &storage,
        db.as_ref(),
        "wss://pipeline.vrchat.cloud".to_string(),
        env!("CARGO_PKG_VERSION"),
    )?);
    let world_cache = Arc::new(vrcx_0_application_core::WorldCache::new(
        Arc::clone(&db),
        512,
        Duration::from_secs(30 * 60),
    ));
    let runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
        db,
        web,
        event_bus: RuntimeEventBus::new(),
        sync: RuntimeSyncEngine::new(),
        tasks: TaskSupervisor::new(),
        session: HostSessionRuntime::new(),
        auth_scope: RuntimeAuthScope::new(),
        local_game_context: Arc::new(UnavailableLocalGameContextSource),
        activity_sink: None,
        world_cache,
        print_cleanup: Arc::new(vrcx_0_application_core::NoopPrintCleanupInputSink),
        friend_note_change_sink: None,
    }));

    assert!(runtime.start_friend_profile_bulk_load().is_err());
    Ok(())
}

#[test]
fn start_completes_immediately_when_no_targets() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-profile-bulk-load-empty")?;
    runtime.friends.set_baseline(
        vrcx_0_core::friends::FriendRosterBaseline {
            current_user_id: active_session.user_id.clone(),
            endpoint: active_session.endpoint.clone(),
            websocket: active_session.websocket.clone(),
            friends_by_id: {
                let mut map = HashMap::new();
                map.insert(
                    "usr_a".to_string(),
                    friend_record(json!({"id": "usr_a", "date_joined": "2026-01-01"})),
                );
                map
            },
        },
        7,
        1,
    );

    let payload = runtime.start_friend_profile_bulk_load()?;
    assert_eq!(payload.status, FriendProfileBulkLoadStatus::Completed);
    assert_eq!(payload.total, 1);
    assert_eq!(payload.processed, 1);
    Ok(())
}

#[test]
fn start_is_idempotent_while_a_run_is_active() -> Result<()> {
    let (_dir, runtime, _active_session) =
        runtime_with_active_session("friend-profile-bulk-load-idempotent")?;
    runtime.test_force_friend_profile_bulk_load_running(5, 3);

    let payload = runtime.start_friend_profile_bulk_load()?;
    assert_eq!(payload.run_id, 5);
    assert_eq!(payload.status, FriendProfileBulkLoadStatus::Running);
    assert_eq!(payload.total, 3);
    Ok(())
}

#[test]
fn start_replaces_run_owned_by_stale_realtime_session() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-profile-bulk-load-stale-owner")?;
    runtime.test_force_friend_profile_bulk_load_running(5, 3);
    {
        let mut state = runtime.state.lock().unwrap();
        let active = state.connection.active_context.as_mut().unwrap();
        active.generation = 8;
        active.client_run_id = 2;
    }
    runtime.friends.set_baseline(
        vrcx_0_core::friends::FriendRosterBaseline {
            current_user_id: active_session.user_id.clone(),
            endpoint: active_session.endpoint.clone(),
            websocket: active_session.websocket,
            friends_by_id: {
                let mut map = HashMap::new();
                map.insert(
                    "usr_a".to_string(),
                    friend_record(json!({"id": "usr_a", "date_joined": "2026-01-01"})),
                );
                map
            },
        },
        8,
        1,
    );

    let payload = runtime.start_friend_profile_bulk_load()?;
    assert_eq!(payload.run_id, 6);
    assert_eq!(payload.status, FriendProfileBulkLoadStatus::Completed);
    Ok(())
}

#[test]
fn cancel_transitions_running_to_cancelling() -> Result<()> {
    let (_dir, runtime, _active_session) =
        runtime_with_active_session("friend-profile-bulk-load-cancel")?;
    runtime.test_force_friend_profile_bulk_load_running(9, 2);

    let payload = runtime.cancel_friend_profile_bulk_load()?;
    assert_eq!(payload.run_id, 9);
    assert_eq!(payload.status, FriendProfileBulkLoadStatus::Cancelling);
    Ok(())
}

#[test]
fn cancel_prevents_in_flight_progress_from_advancing() -> Result<()> {
    let (_dir, runtime, _active_session) =
        runtime_with_active_session("friend-profile-bulk-load-cancel-progress")?;
    runtime.test_force_friend_profile_bulk_load_running(10, 2);

    let payload = runtime.cancel_friend_profile_bulk_load()?;
    assert_eq!(payload.processed, 0);
    assert!(!runtime.test_friend_profile_bulk_load_record_progress(10, true, false));
    let payload = runtime.friend_profile_bulk_load_status();
    assert_eq!(payload.status, FriendProfileBulkLoadStatus::Cancelling);
    assert_eq!(payload.processed, 0);
    assert_eq!(payload.loaded, 0);
    Ok(())
}

#[test]
fn cancel_is_a_noop_when_idle() -> Result<()> {
    let (_dir, runtime, _active_session) =
        runtime_with_active_session("friend-profile-bulk-load-cancel-idle")?;
    let payload = runtime.cancel_friend_profile_bulk_load()?;
    assert_eq!(payload.status, FriendProfileBulkLoadStatus::Idle);
    Ok(())
}

#[test]
fn realtime_stop_cancels_active_bulk_load_immediately() -> Result<()> {
    let (_dir, runtime, _active_session) =
        runtime_with_active_session("friend-profile-bulk-load-session-stop")?;
    runtime.test_force_friend_profile_bulk_load_running(11, 4);

    runtime.stop(RealtimeStopRequest {
        generation: Some(7),
        ..RealtimeStopRequest::default()
    });

    let payload = runtime.friend_profile_bulk_load_status();
    assert_eq!(payload.run_id, 11);
    assert_eq!(payload.status, FriendProfileBulkLoadStatus::Cancelled);
    assert_eq!(payload.processed, 0);
    assert!(payload.finished_at.is_some());
    assert!(!runtime.test_friend_profile_bulk_load_record_progress(11, true, false));
    assert_eq!(runtime.friend_profile_bulk_load_status().processed, 0);
    Ok(())
}

#[test]
fn transport_finished_cancels_active_bulk_load_and_rejects_stale_progress() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-profile-bulk-load-transport-finished")?;
    runtime.test_force_friend_profile_bulk_load_running(12, 4);
    let active = runtime
        .state
        .lock()
        .unwrap()
        .connection
        .active_context
        .clone()
        .unwrap();
    let sink = RealtimeHostRuntimeMessageSink {
        runtime: Arc::clone(&runtime),
    };

    sink.handle_realtime_transport_finished(
        active.generation,
        active.session_generation,
        &active_session,
    );

    let payload = runtime.friend_profile_bulk_load_status();
    assert_eq!(payload.run_id, 12);
    assert_eq!(payload.status, FriendProfileBulkLoadStatus::Cancelled);
    assert_eq!(payload.processed, 0);
    assert!(payload.finished_at.is_some());
    assert!(runtime
        .state
        .lock()
        .unwrap()
        .connection
        .active_context
        .is_none());
    assert!(!runtime.test_friend_profile_bulk_load_record_progress(12, true, false));
    assert_eq!(runtime.friend_profile_bulk_load_status().processed, 0);
    Ok(())
}

#[test]
fn session_replacement_cancels_old_run_without_blocking_the_new_owner() -> Result<()> {
    let (_dir, runtime, _active_session) =
        runtime_with_active_session("friend-profile-bulk-load-session-replacement")?;
    runtime.deps.tasks.set_executor(DiscardTaskExecutor);
    runtime.test_force_friend_profile_bulk_load_running(13, 4);

    runtime.start(
        "usr_next".into(),
        "https://api.vrchat.cloud/api/1".into(),
        "wss://pipeline.vrchat.cloud".into(),
        2,
        json!({"id": "usr_next"}),
        HashMap::new(),
    )?;

    let cancelled = runtime.friend_profile_bulk_load_status();
    assert_eq!(cancelled.run_id, 13);
    assert_eq!(cancelled.status, FriendProfileBulkLoadStatus::Cancelled);
    assert_eq!(cancelled.processed, 0);
    assert!(cancelled.finished_at.is_some());
    assert!(!runtime.test_friend_profile_bulk_load_record_progress(13, true, false));

    let next = runtime.start_friend_profile_bulk_load()?;
    assert_eq!(next.run_id, 14);
    assert_eq!(next.status, FriendProfileBulkLoadStatus::Completed);
    assert_eq!(next.total, 0);
    Ok(())
}

#[test]
fn bulk_profile_refresh_marks_only_its_own_projections() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-profile-bulk-load-projection-source")?;
    runtime.friends.set_baseline(
        vrcx_0_core::friends::FriendRosterBaseline {
            current_user_id: active_session.user_id.clone(),
            endpoint: active_session.endpoint.clone(),
            websocket: active_session.websocket.clone(),
            friends_by_id: {
                let mut map = HashMap::new();
                map.insert(
                    "usr_friend".to_string(),
                    friend_record(json!({"id": "usr_friend", "displayName": "Friend"})),
                );
                map
            },
        },
        7,
        1,
    );

    assert!(runtime.apply_friend_profile_refresh_with_source(
        active_session.endpoint,
        "usr_friend".to_string(),
        json!({
            "id": "usr_friend",
            "displayName": "Friend",
            "state": "offline",
            "status": "active",
            "date_joined": "2026-01-01"
        }),
        Some(RealtimeProjectionSource::FriendProfileBulkLoad),
    )?);

    let events = runtime.deps.event_bus.take_events_for_test();
    for event_name in ["realtimeUserProjection", "realtimeFriendProjection"] {
        let event = events
            .iter()
            .find(|event| event.name == event_name)
            .unwrap();
        assert_eq!(event.payload["source"], "friendProfileBulkLoad");
    }
    Ok(())
}

#[test]
fn worker_stops_when_realtime_scope_no_longer_matches() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-profile-bulk-load-scope")?;
    runtime.test_force_friend_profile_bulk_load_running(3, 1);
    let active = ActiveRealtimeContext {
        session: active_session,
        generation: 7,
        client_run_id: 1,
        session_generation: 999, // stale session generation: no longer current.
    };

    assert!(!runtime.test_friend_profile_bulk_load_is_current(3, &active));
    Ok(())
}
