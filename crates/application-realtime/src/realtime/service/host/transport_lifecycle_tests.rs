use std::collections::HashMap;
use std::time::Duration;

use super::test_support::*;
use super::*;
use crate::realtime::{RealtimeSessionContext, RealtimeTransportLifecycleEvent};
use vrcx_0_application_core::{
    InstanceRosterMember, InstanceRosterSnapshot, RuntimeTask, RuntimeTaskExecutor,
    RuntimeTaskHandle,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::OwnerId;

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
        .runtime()
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
    runtime.runtime().sync_friend_snapshot(
        session.clone(),
        Some(generation),
        [(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".into(),
                display_name: "Friend".into(),
                state: "online".into(),
                location: "wrld_old:123".into(),
                ..FriendRecord::default()
            },
        )]
        .into_iter()
        .collect(),
    )?;
    Ok(())
}

fn local_friend_roster(joined_at_ms: i64) -> InstanceRosterSnapshot {
    InstanceRosterSnapshot {
        location: "wrld_old:123".into(),
        members: vec![InstanceRosterMember {
            user_id: "usr_friend".into(),
            display_name: "Friend".into(),
            joined_at_ms: Some(joined_at_ms),
        }],
        ..InstanceRosterSnapshot::default()
    }
}

#[test]
fn local_mode_startup_preserves_roster_replayed_before_the_first_baseline() -> Result<()> {
    let (_dir, runtime, session) = runtime_with_active_session("local-mode-startup")?;
    assert!(runtime.runtime().friends.session_context().is_none());
    runtime.prepare_pending_friend_baseline(
        &session,
        HashMap::from([(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".into(),
                state: "online".into(),
                location: "wrld_old:123".into(),
                ..FriendRecord::default()
            },
        )]),
    )?;
    runtime
        .runtime()
        .deps
        .instance_dwell
        .observe_roster(&local_friend_roster(1_000));
    runtime.take_events_for_test();
    runtime.set_task_executor_for_test(DiscardTaskExecutor);

    runtime.runtime().start_from_friend_baseline(
        session.user_id.clone(),
        session.endpoint,
        session.websocket,
        2,
        json!({"id": session.user_id}),
    )?;

    let events = runtime.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .unwrap();
    assert_eq!(
        projection.payload["locationTimeSnapshot"][0]["sinceMs"],
        1_000
    );
    Ok(())
}

#[test]
fn local_mode_leave_publishes_while_the_transport_is_disconnected() -> Result<()> {
    let (_dir, runtime, session) = runtime_with_active_session("local-mode-disconnected")?;
    let transport = active_transport(&runtime);
    seed_online_friend(&runtime, &session, transport.generation)?;
    runtime
        .runtime()
        .deps
        .instance_dwell
        .observe_roster(&local_friend_roster(1_000));
    let weak_runtime = Arc::downgrade(runtime.runtime());
    runtime
        .runtime()
        .deps
        .instance_dwell
        .set_roster_change_callback(Arc::new(move || {
            if let Some(runtime) = weak_runtime.upgrade() {
                runtime.emit_friend_location_time_snapshot();
            }
        }));
    runtime.runtime().finish_realtime_transport(
        transport,
        RealtimeTransportTermination::UnexpectedExit {
            reason: "websocket stream ended".into(),
            connected_secs: Some(60),
        },
    );
    runtime.take_events_for_test();

    let mut left = local_friend_roster(1_000);
    left.members.clear();
    left.departed_user_ids.push("usr_friend".into());
    runtime.runtime().deps.instance_dwell.observe_roster(&left);

    let events = runtime.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("a local leave must not wait for websocket reconnection");
    assert!(
        projection.payload["locationTimeSnapshot"][0]["sinceMs"]
            .as_i64()
            .unwrap()
            > 1_000
    );
    runtime.auth_scope().set("usr_other", &session.endpoint);
    runtime
        .runtime()
        .deps
        .instance_dwell
        .observe_roster(&local_friend_roster(8_000));
    assert!(runtime
        .take_events_for_test()
        .iter()
        .all(|event| event.name != "realtimeFriendProjection"));
    Ok(())
}

