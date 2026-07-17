#[cfg(test)]
mod tests {
    use super::super::*;

    #[test]
    fn friend_location_with_state_change_does_not_emit_gps_feed() {
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

        let RealtimeFriendApplyResult::Output(output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-location",
                    "content": {
                        "userId": "usr_friend",
                        "location": "wrld_new:456",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "state": "online"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:01Z".into(),
            })
        else {
            panic!("friend-location should produce an output");
        };

        assert_eq!(output.projection.patches[0].state_bucket, "online");
        assert_eq!(
            output.projection.patches[0].patch["location"],
            "wrld_new:456"
        );
        assert!(output.persistence.feed_entries.is_empty());
        assert!(output.projection.feed_entries.is_empty());
    }

    #[test]
    fn duplicate_friend_location_payload_after_repeat_window_does_not_write_gps_again() {
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

        let payload = json!({
            "type": "friend-location",
            "content": {
                "userId": "usr_friend",
                "location": "wrld_new:456",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "online"
                }
            }
        });

        let RealtimeFriendApplyResult::Output(first) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: payload.clone(),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:01Z".into(),
            })
        else {
            panic!("first friend-location should produce an output");
        };
        assert_eq!(first.persistence.feed_entries[0]["type"], "GPS");

        let RealtimeFriendApplyResult::Output(second) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: payload,
                raw: "{}".into(),
                received_at: "2026-05-15T00:06:01Z".into(),
            })
        else {
            panic!("duplicate friend-location should still produce a projection output");
        };
        assert!(second.persistence.feed_entries.is_empty());
        assert!(second.projection.feed_entries.is_empty());
    }

    #[test]
    fn friend_update_status_visibility_changes_emit_private_and_restored_gps() {
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

        let RealtimeFriendApplyResult::Output(arrived) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-location",
                    "content": {
                        "userId": "usr_friend",
                        "location": "wrld_current:456",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "state": "online"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("arrival should produce an output");
        };
        assert_eq!(
            arrived.persistence.feed_entries[0]["location"],
            "wrld_current:456"
        );

        let apply_status_update = |status: &str, location: &str, received_at: &str| {
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-update",
                    "content": {
                        "userId": "usr_friend",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "state": "online",
                            "status": status,
                            "location": location
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: received_at.into(),
            })
        };

        let RealtimeFriendApplyResult::Output(private) =
            apply_status_update("ask me", "private", "2026-05-15T00:01:00Z")
        else {
            panic!("private status update should produce an output");
        };
        assert_eq!(private.persistence.feed_entries.len(), 2);
        assert_eq!(private.persistence.feed_entries[0]["type"], "GPS");
        assert_eq!(private.persistence.feed_entries[0]["location"], "private");
        assert_eq!(private.persistence.feed_entries[0]["worldName"], "");
        assert_eq!(private.persistence.feed_entries[0]["groupName"], "");
        assert_eq!(
            private.persistence.feed_entries[0]["previousLocation"],
            "wrld_current:456"
        );
        assert_eq!(private.persistence.feed_entries[1]["type"], "Status");
        assert_eq!(private.projection.patches[0].patch["location"], "private");
        assert_eq!(
            private.projection.patches[0].patch["$location"]["isPrivate"],
            true
        );

        let RealtimeFriendApplyResult::Output(restored) =
            apply_status_update("active", "wrld_current:456", "2026-05-15T00:02:00Z")
        else {
            panic!("visible status update should produce an output");
        };
        assert_eq!(restored.persistence.feed_entries.len(), 2);
        assert_eq!(restored.persistence.feed_entries[0]["type"], "GPS");
        assert_eq!(
            restored.persistence.feed_entries[0]["location"],
            "wrld_current:456"
        );
        assert_eq!(
            restored.persistence.feed_entries[0]["previousLocation"],
            "private"
        );
        assert_eq!(restored.persistence.feed_entries[1]["type"], "Status");
        assert_eq!(
            restored.projection.patches[0].patch["$location"]["worldId"],
            "wrld_current"
        );
        assert_eq!(
            restored.projection.patches[0].patch["$location_at"],
            1_778_803_320_000i64
        );
    }

    #[test]
    fn friend_location_embedded_user_location_matches_vue_spread_order() {
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
                            "stateBucket": "online",
                            "location": "wrld_stale:456"
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
        assert_eq!(output.persistence.feed_entries[0]["type"], "GPS");
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
    fn entering_traveling_emits_one_ephemeral_player_joining_entry() {
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

        let payload = json!({
            "type": "friend-location",
            "content": {
                "userId": "usr_friend",
                "location": "traveling",
                "travelingToLocation": "wrld_current:456",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "online"
                }
            }
        });
        let apply = |received_at: &str| {
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: payload.clone(),
                raw: "{}".into(),
                received_at: received_at.into(),
            })
        };

        let RealtimeFriendApplyResult::Output(first) = apply("2026-07-13T10:00:00Z") else {
            panic!("entering traveling should produce an output");
        };
        assert!(first.persistence.feed_entries.is_empty());
        assert_eq!(first.projection.feed_entries.len(), 1);
        assert_eq!(first.projection.feed_entries[0]["type"], "OnPlayerJoining");
        assert_eq!(
            first.projection.feed_entries[0]["travelingToLocation"],
            "wrld_current:456"
        );

        let RealtimeFriendApplyResult::Output(second) = apply("2026-07-13T10:00:01Z") else {
            panic!("repeated traveling should still produce a projection output");
        };
        assert!(second.projection.feed_entries.is_empty());
    }
}
