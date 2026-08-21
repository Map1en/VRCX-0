use std::collections::HashMap;

use super::friend_profile::FriendProfileRefreshExpectation;
use super::test_support::*;
use super::*;
use crate::realtime::RealtimeSessionContext;
use vrcx_0_application_core::RuntimeAuthScope;
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_persistence::OwnerId;

#[test]
fn sync_friend_snapshot_debounces_online_to_offline() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("baseline-projection")?;
    let mut initial_friends = HashMap::new();
    initial_friends.insert(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".into(),
            state: "online".into(),
            location: "wrld_old:123".to_string(),
            ..FriendRecord::default()
        },
    );
    runtime
        .runtime()
        .sync_friend_snapshot(active_session.clone(), Some(7), initial_friends)?;
    runtime.runtime().deps.event_bus.take_events_for_test();

    let mut refreshed_friends = HashMap::new();
    refreshed_friends.insert(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".into(),
            state: "offline".into(),
            location: "offline".to_string(),
            ..FriendRecord::default()
        },
    );
    let result = runtime.runtime().sync_friend_snapshot(
        active_session.clone(),
        Some(7),
        refreshed_friends,
    )?;

    let events = runtime.runtime().deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("baseline refresh should emit a friend projection");
    assert!(result.accepted);
    assert_eq!(result.baseline_revision, 1);
    assert_eq!(projection.payload["generation"], 7);
    assert_eq!(projection.payload["baselineRevision"], 1);
    assert_eq!(projection.payload["patches"].as_array().unwrap().len(), 1);
    assert_eq!(projection.payload["patches"][0]["userId"], "usr_friend");
    assert_eq!(projection.payload["patches"][0]["patch"]["state"], "online");
    assert_eq!(projection.payload["patches"][0]["patch"]["state"], "online");
    assert_eq!(
        projection.payload["patches"][0]["patch"]["location"],
        "wrld_old:123"
    );
    assert_eq!(
        projection.payload["patches"][0]["patch"]["pendingOffline"],
        true
    );
    Ok(())
}

#[test]
fn sync_friend_snapshot_persists_feed_when_refresh_confirms_pending_offline() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("baseline-confirmed-offline-feed")?;
    let mut initial_friends = HashMap::new();
    initial_friends.insert(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".into(),
            state: "online".into(),
            location: "wrld_old:123".to_string(),
            ..FriendRecord::default()
        },
    );
    runtime
        .runtime()
        .sync_friend_snapshot(active_session.clone(), Some(7), initial_friends)?;

    let RealtimeFriendApplyResult::Output(pending_output) = runtime
        .runtime()
        .friends
        .apply_ws_message(&RealtimeWsMessagePayload {
            json: json!({
                "type": "friend-offline",
                "content": { "userId": "usr_friend" }
            }),
            raw: "{}".into(),
            received_at: "2026-05-15T00:00:00Z".into(),
        })
    else {
        panic!("friend-offline should produce an output");
    };
    runtime.runtime().apply_friend_output(*pending_output);
    runtime.runtime().deps.event_bus.take_events_for_test();
    let watermark = runtime.runtime().capture_friend_baseline_watermark()?;

    let mut refreshed_friends = HashMap::new();
    refreshed_friends.insert(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend Fresh Name".into(),
            state: "offline".into(),
            location: "offline".to_string(),
            ..FriendRecord::default()
        },
    );
    runtime.runtime().sync_friend_snapshot_with_watermark(
        active_session.clone(),
        watermark,
        refreshed_friends.clone(),
        FriendStatusVerdicts::default(),
    )?;

    let events = runtime.runtime().deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("confirmed offline refresh should emit a friend projection");
    assert_eq!(
        projection.payload["patches"][0]["patch"]["state"],
        "offline"
    );
    assert_eq!(
        projection.payload["patches"][0]["patch"]["displayName"],
        "Friend Fresh Name"
    );
    assert_eq!(
        projection.payload["patches"][0]["patch"]["pendingOffline"],
        false
    );
    assert!(projection.payload["feedEntries"]
        .as_array()
        .unwrap()
        .is_empty());
    let feed_projection = events
        .iter()
        .find(|event| event.name == "realtimeFeedProjection")
        .expect("confirmed offline refresh should emit a Feed projection");
    assert_eq!(
        feed_projection.payload["upserts"].as_array().unwrap().len(),
        1
    );
    assert_eq!(
        feed_projection.payload["upserts"][0]["entry"]["type"],
        "Offline"
    );
    assert_eq!(
        runtime
            .runtime()
            .friend_snapshot()
            .unwrap()
            .friends_by_id
            .get("usr_friend")
            .unwrap()
            .display_name,
        "Friend Fresh Name"
    );
    assert!(events.iter().all(|event| {
        event.name != "backendRuntimeTelemetry"
            || !matches!(
                event.payload["kind"].as_str(),
                Some("wsMessage" | "wsPersisted" | "gameLogPersisted")
            )
    }));

    let repeated_watermark = runtime.runtime().capture_friend_baseline_watermark()?;
    runtime.runtime().sync_friend_snapshot_with_watermark(
        active_session.clone(),
        repeated_watermark,
        refreshed_friends,
        FriendStatusVerdicts::default(),
    )?;
    let repeated_events = runtime.runtime().deps.event_bus.take_events_for_test();
    assert!(repeated_events
        .iter()
        .all(|event| event.name != "realtimeFeedProjection"));
    assert!(repeated_events.iter().all(|event| {
        event.name != "backendRuntimeTelemetry" || event.payload["kind"] != "wsPersisted"
    }));
    let persisted_rows = vrcx_0_persistence::feed::feed_rows_query(
        &runtime.runtime().deps.db,
        vrcx_0_persistence::feed::FeedRowsQueryInput {
            user_id: active_session.user_id,
            mode: vrcx_0_persistence::feed::FeedQueryMode::Lookup,
            search: String::new(),
            filters: vec![vrcx_0_persistence::feed::FeedFilter::Offline],
            vip_list: Vec::new(),
            scoped_user_ids: Vec::new(),
            excluded_user_ids: Vec::new(),
            max_entries: 10,
            date_from: String::new(),
            date_to: String::new(),
            cursor: None,
        },
    )?;
    assert_eq!(persisted_rows.len(), 1);
    assert_eq!(persisted_rows[0].r#type.as_deref(), Some("Offline"));
    Ok(())
}

#[test]
fn host_watermark_preserves_pending_created_after_capture() -> Result<()> {
    for (state_bucket, location) in [("online", "wrld_old:123"), ("offline", "offline")] {
        let (_dir, runtime, active_session) =
            runtime_with_active_session(&format!("host-stale-watermark-{state_bucket}"))?;
        runtime.runtime().sync_friend_snapshot(
            active_session.clone(),
            Some(7),
            [(
                "usr_friend".to_string(),
                FriendRecord {
                    id: "usr_friend".to_string(),
                    display_name: "Friend".into(),
                    state: "online".into(),
                    location: "wrld_old:123".to_string(),
                    ..FriendRecord::default()
                },
            )]
            .into_iter()
            .collect(),
        )?;
        let stale_watermark = runtime.runtime().capture_friend_baseline_watermark()?;
        let RealtimeFriendApplyResult::Output(pending_output) = runtime
            .runtime()
            .friends
            .apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-offline",
                    "content": { "userId": "usr_friend" }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-offline should produce an output");
        };
        let PendingOfflineTimerAction::Schedule { token, .. } = pending_output.timer_action else {
            panic!("friend-offline should schedule a timer");
        };
        runtime.runtime().apply_friend_output(*pending_output);
        runtime.runtime().deps.event_bus.take_events_for_test();

        runtime.runtime().sync_friend_snapshot_with_watermark(
            active_session.clone(),
            stale_watermark,
            [(
                "usr_friend".to_string(),
                FriendRecord {
                    id: "usr_friend".to_string(),
                    display_name: "Friend".into(),
                    state: state_bucket.into(),
                    location: location.to_string(),
                    ..FriendRecord::default()
                },
            )]
            .into_iter()
            .collect(),
            FriendStatusVerdicts::default(),
        )?;

        let snapshot = runtime.runtime().friend_snapshot().unwrap();
        let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
        assert_eq!(friend.state, "online");
        assert_eq!(friend.extra.get("pendingOffline"), Some(&json!(true)));
        assert!(runtime
            .runtime()
            .deps
            .event_bus
            .take_events_for_test()
            .iter()
            .all(|event| event.name != "realtimeFriendProjection"));
        let fired = runtime
            .runtime()
            .friends
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .expect("the original pending timer should remain active");
        assert_eq!(fired.persistence.feed_entries[0]["type"], "Offline");
    }
    Ok(())
}