#[test]
fn local_mode_stop_after_disconnect_clears_the_previous_session() -> Result<()> {
    let (_dir, runtime, session) = runtime_with_active_session("local-mode-disconnected-stop")?;
    let transport = active_transport(&runtime);
    seed_online_friend(&runtime, &session, transport.generation)?;
    let friends = runtime.runtime().friend_snapshot().unwrap().friends_by_id;
    runtime
        .runtime()
        .deps
        .instance_dwell
        .observe_roster(&local_friend_roster(1_000));
    runtime.runtime().finish_realtime_transport(
        transport,
        RealtimeTransportTermination::UnexpectedExit {
            reason: "websocket stream ended".into(),
            connected_secs: Some(60),
        },
    );
    runtime
        .runtime()
        .sync_friend_snapshot(session.clone(), None, friends.clone())?;

    runtime.runtime().stop(RealtimeStopRequest::default());

    assert!(runtime.runtime().friend_snapshot().is_none());
    assert!(runtime.runtime().deps.instance_dwell.snapshot().is_empty());
    assert!(runtime
        .runtime()
        .state
        .lock()
        .unwrap()
        .friend_baseline
        .pending
        .is_none());
    runtime.auth_scope().set("", "");
    runtime
        .auth_scope()
        .set(&session.user_id, &session.endpoint);
    runtime.take_events_for_test();
    runtime.runtime().emit_friend_location_time_snapshot();
    assert!(runtime.take_events_for_test().is_empty());

    runtime
        .runtime()
        .sync_friend_snapshot(session.clone(), None, friends)?;
    runtime.set_task_executor_for_test(DiscardTaskExecutor);
    runtime.runtime().start_from_friend_baseline(
        session.user_id.clone(),
        session.endpoint,
        session.websocket,
        2,
        json!({"id": session.user_id}),
    )?;
    let times = runtime.runtime().deps.instance_dwell.snapshot();
    assert_eq!(
        times[0].source,
        vrcx_0_application_core::FriendLocationTimeSource::Realtime
    );
    assert!(times[0].since_ms.unwrap() > 1_000);
    Ok(())
}

#[test]
fn local_mode_stop_before_first_connection_preserves_replayed_roster() -> Result<()> {
    let (_dir, runtime, session) = runtime_with_active_session("local-mode-cold-stop")?;
    runtime
        .runtime()
        .state
        .lock()
        .unwrap()
        .connection
        .active_context = None;
    runtime
        .runtime()
        .deps
        .instance_dwell
        .observe_roster(&local_friend_roster(1_000));

    runtime.runtime().stop(RealtimeStopRequest::default());

    runtime.runtime().sync_friend_snapshot(
        session.clone(),
        None,
        HashMap::from([(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".into(),
                state: "online".into(),
                location: "wrld_old:123".into(),
                ..Default::default()
            },
        )]),
    )?;
    runtime.set_task_executor_for_test(DiscardTaskExecutor);
    runtime.runtime().start_from_friend_baseline(
        session.user_id.clone(),
        session.endpoint,
        session.websocket,
        2,
        json!({"id": session.user_id}),
    )?;
    assert_eq!(
        runtime.runtime().deps.instance_dwell.snapshot()[0].since_ms,
        Some(1_000)
    );
    Ok(())
}

#[test]
fn local_mode_scoped_stop_after_disconnect_preserves_reconnect_state() -> Result<()> {
    let (_dir, runtime, session) = runtime_with_active_session("local-mode-scoped-stop")?;
    let transport = active_transport(&runtime);
    seed_online_friend(&runtime, &session, transport.generation)?;
    runtime
        .runtime()
        .deps
        .instance_dwell
        .observe_roster(&local_friend_roster(1_000));
    runtime.runtime().finish_realtime_transport(
        transport.clone(),
        RealtimeTransportTermination::UnexpectedExit {
            reason: "websocket stream ended".into(),
            connected_secs: Some(60),
        },
    );

    runtime.runtime().stop(RealtimeStopRequest {
        client_run_id: Some(transport.client_run_id),
        generation: Some(transport.generation),
        ..Default::default()
    });

    assert!(runtime.runtime().friend_snapshot().is_some());
    assert_eq!(
        runtime.runtime().deps.instance_dwell.snapshot()[0].since_ms,
        Some(1_000)
    );
    Ok(())
}

