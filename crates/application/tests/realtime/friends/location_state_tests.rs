#[cfg(test)]
mod tests {
    use super::super::*;

    #[test]
    fn friend_location_with_embedded_user_without_online_location_preserves_previous_bucket() {
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
                    "type": "friend-location",
                    "content": {
                        "userId": "usr_friend",
                        "location": "offline",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "location": "offline"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-location should produce an output");
        };

        assert_eq!(output.projection.patches[0].state_bucket, "online");
        assert_eq!(
            output.projection.patches[0]
                .state_bucket_authority
                .as_deref(),
            Some("preserve")
        );
        assert!(output.persistence.feed_entries.is_empty());
        assert_eq!(output.projection.patches[0].patch["stateBucket"], "online");
        assert_eq!(output.profile_refetch_user_ids, vec!["usr_friend"]);
        assert_eq!(
            runtime
                .snapshot()
                .unwrap()
                .friends_by_id
                .get("usr_friend")
                .unwrap()
                .state_bucket,
            "online"
        );
    }

    #[test]
    fn friend_location_missing_embedded_user_preserves_previous_state() {
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
                    "type": "friend-location",
                    "content": {
                        "userId": "usr_friend",
                        "location": "wrld_2:456"
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-location should produce an output");
        };

        let patch = &output.projection.patches[0].patch;
        assert_eq!(output.projection.patches[0].state_bucket, "online");
        assert_eq!(output.persistence.feed_entries[0]["type"], "GPS");
        assert_eq!(patch["stateBucket"], "online");
        assert_eq!(patch["location"], "wrld_2:456");
    }

    #[test]
    fn friend_location_missing_embedded_user_without_previous_is_ignored() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );

        let result = runtime.apply_ws_message(&RealtimeWsMessagePayload {
            json: json!({
                "type": "friend-location",
                "content": {
                    "userId": "usr_friend",
                    "location": "wrld_2:456"
                }
            }),
            raw: "{}".into(),
            received_at: "2026-05-15T00:00:00Z".into(),
        });

        assert!(matches!(result, RealtimeFriendApplyResult::Ignored));
    }

    #[test]
    fn friend_location_missing_embedded_user_preserves_pending_offline() {
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

        let RealtimeFriendApplyResult::Output(offline_output) =
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
        let PendingOfflineTimerAction::Schedule { token, .. } = offline_output.timer_action else {
            panic!("offline should schedule pending timer");
        };

        let RealtimeFriendApplyResult::Output(location_output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-location",
                    "content": {
                        "userId": "usr_friend",
                        "location": "wrld_2:456"
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:01Z".into(),
            })
        else {
            panic!("friend-location should produce an output");
        };

        let patch = &location_output.projection.patches[0].patch;
        assert_eq!(location_output.projection.patches[0].state_bucket, "online");
        assert_eq!(
            location_output.projection.patches[0]
                .state_bucket_authority
                .as_deref(),
            Some("preserve")
        );
        assert_eq!(patch["pendingOffline"], true);
        assert_eq!(patch["location"], "wrld_2:456");
        assert!(runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .is_some());
    }
}