#[test]
fn host_watermark_preserves_online_cancellation_after_capture() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("host-online-cancel-watermark")?;
    runtime.runtime().sync_friend_snapshot(
        active_session.clone(),
        Some(7),
        [(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".into(),
                state: "online".into(),
                location: "wrld_old:123".to_string(),
                ..FriendRecord::default()
            },
        )]
        .into_iter()
        .collect(),
    )?;
    let RealtimeFriendApplyResult::Output(pending_output) = runtime
        .runtime()
        .friends
        .apply_ws_message(&RealtimeWsMessagePayload {
            json: json!({
                "type": "friend-offline",
                "content": { "userId": "usr_friend" }
            }),
            raw: "{}".into(),
            received_at: "2026-05-15T00:00:00Z".into(),
        })
    else {
        panic!("friend-offline should produce an output");
    };
    let PendingOfflineTimerAction::Schedule { token, .. } = pending_output.timer_action else {
        panic!("friend-offline should schedule a timer");
    };
    runtime.runtime().apply_friend_output(*pending_output);
    let stale_watermark = runtime.runtime().capture_friend_baseline_watermark()?;
    let active = runtime
        .runtime()
        .state
        .lock()
        .unwrap()
        .connection
        .active_context
        .clone()
        .unwrap();
    runtime.runtime().handle_friend_ws_message(
        active.generation,
        active.session_generation,
        &active.session,
        &RealtimeWsMessagePayload {
            json: json!({
                "type": "friend-online",
                "content": {
                    "userId": "usr_friend",
                    "location": "wrld_new:456",
                    "user": {
                        "id": "usr_friend",
                        "displayName": "Friend",
                        "location": "wrld_new:456"
                    }
                }
            }),
            raw: "{}".into(),
            received_at: "2026-05-15T00:00:01Z".into(),
        },
    );
    runtime.runtime().deps.event_bus.take_events_for_test();

    let outcome = runtime.runtime().sync_friend_snapshot_with_watermark(
        active_session.clone(),
        stale_watermark,
        [(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".into(),
                state: "offline".into(),
                location: "offline".to_string(),
                ..FriendRecord::default()
            },
        )]
        .into_iter()
        .collect(),
        FriendStatusVerdicts::default(),
    )?;

    let snapshot = outcome.snapshot.expect("canonical friend snapshot");
    let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
    assert!(outcome.result.accepted);
    assert_eq!(friend.state, "online");
    assert_eq!(friend.location, "wrld_new:456");
    assert_ne!(friend.extra.get("pendingOffline"), Some(&json!(true)));
    assert!(runtime
        .runtime()
        .deps
        .event_bus
        .take_events_for_test()
        .iter()
        .all(|event| event.name != "realtimeFriendProjection"));
    assert!(runtime
        .runtime()
        .friends
        .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
        .is_none());
    Ok(())
}

