#[cfg(test)]
mod tests {
    use super::super::*;

    #[test]
    fn websocket_friend_update_still_emits_status_feed() {
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
                            "state": "online",
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

        assert_eq!(output.persistence.feed_entries[0]["type"], "Status");
        assert_eq!(output.projection.feed_entries[0]["type"], "Status");
    }

    #[test]
    fn websocket_friend_update_with_offline_status_does_not_emit_status_feed() {
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
                            "state": "online",
                            "status": "offline",
                            "statusDescription": "Fresh offline status"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:01Z".into(),
            })
        else {
            panic!("friend-update should produce an output");
        };

        assert!(output.persistence.feed_entries.is_empty());
        assert!(output.projection.feed_entries.is_empty());
        assert_eq!(output.projection.patches[0].patch["status"], "offline");
        assert_eq!(
            output.projection.patches[0].patch["statusDescription"],
            "Fresh offline status"
        );
    }

    #[test]
    fn duplicate_friend_update_status_payload_only_writes_status_feed_once() {
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

        let payload = json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "online",
                    "status": "active",
                    "statusDescription": "Fresh WS status"
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
            panic!("first friend-update should produce an output");
        };
        assert_eq!(first.persistence.feed_entries[0]["type"], "Status");

        let RealtimeFriendApplyResult::Output(second) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: payload,
                raw: "{}".into(),
                received_at: "2026-05-15T00:01:01Z".into(),
            })
        else {
            panic!("duplicate friend-update should still produce a projection output");
        };
        assert!(second.persistence.feed_entries.is_empty());
        assert!(second.projection.feed_entries.is_empty());
    }

    #[test]
    fn friend_update_status_a_b_a_writes_each_real_diff() {
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
                        status: "active".into(),
                        status_description: "A".into(),
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
                    "type": "friend-update",
                    "content": {
                        "userId": "usr_friend",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "state": "online",
                            "status": "join me",
                            "statusDescription": "B"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:01Z".into(),
            })
        else {
            panic!("first friend-update should produce an output");
        };

        let RealtimeFriendApplyResult::Output(second) =
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
                            "statusDescription": "A"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:02:01Z".into(),
            })
        else {
            panic!("second friend-update should produce an output");
        };

        assert_eq!(first.persistence.feed_entries[0]["type"], "Status");
        assert_eq!(first.persistence.feed_entries[0]["status"], "join me");
        assert_eq!(second.persistence.feed_entries[0]["type"], "Status");
        assert_eq!(second.persistence.feed_entries[0]["status"], "active");
    }

    #[test]
    fn websocket_friend_update_avatar_tags_change_emits_avatar_feed() {
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
                        current_avatar_image_url: "https://avatar.example/image.png".into(),
                        current_avatar_thumbnail_image_url: "https://avatar.example/thumb.png"
                            .into(),
                        extra: [(
                            "currentAvatarTags".into(),
                            json!(["author_tag_avatar_featured"]),
                        )]
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
                    "type": "friend-update",
                    "content": {
                        "userId": "usr_friend",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "state": "online",
                            "currentAvatarImageUrl": "https://avatar.example/image.png",
                            "currentAvatarThumbnailImageUrl": "https://avatar.example/thumb.png",
                            "currentAvatarTags": ["author_tag_avatar_featured", "author_tag_avatar_pc"]
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:01Z".into(),
            })
        else {
            panic!("friend-update should produce an output");
        };

        assert_eq!(output.persistence.feed_entries[0]["type"], "Avatar");
        assert_eq!(
            output.persistence.feed_entries[0]["currentAvatarTags"],
            json!(["author_tag_avatar_featured", "author_tag_avatar_pc"])
        );
        assert_eq!(
            output.persistence.feed_entries[0]["previousCurrentAvatarTags"],
            json!(["author_tag_avatar_featured"])
        );
    }

    #[test]
    fn duplicate_friend_update_avatar_payload_only_writes_avatar_feed_once() {
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
                        current_avatar_image_url: "https://avatar.example/a.png".into(),
                        current_avatar_thumbnail_image_url: "https://avatar.example/a-thumb.png"
                            .into(),
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
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "online",
                    "currentAvatarImageUrl": "https://avatar.example/b.png",
                    "currentAvatarThumbnailImageUrl": "https://avatar.example/b-thumb.png"
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
            panic!("first avatar update should produce an output");
        };
        assert_eq!(first.persistence.feed_entries[0]["type"], "Avatar");

        let RealtimeFriendApplyResult::Output(second) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: payload,
                raw: "{}".into(),
                received_at: "2026-05-15T00:01:01Z".into(),
            })
        else {
            panic!("duplicate avatar update should still produce a projection output");
        };
        assert!(second.persistence.feed_entries.is_empty());
        assert!(second.projection.feed_entries.is_empty());
    }
}