#[test]
fn fresh_baseline_reconnect_preserves_location_time_without_new_game_logs() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("reconnect-location-time")?;
    let old_transport = active_transport(&runtime);
    seed_online_friend(&runtime, &active_session, old_transport.generation)?;
    runtime
        .runtime()
        .deps
        .instance_dwell
        .observe_roster(&local_friend_roster(1_000));
    let expected_times = runtime.runtime().deps.instance_dwell.snapshot();
    let fresh_friends = runtime.runtime().friend_snapshot().unwrap().friends_by_id;
    let RealtimeFriendApplyResult::Output(output) =
        runtime
            .runtime()
            .friends
            .apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({"type": "friend-offline", "content": {"userId": "usr_friend"}}),
                raw: "{}".into(),
                received_at: "2026-07-20T00:00:00Z".into(),
            })
    else {
        panic!("friend-offline should produce an output");
    };
    let PendingOfflineTimerAction::Schedule { token, .. } = output.timer_action else {
        panic!("friend-offline should schedule a pending timer");
    };
    runtime.runtime().finish_realtime_transport(
        old_transport,
        RealtimeTransportTermination::UnexpectedExit {
            reason: "websocket stream ended".into(),
            connected_secs: Some(60),
        },
    );
    let watermark = runtime.runtime().capture_friend_baseline_watermark()?;
    runtime.runtime().sync_friend_snapshot_with_watermark(
        active_session.clone(),
        watermark,
        fresh_friends,
        FriendStatusVerdicts::default(),
    )?;
    runtime.take_events_for_test();
    runtime.set_task_executor_for_test(DiscardTaskExecutor);

    runtime.runtime().start_from_friend_baseline(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        2,
        json!({"id": active_session.user_id}),
    )?;

    assert_eq!(
        runtime.runtime().deps.instance_dwell.snapshot(),
        expected_times
    );
    let events = runtime.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("reconnect should publish the preserved location times");
    assert_eq!(
        projection.payload["locationTimeSnapshot"],
        serde_json::to_value(expected_times).unwrap()
    );
    assert!(
        !runtime.runtime().friend_snapshot().unwrap().friends_by_id["usr_friend"]
            .extra
            .get("pendingOffline")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    );
    assert!(runtime
        .runtime()
        .friends
        .fire_pending_offline("usr_friend", token, "2026-07-20T00:03:00Z".into(),)
        .is_none());

    for location in ["traveling", "wrld_old:123"] {
        runtime.handle_active_friend_ws_message_for_test(&RealtimeWsMessagePayload {
            json: json!({
                "type": "friend-location",
                "content": {
                    "userId": "usr_friend",
                    "location": location,
                    "travelingToLocation": "wrld_old:123",
                    "user": {"id": "usr_friend"}
                }
            }),
            raw: "{}".into(),
            received_at: "2026-07-20T00:04:00Z".into(),
        });
        assert_eq!(
            runtime.runtime().deps.instance_dwell.snapshot()[0].since_ms,
            Some(1_000)
        );
    }
    Ok(())
}