#[test]
fn causal_sync_returns_canonical_snapshot_after_newer_friend_delete() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("canonical-after-friend-delete")?;
    let stale_friend = FriendRecord {
        id: "usr_friend".to_string(),
        display_name: "Friend".into(),
        state: "online".into(),
        location: "wrld_old:123".to_string(),
        ..FriendRecord::default()
    };
    runtime.runtime().sync_friend_snapshot(
        active_session.clone(),
        Some(7),
        [("usr_friend".to_string(), stale_friend.clone())]
            .into_iter()
            .collect(),
    )?;
    config_store::set_bool(
        runtime.runtime().deps.db.as_ref(),
        "friendLogInit_usr_self",
        true,
    )?;
    write_realtime_batch(
        runtime.runtime().deps.db.as_ref(),
        &OwnerId::new(active_session.user_id.clone()),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![vrcx_0_persistence::realtime::FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Visitor".into(),
                friend_number: 1,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    let stale_watermark = runtime.runtime().capture_friend_baseline_watermark()?;
    let active = runtime
        .runtime()
        .state
        .lock()
        .unwrap()
        .connection
        .active_context
        .clone()
        .unwrap();
    runtime.runtime().handle_friend_ws_message(
        active.generation,
        active.session_generation,
        &active.session,
        &RealtimeWsMessagePayload {
            json: json!({
                "type": "friend-delete",
                "content": { "userId": "usr_friend" }
            }),
            raw: "{}".into(),
            received_at: "2026-05-15T00:00:01Z".into(),
        },
    );
    runtime.runtime().deps.event_bus.take_events_for_test();

    let outcome = runtime.runtime().sync_friend_snapshot_with_watermark(
        active_session.clone(),
        stale_watermark,
        [("usr_friend".to_string(), stale_friend)]
            .into_iter()
            .collect(),
        FriendStatusVerdicts::default(),
    )?;

    assert!(outcome.result.accepted);
    assert!(!outcome.friend_log_changed);
    assert!(!outcome
        .snapshot
        .expect("canonical friend snapshot")
        .friends_by_id
        .contains_key("usr_friend"));
    assert!(vrcx_0_persistence::friends::friend_log_current_list(
        runtime.runtime().deps.db.as_ref(),
        active_session.user_id,
    )?
    .is_empty());
    assert!(runtime
        .runtime()
        .deps
        .event_bus
        .take_events_for_test()
        .iter()
        .all(|event| event.name != "realtimeFriendProjection"));
    Ok(())
}

#[test]
fn causal_watermark_rejects_baseline_after_local_friend_log_mutation() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("local-friend-log-watermark")?;
    let friend = FriendRecord {
        id: "usr_friend".to_string(),
        display_name: "Friend".into(),
        state: "online".into(),
        ..FriendRecord::default()
    };
    runtime.runtime().sync_friend_snapshot(
        active_session.clone(),
        Some(7),
        [("usr_friend".to_string(), friend.clone())]
            .into_iter()
            .collect(),
    )?;
    write_realtime_batch(
        runtime.runtime().deps.db.as_ref(),
        &OwnerId::new(active_session.user_id.clone()),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![vrcx_0_persistence::realtime::FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Visitor".into(),
                friend_number: 1,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    let stale_watermark = runtime.runtime().capture_friend_baseline_watermark()?;
    runtime.runtime().run_friend_log_current_mutation(|| {
        vrcx_0_persistence::friends::friend_log_delete_current_array(
            runtime.runtime().deps.db.as_ref(),
            active_session.user_id.clone(),
            vec!["usr_friend".into()],
            Default::default(),
        )
    })?;

    let outcome = runtime.runtime().sync_friend_snapshot_with_watermark(
        active_session.clone(),
        stale_watermark,
        [("usr_friend".to_string(), friend)].into_iter().collect(),
        FriendStatusVerdicts::default(),
    )?;

    assert!(!outcome.result.accepted);
    assert!(outcome.snapshot.is_none());
    assert!(vrcx_0_persistence::friends::friend_log_current_list(
        runtime.runtime().deps.db.as_ref(),
        active_session.user_id,
    )?
    .is_empty());
    Ok(())
}

fn no_verdicts() -> FriendStatusVerdicts {
    FriendStatusVerdicts::default()
}

fn verdict(user_id: &str, is_friend: bool) -> FriendStatusVerdicts {
    HashMap::from([(user_id.to_string(), is_friend)]).into()
}

fn seeded_friend_log(dir: &TestDir, target_user_id: &str) -> Result<DatabaseService> {
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    config_store::set_bool(&db, "friendLogInit_usr_self", true)?;
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![vrcx_0_persistence::realtime::FriendLogUpsert {
                target_user_id: target_user_id.into(),
                display_name: "Friend".into(),
                trust_level: "Known".into(),
                friend_number: 1,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    Ok(db)
}

fn friend_log_history_count(
    db: &DatabaseService,
    target_user_id: &str,
    entry_type: &str,
) -> Result<usize> {
    Ok(vrcx_0_persistence::friends::friend_log_history_query(
        db,
        vrcx_0_persistence::friends::FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: target_user_id.into(),
            types: vec![entry_type.into()],
        },
    )?
    .len())
}

fn roster(user_id: &str) -> HashMap<String, FriendRecord> {
    [(
        user_id.to_string(),
        FriendRecord {
            state: "online".into(),
            id: user_id.into(),
            display_name: "Friend".into(),
            extra: [("$trustLevel".into(), json!("Known"))]
                .into_iter()
                .collect(),
            ..FriendRecord::default()
        },
    )]
    .into_iter()
    .collect()
}

#[test]
fn relationship_candidates_cover_both_diff_directions_after_init() -> Result<()> {
    let dir = TestDir::new("relationship-candidates");
    let db = seeded_friend_log(&dir, "usr_dropped")?;
    let mut friends_by_id = roster("usr_new");
    friends_by_id.extend(roster("usr_self"));
    friends_by_id.insert(
        "usr_placeholder".to_string(),
        FriendRecord {
            state: "offline".into(),
            id: "usr_placeholder".into(),
            extra: [("$profileSource".into(), json!("placeholder"))]
                .into_iter()
                .collect(),
            ..FriendRecord::default()
        },
    );

    let mut candidates = friend_log_relationship_candidates(&db, "usr_self", &friends_by_id);
    candidates.sort();

    assert_eq!(candidates, vec!["usr_dropped", "usr_new"]);
    Ok(())
}

#[test]
fn relationship_candidates_stay_empty_before_friend_log_init() -> Result<()> {
    let dir = TestDir::new("relationship-candidates-uninitialized");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    assert!(friend_log_relationship_candidates(&db, "usr_self", &roster("usr_new")).is_empty());
    Ok(())
}

#[test]
fn reconcile_keeps_roster_dropout_until_friend_status_confirms_it() -> Result<()> {
    let dir = TestDir::new("reconcile-unconfirmed-removal");
    let db = seeded_friend_log(&dir, "usr_friend")?;

    let outcome = reconcile_friend_roster_records(
        &db,
        "usr_self",
        &HashMap::new(),
        None,
        false,
        &no_verdicts(),
    );

    assert!(!outcome.changed);
    assert_eq!(
        vrcx_0_persistence::friends::friend_log_current_list(&db, "usr_self".into())?.len(),
        1
    );
    assert_eq!(friend_log_history_count(&db, "usr_friend", "Unfriend")?, 0);
    Ok(())
}

#[test]
fn reconcile_removes_roster_dropout_confirmed_as_unfriended() -> Result<()> {
    let dir = TestDir::new("reconcile-confirmed-removal");
    let db = seeded_friend_log(&dir, "usr_friend")?;

    let outcome = reconcile_friend_roster_records(
        &db,
        "usr_self",
        &HashMap::new(),
        None,
        false,
        &verdict("usr_friend", false),
    );

    assert!(outcome.changed);
    assert!(
        vrcx_0_persistence::friends::friend_log_current_list(&db, "usr_self".into())?.is_empty()
    );
    assert_eq!(friend_log_history_count(&db, "usr_friend", "Unfriend")?, 1);
    Ok(())
}

#[test]
fn reconcile_holds_back_roster_arrival_until_friend_status_confirms_it() -> Result<()> {
    let dir = TestDir::new("reconcile-unconfirmed-addition");
    let db = seeded_friend_log(&dir, "usr_friend")?;
    let mut friends_by_id = roster("usr_friend");
    friends_by_id.extend(roster("usr_new"));

    let outcome = reconcile_friend_roster_records(
        &db,
        "usr_self",
        &friends_by_id,
        None,
        false,
        &no_verdicts(),
    );

    assert!(!outcome.changed);
    assert_eq!(
        vrcx_0_persistence::friends::friend_log_current_list(&db, "usr_self".into())?.len(),
        1
    );
    assert_eq!(friend_log_history_count(&db, "usr_new", "Friend")?, 0);
    Ok(())
}

#[test]
fn reconcile_adds_roster_arrival_confirmed_as_friend() -> Result<()> {
    let dir = TestDir::new("reconcile-confirmed-addition");
    let db = seeded_friend_log(&dir, "usr_friend")?;
    let mut friends_by_id = roster("usr_friend");
    friends_by_id.extend(roster("usr_new"));

    let outcome = reconcile_friend_roster_records(
        &db,
        "usr_self",
        &friends_by_id,
        None,
        false,
        &verdict("usr_new", true),
    );

    assert!(outcome.changed);
    assert_eq!(
        vrcx_0_persistence::friends::friend_log_current_list(&db, "usr_self".into())?.len(),
        2
    );
    assert_eq!(friend_log_history_count(&db, "usr_new", "Friend")?, 1);
    Ok(())
}

#[test]
fn reconcile_records_display_name_change_for_existing_friend() -> Result<()> {
    let dir = TestDir::new("reconcile-display-name");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    config_store::set_bool(&db, "friendLogInit_usr_self", true)?;
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![vrcx_0_persistence::realtime::FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Old Name".into(),
                trust_level: "Known".into(),
                friend_number: 1,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let friends_by_id: HashMap<String, FriendRecord> = [(
        "usr_friend".to_string(),
        FriendRecord {
            state: "online".into(),
            id: "usr_friend".into(),
            display_name: "New Name".into(),
            ..FriendRecord::default()
        },
    )]
    .into_iter()
    .collect();

    assert!(
        reconcile_friend_roster_records(
            &db,
            "usr_self",
            &friends_by_id,
            None,
            false,
            &no_verdicts(),
        )
        .changed
    );
    assert!(
        !reconcile_friend_roster_records(
            &db,
            "usr_self",
            &friends_by_id,
            None,
            false,
            &no_verdicts(),
        )
        .changed
    );

    let current = vrcx_0_persistence::friends::friend_log_current_list(&db, "usr_self".into())?;
    assert_eq!(current.len(), 1);
    assert_eq!(current[0].display_name, "New Name");
    assert_eq!(current[0].trust_level, "Known");
    assert_eq!(current[0].friend_number, 1);

    let history = vrcx_0_persistence::friends::friend_log_history_query(
        &db,
        vrcx_0_persistence::friends::FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: String::new(),
            types: vec!["DisplayName".into()],
        },
    )?;
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].display_name, "New Name");
    assert_eq!(history[0].previous_display_name, "Old Name");
    Ok(())
}

#[test]
fn reconcile_records_and_projects_trust_only_change_once() -> Result<()> {
    let dir = TestDir::new("reconcile-trust-level");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    config_store::set_bool(&db, "friendLogInit_usr_self", true)?;
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
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
    let friends_by_id = [(
        "usr_friend".to_string(),
        FriendRecord {
            state: "offline".into(),
            id: "usr_friend".into(),
            display_name: "Friend".into(),
            extra: [("$trustLevel".into(), json!("Trusted User"))]
                .into_iter()
                .collect(),
            ..FriendRecord::default()
        },
    )]
    .into_iter()
    .collect();

    let outcome = reconcile_friend_roster_records(
        &db,
        "usr_self",
        &friends_by_id,
        None,
        false,
        &no_verdicts(),
    );
    assert!(outcome.changed);
    assert_eq!(outcome.feed_entries.len(), 1);
    assert_eq!(outcome.feed_entries[0]["type"], "TrustLevel");
    assert_eq!(outcome.feed_entries[0]["trustLevel"], "Trusted User");
    assert_eq!(outcome.feed_entries[0]["previousTrustLevel"], "Known User");
    assert_eq!(outcome.feed_entries[0]["friendNumber"], 7);
    assert!(
        !reconcile_friend_roster_records(
            &db,
            "usr_self",
            &friends_by_id,
            None,
            false,
            &no_verdicts(),
        )
        .changed
    );

    let current = vrcx_0_persistence::friends::friend_log_current_list(&db, "usr_self".into())?;
    assert_eq!(current[0].trust_level, "Trusted User");
    let history = vrcx_0_persistence::friends::friend_log_history_query(
        &db,
        vrcx_0_persistence::friends::FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: "usr_friend".into(),
            types: vec!["TrustLevel".into()],
        },
    )?;
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].trust_level, "Trusted User");
    assert_eq!(history[0].previous_trust_level, "Known User");
    Ok(())
}

