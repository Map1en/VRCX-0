#[cfg(test)]
mod tests {
    use super::super::*;

    #[test]
    fn friend_location_offline_with_real_location_requests_profile_refetch() {
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
                        location: "offline".into(),
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

        assert_eq!(output.projection.patches[0].state_bucket, "offline");
        assert_eq!(
            output.projection.patches[0].state_bucket_authority,
            FriendStateBucketAuthority::Preserve
        );
        assert_eq!(output.projection.patches[0].patch.location, "wrld_2:456");
        assert_eq!(output.profile_refetch_user_ids, vec!["usr_friend"]);
    }

    #[test]
    fn friend_location_embedded_user_without_online_location_does_not_revive_offline_friend() {
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
                        location: "offline".into(),
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
                            "state": "online",
                            "status": "join me"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:03:01Z".into(),
            })
        else {
            panic!("friend-location should produce an output");
        };

        let patch = &output.projection.patches[0].patch;
        assert_eq!(output.projection.patches[0].state_bucket, "offline");
        assert_eq!(patch.state_bucket, "offline");
        assert_eq!(output.profile_refetch_user_ids, vec!["usr_friend"]);
        assert_eq!(
            runtime
                .snapshot()
                .unwrap()
                .friends_by_id
                .get("usr_friend")
                .unwrap()
                .state_bucket,
            "offline"
        );
    }

    #[test]
    fn friend_location_embedded_user_offline_location_starts_pending_offline() {
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
                            "state": "active",
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

        let patch = &output.projection.patches[0].patch;
        let PendingOfflineTimerAction::Schedule { token, .. } = output.timer_action else {
            panic!("offline location should schedule pending timer");
        };
        assert_eq!(output.projection.patches[0].state_bucket, "online");
        assert!(output.persistence.feed_entries.is_empty());
        assert_eq!(patch.location, "offline");
        assert_eq!(patch.extra["pendingOffline"], true);
        let fired = runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .unwrap();
        assert_eq!(fired.projection.patches[0].state_bucket, "offline");
    }

    #[test]
    fn friend_location_embedded_user_offline_location_ignores_nested_active_state() {
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
                        "stateBucket": "online",
                        "location": "offline",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "state": "active",
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

        let patch = &output.projection.patches[0].patch;
        let PendingOfflineTimerAction::Schedule { token, .. } = output.timer_action else {
            panic!("offline location should schedule pending timer");
        };
        assert_eq!(output.projection.patches[0].state_bucket, "online");
        assert!(output.persistence.feed_entries.is_empty());
        assert_eq!(patch.location, "offline");
        assert_eq!(patch.extra["pendingOffline"], true);
        let fired = runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .unwrap();
        assert_eq!(fired.projection.patches[0].state_bucket, "offline");
    }
}
