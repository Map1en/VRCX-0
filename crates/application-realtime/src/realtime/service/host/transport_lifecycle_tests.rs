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

fn active_transport(runtime: &TestRealtimeHostRuntime) -> RealtimeTransportStartResult {
    let active = runtime
        .state
        .lock()
        .unwrap()
        .connection
        .active_context
        .clone()
        .expect("active realtime transport");
    RealtimeTransportStartResult {
        generation: active.generation,
        client_run_id: active.client_run_id,
        session_generation: active.session_generation,
    }
}

fn seed_online_friend(
    runtime: &TestRealtimeHostRuntime,
    session: &RealtimeSessionContext,
    generation: u64,
) -> Result<()> {
    runtime.sync_friend_snapshot(
        session.user_id.clone(),
        session.endpoint.clone(),
        session.websocket.clone(),
        Some(generation),
        [(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".into(),
                display_name: "Friend".into(),
                state: "online".into(),
                state_bucket: "online".into(),
                location: "wrld_old:123".into(),
                ..FriendRecord::default()
            },
        )]
        .into_iter()
        .collect(),
    )?;
    Ok(())
}

#[test]
fn realtime_lifecycle_reports_connected_and_terminal_auth_expiry() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("transport-lifecycle")?;
    let expected = active_transport(&runtime);
    seed_online_friend(&runtime, &active_session, expected.generation)?;
    runtime.current_user.set_snapshot(
        active_session.user_id.clone(),
        expected.generation,
        json!({"id": active_session.user_id.clone()}),
    );
    let mut lifecycle = runtime.subscribe_transport_lifecycle();
    let sink = RealtimeHostRuntimeMessageSink {
        runtime: Arc::clone(&runtime),
    };

    assert!(runtime.transport_is_active(&expected));
    sink.handle_realtime_transport_status(
        expected.generation,
        expected.session_generation,
        &active_session,
        "connected",
    );
    assert_eq!(
        lifecycle.try_recv().unwrap(),
        RealtimeTransportLifecycleEvent::Connected(expected.clone())
    );

    let termination = RealtimeTransportTermination::AuthExpired {
        reason: "auth transport bootstrap failed (403)".into(),
        status_code: Some(403),
    };
    runtime.finish_realtime_transport(expected.clone(), termination.clone());
    assert_eq!(
        lifecycle.try_recv().unwrap(),
        RealtimeTransportLifecycleEvent::Finished {
            transport: expected.clone(),
            termination,
        }
    );
    assert!(!runtime.transport_is_active(&expected));
    assert!(runtime.friend_snapshot().is_none());
    assert!(runtime.current_user_snapshot().is_none());
    Ok(())
}

#[test]
fn stale_auth_expiry_cannot_clear_or_signal_the_active_transport() -> Result<()> {
    let (_dir, runtime, _active_session) = runtime_with_active_session("stale-auth-expiry")?;
    let current = active_transport(&runtime);
    let stale = RealtimeTransportStartResult {
        generation: current.generation.saturating_sub(1),
        client_run_id: current.client_run_id.saturating_sub(1),
        session_generation: current.session_generation.saturating_sub(1),
    };
    let termination = RealtimeTransportTermination::AuthExpired {
        reason: "stale unauthorized response".into(),
        status_code: Some(401),
    };
    let mut lifecycle = runtime.subscribe_transport_lifecycle();
    runtime.take_events_for_test();

    runtime.finish_realtime_transport(stale.clone(), termination.clone());

    assert_eq!(
        lifecycle.try_recv().unwrap(),
        RealtimeTransportLifecycleEvent::Finished {
            transport: stale,
            termination,
        }
    );
    assert!(runtime.transport_is_active(&current));
    assert!(runtime.take_events_for_test().iter().all(|event| {
        event.name != "realtimeWsStatus" || event.payload["status"] != "authFailure"
    }));
    Ok(())
}