#[test]
fn reconcile_skips_placeholder_records() -> Result<()> {
    let dir = TestDir::new("reconcile-placeholder");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    config_store::set_bool(&db, "friendLogInit_usr_self", true)?;
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![vrcx_0_persistence::realtime::FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Trusted User".into(),
                friend_number: 7,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    let friends_by_id = [(
        "usr_friend".to_string(),
        FriendRecord {
            state: "online".into(),
            id: "usr_friend".into(),
            display_name: "usr_friend".into(),
            extra: [
                ("$trustLevel".into(), json!("Visitor")),
                ("$profileSource".into(), json!("placeholder")),
            ]
            .into_iter()
            .collect(),
            ..FriendRecord::default()
        },
    )]
    .into_iter()
    .collect();

    let outcome = reconcile_friend_roster_records(
        &db,
        "usr_self",
        &friends_by_id,
        None,
        false,
        &no_verdicts(),
    );

    assert!(!outcome.changed);
    assert!(outcome.feed_entries.is_empty());
    let current = vrcx_0_persistence::friends::friend_log_current_list(&db, "usr_self".into())?;
    assert_eq!(current[0].trust_level, "Trusted User");
    let history = vrcx_0_persistence::friends::friend_log_history_query(
        &db,
        vrcx_0_persistence::friends::FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: "usr_friend".into(),
            types: vec!["TrustLevel".into()],
        },
    )?;
    assert!(history.is_empty());
    Ok(())
}

#[test]
fn init_seeds_placeholder_without_trust_and_reconcile_fills_it_silently() -> Result<()> {
    let dir = TestDir::new("reconcile-placeholder-init");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let placeholder_roster: HashMap<String, FriendRecord> = [(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".into(),
            display_name: "Friend".into(),
            extra: [
                ("$trustLevel".into(), json!("Visitor")),
                ("$profileSource".into(), json!("placeholder")),
            ]
            .into_iter()
            .collect(),
            ..FriendRecord::default()
        },
    )]
    .into_iter()
    .collect();

    assert!(
        reconcile_friend_roster_records(
            &db,
            "usr_self",
            &placeholder_roster,
            None,
            false,
            &no_verdicts(),
        )
        .changed
    );
    let current = vrcx_0_persistence::friends::friend_log_current_list(&db, "usr_self".into())?;
    assert_eq!(current[0].trust_level, "");

    let fetched_roster: HashMap<String, FriendRecord> = [(
        "usr_friend".to_string(),
        FriendRecord {
            state: "online".into(),
            id: "usr_friend".into(),
            display_name: "Friend".into(),
            extra: [("$trustLevel".into(), json!("Trusted User"))]
                .into_iter()
                .collect(),
            ..FriendRecord::default()
        },
    )]
    .into_iter()
    .collect();

    let outcome = reconcile_friend_roster_records(
        &db,
        "usr_self",
        &fetched_roster,
        None,
        false,
        &no_verdicts(),
    );
    assert!(outcome.changed);
    assert!(outcome.feed_entries.is_empty());
    let current = vrcx_0_persistence::friends::friend_log_current_list(&db, "usr_self".into())?;
    assert_eq!(current[0].trust_level, "Trusted User");
    let history = vrcx_0_persistence::friends::friend_log_history_query(
        &db,
        vrcx_0_persistence::friends::FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: "usr_friend".into(),
            types: vec![],
        },
    )?;
    assert!(history.is_empty());
    Ok(())
}

#[test]
fn reconcile_updates_legacy_equivalent_trust_without_history_or_feed() -> Result<()> {
    let dir = TestDir::new("reconcile-equivalent-trust");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    config_store::set_bool(&db, "friendLogInit_usr_self", true)?;
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![vrcx_0_persistence::realtime::FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Veteran User".into(),
                friend_number: 7,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    let friends_by_id = [(
        "usr_friend".to_string(),
        FriendRecord {
            state: "offline".into(),
            id: "usr_friend".into(),
            display_name: "Friend".into(),
            extra: [("$trustLevel".into(), json!("Trusted User"))]
                .into_iter()
                .collect(),
            ..FriendRecord::default()
        },
    )]
    .into_iter()
    .collect();

    let outcome = reconcile_friend_roster_records(
        &db,
        "usr_self",
        &friends_by_id,
        None,
        false,
        &no_verdicts(),
    );

    assert!(outcome.changed);
    assert!(outcome.feed_entries.is_empty());
    let current = vrcx_0_persistence::friends::friend_log_current_list(&db, "usr_self".into())?;
    assert_eq!(current[0].trust_level, "Trusted User");
    let history = vrcx_0_persistence::friends::friend_log_history_query(
        &db,
        vrcx_0_persistence::friends::FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: "usr_friend".into(),
            types: vec!["TrustLevel".into()],
        },
    )?;
    assert!(history.is_empty());
    Ok(())
}

