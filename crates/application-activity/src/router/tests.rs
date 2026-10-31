use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use serde_json::json;

use super::*;
use vrcx_0_contracts::activity::{ActivityActor, ActivityEvent, ActivityKind, ActivitySubject};
use vrcx_0_i18n::{OverlayMessage, OverlayMessageKey};

#[derive(Clone, Default)]
struct TestOverlayActivitySink {
    snapshots: Arc<Mutex<Vec<ActivitySnapshot>>>,
    deliveries: Arc<Mutex<Vec<ActivityDelivery>>>,
}

impl ActivitySink for TestOverlayActivitySink {
    fn emit_overlay_activity_snapshot(&self, snapshot: ActivitySnapshot) {
        self.snapshots.lock().unwrap().push(snapshot);
    }

    fn emit_overlay_activity_delivery(&self, delivery: ActivityDelivery) {
        self.deliveries.lock().unwrap().push(delivery);
    }
}

impl TestOverlayActivitySink {
    fn take(&self) -> Vec<ActivitySnapshot> {
        std::mem::take(&mut *self.snapshots.lock().unwrap())
    }

    fn take_deliveries(&self) -> Vec<ActivityDelivery> {
        std::mem::take(&mut *self.deliveries.lock().unwrap())
    }
}

#[test]
fn activity_text_serializes_as_the_typed_tagged_contract() {
    assert_eq!(
        serde_json::to_value(ActivityText::message(OverlayMessage::notifications_gps(
            "Test World"
        )))
        .expect("serialize message text"),
        json!({
            "kind": "message",
            "value": {
                "key": "notifications.gps",
                "params": { "location": "Test World" }
            }
        })
    );
    assert_eq!(
        serde_json::to_value(ActivityText::default()).expect("serialize default text"),
        json!({ "kind": "literal", "value": "" })
    );
}

fn recent_event(kind: ActivityKind, user_id: &str) -> ActivityEvent {
    ActivityEvent {
        created_at: chrono::Utc::now().to_rfc3339(),
        ..event(kind, user_id)
    }
}

#[test]
fn display_name_change_names_the_old_and_new_names() {
    let runtime = ActivityRouter::new();
    runtime.set_friend_user_ids(["usr_friend"]);
    let mut renamed = event(ActivityKind::DisplayName, "usr_friend");
    renamed.actor.display_name = "New Name".into();
    renamed.facts.previous_display_name = "Old Name".into();
    runtime.ingest(renamed);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].kind, ActivityKind::DisplayName);
    assert_eq!(entries[0].content.title.source_text(), "Old Name");
    assert_eq!(
        entries[0].content.body.source_text(),
        "changed their name to New Name"
    );
}

#[test]
fn trust_level_change_preserves_new_level_in_overlay_content() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "TrustLevel": {
                    "scope": "friends",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    })));
    runtime.set_friend_user_ids(["usr_friend"]);
    let mut trust = event(ActivityKind::TrustLevel, "usr_friend");
    trust.actor.display_name = "Friend".into();
    trust.facts.trust_level = "Trusted User".into();
    runtime.ingest(trust);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].kind, ActivityKind::TrustLevel);
    assert_eq!(
        entries[0]
            .content
            .body
            .as_message()
            .expect("typed trust level message")
            .params()["trustLevel"],
        "Trusted User"
    );
    assert_eq!(
        entries[0].content.body.source_text(),
        "Trust level is now Trusted User"
    );
}

#[test]
fn player_joining_matches_everyone_in_instance_scope() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "OnPlayerJoining": {
                    "scope": "everyoneInInstance",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    })));
    let mut joining = event(ActivityKind::OnPlayerJoining, "usr_joining");
    joining.in_current_instance = true;

    runtime.ingest(joining);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].kind, ActivityKind::OnPlayerJoining);
}

