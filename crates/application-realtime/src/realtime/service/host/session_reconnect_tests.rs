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

#[test]
fn friend_ws_dispatch_fans_out_one_canonical_output() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("friend-dispatch-fanout")?;
    let active = runtime
        .state
        .lock()
        .unwrap()
        .connection
        .active_context
        .clone()
        .unwrap();
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(active.generation),
        HashMap::new(),
    )?;
    runtime.take_events_for_test();
    runtime.activity_sink_for_test().take_friend_projections();

    let sink = RealtimeHostRuntimeMessageSink {
        runtime: Arc::clone(&runtime),
    };
    sink.handle_realtime_ws_message(
        active.generation,
        active.session_generation,
        &active_session,
        &RealtimeWsMessagePayload {
            json: json!({
                "type": "friend-add",
                "content": {
                    "userId": "usr_friend",
                    "user": {
                        "id": "usr_friend",
                        "displayName": "Friend",
                        "state": "online"
                    }
                }
            }),
            raw: "{}".into(),
            received_at: "2026-07-18T00:00:00Z".into(),
        },
    );

    let snapshot = runtime.friend_snapshot().expect("friend baseline");
    let friend = snapshot
        .friends_by_id
        .get("usr_friend")
        .expect("friend-add should update the canonical snapshot");
    assert_eq!(friend.display_name, "Friend");
    assert_eq!(friend.state_bucket, "offline");

    let current = vrcx_0_persistence::friends::friend_log_current_list(
        runtime.database(),
        active_session.user_id.clone(),
    )?;
    assert_eq!(current.len(), 1);
    assert_eq!(current[0].user_id, "usr_friend");
    assert_eq!(current[0].display_name, "Friend");
    let history = vrcx_0_persistence::friends::friend_log_history_query(
        runtime.database(),
        vrcx_0_persistence::friends::FriendLogHistoryQueryInput {
            user_id: active_session.user_id.clone(),
            target_user_id: "usr_friend".into(),
            types: vec!["Friend".into()],
        },
    )?;
    assert_eq!(history.len(), 1);

    let activity_projections = runtime.activity_sink_for_test().take_friend_projections();
    assert_eq!(activity_projections.len(), 1);
    let events = runtime.take_events_for_test();
    let frontend_projections = events
        .iter()
        .filter(|event| event.name == "realtimeFriendProjection")
        .collect::<Vec<_>>();
    assert_eq!(frontend_projections.len(), 1);
    assert_eq!(
        events
            .iter()
            .filter(|event| event.name == "realtimeUserProjection")
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| {
                event.name == "backendRuntimeTelemetry" && event.payload["kind"] == "wsPersisted"
            })
            .count(),
        1
    );
    assert_eq!(
        frontend_projections[0].payload,
        serde_json::to_value(&activity_projections[0]).expect("serialize activity projection")
    );

    let cached = runtime
        .user_cache
        .get_user(&active_session.endpoint, "usr_friend")
        .expect("friend projection should update user facts");
    assert_eq!(cached.get("displayName"), Some(&json!("Friend")));
    assert_eq!(cached.get("isFriend"), Some(&json!(true)));
    Ok(())
}

#[test]
fn friend_ws_without_baseline_has_no_fanout() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-dispatch-missing-baseline")?;
    let active = runtime
        .state
        .lock()
        .unwrap()
        .connection
        .active_context
        .clone()
        .unwrap();
    runtime.take_events_for_test();
    runtime.activity_sink_for_test().take_friend_projections();

    let sink = RealtimeHostRuntimeMessageSink {
        runtime: Arc::clone(&runtime),
    };
    sink.handle_realtime_ws_message(
        active.generation,
        active.session_generation,
        &active_session,
        &RealtimeWsMessagePayload {
            json: json!({
                "type": "friend-add",
                "content": {
                    "userId": "usr_friend",
                    "user": { "id": "usr_friend", "displayName": "Friend" }
                }
            }),
            raw: "{}".into(),
            received_at: "2026-07-18T00:00:00Z".into(),
        },
    );

    assert!(runtime.friend_snapshot().is_none());
    assert!(vrcx_0_persistence::friends::friend_log_current_list(
        runtime.database(),
        active_session.user_id.clone(),
    )?
    .is_empty());
    assert!(runtime
        .activity_sink_for_test()
        .take_friend_projections()
        .is_empty());
    assert!(runtime
        .user_cache
        .get_user(&active_session.endpoint, "usr_friend")
        .is_none());
    let events = runtime.take_events_for_test();
    assert!(events.iter().all(|event| {
        event.name != "realtimeFriendProjection" && event.name != "realtimeUserProjection"
    }));
    assert!(events.iter().all(|event| {
        event.name != "backendRuntimeTelemetry" || event.payload["kind"] != "wsPersisted"
    }));
    Ok(())
}

