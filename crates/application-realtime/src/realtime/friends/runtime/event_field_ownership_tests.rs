#[cfg(test)]
mod tests {
    use super::super::presence_test_support::{
        friend_view, is_pending_offline, location_tag, traveling_to_tag,
    };
    use super::super::*;
    use crate::realtime::FriendIconChange;

    fn runtime_with_friend(entry: FriendBaselineEntry) -> RealtimeFriendsRuntime {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [("usr_friend".to_string(), entry)].into_iter().collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        runtime
    }

    fn empty_runtime() -> RealtimeFriendsRuntime {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        runtime
    }

    fn ws(json: Value) -> RealtimeWsMessagePayload {
        RealtimeWsMessagePayload {
            json,
            raw: "{}".into(),
            received_at: "2026-05-15T00:00:00Z".into(),
        }
    }

    fn friend_record(state: &str, location: &str) -> FriendBaselineEntry {
        FriendBaselineEntry {
            record: FriendRecord {
                id: "usr_friend".into(),
                display_name: "Friend".into(),
                ..FriendRecord::default()
            },
            presence: FriendBaselinePresence {
                state: state.into(),
                location: location.into(),
                ..FriendBaselinePresence::default()
            },
        }
    }

    fn snapshot_friend(runtime: &RealtimeFriendsRuntime) -> FriendRecord {
        runtime
            .snapshot()
            .unwrap()
            .friends_by_id
            .get("usr_friend")
            .cloned()
            .unwrap()
    }