#[test]
fn removed_friends_no_longer_match_friend_scopes() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "Unfriend": {
                    "scope": "on",
                    "favoriteGroupKeys": "all"
                },
                "TrustLevel": {
                    "scope": "friends",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    })));
    runtime.set_friend_user_ids(["usr_removed"]);
    runtime.update_friend_user_ids(Vec::new(), vec!["usr_removed".to_string()]);

    runtime.ingest_activity(vec![
        event(ActivityKind::Unfriend, "usr_removed"),
        event(ActivityKind::TrustLevel, "usr_removed"),
    ]);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].kind, ActivityKind::Unfriend);
}

#[test]
fn invites_from_favorites_match_the_all_favorites_scope() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "invite": {
                    "scope": "allFavorites",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    })));
    runtime.set_favorite_groups(ActivityFavoriteGroups::from_pairs([(
        "fav-a",
        ["usr_sender"].as_slice(),
    )]));

    runtime.ingest_activity(vec![
        event(ActivityKind::Invite, "usr_sender"),
        event(ActivityKind::Invite, "usr_stranger"),
    ]);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].actor_user_id, "usr_sender");
}

#[test]
fn group_event_notifications_use_the_vrchat_title_when_it_is_given() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::default());
    let group_event = |kind: ActivityKind, title: &str| {
        let mut event = ActivityEvent::new(kind, kind.key(), "2026-05-31T00:02:00.000Z");
        event.facts.title = title.into();
        event.facts.message = "Starts at 21:00".into();
        event
    };

    let entries = runtime.ingest_activity(vec![
        group_event(ActivityKind::GroupEventCreated, "Weekly Meetup"),
        group_event(ActivityKind::GroupEventStarting, ""),
    ]);

    assert_eq!(entries.len(), 2);
    assert_eq!(
        entries[0].content.title,
        ActivityText::literal("Weekly Meetup")
    );
    assert_eq!(
        entries[1]
            .content
            .title
            .as_message()
            .expect("localized starting title")
            .key(),
        OverlayMessageKey::NotificationsGroupEventStartingTitle
    );
}

#[test]
fn group_change_renders_its_message_key_and_keeps_legacy_text() {
    let mut keyed = ActivityEvent::new(ActivityKind::GroupChange, "groupChange:1", "2026-10-30");
    keyed.actor = ActivityActor::new(String::new(), "Club".to_string());
    keyed.facts.message_key = "notifications.group_member_roles".into();
    keyed.facts.message_params = [("roles".to_string(), "Staff".to_string())].into();
    let content = super::content::build_activity_content(&keyed);
    assert_eq!(content.title, ActivityText::literal("Club"));
    assert_eq!(
        content.body.as_message().map(OverlayMessage::key),
        Some(OverlayMessageKey::NotificationsGroupMemberRoles)
    );
    assert_eq!(
        content
            .body
            .as_message()
            .and_then(|message| message.params().get("roles"))
            .map(String::as_str),
        Some("Staff")
    );

    let mut legacy = ActivityEvent::new(ActivityKind::GroupChange, "groupChange:2", "2026-10-30");
    legacy.facts.message = "Role Staff added".into();
    assert_eq!(
        super::content::build_activity_content(&legacy).body,
        ActivityText::literal("Role Staff added")
    );
}

#[test]
fn unnamed_direct_actor_uses_the_user_id_as_title() {
    let (runtime, sink) = webhook_only_invite_runtime();
    let mut invite = recent_event(ActivityKind::Invite, "usr_sender");
    invite.actor.display_name.clear();

    let entries = runtime.ingest_activity(vec![invite]);

    assert_eq!(entries.len(), 1);
    assert_eq!(
        entries[0].content.title,
        ActivityText::literal("usr_sender")
    );
    let deliveries = sink.take_deliveries();
    assert_eq!(deliveries.len(), 1);
    assert!(deliveries[0].webhook);
    assert_eq!(
        deliveries[0].entry.content.title.source_text(),
        "usr_sender"
    );
}

#[test]
fn location_content_exposes_raw_and_display_location() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "GPS": {
                    "scope": "friends",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    })));
    runtime.set_friend_user_ids(["usr_location"]);
    let mut gps = event(ActivityKind::Gps, "usr_location");
    gps.facts.location = "wrld_world:12345".into();
    gps.facts.world_name = "World Name".into();
    gps.facts.group_name = "Group Name".into();

    runtime.ingest(gps);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].content.location, "wrld_world:12345");
    assert_eq!(entries[0].content.world_id, "wrld_world");
    assert_eq!(
        entries[0].content.display_location,
        "World Name public(Group Name)"
    );
}

