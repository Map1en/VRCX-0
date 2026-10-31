use serde_json::{json, Map, Value};
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_contracts::realtime::{NotificationExpiration, NotificationV2Update};
use vrcx_0_core::json::{text_of, JsonExt};
use vrcx_0_core::notification_group::{notification_group_key, NotificationGroupFacts};
use vrcx_0_core::realtime::RealtimeWsMessagePayload;
use vrcx_0_core::text::first_non_empty;
use vrcx_0_core::text::first_owned;

use super::event_kind::RealtimeWsEventKind;
use super::{
    RealtimeInstanceClosedOutput, RealtimeInstanceClosedProjection, RealtimeNotificationOutput,
    RealtimeNotificationProjection, RealtimeNotificationUpsert,
};
use vrcx_0_core::OwnerId;

#[cfg(any(test, feature = "test-utils"))]
pub fn apply_notification_ws_message(
    owner_user_id: &OwnerId,
    endpoint: &str,
    generation: u64,
    payload: &RealtimeWsMessagePayload,
) -> Option<RealtimeNotificationOutput> {
    let event_kind = RealtimeWsEventKind::from_payload(payload)?;
    apply_notification_ws_event(owner_user_id, endpoint, generation, &event_kind, payload)
}

pub(crate) fn apply_notification_ws_event(
    owner_user_id: &OwnerId,
    endpoint: &str,
    generation: u64,
    event_kind: &RealtimeWsEventKind,
    payload: &RealtimeWsMessagePayload,
) -> Option<RealtimeNotificationOutput> {
    if !event_kind.is_notification() {
        return None;
    }
    let content = payload.json.get("content").unwrap_or(&Value::Null);
    let now = payload.received_at.clone();
    let mut output = RealtimeNotificationOutput {
        owner_user_id: OwnerId::new(owner_user_id.as_str().trim()),
        projection: RealtimeNotificationProjection {
            generation,
            ..RealtimeNotificationProjection::default()
        },
        ..RealtimeNotificationOutput::default()
    };

    match event_kind {
        RealtimeWsEventKind::Notification => {
            let notification = normalize_v1_notification(content, &now);
            if should_persist_v1(&notification, owner_user_id.as_str()) {
                output
                    .persistence
                    .notification_v1_upserts
                    .push(notification.clone());
            }
            output.projection.upserts.push(RealtimeNotificationUpsert {
                insert_defaults: None,
                notify_menu: true,
                deliver_runtime: true,
                run_automation: true,
                notification: with_group_key(notification).into(),
            });
        }
        RealtimeWsEventKind::NotificationV2 => {
            let notification = normalize_v2_notification(content, endpoint, &now);
            output
                .persistence
                .notification_v2_upserts
                .push(notification.clone());
            output.projection.upserts.push(RealtimeNotificationUpsert {
                insert_defaults: None,
                notify_menu: should_notify_menu(&notification),
                deliver_runtime: true,
                run_automation: true,
                notification: with_group_key(notification).into(),
            });
        }
        RealtimeWsEventKind::NotificationV2Update => {
            let id = content.text_field("id");
            if id.is_empty() {
                return Some(output);
            }
            let updates = content.get("updates").cloned().unwrap_or(Value::Null);
            let notification = normalize_v2_update_notification(&id, &updates, endpoint);
            output
                .persistence
                .notification_v2_updates
                .push(NotificationV2Update {
                    id: notification.text_field("id"),
                    updates: notification.clone(),
                    received_at: now.clone(),
                });
            if bool_field(notification.get("seen")) {
                output
                    .projection
                    .seen_ids
                    .push(notification.text_field("id"));
                output.projection.clear_menu_if_no_unseen = true;
            }
            output.projection.upserts.push(RealtimeNotificationUpsert {
                insert_defaults: Some(
                    json!({
                        "createdAt": now,
                        "created_at": now,
                        "seen": false,
                    })
                    .into(),
                ),
                notify_menu: should_notify_menu(&notification),
                deliver_runtime: false,
                run_automation: false,
                notification: notification.into(),
            });
        }
        RealtimeWsEventKind::NotificationV2Delete => {
            let ids = content
                .get("ids")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|value| text_of(Some(&value)))
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>();
            for id in &ids {
                output
                    .persistence
                    .notification_expirations
                    .push(NotificationExpiration {
                        id: id.clone(),
                        expired_at: now.clone(),
                    });
            }
            output.projection.expired_ids = ids.clone();
            output.projection.seen_ids = ids;
            output.projection.clear_menu_if_no_unseen = true;
        }
        RealtimeWsEventKind::SeeNotification => {
            let id = content_id(content);
            if !id.is_empty() {
                output.persistence.notification_seen.push(id.clone());
                output.projection.seen_ids.push(id);
                output.projection.clear_menu_if_no_unseen = true;
            }
        }
        RealtimeWsEventKind::HideNotification | RealtimeWsEventKind::ResponseNotification => {
            let direct_id = content_id(content);
            let notification_id = content.text_field("notificationId");
            let id = first_non_empty([direct_id.as_str(), notification_id.as_str()]).to_string();
            if !id.is_empty() {
                output
                    .persistence
                    .notification_expirations
                    .push(NotificationExpiration {
                        id: id.clone(),
                        expired_at: now,
                    });
                output.projection.expired_ids.push(id.clone());
                output.projection.seen_ids.push(id);
                output.projection.clear_menu_if_no_unseen = true;
            }
        }
        _ => return None,
    }

    if output.projection.upserts.is_empty()
        && output.projection.expired_ids.is_empty()
        && output.projection.seen_ids.is_empty()
        && output.persistence.is_empty()
    {
        return None;
    }
    Some(output)
}