#[test]
fn first_time_baseline_init_fills_current_roster_without_history_or_feed() -> Result<()> {
    let dir = TestDir::new("reconcile-first-init");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let friends_by_id: HashMap<String, FriendRecord> = [
        (
            "usr_a_friend".to_string(),
            FriendRecord {
                state: "online".into(),
                id: "usr_a_friend".into(),
                display_name: "A Friend".into(),
                extra: [("$trustLevel".into(), json!("Trusted User"))]
                    .into_iter()
                    .collect(),
                ..FriendRecord::default()
            },
        ),
        (
            "usr_b_friend".to_string(),
            FriendRecord {
                state: "online".into(),
                id: "usr_b_friend".into(),
                display_name: "B Friend".into(),
                ..FriendRecord::default()
            },
        ),
    ]
    .into_iter()
    .collect();

    assert!(!config_store::get_bool(
        &db,
        "friendLogInit_usr_self",
        false
    )?);

    let roster_order = ["usr_b_friend".to_string(), "usr_a_friend".to_string()];
    let outcome = reconcile_friend_roster_records(
        &db,
        "usr_self",
        &friends_by_id,
        Some(&roster_order),
        false,
        &no_verdicts(),
    );

    assert!(outcome.changed);
    assert!(outcome.feed_entries.is_empty());
    assert!(vrcx_0_persistence::friends::friend_log_history_query(
        &db,
        vrcx_0_persistence::friends::FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: String::new(),
            types: Vec::new(),
        },
    )?
    .is_empty());

    let current = vrcx_0_persistence::friends::friend_log_current_list(&db, "usr_self".into())?;
    assert_eq!(current.len(), 2);
    assert_eq!(current[0].user_id, "usr_b_friend");
    assert_eq!(current[0].friend_number, 1);
    assert_eq!(current[1].user_id, "usr_a_friend");
    assert_eq!(current[1].friend_number, 2);
    assert_eq!(current[1].trust_level, "Trusted User");
    assert!(config_store::get_bool(
        &db,
        "friendLogInit_usr_self",
        false
    )?);
    Ok(())
}

#[test]
fn first_time_baseline_init_failure_leaves_flag_unset_for_retry() -> Result<()> {
    let dir = TestDir::new("reconcile-first-init-failure");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let friends_by_id: HashMap<String, FriendRecord> = [(
        "usr_friend".to_string(),
        FriendRecord {
            state: "online".into(),
            id: "usr_friend".into(),
            display_name: "Friend".into(),
            ..FriendRecord::default()
        },
    )]
    .into_iter()
    .collect();

    let failed_outcome = reconcile_friend_roster_records(
        &db,
        "usr!self",
        &friends_by_id,
        None,
        false,
        &no_verdicts(),
    );
    assert!(!failed_outcome.changed);
    assert!(!config_store::get_bool(
        &db,
        "friendLogInit_usr!self",
        false
    )?);

    let retried_outcome = reconcile_friend_roster_records(
        &db,
        "usr_self",
        &friends_by_id,
        None,
        false,
        &no_verdicts(),
    );
    assert!(retried_outcome.changed);
    assert!(config_store::get_bool(
        &db,
        "friendLogInit_usr_self",
        false
    )?);
    let current = vrcx_0_persistence::friends::friend_log_current_list(&db, "usr_self".into())?;
    assert_eq!(current.len(), 1);
    Ok(())
}

#[test]
fn first_time_init_treats_friend_accepted_during_init_window_as_preexisting() -> Result<()> {
    let dir = TestDir::new("reconcile-first-init-race");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let friends_by_id: HashMap<String, FriendRecord> = [
        (
            "usr_established".to_string(),
            FriendRecord {
                state: "offline".into(),
                id: "usr_established".into(),
                display_name: "Established".into(),
                ..FriendRecord::default()
            },
        ),
        (
            "usr_just_accepted".to_string(),
            FriendRecord {
                state: "online".into(),
                id: "usr_just_accepted".into(),
                display_name: "JustAccepted".into(),
                ..FriendRecord::default()
            },
        ),
    ]
    .into_iter()
    .collect();

    let outcome = reconcile_friend_roster_records(
        &db,
        "usr_self",
        &friends_by_id,
        None,
        false,
        &no_verdicts(),
    );

    assert!(outcome.changed);
    assert!(outcome.feed_entries.is_empty());
    let history = vrcx_0_persistence::friends::friend_log_history_query(
        &db,
        vrcx_0_persistence::friends::FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: "usr_just_accepted".into(),
            types: vec!["Friend".into()],
        },
    )?;
    assert!(history.is_empty());
    let current = vrcx_0_persistence::friends::friend_log_current_list(&db, "usr_self".into())?;
    assert_eq!(current.len(), 2);
    Ok(())
}

#[test]
fn active_baseline_trust_change_fans_out_after_atomic_persistence() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("active-baseline-trust")?;
    config_store::set_bool(
        runtime.runtime().deps.db.as_ref(),
        "friendLogInit_usr_self",
        true,
    )?;
    write_realtime_batch(
        runtime.runtime().deps.db.as_ref(),
        &OwnerId::new("usr_self"),
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
    let events = runtime.runtime().deps.event_bus.take_events_for_test();
    let trust_entries = events
        .iter()
        .filter(|event| event.name == "realtimeFeedProjection")
        .flat_map(|event| event.payload["upserts"].as_array().into_iter().flatten())
        .map(|upsert| &upsert["entry"])
        .filter(|entry| entry["type"] == "TrustLevel")
        .collect::<Vec<_>>();
    assert_eq!(trust_entries.len(), 1);
    assert_eq!(trust_entries[0]["trustLevel"], "Trusted User");
    assert_eq!(trust_entries[0]["previousTrustLevel"], "Known User");
    Ok(())
}

#[test]
fn active_baseline_uses_runtime_feed_persistence_state() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("active-baseline-feed-disabled")?;
    config_store::set_bool(
        runtime.runtime().deps.db.as_ref(),
        "friendLogInit_usr_self",
        true,
    )?;
    write_realtime_batch(
        runtime.runtime().deps.db.as_ref(),
        &OwnerId::new("usr_self"),
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
    runtime.runtime().set_feed_persistence_disabled(true)?;
    config_store::set_bool(
        runtime.runtime().deps.db.as_ref(),
        "feedPersistenceDisabled",
        false,
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
    let events = runtime.runtime().deps.event_bus.take_events_for_test();
    assert!(events
        .iter()
        .filter(|event| event.name == "realtimeFeedProjection")
        .flat_map(|event| event.payload["upserts"].as_array().into_iter().flatten())
        .any(|upsert| upsert["entry"]["type"] == "TrustLevel"));
    assert!(vrcx_0_persistence::feed::feed_rows_query(
        runtime.database(),
        feed_lookup_input(active_session.user_id),
    )?
    .is_empty());
    assert_eq!(
        vrcx_0_persistence::friends::friend_log_current_list(
            runtime.database(),
            "usr_self".into(),
        )?[0]
            .trust_level,
        "Trusted User"
    );
    Ok(())
}

#[test]
fn causal_watermark_rejects_superseded_baseline() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("baseline-watermark")?;
    let friend = |display_name: &str| {
        [(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: display_name.into(),
                state: "online".into(),
                location: "wrld_1:123".to_string(),
                ..FriendRecord::default()
            },
        )]
        .into_iter()
        .collect()
    };
    runtime
        .runtime()
        .sync_friend_snapshot(active_session.clone(), Some(7), friend("Initial"))?;
    let stale_watermark = runtime.runtime().capture_friend_baseline_watermark()?;
    runtime
        .runtime()
        .sync_friend_snapshot(active_session.clone(), Some(7), friend("Newer"))?;

    let result = runtime.runtime().sync_friend_snapshot_with_watermark(
        active_session.clone(),
        stale_watermark,
        friend("Stale"),
        FriendStatusVerdicts::default(),
    )?;

    assert!(!result.result.accepted);
    assert_eq!(result.result.baseline_revision, 1);
    assert_eq!(
        runtime
            .runtime()
            .friend_snapshot()
            .unwrap()
            .friends_by_id
            .get("usr_friend")
            .unwrap()
            .display_name,
        "Newer"
    );
    Ok(())
}