#[test]
fn snapshot_marks_favorite_relation_before_friend_relation() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "friendRequest": {
                    "scope": "on",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    })));
    runtime.set_friend_user_ids(["usr_favorite", "usr_friend"]);
    runtime.set_favorite_groups(ActivityFavoriteGroups::from_pairs([(
        "fav-a",
        ["usr_favorite"].as_slice(),
    )]));

    runtime.ingest(event(ActivityKind::FriendRequest, "usr_favorite"));
    runtime.ingest(event(ActivityKind::FriendRequest, "usr_friend"));
    runtime.ingest(event(ActivityKind::FriendRequest, "usr_other"));

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0].actor_relation, ActivityActorRelation::Favorite);
    assert_eq!(entries[1].actor_relation, ActivityActorRelation::Friend);
    assert_eq!(entries[2].actor_relation, ActivityActorRelation::None);
}

#[test]
fn queue_ready_names_the_ready_instance() {
    let runtime = ActivityRouter::new();
    let mut ready = ActivityEvent::new(
        ActivityKind::GroupQueueReady,
        "queue-ready:wrld_1:123",
        "2026-05-31T00:03:10.000Z",
    );
    ready.facts.location = "wrld_1:123".into();
    ready.facts.world_id = "wrld_1".into();
    ready.facts.world_name = "Queue World".into();

    runtime.ingest(ready);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].kind, ActivityKind::GroupQueueReady);
    assert_eq!(
        entries[0]
            .content
            .title
            .as_message()
            .expect("typed queue-ready title")
            .key(),
        OverlayMessageKey::NotificationsGroupQueueReadyTitle
    );
    assert_eq!(
        entries[0].content.summary,
        "Instance Queue Ready Instance ready to join Queue World public"
    );
}

#[test]
fn runtime_emits_snapshot_when_activity_changes_and_clears() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "invite": {
                    "scope": "on",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    })));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());

    runtime.ingest(event(ActivityKind::Invite, "usr_sender"));
    runtime.clear_runtime_state();

    let snapshots = sink.take();
    assert_eq!(snapshots.len(), 2);
    assert_eq!(snapshots[0].entries.len(), 1);
    assert_eq!(snapshots[0].entries[0].kind, ActivityKind::Invite);
    assert!(snapshots[1].entries.is_empty());
}

#[test]
fn runtime_emits_snapshot_when_filters_change() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "invite": {
                    "scope": "on",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    })));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    runtime.ingest(event(ActivityKind::Invite, "usr_sender"));
    sink.take();

    runtime.set_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "invite": {
                    "scope": "off",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    })));

    let snapshots = sink.take();
    assert_eq!(snapshots.len(), 1);
    assert!(snapshots[0].entries.is_empty());
    assert!(runtime.snapshot().entries.is_empty());
}

#[test]
fn test_notification_reaches_every_local_surface_regardless_of_filters() {
    let runtime = ActivityRouter::new();
    runtime.set_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "desktop": { "types": { "Event": { "scope": "off" } } },
        "vr": { "types": { "Event": { "scope": "off" } } },
        "tts": { "types": { "Event": { "scope": "off" } } }
    })));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());

    runtime.deliver_test_notification("Test notification.");

    let deliveries = sink.take_deliveries();
    assert_eq!(deliveries.len(), 1);
    let delivery = &deliveries[0];
    assert!(delivery.desktop && delivery.vr && delivery.hmd && delivery.tts);
    assert!(!delivery.webhook);
    assert_eq!(delivery.entry.kind, ActivityKind::Event);
    assert_eq!(
        delivery.entry.content.body.source_text(),
        "Test notification."
    );
    assert!(runtime.snapshot().entries.is_empty());
}

