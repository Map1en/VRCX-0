use serde_json::Value;
use vrcx_0_contracts::activity::{
    stable_source_hash, ActivityActor, ActivityEvent, ActivityFacts, ActivityKind, ActivitySubject,
};
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::text::first_non_empty_owned;

use super::RealtimeInstanceQueueProjection;

pub(crate) fn feed_activity_event(entry: &FeedLiveEntry) -> Option<ActivityEvent> {
    let (kind, facts) = match entry {
        FeedLiveEntry::Online {
            location,
            world_name,
            group_name,
            world_id,
            display_location,
            ..
        } => (
            ActivityKind::Online,
            place_facts(location, world_name, group_name, world_id, display_location),
        ),
        FeedLiveEntry::Offline {
            location,
            world_name,
            group_name,
            world_id,
            display_location,
            ..
        } => (
            ActivityKind::Offline,
            place_facts(location, world_name, group_name, world_id, display_location),
        ),
        FeedLiveEntry::Gps {
            location,
            world_name,
            group_name,
            world_id,
            display_location,
            ..
        } => (
            ActivityKind::Gps,
            place_facts(location, world_name, group_name, world_id, display_location),
        ),
        FeedLiveEntry::Status {
            status,
            status_description,
            ..
        } => (
            ActivityKind::Status,
            ActivityFacts {
                status: status.clone(),
                status_description: status_description.clone(),
                ..ActivityFacts::default()
            },
        ),
        FeedLiveEntry::Bio { .. } => (ActivityKind::Bio, ActivityFacts::default()),
        FeedLiveEntry::Avatar {
            avatar_name,
            current_avatar_image_url,
            ..
        } => (
            ActivityKind::AvatarChange,
            ActivityFacts {
                avatar_name: avatar_name.clone(),
                image_url: current_avatar_image_url.clone(),
                ..ActivityFacts::default()
            },
        ),
        FeedLiveEntry::TrustLevel { trust_level, .. } => (
            ActivityKind::TrustLevel,
            ActivityFacts {
                trust_level: trust_level.clone(),
                ..ActivityFacts::default()
            },
        ),
        FeedLiveEntry::DisplayName {
            previous_display_name,
            ..
        } => (
            ActivityKind::DisplayName,
            ActivityFacts {
                previous_display_name: previous_display_name.clone(),
                ..ActivityFacts::default()
            },
        ),
        FeedLiveEntry::Friend { .. } => (ActivityKind::Friend, ActivityFacts::default()),
        FeedLiveEntry::Unfriend { .. } => (ActivityKind::Unfriend, ActivityFacts::default()),
        FeedLiveEntry::OnPlayerJoining {
            location,
            world_name,
            world_id,
            display_location,
            ..
        } => (
            ActivityKind::OnPlayerJoining,
            ActivityFacts {
                location: location.clone(),
                world_name: world_name.clone().unwrap_or_default(),
                world_id: world_id.clone().unwrap_or_default(),
                display_location: display_location.clone().unwrap_or_default(),
                ..ActivityFacts::default()
            },
        ),
        FeedLiveEntry::InstanceClosed { .. } => return None,
    };
    let created_at = entry.created_at().trim();
    let user_id = entry.user_id().trim();
    let mut event = ActivityEvent::new(
        kind,
        format!("friend-feed:{}:{user_id}:{created_at}", entry.entry_type()),
        created_at,
    );
    event.actor = ActivityActor::new(user_id, entry.display_name().trim());
    event.subject = ActivitySubject::User(user_id.to_string());
    event.in_current_instance = kind == ActivityKind::OnPlayerJoining;
    event.facts = facts;
    Some(event)
}

pub(crate) fn notification_activity_event(notification: &Value) -> Option<ActivityEvent> {
    let kind = ActivityKind::from_key(&notification.trimmed_text("type"))?;
    let id = first_non_empty_owned([
        notification.trimmed_field("id").unwrap_or_default(),
        notification
            .trimmed_field("notificationId")
            .unwrap_or_default(),
    ]);
    let created_at = notification_created_at(notification);
    let sender_user_id = notification.trimmed_text("senderUserId");
    let actor_user_id = if sender_user_id.starts_with("usr_") {
        sender_user_id
    } else {
        String::new()
    };
    let source_id = if id.is_empty() {
        format!(
            "notification:{}:{actor_user_id}:{created_at}:{}",
            kind.key(),
            stable_source_hash(&notification.to_string())
        )
    } else {
        format!("notification:{id}")
    };
    let mut event = ActivityEvent::new(kind, source_id, created_at);
    event.actor = ActivityActor::new(
        actor_user_id.clone(),
        first_non_empty_owned([
            notification
                .trimmed_field("senderDisplayName")
                .unwrap_or_default(),
            notification
                .trimmed_field("displayName")
                .unwrap_or_default(),
            notification
                .trimmed_field("senderUsername")
                .unwrap_or_default(),
            nested_str(notification, &["details", "senderDisplayName"]),
            nested_str(notification, &["details", "displayName"]),
            nested_str(notification, &["data", "senderDisplayName"]),
            nested_str(notification, &["data", "displayName"]),
        ]),
    );
    if !actor_user_id.is_empty() {
        event.subject = ActivitySubject::User(actor_user_id);
    }
    event.facts = notification_facts(notification);
    Some(event)
}

