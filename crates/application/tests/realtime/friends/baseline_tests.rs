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
    fn refresh_baseline_debounces_inflight_ws() {
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
        runtime.set_baseline_with_schedules(
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
        assert_eq!(friend.extra.get("pendingOffline"), Some(&json!(true)));
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
    fn refresh_baseline_overrides_pending_offline_with_official_state() {
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

        runtime.set_baseline_with_schedules(
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
        );

        let snapshot = runtime.snapshot().unwrap();
        let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
        assert_eq!(friend.display_name, "Friend Fresh Name");
        assert_eq!(friend.state_bucket, "offline");
        assert_eq!(friend.location, "offline");
        assert_eq!(friend.extra.get("pendingOffline"), None);
        assert!(runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .is_none());
    }

    #[test]
    fn newer_rest_offline_baseline_finalizes_pending_offline_without_timer_output() {
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

        runtime.set_baseline_with_schedules(
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
        );

        let snapshot = runtime.snapshot().unwrap();
        let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
        assert_eq!(friend.state_bucket, "offline");
        assert_eq!(friend.location, "offline");
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