#[test]
fn delivery_requires_live_session_event() {
    let runtime = ActivityRouter::new();
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());

    runtime.ingest(recent_event(ActivityKind::FriendRequest, "usr_a"));
    assert!(sink.take_deliveries().is_empty());
    assert_eq!(runtime.snapshot().entries.len(), 1);

    runtime.arm_delivery();
    runtime.ingest(recent_event(ActivityKind::FriendRequest, "usr_b"));
    let deliveries = sink.take_deliveries();
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].entry.actor_user_id, "usr_b");
    assert!(deliveries[0].desktop);
    assert!(deliveries[0].vr);

    runtime.ingest(event(ActivityKind::FriendRequest, "usr_c"));
    assert!(sink.take_deliveries().is_empty());
}

#[test]
fn delivery_fires_for_missed_event_after_live_session_started() {
    let runtime = ActivityRouter::new();
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    runtime.arm_delivery();

    let now = chrono::Utc::now();
    runtime.inner.state.lock().unwrap().live_since = Some(now - chrono::Duration::seconds(120));

    let mut missed = event(ActivityKind::FriendRequest, "usr_missed");
    missed.created_at = (now - chrono::Duration::seconds(90)).to_rfc3339();
    runtime.ingest(missed);
    let deliveries = sink.take_deliveries();
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].entry.actor_user_id, "usr_missed");
}

#[test]
fn default_webhook_surface_is_opt_in() {
    let filters = ActivityFilters::default();

    assert_eq!(
        filters
            .rule_for(NotificationSurface::Webhook, ActivityKind::FriendRequest)
            .scope,
        ActivityScope::Off
    );
    assert_eq!(
        filters
            .rule_for(NotificationSurface::Webhook, ActivityKind::Online)
            .scope,
        ActivityScope::Off
    );
}

#[test]
fn delivery_fires_for_desktop_only_without_wrist_entry() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": { "types": { "invite": { "scope": "off", "favoriteGroupKeys": "all" } } },
        "desktop": { "types": { "invite": { "scope": "on", "favoriteGroupKeys": "all" } } },
        "vr": { "types": { "invite": { "scope": "off", "favoriteGroupKeys": "all" } } }
    })));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    runtime.arm_delivery();

    let entry = runtime.ingest(recent_event(ActivityKind::Invite, "usr_sender"));

    assert!(entry.is_some());
    assert!(runtime.snapshot().entries.is_empty());
    let deliveries = sink.take_deliveries();
    assert_eq!(deliveries.len(), 1);
    assert!(deliveries[0].desktop);
    assert!(!deliveries[0].vr);
}

#[test]
fn current_instance_gps_is_hidden_from_vr_and_hmd_but_kept_on_wrist() {
    let runtime = ActivityRouter::with_filters(current_instance_gps_filters(
        "friends",
        "friends",
        "selectedFavorites",
    ));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    configure_current_instance_friend(&runtime);
    runtime.arm_delivery();

    runtime.ingest(current_instance_join_event());
    let joined = sink.take_deliveries();
    assert_eq!(joined.len(), 1);
    assert!(joined[0].vr);
    assert!(joined[0].hmd);

    runtime.ingest(current_instance_gps_event("wrld_current:123"));

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].kind, ActivityKind::Gps);
    let gps = sink.take_deliveries();
    assert_eq!(gps.len(), 1);
    assert!(gps[0].desktop);
    assert!(!gps[0].vr);
    assert!(!gps[0].hmd);
    assert!(gps[0].webhook);
    assert!(gps[0].tts);
}

#[test]
fn moves_to_private_worlds_stay_off_notification_channels_when_hidden() {
    let runtime = ActivityRouter::with_filters(current_instance_gps_filters(
        "friends", "friends", "friends",
    ));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    runtime.set_friend_user_ids(["usr_selected"]);
    runtime.arm_delivery();
    runtime.set_hide_private_location_changes(true);

    runtime.ingest(current_instance_gps_event("private"));

    assert_eq!(runtime.snapshot().entries.len(), 1);
    assert!(sink.take_deliveries().is_empty());

    runtime.set_hide_private_location_changes(false);
    let mut public_move = current_instance_gps_event("wrld_public:1");
    public_move.source_id = "gps-public".to_string();
    runtime.ingest(public_move);
    let deliveries = sink.take_deliveries();
    assert_eq!(deliveries.len(), 1);
    assert!(deliveries[0].desktop);
}