#[test]
fn causal_baseline_from_stopped_generation_is_not_cached() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("stopped-watermark")?;
    runtime
        .runtime()
        .sync_friend_snapshot(active_session.clone(), Some(7), HashMap::new())?;
    let watermark = runtime.runtime().capture_friend_baseline_watermark()?;
    runtime.runtime().stop(RealtimeStopRequest {
        generation: Some(7),
        ..RealtimeStopRequest::default()
    });

    let result = runtime.runtime().sync_friend_snapshot_with_watermark(
        active_session.clone(),
        watermark,
        HashMap::new(),
        FriendStatusVerdicts::default(),
    )?;

    assert!(!result.result.accepted);
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

#[test]
fn stop_with_unavailable_local_game_context_skips_game_running_output() -> Result<()> {
    let (_dir, runtime, _) = runtime_with_unavailable_game_context_active_session(
        "stop-unavailable-local-game-context",
    )?;
    runtime.runtime().current_user.set_snapshot(
        "usr_self".into(),
        7,
        json!({
            "id": "usr_self",
            "currentAvatar": "avtr_current",
            "$previousAvatarSwapTime": 1_000
        }),
    );
    runtime.runtime().deps.event_bus.take_events_for_test();

    runtime.runtime().stop(RealtimeStopRequest {
        generation: Some(7),
        ..RealtimeStopRequest::default()
    });

    assert!(!runtime
        .runtime()
        .deps
        .event_bus
        .take_events_for_test()
        .iter()
        .any(|event| event.name == "realtimeCurrentUserProjection"));
    Ok(())
}

#[test]
fn sync_friend_snapshot_emits_projection_for_active_removals() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("baseline-removal")?;
    let mut initial_friends = HashMap::new();
    initial_friends.insert(
        "usr_removed".to_string(),
        FriendRecord {
            id: "usr_removed".to_string(),
            display_name: "Removed Friend".into(),
            state: "offline".into(),
            ..FriendRecord::default()
        },
    );
    runtime
        .runtime()
        .sync_friend_snapshot(active_session.clone(), Some(7), initial_friends)?;
    assert_eq!(
        runtime.activity_sink_for_test().friend_user_ids(),
        vec!["usr_removed".to_string()]
    );
    assert!(runtime
        .runtime()
        .user_cache
        .get_user(&active_session.endpoint, "usr_removed")
        .is_some());
    runtime.runtime().deps.event_bus.take_events_for_test();

    let result =
        runtime
            .runtime()
            .sync_friend_snapshot(active_session.clone(), Some(7), HashMap::new())?;

    let events = runtime.runtime().deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("baseline removal should emit a friend projection");
    assert!(result.accepted);
    assert_eq!(result.baseline_revision, 1);
    assert!(projection.payload["patches"].as_array().unwrap().is_empty());
    assert_eq!(
        projection.payload["removals"].as_array().unwrap(),
        &vec![json!("usr_removed")]
    );
    assert!(runtime
        .runtime()
        .friend_snapshot()
        .unwrap()
        .friends_by_id
        .is_empty());
    assert!(runtime
        .runtime()
        .user_cache
        .get_user(&active_session.endpoint, "usr_removed")
        .is_none());
    assert!(runtime
        .activity_sink_for_test()
        .friend_user_ids()
        .is_empty());
    Ok(())
}

#[test]
fn apply_friend_profile_refresh_updates_existing_friend_only() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("profile-refresh")?;
    let mut friends_by_id = HashMap::new();
    friends_by_id.insert(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".into(),
            state: "online".into(),
            location: "wrld_old:123".to_string(),
            ..FriendRecord::default()
        },
    );
    runtime
        .runtime()
        .sync_friend_snapshot(active_session.clone(), Some(7), friends_by_id)?;

    let friend_sequence = runtime
        .runtime()
        .friends
        .friend_state_sequence_for_user(7, "usr_friend")
        .expect("friend should have a causal sequence");
    let updated = runtime.runtime().apply_friend_profile_refresh(
        active_session.endpoint.clone(),
        "usr_friend".into(),
        json!({
            "id": "usr_friend",
            "displayName": "Fresh Friend",
            "state": "online",
            "location": "wrld_fresh:456"
        }),
        FriendProfileRefreshExpectation {
            generation: 7,
            sequence: friend_sequence,
        },
    )?;
    let stranger_added = runtime.runtime().apply_friend_profile_refresh(
        active_session.endpoint.clone(),
        "usr_stranger".into(),
        json!({
            "id": "usr_stranger",
            "displayName": "Stranger",
            "state": "online"
        }),
        FriendProfileRefreshExpectation {
            generation: 7,
            sequence: 0,
        },
    )?;

    let snapshot = runtime.runtime().friend_snapshot().unwrap();
    let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
    assert!(updated);
    assert!(!stranger_added);
    assert_eq!(friend.display_name, "Fresh Friend");
    assert_eq!(friend.location, "wrld_fresh:456");
    assert!(!snapshot.friends_by_id.contains_key("usr_stranger"));
    Ok(())
}

#[test]
fn friend_projection_clears_feed_entries_when_persistence_fails() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-persist-failure-clears-feed")?;
    let feed_entry = json!({
        "created_at": "2026-06-21T00:00:00.000Z",
        "type": "NewFeedType",
        "userId": "usr_friend",
        "displayName": "Friend"
    });

    let mut output = RealtimeFriendOutput::from_projection(
        OwnerId::new(active_session.user_id.clone()),
        FriendProjection {
            generation: 7,
            feed_entries: vec![feed_entry.clone()],
            ..FriendProjection::new(7, 0)
        },
    );
    output.persistence.feed_entries.push(feed_entry);
    runtime.runtime().apply_friend_output(output);

    let events = runtime.runtime().deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("friend projection should still be emitted after persistence failure");
    assert_eq!(
        projection.payload["feedEntries"].as_array().unwrap().len(),
        0
    );
    assert!(events
        .iter()
        .all(|event| event.name != "realtimeFeedProjection"));
    assert!(events.iter().all(|event| {
        event.name != "backendRuntimeTelemetry" || event.payload["kind"] != "wsPersisted"
    }));
    Ok(())
}