#[test]
fn fresh_placeholder_baseline_clears_pending_offline_before_syncing_location_time() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("reconnect-placeholder-offline")?;
    let old_transport = active_transport(&runtime);
    seed_online_friend(&runtime, &active_session, old_transport.generation)?;
    runtime.handle_active_friend_ws_message_for_test(&RealtimeWsMessagePayload {
        json: json!({"type": "friend-offline", "content": {"userId": "usr_friend"}}),
        raw: "{}".into(),
        received_at: "2026-07-20T00:00:00Z".into(),
    });
    assert_eq!(
        runtime.runtime().friend_snapshot().unwrap().friends_by_id["usr_friend"].extra
            ["pendingOffline"],
        true,
    );
    runtime.runtime().finish_realtime_transport(
        old_transport,
        RealtimeTransportTermination::UnexpectedExit {
            reason: "websocket stream ended".into(),
            connected_secs: Some(60),
        },
    );
    let placeholder = FriendRecord {
        id: "usr_friend".into(),
        state: "offline".into(),
        extra: [("$profileSource".into(), json!("placeholder"))]
            .into_iter()
            .collect(),
        ..FriendRecord::default()
    };
    runtime.runtime().sync_friend_snapshot(
        active_session.clone(),
        None,
        HashMap::from([("usr_friend".into(), placeholder)]),
    )?;
    runtime.set_task_executor_for_test(DiscardTaskExecutor);

    runtime.runtime().start_from_friend_baseline(
        active_session.user_id.clone(),
        active_session.endpoint,
        active_session.websocket,
        2,
        json!({"id": active_session.user_id}),
    )?;

    let snapshot = runtime.runtime().friend_snapshot().unwrap();
    let friend = &snapshot.friends_by_id["usr_friend"];
    assert_eq!(friend.state, "offline");
    assert!(!friend.extra.contains_key("pendingOffline"));
    assert_eq!(
        runtime.runtime().deps.instance_dwell.snapshot()[0].since_ms,
        None
    );
    Ok(())
}

#[test]
fn local_roster_publishes_while_disconnected_and_again_on_reconnect() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("reconnect-missed-calibration")?;
    let old_transport = active_transport(&runtime);
    seed_online_friend(&runtime, &active_session, old_transport.generation)?;
    let weak_runtime = Arc::downgrade(runtime.runtime());
    runtime
        .runtime()
        .deps
        .instance_dwell
        .set_roster_change_callback(Arc::new(move || {
            if let Some(runtime) = weak_runtime.upgrade() {
                runtime.emit_friend_location_time_snapshot();
            }
        }));
    runtime.runtime().finish_realtime_transport(
        old_transport,
        RealtimeTransportTermination::UnexpectedExit {
            reason: "websocket stream ended".into(),
            connected_secs: Some(60),
        },
    );
    runtime.take_events_for_test();
    runtime
        .runtime()
        .deps
        .instance_dwell
        .observe_roster(&local_friend_roster(1_000));
    let events = runtime.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("local roster updates do not require an active websocket");
    assert_eq!(
        projection.payload["locationTimeSnapshot"][0]["sinceMs"],
        1_000
    );
    runtime.set_task_executor_for_test(DiscardTaskExecutor);

    runtime.runtime().start_from_friend_baseline(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        2,
        json!({"id": active_session.user_id}),
    )?;

    let events = runtime.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("reconnect should republish the current local time");
    assert_eq!(
        projection.payload["locationTimeSnapshot"][0]["sinceMs"],
        1_000
    );
    Ok(())
}

#[test]
fn replacement_session_does_not_inherit_friend_location_times() -> Result<()> {
    for changed_field in ["user", "endpoint", "websocket"] {
        let (_dir, runtime, active_session) =
            runtime_with_active_session("replacement-session-time")?;
        let old_transport = active_transport(&runtime);
        seed_online_friend(&runtime, &active_session, old_transport.generation)?;
        runtime
            .runtime()
            .deps
            .instance_dwell
            .observe_roster(&local_friend_roster(1_000));
        let friends = runtime.runtime().friend_snapshot().unwrap().friends_by_id;
        runtime.runtime().finish_realtime_transport(
            old_transport,
            RealtimeTransportTermination::UnexpectedExit {
                reason: "websocket stream ended".into(),
                connected_secs: Some(60),
            },
        );
        let mut replacement = active_session;
        match changed_field {
            "user" => replacement.user_id = "usr_other".into(),
            "endpoint" => replacement.endpoint = "https://api.example.test/api/1".into(),
            "websocket" => replacement.websocket = "wss://pipeline.example.test".into(),
            _ => unreachable!(),
        }
        runtime
            .auth_scope()
            .set(&replacement.user_id, &replacement.endpoint);
        runtime
            .runtime()
            .sync_friend_snapshot(replacement.clone(), None, friends)?;
        runtime.set_task_executor_for_test(DiscardTaskExecutor);

        runtime.runtime().start_from_friend_baseline(
            replacement.user_id.clone(),
            replacement.endpoint,
            replacement.websocket,
            2,
            json!({"id": replacement.user_id}),
        )?;

        let times = runtime.runtime().deps.instance_dwell.snapshot();
        assert_eq!(times.len(), 1);
        assert!(times[0].since_ms.is_some_and(|since_ms| since_ms > 1_000));
    }
    Ok(())
}