#[test]
fn video_errors_stay_off_notification_channels_when_hidden() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": { "types": { "Event": { "scope": "on" } } },
        "desktop": { "types": { "Event": { "scope": "on" } } }
    })));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    runtime.arm_delivery();
    runtime.set_hide_video_errors(true);
    let game_event = |source_id: &str, message: &str| {
        let mut event = recent_event(ActivityKind::Event, "");
        event.source_id = source_id.to_string();
        event.facts.message = message.to_string();
        event
    };

    runtime.ingest(game_event("video-error", "VideoError: Video not found"));

    assert_eq!(runtime.snapshot().entries.len(), 1);
    assert!(sink.take_deliveries().is_empty());

    runtime.ingest(game_event(
        "shader",
        "Shader Keyword Limit has been reached",
    ));
    let deliveries = sink.take_deliveries();
    assert_eq!(deliveries.len(), 1);
    assert!(deliveries[0].desktop);
}

#[test]
fn current_instance_gps_is_hidden_only_on_surfaces_that_delivered_joined() {
    let runtime =
        ActivityRouter::with_filters(current_instance_gps_filters("friends", "off", "off"));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    configure_current_instance_friend(&runtime);
    runtime.arm_delivery();

    runtime.ingest(current_instance_join_event());
    let joined = sink.take_deliveries();
    assert_eq!(joined.len(), 1);
    assert!(joined[0].vr);
    assert!(!joined[0].hmd);

    runtime.ingest(current_instance_gps_event("wrld_current:123"));

    let gps = sink.take_deliveries();
    assert_eq!(gps.len(), 1);
    assert!(!gps[0].vr);
    assert!(gps[0].hmd);
}

#[test]
fn current_instance_gps_is_kept_when_joined_was_not_live() {
    let runtime =
        ActivityRouter::with_filters(current_instance_gps_filters("friends", "friends", "off"));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    configure_current_instance_friend(&runtime);

    runtime.ingest(current_instance_join_event());
    assert!(sink.take_deliveries().is_empty());
    runtime.arm_delivery();
    runtime.ingest(current_instance_gps_event("wrld_current:123"));

    let gps = sink.take_deliveries();
    assert_eq!(gps.len(), 1);
    assert!(gps[0].vr);
    assert!(gps[0].hmd);
}

#[test]
fn current_instance_gps_coverage_is_cleared_when_player_leaves() {
    let runtime =
        ActivityRouter::with_filters(current_instance_gps_filters("friends", "friends", "off"));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    configure_current_instance_friend(&runtime);
    runtime.arm_delivery();

    runtime.ingest(current_instance_join_event());
    assert_eq!(sink.take_deliveries().len(), 1);
    runtime.set_current_instance_presence("wrld_current:123", std::iter::empty::<&str>());
    runtime.set_current_instance_presence("wrld_current:123", ["usr_selected"]);
    runtime.ingest(current_instance_gps_event("wrld_current:123"));

    let gps = sink.take_deliveries();
    assert_eq!(gps.len(), 1);
    assert!(gps[0].vr);
    assert!(gps[0].hmd);
}

#[test]
fn gps_for_another_instance_clears_current_instance_joined_coverage() {
    let runtime =
        ActivityRouter::with_filters(current_instance_gps_filters("friends", "friends", "off"));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    configure_current_instance_friend(&runtime);
    runtime.arm_delivery();

    runtime.ingest(current_instance_join_event());
    assert_eq!(sink.take_deliveries().len(), 1);
    let mut away = current_instance_gps_event("wrld_other:456");
    away.source_id = "gps-away".into();
    runtime.ingest(away);

    let gps = sink.take_deliveries();
    assert_eq!(gps.len(), 1);
    assert!(gps[0].vr);
    assert!(gps[0].hmd);

    let mut returning = current_instance_gps_event("wrld_current:123");
    returning.source_id = "gps-returning".into();
    runtime.ingest(returning);

    let gps = sink.take_deliveries();
    assert_eq!(gps.len(), 1);
    assert!(gps[0].vr);
    assert!(gps[0].hmd);
}

