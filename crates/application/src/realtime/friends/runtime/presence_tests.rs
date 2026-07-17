#[cfg(test)]
mod tests {
    use super::super::*;

    fn friend_with_trust() -> FriendRecord {
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
        }
    }

    fn assert_trust_change(output: &RealtimeFriendOutput) {
        assert_eq!(output.persistence.friend_log_upserts.len(), 1);
        assert_eq!(
            output.persistence.friend_log_upserts[0].trust_level,
            "Trusted User"
        );
        let entries = output
            .persistence
            .feed_entries
            .iter()
            .filter(|entry| entry["type"] == "TrustLevel")
            .collect::<Vec<_>>();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["userId"], "usr_friend");
        assert_eq!(entries[0]["displayName"], "Friend");
        assert_eq!(entries[0]["trustLevel"], "Trusted User");
        assert_eq!(entries[0]["previousTrustLevel"], "User");
        assert_eq!(
            output
                .projection
                .feed_entries
                .iter()
                .filter(|entry| entry["type"] == "TrustLevel")
                .count(),
            1
        );
        assert!(output.projection.friend_log_changed);
    }

    #[test]
    fn friend_online_writes_online_feed_and_projection() {
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
                    "type": "friend-online",
                    "content": {
                        "userId": "usr_friend",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "location": "wrld_1:123"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-online should produce an output");
        };

        assert_eq!(output.projection.patches[0].state_bucket, "online");
        assert_eq!(output.persistence.feed_entries[0]["type"], "Online");
    }

    #[test]
    fn friend_add_generates_friend_feed_entry() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: Default::default(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );

        let RealtimeFriendApplyResult::Output(output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-add",
                    "content": {
                        "userId": "usr_added",
                        "user": {
                            "id": "usr_added",
                            "displayName": "Added Friend",
                            "state": "online"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-add should produce an output");
        };

        assert_eq!(output.persistence.feed_entries[0]["type"], "Friend");
        assert_eq!(output.persistence.feed_entries[0]["userId"], "usr_added");
        assert_eq!(
            output.persistence.feed_entries[0]["displayName"],
            "Added Friend"
        );
        assert_eq!(output.projection.patches[0].state_bucket, "offline");
    }

    #[test]
    fn friend_add_twice_logs_single_friend_entry() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: Default::default(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );

        let event = RealtimeWsMessagePayload {
            json: json!({
                "type": "friend-add",
                "content": {
                    "userId": "usr_added",
                    "user": { "id": "usr_added", "displayName": "Added Friend" }
                }
            }),
            raw: "{}".into(),
            received_at: "2026-05-15T00:00:00Z".into(),
        };

        let RealtimeFriendApplyResult::Output(first) = runtime.apply_ws_message(&event) else {
            panic!("first friend-add should produce an output");
        };
        assert_eq!(first.persistence.friend_log_upserts.len(), 1);
        assert!(first.projection.friend_log_changed);

        let RealtimeFriendApplyResult::Output(second) = runtime.apply_ws_message(&event) else {
            panic!("repeated friend-add should still produce an output");
        };
        assert!(second.persistence.friend_log_upserts.is_empty());
        assert!(second
            .persistence
            .feed_entries
            .iter()
            .all(|entry| entry["type"] != "Friend"));
        assert!(!second.projection.friend_log_changed);
    }

    #[test]
    fn friend_add_without_display_name_logs_unknown_not_id() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: Default::default(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );

        let RealtimeFriendApplyResult::Output(output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-add",
                    "content": { "userId": "usr_added" }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-add should produce an output");
        };

        let upsert = &output.persistence.friend_log_upserts[0];
        assert_eq!(upsert.target_user_id, "usr_added");
        assert_eq!(upsert.display_name, "Unknown");
    }

    #[test]
    fn friend_update_display_name_change_upserts_friend_log_once() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Old Name".into(),
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

        let event = RealtimeWsMessagePayload {
            json: json!({
                "type": "friend-update",
                "content": {
                    "userId": "usr_friend",
                    "user": {
                        "id": "usr_friend",
                        "displayName": "New Name"
                    }
                }
            }),
            raw: "{}".into(),
            received_at: "2026-05-15T00:00:00Z".into(),
        };

        let RealtimeFriendApplyResult::Output(first) = runtime.apply_ws_message(&event) else {
            panic!("friend-update with display name change should produce an output");
        };
        assert_eq!(first.persistence.friend_log_upserts.len(), 1);
        assert_eq!(
            first.persistence.friend_log_upserts[0].display_name,
            "New Name"
        );
        assert!(first.projection.friend_log_changed);

        if let RealtimeFriendApplyResult::Output(second) = runtime.apply_ws_message(&event) {
            assert!(second.persistence.friend_log_upserts.is_empty());
            assert!(!second.projection.friend_log_changed);
        }
    }

    #[test]
    fn trust_change_from_realtime_profile_events_upserts_and_projects_once() {
        let events = [
            json!({
                "type": "friend-update",
                "content": {
                    "userId": "usr_friend",
                    "user": {
                        "id": "usr_friend",
                        "displayName": "Friend",
                        "tags": ["system_trust_veteran"]
                    }
                }
            }),
            json!({
                "type": "friend-online",
                "content": {
                    "userId": "usr_friend",
                    "user": {
                        "id": "usr_friend",
                        "displayName": "Friend",
                        "location": "wrld_1:123",
                        "tags": ["system_trust_veteran"]
                    }
                }
            }),
            json!({
                "type": "friend-location",
                "content": {
                    "userId": "usr_friend",
                    "location": "wrld_1:123",
                    "user": {
                        "id": "usr_friend",
                        "displayName": "Friend",
                        "tags": ["system_trust_veteran"]
                    }
                }
            }),
        ];

        for event in events {
            let runtime = RealtimeFriendsRuntime::new();
            runtime.set_baseline(
                FriendRosterBaseline {
                    current_user_id: "usr_self".into(),
                    friends_by_id: [("usr_friend".to_string(), friend_with_trust())]
                        .into_iter()
                        .collect(),
                    ..FriendRosterBaseline::default()
                },
                1,
                0,
            );
            let payload = RealtimeWsMessagePayload {
                json: event,
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            };

            let RealtimeFriendApplyResult::Output(first) = runtime.apply_ws_message(&payload)
            else {
                panic!("trust-changing friend event should produce an output");
            };
            assert_trust_change(&first);
            let friend = runtime
                .snapshot()
                .unwrap()
                .friends_by_id
                .get("usr_friend")
                .cloned()
                .unwrap();
            assert_eq!(friend.extra["$trustLevel"], "Trusted User");
            assert_eq!(friend.extra["trustLevel"], "Trusted User");

            if let RealtimeFriendApplyResult::Output(second) = runtime.apply_ws_message(&payload) {
                assert!(second.persistence.friend_log_upserts.is_empty());
                assert!(second
                    .persistence
                    .feed_entries
                    .iter()
                    .all(|entry| entry["type"] != "TrustLevel"));
            }
        }
    }

    #[test]
    fn legacy_equivalent_trust_change_updates_current_without_feed() {
        let runtime = RealtimeFriendsRuntime::new();
        let mut friend = friend_with_trust();
        friend
            .extra
            .insert("$trustLevel".into(), json!("Veteran User"));
        friend
            .extra
            .insert("trustLevel".into(), json!("Veteran User"));
        friend
            .extra
            .insert("tags".into(), json!(["system_trust_veteran"]));
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [("usr_friend".to_string(), friend)].into_iter().collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );

        let RealtimeFriendApplyResult::Output(output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-update",
                    "content": {
                        "userId": "usr_friend",
                        "user": {
                            "id": "usr_friend",
                            "tags": ["system_trust_veteran"]
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("legacy-equivalent trust change should update current state");
        };

        assert_eq!(output.persistence.friend_log_upserts.len(), 1);
        assert_eq!(
            output.persistence.friend_log_upserts[0].trust_level,
            "Trusted User"
        );
        assert!(output
            .persistence
            .feed_entries
            .iter()
            .all(|entry| entry["type"] != "TrustLevel"));
        assert_eq!(
            runtime.snapshot().unwrap().friends_by_id["usr_friend"].extra["$trustLevel"],
            "Trusted User"
        );
    }

    #[test]
    fn friend_online_with_display_name_change_upserts_friend_log() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Old Name".into(),
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
                    "type": "friend-online",
                    "content": {
                        "userId": "usr_friend",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "New Name",
                            "location": "wrld_1:123"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-online should produce an output");
        };

        assert_eq!(output.persistence.friend_log_upserts.len(), 1);
        assert_eq!(
            output.persistence.friend_log_upserts[0].display_name,
            "New Name"
        );
        assert!(output.projection.friend_log_changed);
    }

    #[test]
    fn friend_location_with_embedded_display_name_change_upserts_friend_log() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Old Name".into(),
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
                        "location": "wrld_2:456",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "New Name"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-location should produce an output");
        };

        assert_eq!(output.persistence.friend_log_upserts.len(), 1);
        assert_eq!(
            output.persistence.friend_log_upserts[0].display_name,
            "New Name"
        );
        assert!(output.projection.friend_log_changed);
    }

    #[test]
    fn friend_delete_generates_unfriend_feed_entry() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_removed".to_string(),
                    FriendRecord {
                        id: "usr_removed".into(),
                        display_name: "Removed Friend".into(),
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

        let RealtimeFriendApplyResult::Output(output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-delete",
                    "content": {
                        "userId": "usr_removed"
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-delete should produce an output");
        };

        assert_eq!(output.persistence.feed_entries[0]["type"], "Unfriend");
        assert_eq!(output.persistence.feed_entries[0]["userId"], "usr_removed");
        assert_eq!(
            output.persistence.feed_entries[0]["displayName"],
            "Removed Friend"
        );
    }

    #[test]
    fn websocket_friend_update_does_not_demote_online_friend_to_offline() {
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

        let RealtimeFriendApplyResult::Output(output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-update",
                    "content": {
                        "userId": "usr_friend",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "state": "offline",
                            "status": "active",
                            "statusDescription": "Fresh WS status"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:01Z".into(),
            })
        else {
            panic!("friend-update should produce an output");
        };

        assert_eq!(output.projection.patches[0].state_bucket, "online");
        assert_eq!(output.projection.patches[0].patch["stateBucket"], "online");
        assert_eq!(output.projection.patches[0].patch["state"], "online");
    }

    #[test]
    fn friend_active_with_dirty_online_state_fires_active_not_online() {
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
                    "type": "friend-active",
                    "content": {
                        "userId": "usr_friend",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "state": "online",
                            "location": "wrld_2:456"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-active should produce an output");
        };

        assert_eq!(output.projection.patches[0].state_bucket, "online");
        let PendingOfflineTimerAction::Schedule { token, .. } = output.timer_action else {
            panic!("online->active should schedule pending timer");
        };
        let fired = runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .unwrap();
        assert_eq!(fired.projection.patches[0].state_bucket, "active");
    }

    #[test]
    fn pending_offline_timer_writes_offline_feed_when_it_fires() {
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
                        extra: [("$location_at".into(), json!(1_700_000_000_000i64))]
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

        let fired = runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .unwrap();

        assert_eq!(fired.projection.patches[0].state_bucket, "offline");
        assert_eq!(fired.persistence.feed_entries[0]["type"], "Offline");
    }

    #[test]
    fn friend_active_with_dirty_offline_state_fires_active_not_offline() {
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
                    "type": "friend-active",
                    "content": {
                        "userId": "usr_friend",
                        "user": { "id": "usr_friend", "displayName": "Friend", "state": "offline" }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-active should produce an output");
        };
        assert_eq!(output.projection.patches[0].state_bucket, "online");
        let PendingOfflineTimerAction::Schedule { token, .. } = output.timer_action else {
            panic!("online->active should schedule pending timer");
        };
        let fired = runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .unwrap();
        assert_eq!(fired.projection.patches[0].state_bucket, "active");
    }

    #[test]
    fn repeated_pending_offline_event_does_not_reschedule_timer() {
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
            panic!("first friend-offline should produce an output");
        };
        let PendingOfflineTimerAction::Schedule { token, .. } = output.timer_action else {
            panic!("first offline should schedule pending timer");
        };

        let repeated = runtime.apply_ws_message(&RealtimeWsMessagePayload {
            json: json!({
                "type": "friend-offline",
                "content": { "userId": "usr_friend" }
            }),
            raw: "{}".into(),
            received_at: "2026-05-15T00:00:10Z".into(),
        });

        assert!(matches!(repeated, RealtimeFriendApplyResult::Ignored));
        let fired = runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .unwrap();
        assert_eq!(fired.projection.patches[0].state_bucket, "offline");
    }

    #[test]
    fn pending_offline_existing_event_does_not_replace_timer_or_target_state() {
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

        let RealtimeFriendApplyResult::Output(first) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-active",
                    "content": { "userId": "usr_friend" }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-active should schedule pending timer");
        };
        let PendingOfflineTimerAction::Schedule { token, .. } = first.timer_action else {
            panic!("online->active should schedule pending timer");
        };

        let repeated = runtime.apply_ws_message(&RealtimeWsMessagePayload {
            json: json!({
                "type": "friend-offline",
                "content": { "userId": "usr_friend" }
            }),
            raw: "{}".into(),
            received_at: "2026-05-15T00:00:10Z".into(),
        });

        assert!(matches!(repeated, RealtimeFriendApplyResult::Ignored));
        let fired = runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .unwrap();
        assert_eq!(fired.projection.patches[0].state_bucket, "active");
        assert_eq!(fired.projection.patches[0].patch["state"], json!("active"));
    }
}