#[cfg(test)]
pub fn apply_instance_closed_ws_message(
    generation: u64,
    payload: &RealtimeWsMessagePayload,
) -> Option<RealtimeInstanceClosedOutput> {
    let event_kind = RealtimeWsEventKind::from_payload(payload)?;
    apply_instance_closed_ws_event(generation, &event_kind, payload)
}

pub(crate) fn apply_instance_closed_ws_event(
    generation: u64,
    event_kind: &RealtimeWsEventKind,
    payload: &RealtimeWsMessagePayload,
) -> Option<RealtimeInstanceClosedOutput> {
    if event_kind != &RealtimeWsEventKind::InstanceClosed {
        return None;
    }
    let content = payload.json.get("content").unwrap_or(&Value::Null);
    let location = first_owned([
        content.text_field("instanceLocation"),
        content.text_field("location"),
    ]);
    let created_at = payload.received_at.clone();
    let id = format!(
        "instance.closed:{}:{}",
        if location.is_empty() {
            "unknown"
        } else {
            &location
        },
        created_at
    );
    let notification = json!({
        "id": id,
        "type": "instance.closed",
        "location": location,
        "message": "Instance Closed",
        "createdAt": created_at,
        "created_at": created_at,
    });
    Some(RealtimeInstanceClosedOutput {
        projection: RealtimeInstanceClosedProjection {
            generation,
            notification: notification.clone().into(),
        },
        feed_entry: FeedLiveEntry::InstanceClosed {
            created_at: created_at.clone(),
            id,
            location: location.clone(),
            message: "Instance Closed".to_string(),
            world_name: None,
            world_id: None,
            display_location: None,
            owner_user_id: String::new(),
        },
        persistence: vrcx_0_contracts::realtime::RealtimePersistenceBatch {
            notification_v1_upserts: vec![notification],
            ..vrcx_0_contracts::realtime::RealtimePersistenceBatch::default()
        },
    })
}

pub fn normalize_v1_notification(content: &Value, now: &str) -> Value {
    let mut object = sanitize_object(content);
    object.entry("id").or_insert(Value::String(String::new()));
    object
        .entry("senderUserId")
        .or_insert(Value::String(String::new()));
    object
        .entry("senderUsername")
        .or_insert(Value::String(String::new()));
    object.entry("type").or_insert(Value::String(String::new()));
    object.entry("version").or_insert(Value::from(1));
    object
        .entry("message")
        .or_insert(Value::String(String::new()));
    object.entry("seen").or_insert(Value::Bool(false));
    object.entry("$isExpired").or_insert(Value::Bool(false));
    let created_at = first_owned([
        object.text_field("createdAt"),
        object.text_field("created_at"),
        now.to_string(),
    ]);
    object.insert("createdAt".into(), Value::String(created_at.clone()));
    object.insert("created_at".into(), Value::String(created_at));
    object.insert(
        "details".into(),
        parse_object_value(object.get("details").cloned()).unwrap_or_else(|| json!({})),
    );
    Value::Object(object)
}

pub fn normalize_v2_notification(content: &Value, endpoint: &str, now: &str) -> Value {
    let mut object = sanitize_object(content);
    for key in [
        "id",
        "createdAt",
        "updatedAt",
        "expiresAt",
        "type",
        "link",
        "linkText",
        "message",
        "title",
        "imageUrl",
        "senderUserId",
        "senderUsername",
    ] {
        object.entry(key).or_insert(Value::String(String::new()));
    }
    object.entry("seen").or_insert(Value::Bool(false));
    object.insert("version".into(), Value::from(2));
    let created_at = first_owned([
        object.text_field("createdAt"),
        object.text_field("created_at"),
        now.to_string(),
    ]);
    object.insert("createdAt".into(), Value::String(created_at.clone()));
    object.insert("created_at".into(), Value::String(created_at));
    object.insert(
        "data".into(),
        parse_object_value(object.get("data").cloned()).unwrap_or_else(|| json!({})),
    );
    object.insert(
        "responses".into(),
        parse_array_value(object.get("responses").cloned()).unwrap_or_else(|| json!([])),
    );
    object.insert(
        "details".into(),
        parse_object_value(object.get("details").cloned()).unwrap_or_else(|| json!({})),
    );
    apply_boop_legacy_handling(&mut object, endpoint);
    Value::Object(object)
}

