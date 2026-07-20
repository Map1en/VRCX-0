use super::friend_profile::FriendProfileRefreshExpectation;
use super::friend_profile_bulk_load::{
    friend_profile_bulk_load_backoff_delay_ms, friend_profile_bulk_load_initial_progress,
    select_friend_profile_bulk_load_targets, FriendProfileBulkLoadStatus,
};
use super::test_support::*;
use super::*;
use crate::realtime::user_query_cache::UserQueryKind;
use vrcx_0_application_core::vrchat_api::VrchatApiResponse;
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

#[tokio::test]
async fn unexpected_exit_and_same_account_replacement_keep_bulk_worker_active() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-profile-bulk-load-passive-reconnect")?;
    let friends_by_id = HashMap::from([
        (
            "usr_a".to_string(),
            friend_record(json!({"id": "usr_a", "displayName": "A"})),
        ),
        (
            "usr_b".to_string(),
            friend_record(json!({"id": "usr_b", "displayName": "B"})),
        ),
    ]);
    runtime.friends.set_baseline(
        vrcx_0_core::friends::FriendRosterBaseline {
            current_user_id: active_session.user_id.clone(),
            endpoint: active_session.endpoint.clone(),
            websocket: active_session.websocket.clone(),
            friends_by_id: friends_by_id.clone(),
        },
        7,
        1,
    );
    let first_response = Arc::new(VrchatApiResponse {
        status: 200,
        data: json!({"id": "usr_a", "displayName": "A", "date_joined": "2026-01-01"}).to_string(),
    });
    runtime
        .user_query_cache
        .get_or_fetch(
            UserQueryKind::from_request(false, Some(true)),
            &active_session.endpoint,
            "usr_a",
            async move { Ok(first_response) },
        )
        .await
        .expect("first bulk response should be cached");
    let started = runtime.start_friend_profile_bulk_load()?;
    assert_eq!(started.status, FriendProfileBulkLoadStatus::Running);
    for _ in 0..100 {
        if runtime.friend_profile_bulk_load_status().processed == 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(runtime.friend_profile_bulk_load_status().processed, 1);

    let active = runtime
        .state
        .lock()
        .unwrap()
        .connection
        .active_context
        .clone()
        .unwrap();

    runtime.finish_realtime_transport(
        RealtimeTransportStartResult {
            generation: active.generation,
            client_run_id: active.client_run_id,
            session_generation: active.session_generation,
        },
        RealtimeTransportTermination::UnexpectedExit {
            reason: "passive disconnect".into(),
        },
    );
    assert_eq!(
        runtime.friend_profile_bulk_load_status().status,
        FriendProfileBulkLoadStatus::Running
    );

    runtime.deps.tasks.set_executor(DiscardTaskExecutor);
    runtime.start(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        2,
        json!({"id": "usr_self"}),
        friends_by_id,
    )?;
    let second_response = Arc::new(VrchatApiResponse {
        status: 200,
        data: json!({"id": "usr_b", "displayName": "B", "date_joined": "2026-01-01"}).to_string(),
    });
    runtime
        .user_query_cache
        .get_or_fetch(
            UserQueryKind::from_request(false, Some(true)),
            &active_session.endpoint,
            "usr_b",
            async move { Ok(second_response) },
        )
        .await
        .expect("second bulk response should be cached");

    let payload = runtime.friend_profile_bulk_load_status();
    assert_eq!(payload.run_id, started.run_id);
    assert_eq!(payload.status, FriendProfileBulkLoadStatus::Running);
    for _ in 0..200 {
        if runtime.friend_profile_bulk_load_status().status
            == FriendProfileBulkLoadStatus::Completed
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let payload = runtime.friend_profile_bulk_load_status();
    assert_eq!(payload.status, FriendProfileBulkLoadStatus::Completed);
    assert_eq!(payload.processed, 2);
    assert_eq!(payload.loaded, 2);
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

#[tokio::test]
async fn explicit_stop_keeps_a_real_worker_cancelled_after_it_exits() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-profile-bulk-load-real-worker-stop")?;
    runtime.friends.set_baseline(
        vrcx_0_core::friends::FriendRosterBaseline {
            current_user_id: active_session.user_id.clone(),
            endpoint: active_session.endpoint.clone(),
            websocket: active_session.websocket.clone(),
            friends_by_id: HashMap::from([(
                "usr_a".to_string(),
                friend_record(json!({"id": "usr_a", "displayName": "A"})),
            )]),
        },
        7,
        1,
    );

    let started = runtime.start_friend_profile_bulk_load()?;
    assert_eq!(started.status, FriendProfileBulkLoadStatus::Running);
    runtime.stop(RealtimeStopRequest {
        user_id: Some(active_session.user_id),
        endpoint: Some(active_session.endpoint),
        ..RealtimeStopRequest::default()
    });

    tokio::time::sleep(Duration::from_millis(25)).await;
    let finished = runtime.friend_profile_bulk_load_status();
    assert_eq!(finished.run_id, started.run_id);
    assert_eq!(finished.status, FriendProfileBulkLoadStatus::Cancelled);
    assert!(finished.finished_at.is_some());
    Ok(())
}

#[test]
fn auth_expired_cancels_active_bulk_load_and_rejects_stale_progress() -> Result<()> {
    let (_dir, runtime, _active_session) =
        runtime_with_active_session("friend-profile-bulk-load-auth-expired")?;
    runtime.test_force_friend_profile_bulk_load_running(12, 4);
    let active = runtime
        .state
        .lock()
        .unwrap()
        .connection
        .active_context
        .clone()
        .unwrap();
    runtime.finish_realtime_transport(
        RealtimeTransportStartResult {
            generation: active.generation,
            client_run_id: active.client_run_id,
            session_generation: active.session_generation,
        },
        RealtimeTransportTermination::AuthExpired {
            reason: "session expired".into(),
            status_code: Some(401),
        },
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
fn explicit_stop_during_passive_reconnect_cancels_bulk_load() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-profile-bulk-load-reconnect-stop")?;
    runtime.test_force_friend_profile_bulk_load_running(12, 4);
    let active = runtime
        .state
        .lock()
        .unwrap()
        .connection
        .active_context
        .clone()
        .unwrap();
    runtime.finish_realtime_transport(
        RealtimeTransportStartResult {
            generation: active.generation,
            client_run_id: active.client_run_id,
            session_generation: active.session_generation,
        },
        RealtimeTransportTermination::UnexpectedExit {
            reason: "passive disconnect".into(),
        },
    );

    runtime.stop(RealtimeStopRequest {
        user_id: Some(active_session.user_id),
        endpoint: Some(active_session.endpoint),
        generation: Some(active.generation),
        ..RealtimeStopRequest::default()
    });

    let payload = runtime.friend_profile_bulk_load_status();
    assert_eq!(payload.status, FriendProfileBulkLoadStatus::Cancelled);
    assert!(payload.finished_at.is_some());
    assert!(!runtime.test_friend_profile_bulk_load_record_progress(12, true, false));
    Ok(())
}

#[test]
fn session_replacement_cancels_old_run_without_blocking_the_new_owner() -> Result<()> {
    let (_dir, runtime, _active_session) =
        runtime_with_active_session("friend-profile-bulk-load-session-replacement")?;
    runtime.deps.tasks.set_executor(DiscardTaskExecutor);
    runtime.test_force_friend_profile_bulk_load_running(13, 4);

    runtime
        .auth_scope()
        .set("usr_next", "https://api.vrchat.cloud/api/1");
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
fn bulk_profile_refresh_applies_when_friend_sequence_matches() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-profile-bulk-load-refresh")?;
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
    let expected_sequence = runtime
        .friends
        .friend_state_sequence_for_user(7, "usr_friend")
        .expect("friend should have a causal sequence");
    let profile = json!({
        "id": "usr_friend",
        "displayName": "Friend",
        "state": "offline",
        "status": "active",
        "date_joined": "2026-01-01"
    });

    assert!(!runtime.apply_friend_profile_refresh(
        active_session.endpoint.clone(),
        "usr_friend".to_string(),
        profile.clone(),
        FriendProfileRefreshExpectation {
            generation: 6,
            sequence: expected_sequence,
        },
    )?);
    assert!(runtime.apply_friend_profile_refresh(
        active_session.endpoint.clone(),
        "usr_friend".to_string(),
        profile,
        FriendProfileRefreshExpectation {
            generation: 7,
            sequence: expected_sequence,
        },
    )?);

    let events = runtime.deps.event_bus.take_events_for_test();
    for event_name in ["realtimeUserProjection", "realtimeFriendProjection"] {
        assert!(events.iter().any(|event| event.name == event_name));
    }
    Ok(())
}

#[test]
fn bulk_profile_refresh_is_discarded_when_friend_sequence_advanced() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-profile-bulk-load-refresh-stale")?;
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
    let stale_sequence = runtime
        .friends
        .friend_state_sequence_for_user(7, "usr_friend")
        .expect("friend should have a causal sequence");

    // A websocket update advances the friend-state sequence past the captured one.
    runtime.handle_active_friend_ws_message_for_test(&RealtimeWsMessagePayload {
        json: json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "online",
                    "status": "join me",
                    "statusDescription": "live"
                }
            }
        }),
        raw: "{}".into(),
        received_at: "2026-05-15T00:00:01Z".into(),
    });

    assert!(!runtime.apply_friend_profile_refresh(
        active_session.endpoint.clone(),
        "usr_friend".to_string(),
        json!({
            "id": "usr_friend",
            "displayName": "Friend",
            "state": "offline",
            "status": "active",
            "statusDescription": "stale"
        }),
        FriendProfileRefreshExpectation {
            generation: 7,
            sequence: stale_sequence,
        },
    )?);

    let snapshot = runtime.friend_snapshot().unwrap();
    let friend = &snapshot.friends_by_id["usr_friend"];
    assert_eq!(friend.status, "join me");
    assert_eq!(friend.status_description, "live");
    Ok(())
}

