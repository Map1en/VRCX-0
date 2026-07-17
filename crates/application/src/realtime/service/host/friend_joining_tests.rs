use super::test_support::*;
use super::*;
use crate::game_log::PlayerState;
use crate::session::GameProcessStatus;

fn joining_output(
    owner_user_id: &str,
    baseline_revision: u64,
    destination: &str,
) -> RealtimeFriendOutput {
    RealtimeFriendOutput {
        owner_user_id: owner_user_id.to_string(),
        projection: FriendProjection {
            generation: 7,
            baseline_revision,
            feed_entries: vec![json!({
                "created_at": "2026-07-13T10:00:00Z",
                "type": "OnPlayerJoining",
                "userId": "usr_friend",
                "displayName": "Friend",
                "location": "traveling",
                "travelingToLocation": destination,
            })],
            ..FriendProjection::default()
        },
        ..RealtimeFriendOutput::default()
    }
}

#[test]
fn player_joining_only_reaches_overlay_for_current_instance_absent_player() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("player-joining")?;
    let baseline = runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
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
    runtime.deps.event_bus.take_events_for_test();
    runtime.deps.overlay_activity.set_delivery_armed(true);
    {
        let mut snapshot = runtime.deps.game_log_snapshot.lock().unwrap();
        snapshot.location = "wrld_current:456".into();
    }
    let apply_joining = |destination: &str| {
        runtime.apply_friend_output(joining_output(
            &active_session.user_id,
            baseline.baseline_revision,
            destination,
        ));
    };

    apply_joining("wrld_current:456");
    assert!(runtime.deps.overlay_activity.snapshot().entries.is_empty());

    runtime
        .deps
        .session
        .apply_game_process_status(GameProcessStatus {
            is_game_running: true,
            is_steamvr_running: true,
            changed_at: "2026-07-13T09:59:00Z".into(),
        });
    apply_joining("wrld_other:789");
    assert!(runtime.deps.overlay_activity.snapshot().entries.is_empty());

    {
        let mut snapshot = runtime.deps.game_log_snapshot.lock().unwrap();
        snapshot.players = vec![PlayerState {
            user_id: "usr_friend".into(),
            display_name: "Friend".into(),
            join_time_ms: Some(1),
        }];
    }
    apply_joining("wrld_current:456");
    assert!(runtime.deps.overlay_activity.snapshot().entries.is_empty());

    runtime
        .deps
        .game_log_snapshot
        .lock()
        .unwrap()
        .players
        .clear();
    apply_joining("wrld_current:456");

    let entries = runtime.deps.overlay_activity.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].activity_type, "OnPlayerJoining");
    assert_eq!(entries[0].actor_user_id, "usr_friend");
    assert_eq!(entries[0].content.body.source_text(), "is joining");
    let events = runtime.deps.event_bus.take_events_for_test();
    assert!(events
        .iter()
        .filter(|event| event.name == "realtimeFriendProjection")
        .all(|event| event.payload["feedEntries"]
            .as_array()
            .is_some_and(Vec::is_empty)));
    Ok(())
}

#[test]
fn initial_traveling_baseline_emits_player_joining() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("baseline-player-joining")?;
    runtime.deps.overlay_activity.set_delivery_armed(true);
    runtime
        .deps
        .session
        .apply_game_process_status(GameProcessStatus {
            is_game_running: true,
            is_steamvr_running: true,
            changed_at: "2026-07-13T09:59:00Z".into(),
        });
    runtime.deps.game_log_snapshot.lock().unwrap().location = "wrld_current:456".into();

    runtime.sync_friend_snapshot(
        active_session.user_id,
        active_session.endpoint,
        active_session.websocket,
        Some(7),
        [(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".into(),
                display_name: "Friend".into(),
                state: "online".into(),
                state_bucket: "online".into(),
                location: "traveling".into(),
                traveling_to_location: "wrld_current:456".into(),
                ..FriendRecord::default()
            },
        )]
        .into_iter()
        .collect(),
    )?;

    let entries = runtime.deps.overlay_activity.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].activity_type, "OnPlayerJoining");
    assert_eq!(entries[0].actor_user_id, "usr_friend");
    let events = runtime.deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("traveling baseline should emit a friend projection");
    assert!(projection.payload["feedEntries"]
        .as_array()
        .unwrap()
        .is_empty());
    Ok(())
}
