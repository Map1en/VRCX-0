#[cfg(test)]
mod tests {
    use super::super::*;

    #[test]
    fn stores_normalized_friend_baseline() {
        let runtime = RealtimeFriendsRuntime::new();
        let result = runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: " usr_self ".into(),
                endpoint: " https://api.example.test ".into(),
                websocket: " wss://ws.example.test ".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        display_name: "Friend".into(),
                        state: "active".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
            },
            7,
            3,
        );

        assert!(result.accepted);
        assert_eq!(result.friend_count, 1);
        assert_eq!(result.generation, 7);
        assert_eq!(result.baseline_revision, 3);
        let snapshot = runtime.snapshot().unwrap();
        assert_eq!(snapshot.current_user_id, "usr_self");
        assert_eq!(snapshot.generation, 7);
        assert_eq!(snapshot.baseline_revision, 3);
        assert_eq!(
            snapshot
                .friends_by_id
                .get("usr_friend")
                .unwrap()
                .state_bucket,
            "active"
        );
    }

    #[test]
    fn baseline_generation_uses_realtime_transport_generation_after_clear() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.clear();

        let result = runtime.set_baseline(FriendRosterBaseline::default(), 1, 0);

        assert!(result.accepted);
        assert_eq!(result.generation, 1);
        assert_eq!(runtime.snapshot().unwrap().generation, 1);
    }

    #[test]
    fn placeholder_baseline_refresh_uses_official_list_bucket() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "active".into(),
                        state_bucket: "active".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "online".into(),
                        state_bucket: "online".into(),
                        extra: [("$profileSource".to_string(), json!("placeholder"))]
                            .into_iter()
                            .collect(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
        );

        let snapshot = runtime.snapshot().expect("baseline present");
        let friend = snapshot
            .friends_by_id
            .get("usr_friend")
            .expect("friend present");
        assert_eq!(friend.state_bucket, "online");
        assert_eq!(friend.state, "online");
    }

    #[test]
    fn placeholder_baseline_refresh_follows_official_list_state() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "offline".into(),
                        state_bucket: "offline".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "online".into(),
                        state_bucket: "online".into(),
                        extra: [("$profileSource".to_string(), json!("placeholder"))]
                            .into_iter()
                            .collect(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
        );

        let snapshot = runtime.snapshot().expect("baseline present");
        let friend = snapshot
            .friends_by_id
            .get("usr_friend")
            .expect("friend present");
        assert_eq!(friend.state_bucket, "online");
    }

    #[test]
    fn refresh_baseline_debounces_online_to_offline() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "online".into(),
                        state_bucket: "online".into(),
                        location: "wrld_x:1".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "offline".into(),
                        state_bucket: "offline".into(),
                        extra: [("$profileSource".to_string(), json!("remote"))]
                            .into_iter()
                            .collect(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
        );

        let snapshot = runtime.snapshot().expect("baseline present");
        let friend = snapshot
            .friends_by_id
            .get("usr_friend")
            .expect("friend present");
        assert_eq!(friend.state_bucket, "online");
        assert_eq!(friend.extra.get("pendingOffline"), Some(&json!(true)));
    }

    #[test]
    fn unwatermarked_baseline_preserves_inflight_ws_state() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "offline".into(),
                        state_bucket: "offline".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        let RealtimeFriendApplyResult::Output(_) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-online",
                    "content": {
                        "userId": "usr_friend",
                        "location": "wrld_x:1",
                        "user": { "id": "usr_friend", "location": "wrld_x:1" }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:01Z".into(),
            })
        else {
            panic!("friend-online should produce an output");
        };
        let (_, schedules) = runtime.set_baseline_with_schedules(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "offline".into(),
                        state_bucket: "offline".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
        );

        let snapshot = runtime.snapshot().expect("baseline present");
        let friend = snapshot
            .friends_by_id
            .get("usr_friend")
            .expect("friend present");
        assert_eq!(friend.state_bucket, "online");
        assert_eq!(friend.extra.get("pendingOffline"), Some(&json!(false)));
        assert!(schedules.is_empty());
    }

    #[test]
    fn in_world_baseline_overrides_stale_active() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "active".into(),
                        state_bucket: "active".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "online".into(),
                        state_bucket: "online".into(),
                        location: "wrld_929c02a8:1".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
        );

        let snapshot = runtime.snapshot().expect("baseline present");
        let friend = snapshot
            .friends_by_id
            .get("usr_friend")
            .expect("friend present");
        assert_eq!(friend.state_bucket, "online");
    }

    #[test]
    fn placeholder_keeps_existing_display_name_not_id() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "online".into(),
                        state_bucket: "online".into(),
                        location: "wrld_x:1".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "usr_friend".into(),
                        state: "online".into(),
                        state_bucket: "online".into(),
                        extra: [("$profileSource".to_string(), json!("placeholder"))]
                            .into_iter()
                            .collect(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
        );

        let snapshot = runtime.snapshot().expect("baseline present");
        let friend = snapshot
            .friends_by_id
            .get("usr_friend")
            .expect("friend present");
        assert_eq!(friend.display_name, "Friend");
    }

    #[test]
    fn refresh_baseline_confirms_pending_offline_with_official_state() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "online".into(),
                        state_bucket: "online".into(),
                        location: "wrld_1:123".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );

        let RealtimeFriendApplyResult::Output(output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
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
        let PendingOfflineTimerAction::Schedule { token, .. } = output.timer_action else {
            panic!("offline should schedule pending timer");
        };
        let watermark = runtime.baseline_causal_watermark().friend_state_sequence;

        let (_, schedules, feed_entries) = runtime.set_baseline_with_effects(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend Fresh Name".into(),
                        state: "offline".into(),
                        state_bucket: "offline".into(),
                        location: "offline".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
            Some(watermark),
        );

        let snapshot = runtime.snapshot().unwrap();
        let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
        assert_eq!(friend.display_name, "Friend Fresh Name");
        assert_eq!(friend.state_bucket, "offline");
        assert_eq!(friend.location, "offline");
        assert_eq!(friend.extra.get("pendingOffline"), Some(&json!(false)));
        assert!(schedules.is_empty());
        assert_eq!(feed_entries.len(), 1);
        assert_eq!(feed_entries[0]["type"], "Offline");
        assert_eq!(feed_entries[0]["userId"], "usr_friend");
        assert!(runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .is_none());
    }

    #[test]
    fn rest_online_baseline_cancels_pending_offline_without_feed() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "online".into(),
                        state_bucket: "online".into(),
                        location: "wrld_1:123".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );

        let RealtimeFriendApplyResult::Output(output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
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
        let PendingOfflineTimerAction::Schedule { token, .. } = output.timer_action else {
            panic!("offline should schedule pending timer");
        };
        let watermark = runtime.baseline_causal_watermark().friend_state_sequence;

        let (_, schedules, feed_entries) = runtime.set_baseline_with_effects(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "online".into(),
                        state_bucket: "online".into(),
                        location: "wrld_2:456".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
            Some(watermark),
        );

        let snapshot = runtime.snapshot().unwrap();
        let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
        assert_eq!(friend.state_bucket, "online");
        assert_eq!(friend.location, "wrld_2:456");
        assert_eq!(friend.extra.get("pendingOffline"), Some(&json!(false)));
        assert!(schedules.is_empty());
        assert!(feed_entries.is_empty());
        assert!(runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .is_none());
    }

    #[test]
    fn stale_baseline_preserves_pending_created_after_request_started() {
        for (state_bucket, location) in [("online", "wrld_stale:1"), ("offline", "offline")] {
            let runtime = RealtimeFriendsRuntime::new();
            runtime.set_baseline(
                FriendRosterBaseline {
                    current_user_id: "usr_self".into(),
                    friends_by_id: [(
                        "usr_friend".to_string(),
                        FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            state: "online".into(),
                            state_bucket: "online".into(),
                            location: "wrld_1:123".into(),
                            ..FriendRecord::default()
                        },
                    )]
                    .into_iter()
                    .collect(),
                    ..FriendRosterBaseline::default()
                },
                1,
                0,
            );
            let watermark = runtime.baseline_causal_watermark().friend_state_sequence;
            let RealtimeFriendApplyResult::Output(output) =
                runtime.apply_ws_message(&RealtimeWsMessagePayload {
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
            let PendingOfflineTimerAction::Schedule { token, .. } = output.timer_action else {
                panic!("offline should schedule pending timer");
            };

            let (_, schedules, feed_entries) = runtime.set_baseline_with_effects(
                FriendRosterBaseline {
                    current_user_id: "usr_self".into(),
                    friends_by_id: [(
                        "usr_friend".to_string(),
                        FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Stale Friend".into(),
                            state: state_bucket.into(),
                            state_bucket: state_bucket.into(),
                            location: location.into(),
                            ..FriendRecord::default()
                        },
                    )]
                    .into_iter()
                    .collect(),
                    ..FriendRosterBaseline::default()
                },
                1,
                1,
                Some(watermark),
            );

            let snapshot = runtime.snapshot().unwrap();
            let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
            assert_eq!(friend.state_bucket, "online");
            assert_eq!(friend.extra.get("pendingOffline"), Some(&json!(true)));
            assert!(schedules.is_empty());
            assert!(feed_entries.is_empty());
            let fired = runtime
                .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
                .expect("the original pending timer should remain active");
            assert_eq!(fired.persistence.feed_entries.len(), 1);
            assert_eq!(fired.persistence.feed_entries[0]["type"], "Offline");
            assert!(runtime
                .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:01Z".into())
                .is_none());
        }
    }

    #[test]
    fn stale_offline_baseline_does_not_reverse_newer_online_cancellation() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
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
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        let RealtimeFriendApplyResult::Output(pending_output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
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
            panic!("friend-offline should schedule pending timer");
        };
        let watermark = runtime.baseline_causal_watermark().friend_state_sequence;
        assert!(matches!(
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
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
            }),
            RealtimeFriendApplyResult::Output(_)
        ));

        let (_, schedules, feed_entries) = runtime.set_baseline_with_effects(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "offline".into(),
                        state_bucket: "offline".into(),
                        location: "offline".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
            Some(watermark),
        );

        let snapshot = runtime.snapshot().unwrap();
        let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
        assert_eq!(friend.state_bucket, "online");
        assert_eq!(friend.location, "wrld_new:456");
        assert!(schedules.is_empty());
        assert!(feed_entries.is_empty());
        assert!(runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .is_none());
    }

    #[test]
    fn clear_drops_baseline() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(FriendRosterBaseline::default(), 7, 0);

        let generation = runtime.clear();

        assert!(generation > 7);
        assert!(runtime.snapshot().is_none());
    }
}