#[test]
fn pending_baseline_start_emits_initial_location_time_snapshot() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("pending-baseline-location-time")?;
    runtime.prepare_pending_friend_baseline(
        &active_session,
        HashMap::from([(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".into(),
                display_name: "Friend".into(),
                state: "online".into(),
                location: "wrld_start:123".into(),
                ..FriendRecord::default()
            },
        )]),
    )?;
    runtime.take_events_for_test();
    runtime.set_task_executor_for_test(DiscardTaskExecutor);

    runtime.runtime().start_from_friend_baseline(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        2,
        json!({"id": active_session.user_id}),
    )?;

    let events = runtime.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("starting from a pending baseline should emit a friend projection");
    assert_eq!(
        projection.payload["locationTimeSnapshot"][0]["userId"],
        "usr_friend"
    );
    assert_eq!(
        projection.payload["locationTimeSnapshot"][0]["location"],
        "wrld_start:123"
    );
    assert!(projection.payload["locationTimeSnapshot"][0]["sinceMs"].is_number());
    Ok(())
}

#[test]
fn baseline_friend_cache_seed_preserves_profile_and_friend_fields() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("baseline-friend-cache-open-fields")?;
    let active = active_transport(&runtime);
    let mut extra = serde_json::Map::new();
    extra.insert(
        "currentAvatarImageUrl".into(),
        json!("https://example.test/avatar.png"),
    );
    extra.insert("tags".into(), json!(["system_trust_known"]));
    runtime.runtime().sync_friend_snapshot(
        active_session.clone(),
        Some(active.generation),
        HashMap::from([(
            "usr_future".to_string(),
            FriendRecord {
                id: "usr_future".into(),
                display_name: "Future Friend".into(),
                state: "online".into(),
                extra,
                ..FriendRecord::default()
            },
        )]),
    )?;
    runtime.runtime().user_cache.clear();

    runtime.runtime().record_baseline_friends_into_cache();

    let cached = runtime
        .runtime()
        .user_cache
        .get_user(&active_session.endpoint, "usr_future")
        .expect("baseline friend should be cached");
    assert_eq!(
        cached.get("currentAvatarImageUrl"),
        Some(&json!("https://example.test/avatar.png"))
    );
    assert_eq!(cached.get("tags"), Some(&json!(["system_trust_known"])));
    assert_eq!(cached.get("isFriend"), Some(&json!(true)));
    Ok(())
}

