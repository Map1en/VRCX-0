use std::sync::{Arc, Mutex};

use serde_json::json;

use super::*;
use crate::game_log::video::VideoInput;
use crate::realtime::{
    FriendProjection, RealtimeInstanceQueueProjection, RealtimeNotificationProjection,
    RealtimeNotificationUpsert,
};
use crate::GameLogSideEffect;
use vrcx_0_persistence::game_log::{
    GameLogEventEntry, GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogWriteBatch,
};

#[derive(Clone, Default)]
struct TestOverlayActivitySink {
    snapshots: Arc<Mutex<Vec<OverlayActivitySnapshot>>>,
}

impl OverlayActivitySink for TestOverlayActivitySink {
    fn emit_overlay_activity_snapshot(&self, snapshot: OverlayActivitySnapshot) {
        self.snapshots.lock().unwrap().push(snapshot);
    }
}

impl TestOverlayActivitySink {
    fn take(&self) -> Vec<OverlayActivitySnapshot> {
        std::mem::take(&mut *self.snapshots.lock().unwrap())
    }
}

#[test]
fn friend_projection_feed_entries_are_ingested_with_canonical_activity_types() {
    let runtime = OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "AvatarChange": {
                    "scope": "friends",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    })));
    runtime.set_friend_user_ids(["usr_avatar"]);
    let projection = FriendProjection {
        feed_entries: vec![json!({
            "type": "Avatar",
            "created_at": "2026-05-31T00:01:00.000Z",
            "userId": "usr_avatar",
            "displayName": "Avatar User"
        })],
        ..FriendProjection::default()
    };

    runtime.ingest_friend_projection(&projection);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].activity_type, "AvatarChange");
    assert_eq!(entries[0].actor_user_id, "usr_avatar");
}

#[test]
fn friend_projection_feed_entries_do_not_restore_removed_friend_membership() {
    let runtime = OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "Unfriend": {
                    "scope": "on",
                    "favoriteGroupKeys": "all"
                },
                "DisplayName": {
                    "scope": "friends",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    })));
    runtime.set_friend_user_ids(["usr_removed"]);
    let projection = FriendProjection {
        removals: vec!["usr_removed".to_string()],
        feed_entries: vec![
            json!({
                "type": "Unfriend",
                "created_at": "2026-05-31T00:01:30.000Z",
                "userId": "usr_removed",
                "displayName": "Removed User"
            }),
            json!({
                "type": "DisplayName",
                "created_at": "2026-05-31T00:01:31.000Z",
                "userId": "usr_removed",
                "displayName": "Removed User"
            }),
        ],
        ..FriendProjection::default()
    };

    runtime.ingest_friend_projection(&projection);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].activity_type, "Unfriend");
}

