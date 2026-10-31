use serde_json::json;
use vrcx_0_core::OwnerId;

use super::super::test_support::runtime_with_active_session;
use super::invite_automation_send_body;
use crate::realtime::{
    RealtimeNotificationOutput, RealtimeNotificationProjection, RealtimeNotificationUpsert,
};
use crate::RealtimeStore;

fn friend_request_projection() -> RealtimeNotificationProjection {
    RealtimeNotificationProjection {
        generation: 1,
        upserts: vec![RealtimeNotificationUpsert {
            notification: json!({
                "id": "frq_1",
                "createdAt": "2026-10-02T00:00:00.000Z",
                "type": "friendRequest",
                "senderUserId": "usr_stranger",
                "senderUsername": "Stranger",
            })
            .into(),
            insert_defaults: None,
            notify_menu: true,
            deliver_runtime: true,
            run_automation: true,
        }],
        ..RealtimeNotificationProjection::default()
    }
}

#[test]
fn auto_decline_only_picks_never_met_senders_when_enabled() {
    let (_dir, runtime, _session) =
        runtime_with_active_session("friend-request-auto-decline").expect("realtime runtime");
    let declined_ids = || {
        runtime
            .runtime()
            .friend_requests_to_auto_decline(&friend_request_projection())
            .into_iter()
            .map(|decline| decline.facts.id)
            .collect::<Vec<_>>()
    };

    assert!(declined_ids().is_empty());

    runtime
        .store()
        .set_bool("autoDeclineFriendRequests", true)
        .unwrap();
    runtime.store().set_game_log_join_count("usr_stranger", 1);
    assert!(declined_ids().is_empty());

    runtime.store().set_game_log_join_count("usr_stranger", 0);
    assert_eq!(declined_ids(), ["frq_1"]);
}

#[test]
fn an_auto_declined_friend_request_never_reaches_the_activity_router() {
    let (_dir, runtime, session) =
        runtime_with_active_session("friend-request-auto-decline-toast").expect("realtime runtime");
    let deliver = || {
        runtime
            .runtime()
            .apply_notification_output(RealtimeNotificationOutput {
                owner_user_id: OwnerId::new(session.user_id.clone()),
                projection: friend_request_projection(),
                ..RealtimeNotificationOutput::default()
            });
        runtime
            .activity_sink_for_test()
            .take_events()
            .into_iter()
            .map(|event| event.source_id)
            .collect::<Vec<_>>()
    };

    assert_eq!(deliver(), ["notification:frq_1"]);

    runtime
        .store()
        .set_bool("autoDeclineFriendRequests", true)
        .unwrap();
    runtime.store().set_game_log_join_count("usr_stranger", 0);
    assert!(deliver().is_empty());
}

#[test]
fn auto_invite_body_attaches_message_slot_only_when_chosen() {
    let without = invite_automation_send_body("wrld_a:1", "wrld_a", "World", None);
    assert!(without.get("messageSlot").is_none());

    let with = invite_automation_send_body("wrld_a:1", "wrld_a", "World", Some(3));
    assert_eq!(with["messageSlot"], 3);
    assert_eq!(with["rsvp"], true);
}