#[test]
fn auth_expiry_keeps_snapshots_for_the_reconnect_attempt() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("transport-lifecycle")?;
    let expected = active_transport(&runtime);
    seed_online_friend(&runtime, &active_session, expected.generation)?;
    runtime.runtime().current_user.set_snapshot(
        active_session.user_id.clone(),
        expected.generation,
        json!({"id": active_session.user_id.clone()}),
    );
    let mut lifecycle = runtime.runtime().subscribe_transport_lifecycle();
    let sink = RealtimeHostRuntimeMessageSink {
        runtime: Arc::clone(runtime.runtime()),
    };

    assert!(runtime.runtime().transport_is_active(&expected));
    sink.handle_realtime_transport_status(
        expected.generation,
        expected.session_generation,
        &active_session,
        crate::realtime::RealtimeWsStatus::Connected,
    );
    assert_eq!(
        lifecycle.try_recv().unwrap(),
        RealtimeTransportLifecycleEvent::Connected(expected.clone())
    );

    let termination = RealtimeTransportTermination::AuthExpired {
        reason: "auth transport bootstrap failed (403)".into(),
        status_code: Some(403),
    };
    runtime
        .runtime()
        .finish_realtime_transport(expected.clone(), termination.clone());
    assert_eq!(
        lifecycle.try_recv().unwrap(),
        RealtimeTransportLifecycleEvent::Finished {
            transport: expected.clone(),
            termination,
        }
    );
    assert!(!runtime.runtime().transport_is_active(&expected));
    assert!(runtime.runtime().friend_snapshot().is_some());
    assert!(runtime.runtime().current_user_snapshot().is_some());
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
    let mut lifecycle = runtime.runtime().subscribe_transport_lifecycle();
    runtime.take_events_for_test();

    runtime
        .runtime()
        .finish_realtime_transport(stale.clone(), termination.clone());

    assert_eq!(
        lifecycle.try_recv().unwrap(),
        RealtimeTransportLifecycleEvent::Finished {
            transport: stale,
            termination,
        }
    );
    assert!(runtime.runtime().transport_is_active(&current));
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
    runtime.runtime().current_user.set_snapshot(
        active_session.user_id.clone(),
        transport.generation,
        json!({"id": active_session.user_id.clone()}),
    );
    runtime.take_events_for_test();
    let mut lifecycle = runtime.runtime().subscribe_transport_lifecycle();
    runtime.runtime().stop(RealtimeStopRequest {
        user_id: Some(active_session.user_id),
        endpoint: Some(active_session.endpoint),
        websocket: Some(active_session.websocket),
        client_run_id: Some(transport.client_run_id),
        generation: Some(transport.generation),
    });

    runtime
        .runtime()
        .finish_realtime_transport(transport.clone(), RealtimeTransportTermination::Stopped);

    assert_eq!(
        lifecycle.try_recv().unwrap(),
        RealtimeTransportLifecycleEvent::Finished {
            transport: transport.clone(),
            termination: RealtimeTransportTermination::Stopped,
        }
    );
    assert!(!runtime.runtime().transport_is_active(&transport));
    assert!(runtime.runtime().friend_snapshot().is_none());
    assert!(runtime.runtime().current_user_snapshot().is_none());
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

    runtime.runtime().finish_realtime_transport(
        old_transport.clone(),
        RealtimeTransportTermination::UnexpectedExit {
            reason: "websocket stream ended".into(),
            connected_secs: None,
        },
    );

    assert!(!runtime.runtime().transport_is_active(&old_transport));
    assert_eq!(
        runtime.runtime().friend_snapshot().unwrap().friends_by_id["usr_friend"].location,
        "wrld_old:123"
    );

    let watermark = runtime.runtime().capture_friend_baseline_watermark()?;
    assert_eq!(watermark.generation, None);
    let fresh_friends = [(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".into(),
            display_name: "Friend".into(),
            state: "online".into(),
            location: "wrld_fresh:456".into(),
            ..FriendRecord::default()
        },
    )]
    .into_iter()
    .collect::<HashMap<_, _>>();
    let outcome = runtime.runtime().sync_friend_snapshot_with_watermark(
        active_session.clone(),
        watermark,
        fresh_friends,
        FriendStatusVerdicts::default(),
    )?;
    assert!(outcome.result.accepted);
    assert_eq!(
        runtime.runtime().friend_snapshot().unwrap().friends_by_id["usr_friend"].location,
        "wrld_old:123",
        "the last visible roster should remain stable during the reconnect gap"
    );

    runtime
        .runtime()
        .deps
        .tasks
        .set_executor(DiscardTaskExecutor);
    let replacement = runtime.runtime().start_from_friend_baseline(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        2,
        json!({"id": active_session.user_id.clone()}),
    )?;
    assert_eq!(
        runtime.runtime().friend_snapshot().unwrap().friends_by_id["usr_friend"].location,
        "wrld_fresh:456"
    );

    let sink = RealtimeHostRuntimeMessageSink {
        runtime: Arc::clone(runtime.runtime()),
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
    let snapshot = runtime.runtime().friend_snapshot().unwrap();
    assert!(!snapshot.friends_by_id.contains_key("usr_stale"));
    assert!(snapshot.friends_by_id.contains_key("usr_live"));
    Ok(())
}