#[test]
fn delivery_fires_for_webhook_only_without_wrist_entry() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": { "types": { "invite": { "scope": "off", "favoriteGroupKeys": "all" } } },
        "desktop": { "types": { "invite": { "scope": "off", "favoriteGroupKeys": "all" } } },
        "vr": { "types": { "invite": { "scope": "off", "favoriteGroupKeys": "all" } } },
        "webhook": { "types": { "invite": { "scope": "on", "favoriteGroupKeys": "all" } } }
    })));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    runtime.arm_delivery();

    let entry = runtime.ingest(recent_event(ActivityKind::Invite, "usr_sender"));

    assert!(entry.is_some());
    assert!(runtime.snapshot().entries.is_empty());
    let deliveries = sink.take_deliveries();
    assert_eq!(deliveries.len(), 1);
    assert!(!deliveries[0].desktop);
    assert!(!deliveries[0].vr);
    assert!(deliveries[0].webhook);
}

#[test]
fn dedup_blocks_redelivery_across_surfaces() {
    let runtime = ActivityRouter::new();
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    runtime.arm_delivery();

    let first = recent_event(ActivityKind::FriendRequest, "usr_a");
    let duplicate = first.clone();
    assert!(runtime.ingest(first).is_some());
    assert!(runtime.ingest(duplicate).is_none());
    assert_eq!(sink.take_deliveries().len(), 1);
}