#[tokio::test]
async fn cached_user_response_is_not_replayed_into_friend_state() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-profile-cached-response-no-replay")?;
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

    runtime.handle_active_friend_ws_message_for_test(&RealtimeWsMessagePayload {
        json: json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "online",
                    "status": "join me",
                    "statusDescription": "live"
                }
            }
        }),
        raw: "{}".into(),
        received_at: "2026-05-15T00:00:01Z".into(),
    });

    let stale_profile = json!({
        "id": "usr_friend",
        "displayName": "Friend",
        "state": "offline",
        "status": "active",
        "statusDescription": "stale"
    });
    let canned = std::sync::Arc::new(VrchatApiResponse {
        status: 200,
        data: stale_profile.to_string(),
    });
    runtime
        .user_query_cache
        .get_or_fetch(
            UserQueryKind::from_request(false, Some(true)),
            &active_session.endpoint,
            "usr_friend",
            async move { Ok(canned) },
        )
        .await
        .expect("priming the user query cache should succeed");

    let response = runtime
        .get_user_via_cache(
            active_session.endpoint.clone(),
            "usr_friend".to_string(),
            false,
            false,
            Some(true),
        )
        .await?;
    assert_eq!(response.status, 200);

    let snapshot = runtime.friend_snapshot().unwrap();
    let friend = &snapshot.friends_by_id["usr_friend"];
    assert_eq!(friend.status, "join me");
    assert_eq!(friend.status_description, "live");
    Ok(())
}