fn normalize_v2_update_notification(id: &str, updates: &Value, endpoint: &str) -> Value {
    let mut object = sanitize_object(updates);
    object.insert("id".into(), Value::String(id.to_string()));
    object.insert("version".into(), Value::from(2));
    if object.contains_key("data") {
        object.insert(
            "data".into(),
            parse_object_value(object.get("data").cloned()).unwrap_or_else(|| json!({})),
        );
    }
    if object.contains_key("responses") {
        object.insert(
            "responses".into(),
            parse_array_value(object.get("responses").cloned()).unwrap_or_else(|| json!([])),
        );
    }
    if object.contains_key("details") {
        object.insert(
            "details".into(),
            parse_object_value(object.get("details").cloned()).unwrap_or_else(|| json!({})),
        );
    }
    apply_boop_legacy_handling(&mut object, endpoint);
    Value::Object(object)
}

fn apply_boop_legacy_handling(object: &mut Map<String, Value>, endpoint: &str) {
    if object.text_field("type") != "boop" || object.text_field("title").is_empty() {
        return;
    }
    let title = object.text_field("title");
    object.insert("message".into(), Value::String(title));
    object.insert("title".into(), Value::String(String::new()));
    let details = object.get("details").cloned().unwrap_or_else(|| json!({}));
    let emoji_id = details.text_field("emojiId");
    if emoji_id.starts_with("default_") {
        object.insert("imageUrl".into(), Value::String(emoji_id.clone()));
        let message = format!(
            "{} {}",
            object.text_field("message"),
            emoji_id.replacen("default_", "", 1)
        );
        object.insert("message".into(), Value::String(message));
    } else if !emoji_id.is_empty() {
        let domain = normalize_endpoint_domain(endpoint);
        object.insert(
            "imageUrl".into(),
            Value::String(format!(
                "{domain}/file/{}/{}",
                emoji_id,
                details.text_field("emojiVersion")
            )),
        );
    }
}

fn with_group_key(mut notification: Value) -> Value {
    let empty = json!({});
    let group_key = notification_group_key(&NotificationGroupFacts {
        kind: &notification.text_field("type"),
        sender_user_id: &notification.text_field("senderUserId"),
        data: notification.get("data").unwrap_or(&empty),
        details: notification.get("details").unwrap_or(&empty),
    });
    if let (Some(group_key), Some(object)) = (group_key, notification.as_object_mut()) {
        object.insert("groupKey".into(), Value::String(group_key));
    }
    notification
}

fn sanitize_object(content: &Value) -> Map<String, Value> {
    content
        .as_object()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|(_, value)| !value.is_null())
        .collect()
}

fn should_persist_v1(notification: &Value, current_user_id: &str) -> bool {
    let sender = notification.text_field("senderUserId");
    let notification_type = notification.text_field("type");
    sender != current_user_id
        && notification_type != "ignoredFriendRequest"
        && !notification_type.contains('.')
}

fn should_notify_menu(notification: &Value) -> bool {
    !(notification.i64_field("version").unwrap_or(0) == 2 && bool_field(notification.get("seen")))
}

fn content_id(content: &Value) -> String {
    if let Some(id) = content.as_str() {
        return id.trim().to_string();
    }
    content.text_field("id")
}

fn normalize_endpoint_domain(endpoint: &str) -> String {
    let value = endpoint.trim().trim_end_matches('/');
    if value.is_empty() {
        "https://api.vrchat.cloud/api/1".to_string()
    } else {
        value.to_string()
    }
}

fn parse_object_value(value: Option<Value>) -> Option<Value> {
    match value? {
        Value::Object(object) => Some(Value::Object(object)),
        Value::String(value) if value.trim() != "{}" => serde_json::from_str::<Value>(&value)
            .ok()
            .filter(Value::is_object),
        _ => None,
    }
}

fn parse_array_value(value: Option<Value>) -> Option<Value> {
    match value? {
        Value::Array(items) => Some(Value::Array(items)),
        Value::String(value) => serde_json::from_str::<Value>(&value)
            .ok()
            .filter(Value::is_array),
        _ => None,
    }
}

fn bool_field(value: Option<&Value>) -> bool {
    value.and_then(Value::as_bool).unwrap_or(false)
}

#[cfg(test)]
mod tests;
