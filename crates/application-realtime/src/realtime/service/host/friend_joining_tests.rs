use super::test_support::*;
use super::*;
use vrcx_0_application_core::HostSessionGameProcessStatus as GameProcessStatus;
use vrcx_0_core::friends::{FriendBaselineEntry, FriendBaselinePresence, FriendRecord};
use vrcx_0_core::OwnerId;

fn joining_output(
    owner_user_id: &OwnerId,
    baseline_revision: u64,
    destination: &str,
) -> RealtimeFriendOutput {
    let mut output = RealtimeFriendOutput::from_projection(
        owner_user_id.clone(),
        FriendProjection::new(7, baseline_revision),
    );
    output.joining.push(FeedLiveEntry::OnPlayerJoining {
        created_at: "2026-07-13T10:00:00Z".into(),
        user_id: "usr_friend".into(),
        display_name: "Friend".into(),
        location: "traveling".into(),
        traveling_to_location: destination.into(),
        world_name: None,
        world_id: None,
        display_location: None,
        owner_user_id: String::new(),
    });
    output
}

#[test]
fn player_joining_only_reaches_overlay_for_current_instance_absent_player() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("player-joining")?;
    let local_game_context = runtime.local_game_context_for_test();
    let activity_sink = runtime.activity_sink_for_test();
    let baseline = runtime.sync_friend_baseline(
        &active_session,
        [(
            "usr_friend".to_string(),
            FriendBaselineEntry {
                record: FriendRecord {
                    id: "usr_friend".into(),
                    display_name: "Friend".into(),
                    ..FriendRecord::default()
                },
                presence: FriendBaselinePresence {
                    state: "online".into(),
                    location: "wrld_old:123".into(),
                    ..FriendBaselinePresence::default()
                },
            },
        )]
        .into_iter()
        .collect(),
    )?;
    runtime.runtime().deps.event_bus.take_events_for_test();
    activity_sink.take_events();
    local_game_context.set_location("wrld_current:456");
    let apply_joining = |destination: &str| {
        runtime.runtime().apply_friend_output(joining_output(
            &OwnerId::new(active_session.user_id.clone()),
            baseline.result.baseline_revision,
            destination,
        ));
    };

    apply_joining("wrld_current:456");
    assert!(activity_sink.take_events().is_empty());

    runtime
        .runtime()
        .deps
        .session
        .apply_game_process_status(GameProcessStatus {
            is_game_running: true,
            is_steamvr_running: true,
            changed_at: "2026-07-13T09:59:00Z".into(),
        });
    apply_joining("wrld_other:789");
    assert!(activity_sink.take_events().is_empty());

    local_game_context.set_player_user_ids(vec!["usr_friend".into()]);
    apply_joining("wrld_current:456");
    assert!(activity_sink.take_events().is_empty());

    local_game_context.set_player_user_ids(Vec::new());
    apply_joining("wrld_current:456");

    let entries = activity_sink.take_events();
    assert_eq!(entries.len(), 1);
    assert_eq!(
        entries[0].kind,
        vrcx_0_contracts::activity::ActivityKind::OnPlayerJoining
    );
    assert_eq!(entries[0].actor.user_id, "usr_friend");
    let events = runtime.runtime().deps.event_bus.take_events_for_test();
    assert!(events
        .iter()
        .all(|event| event.name != "realtimeFeedProjection"));
    Ok(())
}