    #[test]
    fn friend_online_presence_from_content_profile_from_user_ignores_garbage_state() {
        let runtime = runtime_with_friend(friend_record("offline", "offline"));

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-online",
            "content": {
                "userId": "usr_friend",
                "location": "wrld_home:42~region(jp)",
                "travelingToLocation": "",
                "worldId": "wrld_home",
                "platform": "standalonewindows",
                "canRequestInvite": false,
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "offline",
                    "status": "join me",
                    "statusDescription": "come vibe",
                    "tags": ["system_trust_veteran"],
                    "last_platform": "standalonewindows"
                }
            }
        }))) else {
            panic!("friend-online should produce an output");
        };

        let patch = &output.projection.patches[0];
        let view = &patch.presence.view;
        assert_eq!(view.section().as_str(), "online");
        assert_eq!(location_tag(view), Some("wrld_home:42~region(jp)"));
        assert_eq!(
            view.place().expect("online place").location.world_id,
            "wrld_home"
        );
        assert_eq!(view.platform(), "standalonewindows");
        assert_eq!(patch.record.status, "join me");
        assert_eq!(patch.record.status_description, "come vibe");
        assert_eq!(patch.record.display_name, "Friend");
        assert_eq!(patch.record.extra["$trustLevel"], "Trusted User");
        assert!(output
            .persistence
            .feed_entries
            .iter()
            .any(|entry| entry.to_json()["type"] == "Online"));

        let friend = friend_view(&runtime, "usr_friend");
        assert_eq!(friend.section().as_str(), "online");
        assert_eq!(location_tag(&friend), Some("wrld_home:42~region(jp)"));
    }

    #[test]
    fn friend_online_traveling_splits_location_sentinel_and_destination() {
        let runtime = runtime_with_friend(friend_record("offline", "offline"));

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-online",
            "content": {
                "userId": "usr_friend",
                "location": "traveling",
                "travelingToLocation": "wrld_dest:7~region(us)",
                "worldId": "wrld_dest",
                "platform": "standalonewindows",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "offline"
                }
            }
        }))) else {
            panic!("friend-online should produce an output");
        };

        let view = &output.projection.patches[0].presence.view;
        assert_eq!(view.section().as_str(), "online");
        assert_eq!(location_tag(view), Some("traveling"));
        assert_eq!(traveling_to_tag(view), Some("wrld_dest:7~region(us)"));
        assert!(output
            .joining
            .iter()
            .any(|entry| entry.to_json()["type"] == "OnPlayerJoining"));

        let friend = friend_view(&runtime, "usr_friend");
        assert_eq!(location_tag(&friend), Some("traveling"));
        assert_eq!(traveling_to_tag(&friend), Some("wrld_dest:7~region(us)"));
    }

    #[test]
    fn friend_location_with_embedded_user_updates_location_and_profile() {
        let mut baseline = friend_record("online", "wrld_old:1~region(jp)");
        baseline.record.status = "active".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-location",
            "content": {
                "userId": "usr_friend",
                "location": "wrld_new:2~region(jp)",
                "travelingToLocation": "",
                "worldId": "wrld_new",
                "platform": "standalonewindows",
                "canRequestInvite": false,
                "user": {
                    "id": "usr_friend",
                    "displayName": "New Name",
                    "state": "offline",
                    "status": "join me"
                }
            }
        }))) else {
            panic!("friend-location should produce an output");
        };

        let patch = &output.projection.patches[0];
        assert_eq!(patch.presence.view.section().as_str(), "online");
        assert_eq!(
            location_tag(&patch.presence.view),
            Some("wrld_new:2~region(jp)")
        );
        assert_eq!(patch.record.status, "join me");
        assert_eq!(patch.record.display_name, "New Name");
        assert!(output
            .persistence
            .feed_entries
            .iter()
            .any(|entry| entry.to_json()["type"] == "GPS"));

        assert_eq!(
            location_tag(&friend_view(&runtime, "usr_friend")),
            Some("wrld_new:2~region(jp)")
        );
        assert_eq!(snapshot_friend(&runtime).status, "join me");
    }

    #[test]
    fn friend_update_embedded_user_owns_icon_url() {
        let mut baseline = friend_record("online", "wrld_old:1~region(jp)");
        baseline.record.icon_url = "https://api.vrchat.cloud/api/1/image/file_old/1/256".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "iconUrl": "https://api.vrchat.cloud/api/1/image/file_new/2/256",
                    "iconFrame": "invt_frame"
                }
            }
        }))) else {
            panic!("friend-update should produce an output");
        };

        let patch = &output.projection.patches[0];
        assert_eq!(
            patch.record.icon_url,
            "https://api.vrchat.cloud/api/1/image/file_new/2/256"
        );
        assert!(!patch.record.extra.contains_key("iconUrl"));

        let friend = snapshot_friend(&runtime);
        assert_eq!(
            friend.icon_url,
            "https://api.vrchat.cloud/api/1/image/file_new/2/256"
        );
        assert!(!friend.extra.contains_key("iconUrl"));
        assert_eq!(
            friend.extra.get("iconFrame"),
            Some(&Value::String("invt_frame".into()))
        );
    }

    #[test]
    fn friend_location_top_level_traveling_overrides_stale_embedded_location() {
        let runtime = runtime_with_friend(friend_record("online", "wrld_old:1~region(jp)"));

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-location",
            "content": {
                "userId": "usr_friend",
                "location": "traveling",
                "travelingToLocation": "wrld_dest:7~region(us)",
                "worldId": "wrld_dest",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "offline",
                    "location": "wrld_old:1~region(jp)",
                    "travelingToLocation": "wrld_old:1~region(jp)",
                    "worldId": "wrld_old"
                }
            }
        }))) else {
            panic!("friend-location should produce an output");
        };

        for view in [
            output.projection.patches[0].presence.view.clone(),
            friend_view(&runtime, "usr_friend"),
        ] {
            assert_eq!(location_tag(&view), Some("traveling"));
            let destination = view
                .place()
                .and_then(|place| place.traveling_to.as_ref())
                .expect("traveling destination");
            assert_eq!(destination.tag, "wrld_dest:7~region(us)");
            assert_eq!(destination.world_id, "wrld_dest");
        }
    }

    #[test]
    fn friend_location_top_level_presence_ignores_stale_embedded_presence_fields() {
        let runtime = runtime_with_friend(friend_record("online", "traveling"));

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-location",
            "content": {
                "userId": "usr_friend",
                "location": "wrld_new:2~region(jp)",
                "travelingToLocation": "",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "offline",
                    "location": "traveling",
                    "travelingToLocation": "wrld_old:1~region(jp)",
                    "worldId": "wrld_old"
                }
            }
        }))) else {
            panic!("friend-location should produce an output");
        };

        for view in [
            output.projection.patches[0].presence.view.clone(),
            friend_view(&runtime, "usr_friend"),
        ] {
            assert_eq!(location_tag(&view), Some("wrld_new:2~region(jp)"));
            assert_eq!(traveling_to_tag(&view), None);
            assert_eq!(
                view.place().expect("online place").location.world_id,
                "wrld_new"
            );
        }
    }

    #[test]
    fn friend_location_embedded_state_does_not_override_real_location() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "online".into(),
                            location: "wrld_1:123".into(),
                            ..FriendBaselinePresence::default()
                        },
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
                            "displayName": "Friend",
                            "state": "offline"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-location should produce an output");
        };

        let view = &output.projection.patches[0].presence.view;
        assert_eq!(view.section().as_str(), "online");
        assert_eq!(output.persistence.feed_entries[0].to_json()["type"], "GPS");
        assert_eq!(location_tag(view), Some("wrld_2:456"));
        assert!(output.profile_refetch_user_ids.is_empty());
        assert_eq!(
            location_tag(&friend_view(&runtime, "usr_friend")),
            Some("wrld_2:456")
        );
    }

    #[test]
    fn friend_location_offline_offline_alias_is_not_online_proof() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "online".into(),
                            location: "wrld_1:123".into(),
                            ..FriendBaselinePresence::default()
                        },
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
                        "location": "offline:offline",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-location should produce an output");
        };

        assert_eq!(
            output.projection.patches[0]
                .presence
                .view
                .section()
                .as_str(),
            "online"
        );
        assert!(output.persistence.feed_entries.is_empty());
        assert_eq!(
            friend_view(&runtime, "usr_friend").section().as_str(),
            "online"
        );
    }

    #[test]
    fn friend_location_embedded_user_without_online_location_preserves_pending_offline() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "online".into(),
                            location: "wrld_1:123".into(),
                            ..FriendBaselinePresence::default()
                        },
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
                    "type": "friend-offline",
                    "content": { "userId": "usr_friend" }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-offline should produce an output");
        };

        let RealtimeFriendApplyResult::Output(output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-location",
                    "content": {
                        "userId": "usr_friend",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "state": "active"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:01Z".into(),
            })
        else {
            panic!("friend-location should produce an output");
        };

        let view = &output.projection.patches[0].presence.view;
        assert_eq!(view.section().as_str(), "online");
        assert!(output.persistence.feed_entries.is_empty());
        assert!(is_pending_offline(view));
        assert_eq!(output.profile_refetch_user_ids, vec!["usr_friend"]);
        assert!(runtime.wake("usr_friend", "2026-05-15T00:03:00Z").is_some());
    }

    #[test]
    fn friend_location_embedded_user_without_online_location_does_not_revive_offline_friend() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "offline".into(),
                            location: "offline".into(),
                            ..FriendBaselinePresence::default()
                        },
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

        assert_eq!(
            output.projection.patches[0]
                .presence
                .view
                .section()
                .as_str(),
            "offline"
        );
        assert_eq!(output.profile_refetch_user_ids, vec!["usr_friend"]);
        assert_eq!(
            friend_view(&runtime, "usr_friend").section().as_str(),
            "offline"
        );
    }

    #[test]
    fn friend_location_embedded_user_offline_location_starts_pending_offline() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "online".into(),
                            location: "wrld_1:123".into(),
                            ..FriendBaselinePresence::default()
                        },
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

        let view = &output.projection.patches[0].presence.view;
        assert!(
            output.wake.is_some(),
            "offline location should schedule pending timer"
        );
        assert_eq!(view.section().as_str(), "online");
        assert!(output.persistence.feed_entries.is_empty());
        assert_eq!(location_tag(view), Some("wrld_1:123"));
        assert!(is_pending_offline(view));
        let fired = runtime.wake("usr_friend", "2026-05-15T00:03:00Z").unwrap();
        assert_eq!(
            fired.projection.patches[0].presence.view.section().as_str(),
            "offline"
        );
    }

    #[test]
    fn friend_location_missing_embedded_user_without_previous_is_ignored() {
        let runtime = RealtimeFriendsRuntime::default();
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
    fn friend_location_without_user_updates_location_from_content_top_level() {
        let runtime = runtime_with_friend(friend_record("online", "wrld_old:1~region(jp)"));

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-location",
            "content": {
                "userId": "usr_friend",
                "location": "wrld_new:2~region(jp)"
            }
        }))) else {
            panic!("friend-location should produce an output");
        };

        let view = &output.projection.patches[0].presence.view;
        assert_eq!(view.section().as_str(), "online");
        assert_eq!(location_tag(view), Some("wrld_new:2~region(jp)"));
        assert!(output
            .persistence
            .feed_entries
            .iter()
            .any(|entry| entry.to_json()["type"] == "GPS"));

        assert_eq!(
            location_tag(&friend_view(&runtime, "usr_friend")),
            Some("wrld_new:2~region(jp)")
        );
    }

    #[test]
    fn friend_active_from_offline_sets_active_bucket_offline_sentinel_and_profile() {
        let runtime = runtime_with_friend(friend_record("offline", "offline"));

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-active",
            "content": {
                "userId": "usr_friend",
                "platform": "standalonewindows",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "offline",
                    "status": "busy"
                }
            }
        }))) else {
            panic!("friend-active should produce an output");
        };

        let patch = &output.projection.patches[0];
        assert_eq!(patch.presence.view.section().as_str(), "active");
        assert_eq!(location_tag(&patch.presence.view), None);
        assert_eq!(patch.record.status, "busy");
        assert_eq!(patch.record.display_name, "Friend");

        let view = friend_view(&runtime, "usr_friend");
        assert_eq!(view.section().as_str(), "active");
        assert_eq!(location_tag(&view), None);
        assert_eq!(snapshot_friend(&runtime).status, "busy");
    }

    #[test]
    fn friend_offline_without_user_debounces_and_preserves_profile() {
        let mut baseline = friend_record("online", "wrld_1:123~region(jp)");
        baseline.record.status = "join me".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-offline",
            "content": {
                "userId": "usr_friend",
                "platform": "standalonewindows"
            }
        }))) else {
            panic!("friend-offline should produce an output");
        };

        let view = &output.projection.patches[0].presence.view;
        assert_eq!(view.section().as_str(), "online");
        assert!(is_pending_offline(view));
        assert!(output.persistence.feed_entries.is_empty());
        assert!(
            output.wake.is_some(),
            "online->offline should schedule a pending-offline timer"
        );

        let debounced = friend_view(&runtime, "usr_friend");
        assert_eq!(debounced.section().as_str(), "online");
        assert_eq!(snapshot_friend(&runtime).status, "join me");
        assert_eq!(location_tag(&debounced), Some("wrld_1:123~region(jp)"));

        let fired = runtime.wake("usr_friend", "2026-05-15T00:03:00Z").unwrap();
        assert_eq!(
            fired.projection.patches[0].presence.view.section().as_str(),
            "offline"
        );
        assert_eq!(snapshot_friend(&runtime).status, "join me");
    }

    #[test]
    fn friend_update_is_profile_only_and_ignores_garbage_state() {
        let mut baseline = friend_record("online", "wrld_1:123~region(jp)");
        baseline.record.status = "join me".into();
        baseline.record.status_description = "old".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "offline",
                    "status": "active",
                    "statusDescription": "fresh"
                }
            }
        }))) else {
            panic!("friend-update should produce an output");
        };

        let patch = &output.projection.patches[0];
        assert_eq!(patch.presence.view.section().as_str(), "online");
        assert_eq!(
            location_tag(&patch.presence.view),
            Some("wrld_1:123~region(jp)")
        );
        assert_eq!(patch.record.status, "active");
        assert_eq!(patch.record.status_description, "fresh");

        let friend = friend_view(&runtime, "usr_friend");
        assert_eq!(friend.section().as_str(), "online");
        assert_eq!(location_tag(&friend), Some("wrld_1:123~region(jp)"));
    }

    #[test]
    fn friend_add_ws_shape_does_not_trust_embedded_state() {
        let runtime = empty_runtime();

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-add",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Added",
                    "state": "online"
                }
            }
        }))) else {
            panic!("friend-add should produce an output");
        };

        assert_eq!(
            output.projection.patches[0]
                .presence
                .view
                .section()
                .as_str(),
            "offline"
        );
        assert_eq!(output.persistence.friend_log_upserts.len(), 1);
        assert!(output
            .persistence
            .feed_entries
            .iter()
            .any(|entry| entry.to_json()["type"] == "Friend"
                && entry.to_json()["displayName"] == "Added"));

        assert_eq!(
            friend_view(&runtime, "usr_friend").section().as_str(),
            "offline"
        );
    }

    #[test]
    fn friend_delete_removes_from_roster() {
        let runtime = runtime_with_friend(friend_record("online", "wrld_1:123~region(jp)"));
        let friend_user_ids = runtime.friend_user_ids_snapshot();

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-delete",
            "content": { "userId": "usr_friend" }
        }))) else {
            panic!("friend-delete should produce an output");
        };

        assert_eq!(output.projection.removals, vec!["usr_friend"]);
        assert_eq!(output.projection.location_time_snapshot, Some(vec![]));
        assert_eq!(output.persistence.friend_log_deletes.len(), 1);
        assert!(output
            .persistence
            .feed_entries
            .iter()
            .any(|entry| entry.to_json()["type"] == "Unfriend"));

        assert!(!runtime
            .snapshot()
            .unwrap()
            .friends_by_id
            .contains_key("usr_friend"));
        let empty_friend_user_ids = runtime.friend_user_ids_snapshot();
        assert!(!std::sync::Arc::ptr_eq(
            &friend_user_ids,
            &empty_friend_user_ids
        ));
        assert!(empty_friend_user_ids.is_empty());
    }

    #[test]
    fn friend_update_profile_merge_is_defined_only() {
        let mut baseline = friend_record("online", "wrld_1:123~region(jp)");
        baseline.record.icon_url = "https://images.example/original/256".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(_) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "iconUrl": "https://images.example/first/256",
                    "status": "join me"
                }
            }
        }))) else {
            panic!("friend-update with iconUrl should produce an output");
        };
        assert_eq!(
            snapshot_friend(&runtime).icon_url,
            "https://images.example/first/256"
        );

        let RealtimeFriendApplyResult::Output(_) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "statusDescription": "desc only"
                }
            }
        }))) else {
            panic!("friend-update without iconUrl should still produce an output");
        };
        assert_eq!(
            snapshot_friend(&runtime).icon_url,
            "https://images.example/first/256"
        );

        let RealtimeFriendApplyResult::Output(_) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "iconUrl": Value::Null,
                    "status": "ask me"
                }
            }
        }))) else {
            panic!("friend-update with null iconUrl should still produce an output");
        };
        assert_eq!(
            snapshot_friend(&runtime).icon_url,
            "https://images.example/first/256"
        );
    }

    #[test]
    fn friend_update_icon_file_change_reports_previous_and_next_file_ids() {
        let mut baseline = friend_record("online", "wrld_1:123~region(jp)");
        baseline.record.icon_url = "https://api.vrchat.cloud/api/1/image/file_old/1/256".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "iconUrl": "https://api.vrchat.cloud/api/1/image/file_new/2/256"
                }
            }
        }))) else {
            panic!("friend-update should produce an output");
        };

        assert_eq!(
            output.icon_changes,
            vec![FriendIconChange {
                user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                previous_icon_url: "https://api.vrchat.cloud/api/1/image/file_old/1/256".into(),
                next_icon_url: "https://api.vrchat.cloud/api/1/image/file_new/2/256".into(),
                created_at: output.icon_changes[0].created_at.clone(),
            }]
        );
        assert!(!output.icon_changes[0].created_at.is_empty());
    }

    #[test]
    fn avatar_banner_friends_report_banner_file_changes_as_avatar_changes() {
        let mut baseline = friend_record("online", "wrld_1:123~region(jp)");
        baseline.record.icon_url = "https://api.vrchat.cloud/api/1/image/file_icon/1/256".into();
        baseline
            .record
            .extra
            .insert("bannerType".into(), json!("avatarBanner"));
        baseline.record.extra.insert(
            "bannerUrl".into(),
            json!("https://api.vrchat.cloud/api/1/file/file_old/1/file"),
        );
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "iconUrl": "https://api.vrchat.cloud/api/1/image/file_icon/1/256",
                    "bannerType": "avatarBanner",
                    "bannerUrl": "https://api.vrchat.cloud/api/1/file/file_new/1/file"
                }
            }
        }))) else {
            panic!("friend-update should produce an output");
        };

        assert_eq!(
            output.icon_changes,
            vec![FriendIconChange {
                user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                previous_icon_url: "https://api.vrchat.cloud/api/1/file/file_old/1/file".into(),
                next_icon_url: "https://api.vrchat.cloud/api/1/file/file_new/1/file".into(),
                created_at: output.icon_changes[0].created_at.clone(),
            }]
        );
    }

    #[test]
    fn icon_file_changes_on_presence_events_are_reported() {
        let mut baseline = friend_record("online", "wrld_1:123~region(jp)");
        baseline.record.icon_url = "https://api.vrchat.cloud/api/1/image/file_old/1/256".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-location",
            "content": {
                "userId": "usr_friend",
                "location": "wrld_1:456~region(jp)",
                "travelingToLocation": "",
                "worldId": "wrld_1",
                "platform": "standalonewindows",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "iconUrl": "https://api.vrchat.cloud/api/1/image/file_new/1/256"
                }
            }
        }))) else {
            panic!("friend-location should produce an output");
        };

        assert_eq!(output.icon_changes.len(), 1);
        assert_eq!(
            output.icon_changes[0].next_icon_url,
            "https://api.vrchat.cloud/api/1/image/file_new/1/256"
        );
    }

    #[test]
    fn icon_url_changes_without_a_new_file_id_are_not_reported() {
        let mut baseline = friend_record("online", "wrld_1:123~region(jp)");
        baseline.record.icon_url = "https://api.vrchat.cloud/api/1/image/file_same/1/256".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-location",
            "content": {
                "userId": "usr_friend",
                "location": "wrld_1:456~region(jp)",
                "travelingToLocation": "",
                "worldId": "wrld_1",
                "platform": "standalonewindows",
                "user": {
                    "id": "usr_friend",
                    "iconUrl": "https://api.vrchat.cloud/api/1/image/file_same/2/128"
                }
            }
        }))) else {
            panic!("friend-location should produce an output");
        };
        assert!(output.icon_changes.is_empty());
    }

    #[test]
    fn first_seen_icon_urls_are_not_reported_as_changes() {
        let runtime = runtime_with_friend(friend_record("online", "wrld_1:123~region(jp)"));

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "iconUrl": "https://api.vrchat.cloud/api/1/image/file_new/1/256"
                }
            }
        }))) else {
            panic!("friend-update should produce an output");
        };
        assert!(output.icon_changes.is_empty());
        assert_eq!(
            snapshot_friend(&runtime).icon_url,
            "https://api.vrchat.cloud/api/1/image/file_new/1/256"
        );
    }
}