#[test]
fn reconnect_without_a_fresh_baseline_preserves_the_latest_canonical_roster() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("unexpected-exit-preserved-baseline")?;
    let old_transport = active_transport(&runtime);
    runtime.runtime().sync_friend_snapshot(
        active_session.clone(),
        Some(old_transport.generation),
        HashMap::from([(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".into(),
                display_name: "Friend".into(),
                state: "online".into(),
                location: "wrld_latest:456".into(),
                ..FriendRecord::default()
            },
        )]),
    )?;
    runtime.runtime().finish_realtime_transport(
        old_transport,
        RealtimeTransportTermination::UnexpectedExit {
            reason: "websocket stream ended".into(),
            connected_secs: None,
        },
    );
    runtime
        .runtime()
        .deps
        .tasks
        .set_executor(DiscardTaskExecutor);

    let replacement = runtime.runtime().start_from_friend_baseline(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        2,
        json!({"id": active_session.user_id}),
    )?;

    let snapshot = runtime.runtime().friend_snapshot().unwrap();
    assert_eq!(snapshot.generation, replacement.generation);
    assert_eq!(snapshot.baseline_revision, 0);
    assert_eq!(
        snapshot.friends_by_id["usr_friend"].location,
        "wrld_latest:456"
    );
    Ok(())
}

#[test]
fn reconnect_without_a_fresh_baseline_clears_pending_offline_runtime_state() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("unexpected-exit-pending-offline")?;
    let old_transport = active_transport(&runtime);
    seed_online_friend(&runtime, &active_session, old_transport.generation)?;
    let RealtimeFriendApplyResult::Output(output) =
        runtime
            .runtime()
            .friends
            .apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-offline",
                    "content": { "userId": "usr_friend" }
                }),
                raw: "{}".into(),
                received_at: "2026-07-20T00:00:00Z".into(),
            })
    else {
        panic!("friend-offline should produce an output");
    };
    let PendingOfflineTimerAction::Schedule { token, .. } = output.timer_action else {
        panic!("friend-offline should schedule a pending timer");
    };
    assert_eq!(
        runtime.runtime().friend_snapshot().unwrap().friends_by_id["usr_friend"]
            .extra
            .get("pendingOffline"),
        Some(&json!(true))
    );

    runtime.runtime().finish_realtime_transport(
        old_transport,
        RealtimeTransportTermination::UnexpectedExit {
            reason: "websocket stream ended".into(),
            connected_secs: None,
        },
    );
    runtime
        .runtime()
        .deps
        .tasks
        .set_executor(DiscardTaskExecutor);

    runtime.runtime().start_from_friend_baseline(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        2,
        json!({"id": active_session.user_id}),
    )?;

    let snapshot = runtime.runtime().friend_snapshot().unwrap();
    assert!(!snapshot.friends_by_id["usr_friend"]
        .extra
        .contains_key("pendingOffline"));
    assert!(runtime
        .runtime()
        .friends
        .fire_pending_offline("usr_friend", token, "2026-07-20T00:03:00Z".into())
        .is_none());
    Ok(())
}