#[test]
fn repeated_friend_delete_retries_after_persistence_failure_without_duplicate_feed() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-delete-persistence-retry")?;
    runtime.runtime().sync_friend_snapshot(
        active_session.clone(),
        Some(7),
        [(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".into(),
                display_name: "Friend".into(),
                state: "offline".into(),
                ..FriendRecord::default()
            },
        )]
        .into_iter()
        .collect(),
    )?;
    write_realtime_batch(
        runtime.runtime().deps.db.as_ref(),
        &OwnerId::new(active_session.user_id.clone()),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![vrcx_0_persistence::realtime::FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Visitor".into(),
                friend_number: 1,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    runtime.runtime().deps.event_bus.take_events_for_test();
    let payload = RealtimeWsMessagePayload {
        json: json!({
            "type": "friend-delete",
            "content": { "userId": "usr_friend" }
        }),
        raw: "{}".into(),
        received_at: "2026-05-15T00:00:01Z".into(),
    };

    let RealtimeFriendApplyResult::Output(mut first) =
        runtime.runtime().friends.apply_ws_message(&payload)
    else {
        panic!("first friend-delete should produce an output");
    };
    first.persistence.feed_entries[0]["type"] = json!("NewFeedType");
    runtime.runtime().apply_friend_output(*first);

    assert_eq!(
        vrcx_0_persistence::friends::friend_log_current_list(
            runtime.runtime().deps.db.as_ref(),
            active_session.user_id.clone(),
        )?
        .len(),
        1
    );

    let RealtimeFriendApplyResult::Output(retry) =
        runtime.runtime().friends.apply_ws_message(&payload)
    else {
        panic!("repeated friend-delete should retry persistence");
    };
    assert_eq!(retry.persistence.friend_log_deletes.len(), 1);
    assert!(retry.persistence.feed_entries.is_empty());
    runtime.runtime().apply_friend_output(*retry);

    assert!(vrcx_0_persistence::friends::friend_log_current_list(
        runtime.runtime().deps.db.as_ref(),
        active_session.user_id,
    )?
    .is_empty());
    assert!(runtime
        .runtime()
        .deps
        .event_bus
        .take_events_for_test()
        .iter()
        .all(|event| event.name != "realtimeFeedProjection"));
    Ok(())
}

#[test]
fn disabled_feed_persistence_keeps_projection_and_other_batch_writes() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-feed-persistence-disabled")?;
    runtime.runtime().set_feed_persistence_disabled(true)?;
    let feed_entries = ["GPS", "Online", "Status", "Bio", "Avatar"]
        .into_iter()
        .enumerate()
        .map(|(index, entry_type)| {
            json!({
                "created_at": format!("2026-06-21T00:00:0{index}.000Z"),
                "type": entry_type,
                "userId": "usr_friend",
                "displayName": "Friend"
            })
        })
        .collect::<Vec<_>>();
    let mut output = RealtimeFriendOutput::from_projection(
        OwnerId::new(active_session.user_id.clone()),
        FriendProjection {
            generation: 7,
            feed_entries: feed_entries.clone(),
            ..FriendProjection::new(7, 0)
        },
    );
    output.persistence.feed_entries = feed_entries;
    output
        .persistence
        .friend_log_upserts
        .push(vrcx_0_persistence::realtime::FriendLogUpsert {
            target_user_id: "usr_friend".into(),
            display_name: "Friend".into(),
            trust_level: "Known User".into(),
            friend_number: 1,
            created_at: "2026-06-21T00:00:00.000Z".into(),
            force_history: false,
        });
    runtime.runtime().apply_friend_output(output);

    let events = runtime.runtime().deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("disabled persistence should still emit the live projection");
    assert!(projection.payload["feedEntries"]
        .as_array()
        .unwrap()
        .is_empty());
    let feed_projection = events
        .iter()
        .find(|event| event.name == "realtimeFeedProjection")
        .expect("disabled persistence should still emit the live Feed projection");
    assert_eq!(
        feed_projection.payload["upserts"].as_array().unwrap().len(),
        5
    );
    assert_eq!(
        runtime
            .activity_sink_for_test()
            .take_friend_projections()
            .len(),
        1
    );
    assert_eq!(
        vrcx_0_persistence::friends::friend_log_current_list(
            runtime.database(),
            active_session.user_id.clone(),
        )?
        .len(),
        1
    );
    assert!(vrcx_0_persistence::feed::feed_rows_query(
        runtime.database(),
        feed_lookup_input(active_session.user_id.clone()),
    )?
    .is_empty());

    runtime.runtime().set_feed_persistence_disabled(false)?;
    let enabled_entry = json!({
        "created_at": "2026-06-21T00:00:10.000Z",
        "type": "Online",
        "userId": "usr_friend",
        "displayName": "Friend"
    });
    let mut enabled_output = RealtimeFriendOutput::from_projection(
        OwnerId::new(active_session.user_id.clone()),
        FriendProjection {
            generation: 7,
            feed_entries: vec![enabled_entry.clone()],
            ..FriendProjection::new(7, 0)
        },
    );
    enabled_output.persistence.feed_entries.push(enabled_entry);
    runtime.runtime().apply_friend_output(enabled_output);

    let persisted = vrcx_0_persistence::feed::feed_rows_query(
        runtime.database(),
        feed_lookup_input(active_session.user_id),
    )?;
    assert_eq!(persisted.len(), 1);
    assert_eq!(persisted[0].r#type.as_deref(), Some("Online"));
    Ok(())
}

#[test]
fn disabled_avatar_feed_persistence_keeps_feed_and_activity_delivery() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("avatar-feed-persistence-disabled")?;
    runtime
        .runtime()
        .set_avatar_feed_persistence_disabled(true)?;
    let avatar_entry = json!({
        "created_at": "2026-06-21T00:00:00.000Z",
        "type": "Avatar",
        "userId": "usr_friend",
        "displayName": "Friend",
        "ownerId": "usr_author",
        "avatarName": "New Avatar",
        "currentAvatarImageUrl": "https://avatar.example/new.png",
        "currentAvatarThumbnailImageUrl": "https://avatar.example/new-thumb.png",
        "previousCurrentAvatarImageUrl": "https://avatar.example/old.png",
        "previousCurrentAvatarThumbnailImageUrl": "https://avatar.example/old-thumb.png"
    });
    let gps_entry = json!({
        "created_at": "2026-06-21T00:00:01.000Z",
        "type": "GPS",
        "userId": "usr_friend",
        "displayName": "Friend",
        "location": "wrld_test:instance",
        "worldName": "Test World"
    });
    let feed_entries = vec![avatar_entry, gps_entry];
    let mut output = RealtimeFriendOutput::from_projection(
        OwnerId::new(active_session.user_id.clone()),
        FriendProjection {
            generation: 7,
            feed_entries: feed_entries.clone(),
            ..FriendProjection::new(7, 0)
        },
    );
    output.persistence.feed_entries = feed_entries;

    runtime.runtime().apply_friend_output(output);

    assert!(config_store::get_bool(
        runtime.database(),
        "avatarFeedPersistenceDisabled",
        false
    )?);
    let persisted = vrcx_0_persistence::feed::feed_rows_query(
        runtime.database(),
        feed_lookup_input(active_session.user_id.clone()),
    )?;
    assert_eq!(persisted.len(), 1);
    assert_eq!(persisted[0].r#type.as_deref(), Some("GPS"));
    let search_rows =
        runtime
            .runtime()
            .query_feed_search(vrcx_0_persistence::feed::FeedSearchQueryInput {
                user_id: active_session.user_id.clone(),
                search: String::new(),
                filters: Vec::new(),
                favorite_user_ids: Vec::new(),
                scoped_user_ids: Vec::new(),
                excluded_user_ids: Vec::new(),
                favorites_only: false,
                date_from: "2026-06-21T00:00:00.000Z".into(),
                date_to: "2026-06-21T00:00:01.000Z".into(),
                max_rows: 10,
            })?;
    assert_eq!(search_rows.len(), 2);
    assert!(search_rows
        .iter()
        .any(|row| row.r#type.as_deref() == Some("Avatar")));
    assert!(search_rows
        .iter()
        .any(|row| row.r#type.as_deref() == Some("GPS")));

    let activity_projections = runtime.activity_sink_for_test().take_friend_projections();
    assert_eq!(activity_projections.len(), 1);
    assert!(activity_projections[0]
        .feed_entries
        .iter()
        .any(|entry| entry["type"] == "Avatar"));

    let events = runtime.runtime().deps.event_bus.take_events_for_test();
    let feed_projection = events
        .iter()
        .find(|event| event.name == "realtimeFeedProjection")
        .expect("avatar changes should still reach the live Feed");
    assert!(feed_projection.payload["upserts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|upsert| upsert["entry"]["type"] == "Avatar"));
    Ok(())
}

#[test]
fn changing_avatar_feed_persistence_keeps_existing_live_entries() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("avatar-feed-switch-keeps-live")?;
    runtime.runtime().emit_feed_entries(
        7,
        &OwnerId::new(active_session.user_id.clone()),
        vec![json!({
            "created_at": "2026-06-21T00:00:00.000Z",
            "type": "Avatar",
            "userId": "usr_friend",
            "displayName": "Friend",
            "avatarName": "Transient Avatar"
        })],
    );

    runtime
        .runtime()
        .set_avatar_feed_persistence_disabled(true)?;

    let latest =
        runtime
            .runtime()
            .query_feed_latest(vrcx_0_persistence::feed::FeedLatestQueryInput {
                user_id: active_session.user_id.clone(),
                filters: vec![vrcx_0_persistence::feed::FeedFilter::Avatar],
                favorite_user_ids: Vec::new(),
                scoped_user_ids: Vec::new(),
                excluded_user_ids: Vec::new(),
                favorites_only: false,
                max_rows: 10,
            })?;
    assert_eq!(latest.rows.len(), 1);
    assert_eq!(
        latest.rows[0].avatar_name.as_deref(),
        Some("Transient Avatar")
    );
    runtime
        .runtime()
        .set_avatar_feed_persistence_disabled(false)?;
    let search_rows =
        runtime
            .runtime()
            .query_feed_search(vrcx_0_persistence::feed::FeedSearchQueryInput {
                user_id: active_session.user_id,
                search: "Transient Avatar".into(),
                filters: vec![vrcx_0_persistence::feed::FeedFilter::Avatar],
                favorite_user_ids: Vec::new(),
                scoped_user_ids: Vec::new(),
                excluded_user_ids: Vec::new(),
                favorites_only: false,
                date_from: "2026-06-21T00:00:00.000Z".into(),
                date_to: "2026-06-21T00:00:00.000Z".into(),
                max_rows: 10,
            })?;
    assert_eq!(search_rows.len(), 1);
    assert_eq!(
        search_rows[0].avatar_name.as_deref(),
        Some("Transient Avatar")
    );
    Ok(())
}

fn feed_lookup_input(user_id: String) -> vrcx_0_persistence::feed::FeedRowsQueryInput {
    vrcx_0_persistence::feed::FeedRowsQueryInput {
        user_id,
        mode: vrcx_0_persistence::feed::FeedQueryMode::Lookup,
        search: String::new(),
        filters: Vec::new(),
        vip_list: Vec::new(),
        scoped_user_ids: Vec::new(),
        excluded_user_ids: Vec::new(),
        max_entries: 20,
        date_from: String::new(),
        date_to: String::new(),
        cursor: None,
    }
}

#[test]
fn friend_note_change_notifies_note_cache_sink() -> Result<()> {
    let dir = TestDir::new("friend-note-cache-sink");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let storage = StorageService::new(&dir.path.join("storage.json"))?;
    let web = Arc::new(WebClient::new(
        &storage,
        db.as_ref(),
        "wss://pipeline.vrchat.cloud".to_string(),
        env!("CARGO_PKG_VERSION"),
    )?);
    let session = HostSessionRuntime::new();
    let host_session_generation =
        session.set_realtime_context(vrcx_0_application_core::HostRealtimeSessionContext::new(
            "usr_self".into(),
            "https://api.vrchat.cloud/api/1".into(),
            "wss://pipeline.vrchat.cloud".into(),
        ));
    let world_cache = Arc::new(vrcx_0_application_core::WorldCache::new(
        Arc::clone(&db),
        512,
        Duration::from_secs(30 * 60),
    ));
    let invalidations = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let event_bus = RuntimeEventBus::new();
    let runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
        db,
        web,
        event_bus: event_bus.clone(),
        backend_status: vrcx_0_application_core::BackendRuntimeStatusPublisher::new(
            vrcx_0_application_core::BackendRuntime::new(
                vrcx_0_application_core::RuntimeHostProfile::Desktop,
            ),
            event_bus.clone(),
        ),
        friend_projection_sink: crate::FriendProjectionSink::new(event_bus.clone(), None),
        sync: RuntimeSyncEngine::new(),
        tasks: TaskSupervisor::new(),
        session,
        auth_scope: RuntimeAuthScope::new(),
        remote_mutations: Arc::new(vrcx_0_application_core::RemoteMutationGate::default()),
        local_game_context: Arc::new(UnavailableLocalGameContextSource),
        activity_sink: None,
        world_cache,
        instance_dwell: Arc::new(vrcx_0_application_core::InstanceDwellRegistry::new()),
        print_cleanup: Arc::new(vrcx_0_application_core::NoopPrintCleanupInputSink),
        friend_note_change_sink: Some({
            let invalidations = Arc::clone(&invalidations);
            Arc::new(move || {
                invalidations.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            })
        }),
        current_user_snapshot_sink: None,
    }));
    let active_session = RealtimeSessionContext::new(
        "usr_self".into(),
        "https://api.vrchat.cloud/api/1".into(),
        "wss://pipeline.vrchat.cloud".into(),
    );
    {
        let mut state = runtime.state.lock().unwrap();
        *state = RealtimeHostRuntimeState::default();
        state.connection.generation = 7;
        state.connection.active_context = Some(ActiveRealtimeContext {
            session: active_session.clone(),
            auth_scope_generation: 1,
            generation: 7,
            client_run_id: 1,
            session_generation: host_session_generation,
        });
    }
    let mut friend = FriendRecord {
        id: "usr_friend".to_string(),
        display_name: "Friend".into(),
        state: "online".into(),
        ..FriendRecord::default()
    };
    friend.extra.insert("note".into(), json!("old note"));
    runtime.sync_friend_snapshot(
        active_session.clone(),
        Some(7),
        [("usr_friend".to_string(), friend)].into_iter().collect(),
    )?;
    assert_eq!(invalidations.load(std::sync::atomic::Ordering::SeqCst), 0);

    let output = runtime.friends.apply_ws_message(&RealtimeWsMessagePayload {
        json: json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "note": "new note"
                }
            }
        }),
        raw: String::new(),
        received_at: "2026-07-05T00:00:00.000Z".to_string(),
    });
    let RealtimeFriendApplyResult::Output(output) = output else {
        panic!("friend note update should emit output");
    };
    runtime.apply_friend_output(*output);

    assert_eq!(invalidations.load(std::sync::atomic::Ordering::SeqCst), 1);
    Ok(())
}

#[test]
fn emit_friend_log_changed_carries_the_active_baseline_scope() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("friend-log-changed-scope")?;
    let mut friends = HashMap::new();
    friends.insert(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".into(),
            state: "online".into(),
            location: "wrld_home:1".to_string(),
            ..FriendRecord::default()
        },
    );
    runtime
        .runtime()
        .sync_friend_snapshot(active_session.clone(), Some(7), friends)?;
    let mut refreshed = HashMap::new();
    refreshed.insert(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".into(),
            state: "offline".into(),
            location: "offline".to_string(),
            ..FriendRecord::default()
        },
    );
    let refreshed_result =
        runtime
            .runtime()
            .sync_friend_snapshot(active_session.clone(), Some(7), refreshed)?;
    assert_eq!(refreshed_result.baseline_revision, 1);
    runtime.runtime().deps.event_bus.take_events_for_test();

    runtime.runtime().emit_friend_log_changed();

    let events = runtime.runtime().deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("friend log change should emit a friend projection");
    assert_eq!(projection.payload["friendLogChanged"], true);
    assert_eq!(projection.payload["generation"], 7);
    assert_eq!(projection.payload["baselineRevision"], 1);
    Ok(())
}