#[test]
fn explicit_stop_finishes_without_auth_expiry_or_restart_signal() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("explicit-stop")?;
    let transport = active_transport(&runtime);
    seed_online_friend(&runtime, &active_session, transport.generation)?;
    runtime.current_user.set_snapshot(
        active_session.user_id.clone(),
        transport.generation,
        json!({"id": active_session.user_id.clone()}),
    );
    runtime.take_events_for_test();
    let mut lifecycle = runtime.subscribe_transport_lifecycle();
    runtime.stop(RealtimeStopRequest {
        user_id: Some(active_session.user_id),
        endpoint: Some(active_session.endpoint),
        websocket: Some(active_session.websocket),
        client_run_id: Some(transport.client_run_id),
        generation: Some(transport.generation),
    });

    runtime.finish_realtime_transport(transport.clone(), RealtimeTransportTermination::Stopped);

    assert_eq!(
        lifecycle.try_recv().unwrap(),
        RealtimeTransportLifecycleEvent::Finished {
            transport: transport.clone(),
            termination: RealtimeTransportTermination::Stopped,
        }
    );
    assert!(!runtime.transport_is_active(&transport));
    assert!(runtime.friend_snapshot().is_none());
    assert!(runtime.current_user_snapshot().is_none());
    assert!(runtime.take_events_for_test().iter().all(|event| {
        event.name != "realtimeWsStatus"
            || !matches!(
                event.payload["status"].as_str(),
                Some("authFailure" | "error")
            )
    }));
    Ok(())
}

#[test]
fn unexpected_exit_keeps_old_roster_until_pending_baseline_replacement_starts() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("unexpected-exit-replacement-baseline")?;
    let old_transport = active_transport(&runtime);
    seed_online_friend(&runtime, &active_session, old_transport.generation)?;

    runtime.finish_realtime_transport(
        old_transport.clone(),
        RealtimeTransportTermination::UnexpectedExit {
            reason: "websocket stream ended".into(),
        },
    );

    assert!(!runtime.transport_is_active(&old_transport));
    assert_eq!(
        runtime.friend_snapshot().unwrap().friends_by_id["usr_friend"].location,
        "wrld_old:123"
    );

    let watermark = runtime.capture_friend_baseline_watermark()?;
    assert_eq!(watermark.generation, None);
    let fresh_friends = [(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".into(),
            display_name: "Friend".into(),
            state: "online".into(),
            state_bucket: "online".into(),
            location: "wrld_fresh:456".into(),
            ..FriendRecord::default()
        },
    )]
    .into_iter()
    .collect::<HashMap<_, _>>();
    let outcome = runtime.sync_friend_snapshot_with_watermark(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        watermark,
        fresh_friends,
    )?;
    assert!(outcome.result.accepted);
    assert_eq!(
        runtime.friend_snapshot().unwrap().friends_by_id["usr_friend"].location,
        "wrld_old:123",
        "the last visible roster should remain stable during the reconnect gap"
    );

    runtime.deps.tasks.set_executor(DiscardTaskExecutor);
    let replacement = runtime.start(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        2,
        json!({"id": active_session.user_id.clone()}),
        HashMap::new(),
    )?;
    assert_eq!(
        runtime.friend_snapshot().unwrap().friends_by_id["usr_friend"].location,
        "wrld_fresh:456"
    );

    let sink = RealtimeHostRuntimeMessageSink {
        runtime: Arc::clone(&runtime),
    };
    let friend_add = |user_id: &str| RealtimeWsMessagePayload {
        json: json!({
            "type": "friend-add",
            "content": {
                "userId": user_id,
                "user": { "id": user_id, "displayName": user_id }
            }
        }),
        raw: "{}".into(),
        received_at: "2026-07-20T00:00:00Z".into(),
    };
    sink.handle_realtime_ws_message(
        old_transport.generation,
        old_transport.session_generation,
        &active_session,
        &friend_add("usr_stale"),
    );
    sink.handle_realtime_ws_message(
        replacement.generation,
        replacement.session_generation,
        &active_session,
        &friend_add("usr_live"),
    );
    let snapshot = runtime.friend_snapshot().unwrap();
    assert!(!snapshot.friends_by_id.contains_key("usr_stale"));
    assert!(snapshot.friends_by_id.contains_key("usr_live"));
    Ok(())
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
