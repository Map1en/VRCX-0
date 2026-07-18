#[cfg(test)]
mod tests {
    use super::super::*;

    fn runtime_with_online_status(status: &str) -> RealtimeFriendsRuntime {
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
                        status: status.into(),
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
        runtime
    }

    #[test]
    fn refetched_profile_trust_change_upserts_and_projects_once() {
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
                        extra: [
                            ("$trustLevel".into(), json!("User")),
                            ("trustLevel".into(), json!("User")),
                            ("tags".into(), json!(["system_trust_known"])),
                        ]
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
            0,
        );
        let profile = json!({
            "id": "usr_friend",
            "displayName": "Friend",
            "state": "offline",
            "location": "offline",
            "tags": ["system_trust_veteran"]
        });

        let RealtimeFriendApplyResult::Output(first) = runtime.apply_refetched_user_profile(
            1,
            "usr_friend",
            profile.clone(),
            "2026-05-15T00:00:01Z",
        ) else {
            panic!("trust-changing profile should produce an output");
        };
        assert_eq!(first.persistence.friend_log_upserts.len(), 1);
        assert_eq!(
            first.persistence.friend_log_upserts[0].trust_level,
            "Trusted User"
        );
        assert_eq!(
            first
                .persistence
                .feed_entries
                .iter()
                .filter(|entry| entry["type"] == "TrustLevel")
                .count(),
            1
        );
        assert_eq!(
            first
                .projection
                .feed_entries
                .iter()
                .filter(|entry| entry["type"] == "TrustLevel")
                .count(),
            1
        );

        if let RealtimeFriendApplyResult::Output(second) =
            runtime.apply_refetched_user_profile(1, "usr_friend", profile, "2026-05-15T00:00:02Z")
        {
            assert!(second.persistence.friend_log_upserts.is_empty());
            assert!(second
                .persistence
                .feed_entries
                .iter()
                .all(|entry| entry["type"] != "TrustLevel"));
        }
    }

    #[test]
    fn refetched_friend_profile_updates_offline_real_location_to_online() {
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
                        location: "wrld_2:456".into(),
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

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_refetched_user_profile(
            1,
            "usr_friend",
            json!({
                "id": "usr_friend",
                "displayName": "Friend",
                "state": "online",
                "location": "wrld_2:456"
            }),
            "2026-05-15T00:00:01Z",
        ) else {
            panic!("refetched friend profile should produce an output");
        };

        assert_eq!(output.projection.patches[0].state_bucket, "online");
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
    fn refetched_friend_profile_does_not_emit_status_feed() {
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
                        status: "join me".into(),
                        status_description: "Old status".into(),
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

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_refetched_user_profile(
            1,
            "usr_friend",
            json!({
                "id": "usr_friend",
                "displayName": "Friend",
                "state": "offline",
                "location": "offline",
                "status": "active",
                "statusDescription": "Fresh REST status"
            }),
            "2026-05-15T00:00:01Z",
        ) else {
            panic!("refetched friend profile should produce an output");
        };

        assert_eq!(output.projection.patches[0].state_bucket, "offline");
        assert!(output.persistence.feed_entries.is_empty());
        assert!(output.projection.feed_entries.is_empty());
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
    fn refetched_offline_profile_finalizes_pending_offline_without_status_feed() {
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
                        status: "join me".into(),
                        status_description: "Old status".into(),
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

        let RealtimeFriendApplyResult::Output(location_output) =
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
        let PendingOfflineTimerAction::Schedule { token, .. } = location_output.timer_action else {
            panic!("offline location should schedule pending timer");
        };

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_refetched_user_profile(
            1,
            "usr_friend",
            json!({
                "id": "usr_friend",
                "displayName": "Friend",
                "state": "offline",
                "location": "offline",
                "status": "active",
                "statusDescription": "Fresh REST status"
            }),
            "2026-05-15T00:00:01Z",
        ) else {
            panic!("refetched friend profile should produce an output");
        };

        assert_eq!(output.projection.patches[0].state_bucket, "offline");
        assert!(output.persistence.feed_entries.is_empty());
        assert_eq!(output.projection.patches[0].patch["pendingOffline"], false);
        assert!(runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .is_none());
    }

    #[test]
    fn refetched_online_profile_cancels_pending_offline_timer() {
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

        let RealtimeFriendApplyResult::Output(location_output) =
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
        let PendingOfflineTimerAction::Schedule { token, .. } = location_output.timer_action else {
            panic!("offline location should schedule pending timer");
        };

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_refetched_user_profile(
            1,
            "usr_friend",
            json!({
                "id": "usr_friend",
                "displayName": "Friend",
                "state": "online",
                "location": "wrld_fresh:456"
            }),
            "2026-05-15T00:00:01Z",
        ) else {
            panic!("refetched friend profile should produce an output");
        };

        assert_eq!(output.projection.patches[0].state_bucket, "online");
        assert_eq!(output.projection.patches[0].patch["pendingOffline"], false);
        assert!(runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .is_none());
    }

    #[test]
    fn stale_refetched_profile_does_not_overwrite_newer_websocket_status() {
        let runtime = runtime_with_online_status("ask me");
        let refetch_sequence = runtime
            .friend_state_sequence_for_user(1, "usr_friend")
            .expect("friend should have a causal sequence");

        let RealtimeFriendApplyResult::Output(_) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-update",
                    "content": {
                        "userId": "usr_friend",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "state": "online",
                            "status": "active",
                            "statusDescription": "freeggs"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:01Z".into(),
            })
        else {
            panic!("websocket status update should produce an output");
        };

        let result = runtime.apply_refetched_user_profile_if_sequence(
            1,
            "usr_friend",
            refetch_sequence,
            json!({
                "id": "usr_friend",
                "displayName": "Friend",
                "state": "online",
                "status": "ask me",
                "statusDescription": ""
            }),
            "2026-05-15T00:00:02Z",
        );

        assert!(matches!(result, RealtimeFriendApplyResult::Ignored));
        let snapshot = runtime.snapshot().unwrap();
        let friend = &snapshot.friends_by_id["usr_friend"];
        assert_eq!(friend.status, "active");
        assert_eq!(friend.status_description, "freeggs");
    }

    #[test]
    fn refetched_profile_applies_when_friend_sequence_is_unchanged() {
        let runtime = runtime_with_online_status("ask me");
        let refetch_sequence = runtime
            .friend_state_sequence_for_user(1, "usr_friend")
            .expect("friend should have a causal sequence");

        let RealtimeFriendApplyResult::Output(_) = runtime
            .apply_refetched_user_profile_if_sequence(
                1,
                "usr_friend",
                refetch_sequence,
                json!({
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "online",
                    "status": "active",
                    "statusDescription": "freeggs"
                }),
                "2026-05-15T00:00:01Z",
            )
        else {
            panic!("current refetched profile should produce an output");
        };

        let snapshot = runtime.snapshot().unwrap();
        let friend = &snapshot.friends_by_id["usr_friend"];
        assert_eq!(friend.status, "active");
        assert_eq!(friend.status_description, "freeggs");
    }

    #[test]
    fn refetched_profile_does_not_add_unknown_friend() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );

        let result = runtime.apply_refetched_user_profile(
            1,
            "usr_stranger",
            json!({
                "id": "usr_stranger",
                "displayName": "Stranger",
                "state": "online"
            }),
            "2026-05-15T00:00:00Z",
        );

        assert!(matches!(result, RealtimeFriendApplyResult::Ignored));
        assert!(!runtime
            .snapshot()
            .unwrap()
            .friends_by_id
            .contains_key("usr_stranger"));
    }
}