#[test]
fn notification_projection_uses_sender_as_actor() {
    let runtime = OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(json!({
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
    runtime.set_favorite_groups(OverlayFavoriteGroups::from_pairs([(
        "fav-a",
        ["usr_sender"].as_slice(),
    )]));
    let projection = RealtimeNotificationProjection {
        upserts: vec![RealtimeNotificationUpsert {
            notification: json!({
                "id": "notification-1",
                "type": "invite",
                "createdAt": "2026-05-31T00:02:00.000Z",
                "senderUserId": "usr_sender",
                "senderUsername": "Sender"
            }),
            insert_defaults: None,
            notify_menu: true,
            deliver_runtime: true,
            run_automation: true,
        }],
        ..RealtimeNotificationProjection::default()
    };

    runtime.ingest_notification_projection(&projection);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].source_id, "notification:notification-1");
    assert_eq!(entries[0].actor_user_id, "usr_sender");
}

#[test]
fn snapshot_marks_favorite_relation_before_friend_relation() {
    let runtime = OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(json!({
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
    runtime.set_favorite_groups(OverlayFavoriteGroups::from_pairs([(
        "fav-a",
        ["usr_favorite"].as_slice(),
    )]));

    runtime.ingest_candidate(candidate("friendRequest", "usr_favorite"));
    runtime.ingest_candidate(candidate("friendRequest", "usr_friend"));
    runtime.ingest_candidate(candidate("friendRequest", "usr_other"));

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 3);
    assert_eq!(
        entries[0].actor_relation,
        OverlayActivityActorRelation::Favorite
    );
    assert_eq!(
        entries[1].actor_relation,
        OverlayActivityActorRelation::Friend
    );
    assert_eq!(
        entries[2].actor_relation,
        OverlayActivityActorRelation::None
    );
}

#[test]
fn notification_projection_without_ids_uses_stable_fallback_source_ids() {
    let runtime = OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(json!({
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
    let projection = RealtimeNotificationProjection {
        upserts: vec![
            RealtimeNotificationUpsert {
                notification: json!({
                    "type": "invite",
                    "createdAt": "2026-05-31T00:02:00.000Z",
                    "senderUserId": "usr_sender",
                    "senderUsername": "Sender",
                    "message": "first"
                }),
                insert_defaults: None,
                notify_menu: true,
                deliver_runtime: true,
                run_automation: true,
            },
            RealtimeNotificationUpsert {
                notification: json!({
                    "type": "invite",
                    "createdAt": "2026-05-31T00:02:00.000Z",
                    "senderUserId": "usr_sender",
                    "senderUsername": "Sender",
                    "message": "second"
                }),
                insert_defaults: None,
                notify_menu: true,
                deliver_runtime: true,
                run_automation: true,
            },
        ],
        ..RealtimeNotificationProjection::default()
    };

    runtime.ingest_notification_projection(&projection);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 2);
    assert!(entries[0]
        .source_id
        .starts_with("notification:invite:usr_sender:2026-05-31T00:02:00.000Z:"));
    assert!(entries[1]
        .source_id
        .starts_with("notification:invite:usr_sender:2026-05-31T00:02:00.000Z:"));
    assert_ne!(entries[0].source_id, entries[1].source_id);
}

#[test]
fn queue_projection_only_ingests_ready_events() {
    let runtime = OverlayActivityRuntime::new();
    runtime.ingest_instance_queue_projection(&RealtimeInstanceQueueProjection {
        kind: "update".to_string(),
        instance_location: "wrld_1:123".to_string(),
        position: 2,
        queue_size: 4,
        received_at: "2026-05-31T00:03:00.000Z".to_string(),
        generation: 1,
    });
    runtime.ingest_instance_queue_projection(&RealtimeInstanceQueueProjection {
        kind: "ready".to_string(),
        instance_location: "wrld_1:123".to_string(),
        position: 0,
        queue_size: 0,
        received_at: "2026-05-31T00:03:10.000Z".to_string(),
        generation: 1,
    });

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].activity_type, "group.queueReady");
    assert_eq!(
        entries[0].content.title.key,
        "notifications.group_queue_ready_title"
    );
    assert_eq!(entries[0].content.summary, "Group queue ready");
}

#[test]
fn runtime_emits_snapshot_when_activity_changes_and_clears() {
    let runtime = OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(json!({
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

    runtime.ingest_candidate(candidate("invite", "usr_sender"));
    runtime.clear_runtime_state();

    let snapshots = sink.take();
    assert_eq!(snapshots.len(), 2);
    assert_eq!(snapshots[0].entries.len(), 1);
    assert_eq!(snapshots[0].entries[0].activity_type, "invite");
    assert!(snapshots[1].entries.is_empty());
}

#[test]
fn runtime_emits_snapshot_when_filters_change() {
    let runtime = OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(json!({
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
    runtime.ingest_candidate(candidate("invite", "usr_sender"));
    sink.take();

    runtime.set_filters(OverlayActivityFilters::from_json(json!({
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
fn game_log_join_leave_batch_ingests_current_instance_activity() {
    let runtime = OverlayActivityRuntime::new();
    let output = crate::GameLogIngestOutput {
        batch: GameLogWriteBatch {
            join_leave: vec![GameLogJoinLeaveEntry {
                created_at: "2026-05-31T00:04:00.000Z".to_string(),
                event_type: "OnPlayerJoined".to_string(),
                display_name: "Joining User".to_string(),
                location: "wrld_1:123".to_string(),
                user_id: "usr_joining".to_string(),
                time: 0,
            }],
            ..GameLogWriteBatch::default()
        },
        ..crate::GameLogIngestOutput::default()
    };

    runtime.ingest_game_log_output(&output);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].activity_type, "OnPlayerJoined");
    assert_eq!(entries[0].actor_display_name, "Joining User");
}

#[test]
fn game_log_event_and_external_batches_ingest_system_activity() {
    let runtime = OverlayActivityRuntime::new();
    let output = crate::GameLogIngestOutput {
        batch: GameLogWriteBatch {
            events: vec![GameLogEventEntry {
                created_at: "2026-05-31T00:05:00.000Z".to_string(),
                data: "Something happened".to_string(),
            }],
            externals: vec![GameLogExternalEntry {
                created_at: "2026-05-31T00:05:01.000Z".to_string(),
                message: "External message".to_string(),
                display_name: "External User".to_string(),
                user_id: "usr_external".to_string(),
                location: "wrld_1:123".to_string(),
            }],
            ..GameLogWriteBatch::default()
        },
        ..crate::GameLogIngestOutput::default()
    };

    runtime.ingest_game_log_output(&output);

    let entries = runtime.snapshot().entries;
    assert_eq!(
        entries
            .iter()
            .map(|entry| entry.activity_type.as_str())
            .collect::<Vec<_>>(),
        vec!["Event", "External"]
    );
    assert_eq!(entries[0].content.body.fallback, "Something happened");
    assert_eq!(entries[1].actor_display_name, "External User");
}

#[test]
fn game_log_system_and_video_entries_with_same_timestamp_do_not_collide() {
    let runtime = OverlayActivityRuntime::new();
    let output = crate::GameLogIngestOutput {
        batch: GameLogWriteBatch {
            events: vec![
                GameLogEventEntry {
                    created_at: "2026-05-31T00:05:00.000Z".to_string(),
                    data: "First event".to_string(),
                },
                GameLogEventEntry {
                    created_at: "2026-05-31T00:05:00.000Z".to_string(),
                    data: "Second event".to_string(),
                },
            ],
            externals: vec![
                GameLogExternalEntry {
                    created_at: "2026-05-31T00:05:01.000Z".to_string(),
                    message: "First external".to_string(),
                    display_name: "External User".to_string(),
                    user_id: "usr_external".to_string(),
                    location: "wrld_1:123".to_string(),
                },
                GameLogExternalEntry {
                    created_at: "2026-05-31T00:05:01.000Z".to_string(),
                    message: "Second external".to_string(),
                    display_name: "External User".to_string(),
                    user_id: "usr_external".to_string(),
                    location: "wrld_1:123".to_string(),
                },
            ],
            ..GameLogWriteBatch::default()
        },
        side_effects: vec![
            GameLogSideEffect::Video(VideoInput {
                created_at: "2026-05-31T00:05:02.000Z".to_string(),
                location: "wrld_1:123".to_string(),
                video_url: "https://example.test/first".to_string(),
                video_id: "first".to_string(),
                display_name: "Video User".to_string(),
                user_id: "usr_video".to_string(),
                ..VideoInput::default()
            }),
            GameLogSideEffect::Video(VideoInput {
                created_at: "2026-05-31T00:05:02.000Z".to_string(),
                location: "wrld_1:123".to_string(),
                video_url: "https://example.test/second".to_string(),
                video_id: "second".to_string(),
                display_name: "Video User".to_string(),
                user_id: "usr_video".to_string(),
                ..VideoInput::default()
            }),
        ],
        ..crate::GameLogIngestOutput::default()
    };

    runtime.ingest_game_log_output(&output);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 6);
    assert_eq!(
        entries
            .iter()
            .map(|entry| entry.activity_type.as_str())
            .collect::<Vec<_>>(),
        vec![
            "VideoPlay",
            "VideoPlay",
            "Event",
            "Event",
            "External",
            "External"
        ]
    );
    let source_ids = entries
        .iter()
        .map(|entry| entry.source_id.as_str())
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(source_ids.len(), entries.len());
}

fn candidate(activity_type: &str, user_id: &str) -> OverlayActivityCandidate {
    OverlayActivityCandidate {
        source_id: format!("{activity_type}:{user_id}"),
        activity_type: activity_type.to_string(),
        created_at: "2026-05-31T00:00:00.000Z".to_string(),
        actor_user_id: user_id.to_string(),
        actor_display_name: user_id.to_string(),
        current_instance: false,
        payload: json!({}),
    }
}