pub(crate) fn instance_closed_activity_event(notification: &Value) -> ActivityEvent {
    let location = notification.trimmed_text("location");
    let created_at = notification_created_at(notification);
    let mut event = ActivityEvent::new(
        ActivityKind::InstanceClosed,
        format!("instance-closed:{location}:{created_at}"),
        created_at,
    );
    event.facts = notification_facts(notification);
    event
}

pub(crate) fn queue_ready_activity_event(
    projection: &RealtimeInstanceQueueProjection,
) -> ActivityEvent {
    let mut event = ActivityEvent::new(
        ActivityKind::GroupQueueReady,
        format!(
            "queue-ready:{}:{}",
            projection.instance_location, projection.received_at
        ),
        projection.received_at.clone(),
    );
    event.facts = ActivityFacts {
        location: projection.instance_location.clone(),
        world_id: projection.world_id.clone(),
        world_name: projection.world_name.clone(),
        ..ActivityFacts::default()
    };
    event
}

fn notification_created_at(notification: &Value) -> String {
    first_non_empty_owned([
        notification.trimmed_field("createdAt").unwrap_or_default(),
        notification.trimmed_field("created_at").unwrap_or_default(),
    ])
}

fn notification_facts(notification: &Value) -> ActivityFacts {
    ActivityFacts {
        location: first_non_empty_owned([
            notification.trimmed_field("location").unwrap_or_default(),
            nested_str(notification, &["details", "location"]),
            nested_str(notification, &["details", "worldId"]),
            nested_str(notification, &["instanceLocation"]),
        ]),
        world_id: notification.trimmed_text("worldId"),
        world_name: first_non_empty_owned([
            notification.trimmed_field("worldName").unwrap_or_default(),
            nested_str(notification, &["details", "worldName"]),
        ]),
        display_location: first_non_empty_owned([
            notification
                .trimmed_field("displayLocation")
                .unwrap_or_default(),
            nested_str(notification, &["details", "displayLocation"]),
        ]),
        group_id: notification.trimmed_text("groupId"),
        group_name: first_non_empty_owned([
            notification.trimmed_field("groupName").unwrap_or_default(),
            nested_str(notification, &["details", "groupName"]),
            nested_str(notification, &["data", "groupName"]),
        ]),
        title: notification.trimmed_text("title"),
        message: first_non_empty_owned([
            nested_str(notification, &["details", "inviteMessage"]),
            nested_str(notification, &["details", "requestMessage"]),
            nested_str(notification, &["details", "responseMessage"]),
            notification.trimmed_field("message").unwrap_or_default(),
        ]),
        status: notification.trimmed_text("status"),
        status_description: notification.trimmed_text("statusDescription"),
        avatar_name: first_non_empty_owned([
            notification.trimmed_field("avatarName").unwrap_or_default(),
            notification.trimmed_field("name").unwrap_or_default(),
        ]),
        image_url: first_non_empty_owned([
            notification
                .trimmed_field("thumbnailImageUrl")
                .unwrap_or_default(),
            nested_str(notification, &["details", "imageUrl"]),
            notification.trimmed_field("imageUrl").unwrap_or_default(),
            notification
                .trimmed_field("currentAvatarThumbnailImageUrl")
                .unwrap_or_default(),
            notification
                .trimmed_field("currentAvatarImageUrl")
                .unwrap_or_default(),
            notification
                .trimmed_field("thumbnailUrl")
                .unwrap_or_default(),
        ]),
        message_key: nested_str(notification, &["details", "messageKey"]).to_string(),
        message_params: notification
            .get("details")
            .and_then(|details| details.get("messageParams"))
            .and_then(Value::as_object)
            .map(|params| {
                params
                    .iter()
                    .filter_map(|(name, value)| Some((name.clone(), value.as_str()?.to_string())))
                    .collect()
            })
            .unwrap_or_default(),
        ..ActivityFacts::default()
    }
}

fn place_facts(
    location: &str,
    world_name: &str,
    group_name: &str,
    world_id: &Option<String>,
    display_location: &Option<String>,
) -> ActivityFacts {
    ActivityFacts {
        location: location.to_string(),
        world_name: world_name.to_string(),
        group_name: group_name.to_string(),
        world_id: world_id.clone().unwrap_or_default(),
        display_location: display_location.clone().unwrap_or_default(),
        ..ActivityFacts::default()
    }
}

fn nested_str<'a>(value: &'a Value, path: &[&str]) -> &'a str {
    let mut current = value;
    for key in path {
        let Some(next) = current.get(key) else {
            return "";
        };
        current = next;
    }
    current.as_str().map(str::trim).unwrap_or_default()
}

#[cfg(test)]
mod tests;
