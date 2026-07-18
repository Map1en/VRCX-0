use serde_json::{json, Value};
use vrcx_0_application_core::{
    FriendProjection, RealtimeInstanceClosedProjection, RealtimeInstanceQueueProjection,
    RealtimeNotificationProjection,
};

use super::definitions::known_definition_for_type;
use super::runtime::{first_non_empty, string_field};
use super::types::{OverlayActivityCandidate, OverlayActivityEntry};
use super::OverlayActivityRuntime;

impl OverlayActivityRuntime {
    pub fn ingest_friend_projection(
        &self,
        projection: &FriendProjection,
    ) -> Vec<OverlayActivityEntry> {
        self.apply_friend_membership_projection(projection);
        projection
            .feed_entries
            .iter()
            .filter_map(friend_feed_candidate)
            .filter_map(|candidate| self.ingest_candidate(candidate))
            .collect()
    }

    pub fn ingest_notification_projection(
        &self,
        projection: &RealtimeNotificationProjection,
    ) -> Vec<OverlayActivityEntry> {
        projection
            .upserts
            .iter()
            .filter(|upsert| upsert.deliver_runtime)
            .filter_map(|upsert| notification_candidate(&upsert.notification))
            .filter_map(|candidate| self.ingest_candidate(candidate))
            .collect()
    }

    pub fn ingest_instance_queue_projection(
        &self,
        projection: &RealtimeInstanceQueueProjection,
    ) -> Vec<OverlayActivityEntry> {
        if projection.kind != "ready" {
            return Vec::new();
        }
        let candidate = OverlayActivityCandidate {
            source_id: format!(
                "queue-ready:{}:{}",
                projection.instance_location, projection.received_at
            ),
            activity_type: "group.queueReady".to_string(),
            created_at: projection.received_at.clone(),
            actor_user_id: String::new(),
            actor_display_name: String::new(),
            current_instance: false,
            payload: json!({
                "instanceLocation": projection.instance_location,
                "worldId": projection.world_id,
                "worldName": projection.world_name,
                "position": projection.position,
                "queueSize": projection.queue_size,
            }),
        };
        self.ingest_candidate(candidate).into_iter().collect()
    }

    pub fn ingest_instance_closed_projection(
        &self,
        projection: &RealtimeInstanceClosedProjection,
    ) -> Vec<OverlayActivityEntry> {
        let notification = &projection.notification;
        let location = string_field(notification, "location");
        let created_at = first_non_empty([
            string_field(notification, "createdAt"),
            string_field(notification, "created_at"),
        ]);
        let candidate = OverlayActivityCandidate {
            source_id: format!("instance-closed:{location}:{created_at}"),
            activity_type: "instance.closed".to_string(),
            created_at,
            actor_user_id: String::new(),
            actor_display_name: String::new(),
            current_instance: false,
            payload: notification.clone(),
        };
        self.ingest_candidate(candidate).into_iter().collect()
    }

    fn apply_friend_membership_projection(&self, projection: &FriendProjection) {
        for patch in &projection.patches {
            self.insert_friend_user_id(patch.user_id.clone());
        }
        for user_id in &projection.removals {
            self.remove_friend_user_id(user_id);
        }
    }
}

fn friend_feed_candidate(value: &Value) -> Option<OverlayActivityCandidate> {
    let activity_type = string_field(value, "type");
    known_definition_for_type(&activity_type)?;
    let created_at = first_non_empty([
        string_field(value, "created_at"),
        string_field(value, "createdAt"),
    ]);
    let user_id = string_field(value, "userId");
    let current_instance = activity_type == "OnPlayerJoining";
    Some(OverlayActivityCandidate {
        source_id: format!("friend-feed:{activity_type}:{user_id}:{created_at}"),
        activity_type,
        created_at,
        actor_user_id: user_id,
        actor_display_name: string_field(value, "displayName"),
        current_instance,
        payload: value.clone(),
    })
}

fn notification_candidate(value: &Value) -> Option<OverlayActivityCandidate> {
    let activity_type = string_field(value, "type");
    known_definition_for_type(&activity_type)?;
    let id = first_non_empty([
        string_field(value, "id"),
        string_field(value, "notificationId"),
    ]);
    let created_at = first_non_empty([
        string_field(value, "createdAt"),
        string_field(value, "created_at"),
    ]);
    let actor_user_id = string_field(value, "senderUserId");
    let actor_user_id = if actor_user_id.starts_with("usr_") {
        actor_user_id
    } else {
        String::new()
    };
    let actor_display_name = notification_actor_display_name(value);
    let source_id = if id.trim().is_empty() {
        format!(
            "notification:{activity_type}:{actor_user_id}:{created_at}:{}",
            stable_json_hash(value)
        )
    } else {
        format!("notification:{id}")
    };
    Some(OverlayActivityCandidate {
        source_id,
        activity_type,
        created_at,
        actor_user_id,
        actor_display_name,
        current_instance: false,
        payload: value.clone(),
    })
}

fn notification_actor_display_name(value: &Value) -> String {
    first_non_empty([
        string_field(value, "senderDisplayName"),
        string_field(value, "displayName"),
        string_field(value, "senderUsername"),
        nested_string(value, &["details", "senderDisplayName"]),
        nested_string(value, &["details", "displayName"]),
        nested_string(value, &["data", "senderDisplayName"]),
        nested_string(value, &["data", "displayName"]),
    ])
}

fn nested_string(value: &Value, path: &[&str]) -> String {
    let mut current = value;
    for key in path {
        let Some(next) = current.get(key) else {
            return String::new();
        };
        current = next;
    }
    current
        .as_str()
        .map(str::trim)
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn stable_json_hash(value: &Value) -> String {
    let payload = serde_json::to_string(value).unwrap_or_else(|_| value.to_string());
    let mut hash = 0xcbf29ce484222325u64;
    for byte in payload.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}