#[tokio::test]
async fn cached_user_response_does_not_revert_display_name() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-profile-cached-response-no-rename-flap")?;
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

    let rename_sequence = runtime
        .friends
        .friend_state_sequence_for_user(7, "usr_friend")
        .expect("friend should have a causal sequence");
    assert!(runtime.apply_friend_profile_refresh(
        active_session.endpoint.clone(),
        "usr_friend".to_string(),
        json!({
            "id": "usr_friend",
            "displayName": "Fresh Name",
            "state": "online",
            "status": "active"
        }),
        FriendProfileRefreshExpectation {
            generation: 7,
            sequence: rename_sequence,
        },
    )?);

    let stale_profile = json!({
        "id": "usr_friend",
        "displayName": "Friend",
        "state": "online",
        "status": "active"
    });
    let canned = std::sync::Arc::new(VrchatApiResponse {
        status: 200,
        data: stale_profile.to_string(),
    });
    runtime
        .user_query_cache
        .get_or_fetch(
            UserQueryKind::from_request(false, Some(true)),
            &active_session.endpoint,
            "usr_friend",
            async move { Ok(canned) },
        )
        .await
        .expect("priming the user query cache should succeed");

    let response = runtime
        .get_user_via_cache(
            active_session.endpoint.clone(),
            "usr_friend".to_string(),
            false,
            false,
            Some(true),
        )
        .await?;
    assert_eq!(response.status, 200);

    let snapshot = runtime.friend_snapshot().unwrap();
    assert_eq!(
        snapshot.friends_by_id["usr_friend"].display_name,
        "Fresh Name"
    );
    Ok(())
}