#[test]
fn connected_after_reconnect_without_snapshot_resumes_queued_friend_events() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("reconnect-drain")?;
    let active = runtime
        .state
        .lock()
        .unwrap()
        .connection
        .active_context
        .clone()
        .unwrap();
    let mut friends_by_id = HashMap::new();
    friends_by_id.insert(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".to_string(),
            state: "online".to_string(),
            state_bucket: "online".to_string(),
            location: "wrld_old:123".to_string(),
            ..FriendRecord::default()
        },
    );
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(active.generation),
        friends_by_id,
    )?;
    runtime.deps.event_bus.take_events_for_test();

    let sink = RealtimeHostRuntimeMessageSink {
        runtime: Arc::clone(&runtime),
    };
    sink.handle_realtime_transport_status(
        active.generation,
        active.session_generation,
        &active_session,
        "reconnecting",
    );
    sink.handle_realtime_ws_message(
        active.generation,
        active.session_generation,
        &active_session,
        &RealtimeWsMessagePayload {
            json: json!({
                "type": "friend-location",
                "content": {
                    "userId": "usr_friend",
                    "location": "wrld_new:456"
                }
            }),
            raw: "{}".into(),
            received_at: "2026-06-08T10:05:00Z".into(),
        },
    );
    assert!(
        runtime
            .state
            .lock()
            .unwrap()
            .connection
            .friend_messages_paused
    );

    sink.handle_realtime_transport_status(
        active.generation,
        active.session_generation,
        &active_session,
        "connected",
    );
    assert!(runtime.activity_sink_for_test().delivery_armed());

    let events = runtime.deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("queued friend event should be drained after reconnect");
    assert!(
        !runtime
            .state
            .lock()
            .unwrap()
            .connection
            .friend_messages_paused
    );
    assert_eq!(projection.payload["patches"][0]["userId"], "usr_friend");
    assert_eq!(
        projection.payload["patches"][0]["patch"]["location"],
        "wrld_new:456"
    );
    Ok(())
}

#[test]
fn passive_reconnect_resumes_stream_without_refetching_roster() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("reconnect-no-refetch")?;
    let active = runtime
        .state
        .lock()
        .unwrap()
        .connection
        .active_context
        .clone()
        .unwrap();
    let mut friends_by_id = HashMap::new();
    friends_by_id.insert(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".to_string(),
            state: "online".to_string(),
            state_bucket: "online".to_string(),
            location: "wrld_1:123".to_string(),
            ..FriendRecord::default()
        },
    );
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(active.generation),
        friends_by_id,
    )?;
    {
        let mut state = runtime.state.lock().unwrap();
        state.friend_baseline.pending = Some(PendingFriendBaseline {
            session: active_session.clone(),
            friends_by_id: [(
                "usr_friend".to_string(),
                FriendRecord {
                    id: "usr_friend".to_string(),
                    display_name: "Polluted Baseline".to_string(),
                    state: "offline".to_string(),
                    state_bucket: "offline".to_string(),
                    location: "offline".to_string(),
                    ..FriendRecord::default()
                },
            )]
            .into_iter()
            .collect(),
            feed_entries: Vec::new(),
            projection: FriendProjection::default(),
        });
    }

    let sink = RealtimeHostRuntimeMessageSink {
        runtime: Arc::clone(&runtime),
    };
    sink.handle_realtime_transport_status(
        active.generation,
        active.session_generation,
        &active_session,
        "reconnecting",
    );
    assert!(
        runtime
            .state
            .lock()
            .unwrap()
            .connection
            .friend_messages_paused
    );
    sink.handle_realtime_ws_message(
        active.generation,
        active.session_generation,
        &active_session,
        &RealtimeWsMessagePayload {
            json: json!({
                "type": "friend-location",
                "content": {
                    "userId": "usr_friend",
                    "location": "wrld_2:456"
                }
            }),
            raw: "{}".into(),
            received_at: "2026-06-08T10:05:00Z".into(),
        },
    );
    sink.handle_realtime_transport_status(
        active.generation,
        active.session_generation,
        &active_session,
        "connected",
    );

    assert!(
        !runtime
            .state
            .lock()
            .unwrap()
            .connection
            .friend_messages_paused
    );
    let snapshot = runtime.friend_snapshot().unwrap();
    let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
    assert_eq!(friend.state_bucket, "online");
    assert_eq!(friend.display_name, "Friend");
    assert_eq!(friend.location, "wrld_2:456");
    assert!(runtime
        .state
        .lock()
        .unwrap()
        .friend_baseline
        .pending
        .is_some());
    Ok(())
}