#[test]
fn location_hidden_users_skip_gps_on_every_surface_but_keep_other_activity() {
    let rule = json!({ "scope": "friends", "favoriteGroupKeys": "all" });
    let surface = json!({ "types": { "GPS": rule, "Status": rule } });
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": surface,
        "desktop": surface,
        "vr": surface,
        "hmd": surface,
        "webhook": surface,
        "tts": surface
    })));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    runtime.arm_delivery();
    runtime.set_friend_user_ids(["usr_hidden", "usr_other"]);
    runtime.set_feed_hidden_users(HashSet::from(["usr_hidden".to_string()]), false);

    assert!(runtime
        .ingest(recent_event(ActivityKind::Gps, "usr_hidden"))
        .is_none());
    assert!(sink.take_deliveries().is_empty());
    assert!(runtime.snapshot().entries.is_empty());

    assert!(runtime
        .ingest(recent_event(ActivityKind::Status, "usr_hidden"))
        .is_some());
    assert!(runtime
        .ingest(recent_event(ActivityKind::Gps, "usr_other"))
        .is_some());
    let delivered = sink
        .take_deliveries()
        .into_iter()
        .map(|delivery| {
            (
                delivery.entry.kind.key().to_string(),
                delivery.entry.actor_user_id,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        delivered,
        vec![
            ("Status".to_string(), "usr_hidden".to_string()),
            ("GPS".to_string(), "usr_other".to_string()),
        ]
    );
}

#[test]
fn hide_all_feed_activity_skips_every_feed_kind_but_keeps_other_activity() {
    let rule = json!({ "scope": "friends", "favoriteGroupKeys": "all" });
    let surface = json!({ "types": {
        "GPS": rule,
        "Online": rule,
        "Offline": rule,
        "Status": rule,
        "AvatarChange": rule,
        "Bio": rule,
        "boop": rule
    } });
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": surface,
        "desktop": surface
    })));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    runtime.arm_delivery();
    runtime.set_friend_user_ids(["usr_hidden", "usr_other"]);
    runtime.set_feed_hidden_users(HashSet::from(["usr_hidden".to_string()]), true);

    for kind in [
        ActivityKind::Gps,
        ActivityKind::Online,
        ActivityKind::Offline,
        ActivityKind::Status,
        ActivityKind::AvatarChange,
        ActivityKind::Bio,
    ] {
        assert!(runtime.ingest(recent_event(kind, "usr_hidden")).is_none());
    }
    assert!(sink.take_deliveries().is_empty());

    assert!(runtime
        .ingest(recent_event(ActivityKind::Boop, "usr_hidden"))
        .is_some());
    assert!(runtime
        .ingest(recent_event(ActivityKind::Online, "usr_other"))
        .is_some());
    let delivered = sink
        .take_deliveries()
        .into_iter()
        .map(|delivery| {
            (
                delivery.entry.kind.key().to_string(),
                delivery.entry.actor_user_id,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        delivered,
        vec![
            ("boop".to_string(), "usr_hidden".to_string()),
            ("Online".to_string(), "usr_other".to_string()),
        ]
    );
}

fn event(kind: ActivityKind, user_id: &str) -> ActivityEvent {
    let mut event = ActivityEvent::new(
        kind,
        format!("{}:{user_id}", kind.key()),
        "2026-05-31T00:00:00.000Z",
    );
    event.actor = ActivityActor::new(user_id, user_id);
    event.subject = ActivitySubject::User(user_id.to_string());
    event
}

fn current_instance_gps_filters(
    vr_joined_scope: &str,
    hmd_joined_scope: &str,
    wrist_gps_scope: &str,
) -> ActivityFilters {
    ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": { "types": {
            "OnPlayerJoined": { "scope": "off", "favoriteGroupKeys": "all" },
            "GPS": { "scope": wrist_gps_scope, "favoriteGroupKeys": ["fav-selected"] }
        } },
        "desktop": { "types": {
            "OnPlayerJoined": { "scope": "off", "favoriteGroupKeys": "all" },
            "GPS": { "scope": "friends", "favoriteGroupKeys": "all" }
        } },
        "vr": { "types": {
            "OnPlayerJoined": { "scope": vr_joined_scope, "favoriteGroupKeys": "all" },
            "GPS": { "scope": "selectedFavorites", "favoriteGroupKeys": ["fav-selected"] }
        } },
        "hmd": { "types": {
            "OnPlayerJoined": { "scope": hmd_joined_scope, "favoriteGroupKeys": "all" },
            "GPS": { "scope": "selectedFavorites", "favoriteGroupKeys": ["fav-selected"] }
        } },
        "webhook": { "types": {
            "OnPlayerJoined": { "scope": "off", "favoriteGroupKeys": "all" },
            "GPS": { "scope": "friends", "favoriteGroupKeys": "all" }
        } },
        "tts": { "types": {
            "OnPlayerJoined": { "scope": "off", "favoriteGroupKeys": "all" },
            "GPS": { "scope": "friends", "favoriteGroupKeys": "all" }
        } }
    }))
}

fn configure_current_instance_friend(runtime: &ActivityRouter) {
    runtime.set_friend_user_ids(["usr_selected"]);
    runtime.set_favorite_groups(ActivityFavoriteGroups::from_pairs([(
        "fav-selected",
        ["usr_selected"].as_slice(),
    )]));
    runtime.set_current_instance_presence("wrld_current:123", ["usr_selected"]);
}

fn current_instance_join_event() -> ActivityEvent {
    let mut row = recent_event(ActivityKind::OnPlayerJoined, "usr_selected");
    row.in_current_instance = true;
    row.facts.location = "wrld_current:123".into();
    row.facts.world_id = "wrld_current".into();
    row
}

fn current_instance_gps_event(location: &str) -> ActivityEvent {
    let mut row = recent_event(ActivityKind::Gps, "usr_selected");
    row.facts.location = location.into();
    row
}

fn webhook_only_invite_runtime() -> (ActivityRouter, TestOverlayActivitySink) {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": { "types": { "invite": { "scope": "off", "favoriteGroupKeys": "all" } } },
        "desktop": { "types": { "invite": { "scope": "off", "favoriteGroupKeys": "all" } } },
        "vr": { "types": { "invite": { "scope": "off", "favoriteGroupKeys": "all" } } },
        "webhook": { "types": { "invite": { "scope": "on", "favoriteGroupKeys": "all" } } }
    })));
    let sink = TestOverlayActivitySink::default();
    runtime.set_sink(sink.clone());
    runtime.arm_delivery();
    (runtime, sink)
}
