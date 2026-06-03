use super::*;

pub(super) fn string_or_previous(patch: &Value, previous: &Value, key: &str) -> String {
    let value = string_field(patch.get(key));
    if value.is_empty() {
        string_field(previous.get(key))
    } else {
        value
    }
}

pub(super) fn object_with_pending_offline(value: Value, pending_offline: bool) -> Value {
    let mut object = value.as_object().cloned().unwrap_or_default();
    object.insert("pendingOffline".into(), Value::Bool(pending_offline));
    Value::Object(object)
}

pub(super) fn string_field(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            value
                .filter(|value| !value.is_null())
                .map(ToString::to_string)
                .unwrap_or_default()
        })
}

pub(super) fn int_field(value: Option<&Value>) -> Option<i64> {
    value
        .and_then(Value::as_i64)
        .or_else(|| {
            value
                .and_then(Value::as_u64)
                .and_then(|value| i64::try_from(value).ok())
        })
        .or_else(|| {
            value
                .and_then(Value::as_str)
                .and_then(|value| value.parse().ok())
        })
}

pub(super) fn bool_field(value: Option<&Value>) -> bool {
    value.and_then(Value::as_bool).unwrap_or(false)
}

pub(super) trait JsonHas {
    fn has(&self, key: &str) -> bool;
}

impl JsonHas for Value {
    fn has(&self, key: &str) -> bool {
        self.as_object()
            .map(|object| object.contains_key(key))
            .unwrap_or(false)
    }
}

pub(super) fn first_string<'a>(values: impl IntoIterator<Item = Option<&'a str>>) -> String {
    values
        .into_iter()
        .flatten()
        .find(|value| !value.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string()
}

pub(super) fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> &'a str {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or("")
        .trim()
}

pub(super) fn first_owned(values: impl IntoIterator<Item = String>) -> String {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
        .trim()
        .to_string()
}

#[derive(Default)]
pub(super) struct ParsedLocation {
    pub(super) world_id: String,
    pub(super) instance_id: String,
    pub(super) group_id: String,
}

impl ParsedLocation {
    pub(super) fn to_value(&self, tag: &str) -> Value {
        json!({
            "tag": tag,
            "worldId": self.world_id,
            "instanceId": self.instance_id,
            "groupId": self.group_id,
        })
    }
}

pub(super) fn parse_location(location: &str) -> ParsedLocation {
    let mut parsed = ParsedLocation::default();
    let location = location.trim();
    if let Some((world_id, instance)) = location.split_once(':') {
        parsed.world_id = world_id.to_string();
        parsed.instance_id = instance.to_string();
    } else if location.starts_with("wrld_") {
        parsed.world_id = location.to_string();
    }
    if let Some(start) = location.find("group(") {
        let rest = &location[start + "group(".len()..];
        if let Some(end) = rest.find(')') {
            parsed.group_id = rest[..end].to_string();
        }
    }
    parsed
}

pub(super) struct EventTime {
    pub(super) iso: String,
    pub(super) timestamp_ms: i64,
}

impl EventTime {
    pub(super) fn from_received_at(received_at: &str) -> Self {
        let timestamp_ms = DateTime::parse_from_rfc3339(received_at)
            .map(|value| value.timestamp_millis())
            .unwrap_or_else(|_| Utc::now().timestamp_millis());
        Self {
            iso: received_at.to_string(),
            timestamp_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use vrcx_0_core::friends::{FriendRecord, FriendRosterBaseline};
    use vrcx_0_core::realtime::RealtimeWsMessagePayload;

    use super::{PendingOfflineTimerAction, RealtimeFriendApplyResult, RealtimeFriendsRuntime};

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
                            "displayName": "Added Friend"
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
    fn friend_location_with_embedded_user_forces_online_projection() {
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
            Some("explicit")
        );
        assert!(output.persistence.feed_entries.is_empty());
        assert_eq!(output.projection.patches[0].patch["stateBucket"], "online");
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
            output.projection.patches[0]
                .state_bucket_authority
                .as_deref(),
            Some("preserve")
        );
        assert_eq!(output.projection.patches[0].patch["location"], "wrld_2:456");
        assert_eq!(output.profile_refetch_user_ids, vec!["usr_friend"]);
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
    fn friend_location_embedded_state_does_not_override_real_location() {
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

        let patch = &output.projection.patches[0].patch;
        assert_eq!(output.projection.patches[0].state_bucket, "online");
        assert_eq!(output.persistence.feed_entries[0]["type"], "GPS");
        assert_eq!(patch["stateBucket"], "online");
        assert_eq!(patch["location"], "wrld_2:456");
        assert_eq!(
            runtime
                .snapshot()
                .unwrap()
                .friends_by_id
                .get("usr_friend")
                .unwrap()
                .location,
            "wrld_2:456"
        );
    }

    #[test]
    fn friend_location_embedded_user_keeps_online_bucket_for_offline_location() {
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
                        "location": "offline:offline",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "stateBucket": "online"
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
        assert!(output.persistence.feed_entries.is_empty());
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
    fn friend_location_embedded_user_clears_pending_offline_as_online() {
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

        let patch = &output.projection.patches[0].patch;
        assert_eq!(output.projection.patches[0].state_bucket, "online");
        assert!(output.persistence.feed_entries.is_empty());
        assert_eq!(patch["pendingOffline"], false);
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

    #[test]
    fn friend_location_embedded_user_forces_online_over_active_state() {
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
        assert_eq!(output.projection.patches[0].state_bucket, "online");
        assert!(output.persistence.feed_entries.is_empty());
        assert_eq!(patch["location"], "offline");
        assert_eq!(patch["pendingOffline"], false);
    }

    #[test]
    fn friend_location_embedded_user_ignores_nested_active_state() {
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
        assert_eq!(output.projection.patches[0].state_bucket, "online");
        assert!(output.persistence.feed_entries.is_empty());
        assert_eq!(patch["location"], "offline");
        assert_eq!(patch["pendingOffline"], false);
    }

    #[test]
    fn friend_active_embedded_online_user_keeps_online_like_vue_spread_order() {
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

        let patch = &output.projection.patches[0].patch;
        assert_eq!(output.projection.patches[0].state_bucket, "online");
        assert_eq!(patch["stateBucket"], "online");
        assert_eq!(patch["pendingOffline"], false);
        assert_eq!(output.timer_action, PendingOfflineTimerAction::None);
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
    fn clear_drops_baseline() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(FriendRosterBaseline::default(), 7, 0);

        let generation = runtime.clear();

        assert!(generation > 7);
        assert!(runtime.snapshot().is_none());
    }
}