#[test]
fn sync_friend_snapshot_caches_pre_active_baseline() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("pre-active-baseline")?;
    {
        let mut state = runtime.state.lock().unwrap();
        state.connection.active_context = None;
    }
    let mut friends_by_id = HashMap::new();
    friends_by_id.insert(
        "usr_cached".to_string(),
        FriendRecord {
            id: "usr_cached".to_string(),
            display_name: "Cached Friend".to_string(),
            state: "online".to_string(),
            state_bucket: "online".to_string(),
            ..FriendRecord::default()
        },
    );

    let result = runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        None,
        friends_by_id,
    )?;

    let state = runtime.state.lock().unwrap();
    let pending = state.friend_baseline.pending.as_ref().unwrap();
    assert!(result.accepted);
    assert_eq!(result.friend_count, 1);
    assert_eq!(pending.session, active_session);
    assert!(pending.friends_by_id.contains_key("usr_cached"));
    Ok(())
}

#[test]
fn pending_baseline_trust_feed_projects_once_after_start_without_rewriting() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("pending-baseline-trust")?;
    {
        let mut state = runtime.state.lock().unwrap();
        state.connection.active_context = None;
    }
    config_store::set_bool(runtime.deps.db.as_ref(), "friendLogInit_usr_self", true)?;
    write_realtime_batch(
        runtime.deps.db.as_ref(),
        "usr_self",
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![vrcx_0_persistence::realtime::FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Known User".into(),
                friend_number: 7,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    let watermark = runtime.capture_friend_baseline_watermark()?;
    let friend = FriendRecord {
        id: "usr_friend".into(),
        display_name: "Friend".into(),
        extra: [("$trustLevel".into(), json!("Trusted User"))]
            .into_iter()
            .collect(),
        ..FriendRecord::default()
    };

    let outcome = runtime.sync_friend_snapshot_with_watermark(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        watermark,
        [("usr_friend".to_string(), friend)].into_iter().collect(),
    )?;
    assert!(outcome.friend_log_changed);
    assert!(runtime
        .deps
        .event_bus
        .take_events_for_test()
        .iter()
        .all(|event| {
            event.name != "realtimeFriendProjection"
                || event.payload["feedEntries"]
                    .as_array()
                    .is_none_or(Vec::is_empty)
        }));
    let history_count_before = vrcx_0_persistence::friends::friend_log_history_query(
        runtime.deps.db.as_ref(),
        vrcx_0_persistence::friends::FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: "usr_friend".into(),
            types: vec!["TrustLevel".into()],
        },
    )?
    .len();

    runtime.deps.tasks.set_executor(DiscardTaskExecutor);
    runtime.start(
        active_session.user_id,
        active_session.endpoint,
        active_session.websocket,
        1,
        json!({"id": "usr_self"}),
        HashMap::new(),
    )?;

    let events = runtime.deps.event_bus.take_events_for_test();
    let trust_entries = events
        .iter()
        .filter(|event| event.name == "realtimeFriendProjection")
        .flat_map(|event| {
            event.payload["feedEntries"]
                .as_array()
                .into_iter()
                .flatten()
        })
        .filter(|entry| entry["type"] == "TrustLevel")
        .count();
    assert_eq!(trust_entries, 1);
    let history_count_after = vrcx_0_persistence::friends::friend_log_history_query(
        runtime.deps.db.as_ref(),
        vrcx_0_persistence::friends::FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: "usr_friend".into(),
            types: vec!["TrustLevel".into()],
        },
    )?
    .len();
    assert_eq!(history_count_after, history_count_before);
    assert!(runtime
        .state
        .lock()
        .unwrap()
        .friend_baseline
        .pending
        .is_none());
    Ok(())
}