#[test]
fn friend_ws_dispatch_fans_out_one_canonical_output() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("friend-dispatch-fanout")?;
    let active = runtime
        .runtime()
        .state
        .lock()
        .unwrap()
        .connection
        .active_context
        .clone()
        .unwrap();
    runtime.runtime().sync_friend_snapshot(
        active_session.clone(),
        Some(active.generation),
        HashMap::new(),
    )?;
    runtime.take_events_for_test();
    runtime.activity_sink_for_test().take_friend_projections();

    let sink = RealtimeHostRuntimeMessageSink {
        runtime: Arc::clone(runtime.runtime()),
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

    let snapshot = runtime
        .runtime()
        .friend_snapshot()
        .expect("friend baseline");
    let friend = snapshot
        .friends_by_id
        .get("usr_friend")
        .expect("friend-add should update the canonical snapshot");
    assert_eq!(friend.display_name, "Friend");
    assert_eq!(friend.state, "offline");

    let current = friend_log_current_list(runtime.database(), active_session.user_id.clone())?;
    assert_eq!(current.len(), 1);
    assert_eq!(current[0].user_id, "usr_friend");
    assert_eq!(current[0].display_name, "Friend");
    let history = friend_log_history_query(
        runtime.database(),
        FriendLogHistoryQueryInput {
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
    assert!(events.iter().all(|event| {
        event.name != "backendRuntimeTelemetry"
            || !matches!(
                event.payload["kind"].as_str(),
                Some("wsMessage" | "wsPersisted" | "gameLogPersisted")
            )
    }));
    let mut frontend_projection = activity_projections[0].clone();
    frontend_projection.feed_entries.clear();
    assert_eq!(
        frontend_projections[0].payload,
        serde_json::to_value(frontend_projection)
            .expect("serialize frontend projection")
            .into()
    );
    let feed_projection = events
        .iter()
        .find(|event| event.name == "realtimeFeedProjection")
        .expect("friend Feed entry should use the dedicated projection");
    assert_eq!(
        feed_projection.payload["upserts"][0]["entry"]["type"],
        "Friend"
    );

    let cached = runtime
        .runtime()
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
        .runtime()
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
        runtime: Arc::clone(runtime.runtime()),
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

    assert!(runtime.runtime().friend_snapshot().is_none());
    assert!(
        friend_log_current_list(runtime.database(), active_session.user_id.clone(),)?.is_empty()
    );
    assert!(runtime
        .activity_sink_for_test()
        .take_friend_projections()
        .is_empty());
    assert!(runtime
        .runtime()
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
        let mut state = runtime.runtime().state.lock().unwrap();
        state.connection.active_context = None;
    }
    config_store::set_bool(
        runtime.runtime().deps.store.as_ref(),
        "friendLogInit_usr_self",
        true,
    )?;
    write_realtime_batch(
        runtime.runtime().deps.store.as_ref(),
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
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
    let watermark = runtime.runtime().capture_friend_baseline_watermark()?;
    let friend = FriendRecord {
        state: "online".into(),
        id: "usr_friend".into(),
        display_name: "Friend".into(),
        extra: [("$trustLevel".into(), json!("Trusted User"))]
            .into_iter()
            .collect(),
        ..FriendRecord::default()
    };

    let outcome = runtime.runtime().sync_friend_snapshot_with_watermark(
        active_session.clone(),
        watermark,
        [("usr_friend".to_string(), friend)].into_iter().collect(),
        FriendStatusVerdicts::default(),
    )?;
    assert!(outcome.friend_log_changed);
    assert!(runtime
        .runtime()
        .deps
        .event_bus
        .take_events_for_test()
        .iter()
        .all(|event| { event.name != "realtimeFeedProjection" }));
    let history_count_before = friend_log_history_query(
        runtime.runtime().deps.store.as_ref(),
        FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: "usr_friend".into(),
            types: vec!["TrustLevel".into()],
        },
    )?
    .len();

    runtime
        .runtime()
        .deps
        .tasks
        .set_executor(DiscardTaskExecutor);
    runtime.runtime().start(
        active_session.user_id,
        active_session.endpoint,
        active_session.websocket,
        1,
        json!({"id": "usr_self"}),
        HashMap::new(),
    )?;

    let events = runtime.runtime().deps.event_bus.take_events_for_test();
    let trust_entries = events
        .iter()
        .filter(|event| event.name == "realtimeFeedProjection")
        .flat_map(|event| event.payload["upserts"].as_array().into_iter().flatten())
        .filter(|upsert| upsert["entry"]["type"] == "TrustLevel")
        .count();
    assert_eq!(trust_entries, 1);
    let history_count_after = friend_log_history_query(
        runtime.runtime().deps.store.as_ref(),
        FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: "usr_friend".into(),
            types: vec!["TrustLevel".into()],
        },
    )?
    .len();
    assert_eq!(history_count_after, history_count_before);
    assert!(runtime
        .runtime()
        .state
        .lock()
        .unwrap()
        .friend_baseline
        .pending
        .is_none());
    Ok(())
}
