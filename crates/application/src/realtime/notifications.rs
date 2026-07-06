use serde_json::{json, Map, Value};
use vrcx_0_core::friends::first_non_empty;
use vrcx_0_core::realtime::RealtimeWsMessagePayload;
use vrcx_0_persistence::realtime::{NotificationExpiration, NotificationV2Update};

use super::{
    RealtimeInstanceClosedOutput, RealtimeInstanceClosedProjection, RealtimeNotificationOutput,
    RealtimeNotificationProjection, RealtimeNotificationUpsert,
};

pub fn apply_notification_ws_message(
    owner_user_id: &str,
    endpoint: &str,
    generation: u64,
    payload: &RealtimeWsMessagePayload,
) -> Option<RealtimeNotificationOutput> {
    let message_type = payload.json.get("type").and_then(Value::as_str)?;
    if !is_notification_event_type(message_type) {
        return None;
    }
    let content = payload.json.get("content").unwrap_or(&Value::Null);
    let now = payload.received_at.clone();
    let mut output = RealtimeNotificationOutput {
        owner_user_id: owner_user_id.trim().to_string(),
        projection: RealtimeNotificationProjection {
            generation,
            ..RealtimeNotificationProjection::default()
        },
        ..RealtimeNotificationOutput::default()
    };

    match message_type {
        "notification" => {
            let notification = normalize_v1_notification(content, &now);
            if should_persist_v1(&notification, owner_user_id) {
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
                notification,
            });
        }
        "notification-v2" => {
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
                notification,
            });
        }
        "notification-v2-update" => {
            let id = string_field(content.get("id"));
            if id.is_empty() {
                return Some(output);
            }
            let updates = content.get("updates").cloned().unwrap_or(Value::Null);
            let notification = normalize_v2_update_notification(&id, &updates, endpoint);
            output
                .persistence
                .notification_v2_updates
                .push(NotificationV2Update {
                    id: string_field(notification.get("id")),
                    updates: notification.clone(),
                    received_at: now.clone(),
                });
            if bool_field(notification.get("seen")) {
                output
                    .projection
                    .seen_ids
                    .push(string_field(notification.get("id")));
                output.projection.clear_menu_if_no_unseen = true;
            }
            output.projection.upserts.push(RealtimeNotificationUpsert {
                insert_defaults: Some(json!({
                    "createdAt": now,
                    "created_at": now,
                    "seen": false,
                })),
                notify_menu: should_notify_menu(&notification),
                deliver_runtime: false,
                run_automation: false,
                notification,
            });
        }
        "notification-v2-delete" => {
            let ids = content
                .get("ids")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|value| string_field(Some(&value)))
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
        "see-notification" => {
            let id = content_id(content);
            if !id.is_empty() {
                output.persistence.notification_seen.push(id.clone());
                output.projection.seen_ids.push(id);
                output.projection.clear_menu_if_no_unseen = true;
            }
        }
        "hide-notification" | "response-notification" => {
            let direct_id = content_id(content);
            let notification_id = string_field(content.get("notificationId"));
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

pub fn is_notification_event_type(message_type: &str) -> bool {
    matches!(
        message_type,
        "notification"
            | "notification-v2"
            | "notification-v2-delete"
            | "notification-v2-update"
            | "see-notification"
            | "hide-notification"
            | "response-notification"
    )
}

pub fn apply_instance_closed_ws_message(
    generation: u64,
    payload: &RealtimeWsMessagePayload,
) -> Option<RealtimeInstanceClosedOutput> {
    let message_type = payload.json.get("type").and_then(Value::as_str)?;
    if message_type != "instance-closed" {
        return None;
    }
    let content = payload.json.get("content").unwrap_or(&Value::Null);
    let location = first_owned([
        string_field(content.get("instanceLocation")),
        string_field(content.get("location")),
    ]);
    let created_at = payload.received_at.clone();
    let notification = json!({
        "id": format!("instance.closed:{}:{}", if location.is_empty() { "unknown" } else { &location }, created_at),
        "type": "instance.closed",
        "location": location,
        "message": "Instance Closed",
        "createdAt": created_at,
        "created_at": created_at,
    });
    Some(RealtimeInstanceClosedOutput {
        projection: RealtimeInstanceClosedProjection {
            generation,
            feed_entry: notification.clone(),
            notification: notification.clone(),
        },
        persistence: vrcx_0_persistence::realtime::RealtimePersistenceBatch {
            notification_v1_upserts: vec![notification],
            ..vrcx_0_persistence::realtime::RealtimePersistenceBatch::default()
        },
    })
}

fn normalize_v1_notification(content: &Value, now: &str) -> Value {
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
        string_field(object.get("createdAt")),
        string_field(object.get("created_at")),
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

fn normalize_v2_notification(content: &Value, endpoint: &str, now: &str) -> Value {
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
        string_field(object.get("createdAt")),
        string_field(object.get("created_at")),
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
    if string_field(object.get("type")) != "boop" || string_field(object.get("title")).is_empty() {
        return;
    }
    let title = string_field(object.get("title"));
    object.insert("message".into(), Value::String(title));
    object.insert("title".into(), Value::String(String::new()));
    let details = object.get("details").cloned().unwrap_or_else(|| json!({}));
    let emoji_id = string_field(details.get("emojiId"));
    if emoji_id.starts_with("default_") {
        object.insert("imageUrl".into(), Value::String(emoji_id.clone()));
        let message = format!(
            "{} {}",
            string_field(object.get("message")),
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
                string_field(details.get("emojiVersion"))
            )),
        );
    }
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
    let sender = string_field(notification.get("senderUserId"));
    let notification_type = string_field(notification.get("type"));
    sender != current_user_id
        && notification_type != "ignoredFriendRequest"
        && !notification_type.contains('.')
}

fn should_notify_menu(notification: &Value) -> bool {
    !(int_field(notification.get("version")).unwrap_or(0) == 2
        && bool_field(notification.get("seen")))
}

fn content_id(content: &Value) -> String {
    if let Some(id) = content.as_str() {
        return id.trim().to_string();
    }
    string_field(content.get("id"))
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

fn string_field(value: Option<&Value>) -> String {
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

fn int_field(value: Option<&Value>) -> Option<i64> {
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

fn bool_field(value: Option<&Value>) -> bool {
    value.and_then(Value::as_bool).unwrap_or(false)
}

fn first_owned(values: impl IntoIterator<Item = String>) -> String {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws(message_type: &str, content: Value) -> RealtimeWsMessagePayload {
        RealtimeWsMessagePayload {
            json: json!({
                "type": message_type,
                "content": content
            }),
            raw: "{}".into(),
            received_at: "2026-06-08T10:00:00Z".into(),
        }
    }

    #[test]
    fn notification_v1_routes_projection_and_persistence_filters() {
        let output = apply_notification_ws_message(
            " usr_self ",
            "https://api.example.test/api/1",
            7,
            &ws(
                "notification",
                json!({
                    "id": "notif_1",
                    "senderUserId": "usr_friend",
                    "senderUsername": "Friend",
                    "type": "invite",
                    "message": "Join me"
                }),
            ),
        )
        .expect("v1 notification output");

        assert_eq!(output.owner_user_id, "usr_self");
        assert_eq!(output.projection.generation, 7);
        assert_eq!(output.persistence.notification_v1_upserts.len(), 1);
        assert_eq!(output.projection.upserts.len(), 1);
        let upsert = &output.projection.upserts[0];
        assert!(upsert.notify_menu);
        assert!(upsert.deliver_runtime);
        assert!(upsert.run_automation);
        assert_eq!(upsert.notification["version"], json!(1));
        assert_eq!(
            upsert.notification["createdAt"],
            json!("2026-06-08T10:00:00Z")
        );
        assert_eq!(upsert.notification["seen"], json!(false));

        let self_sent = apply_notification_ws_message(
            "usr_self",
            "https://api.example.test/api/1",
            7,
            &ws(
                "notification",
                json!({
                    "id": "notif_self",
                    "senderUserId": "usr_self",
                    "type": "invite"
                }),
            ),
        )
        .expect("self-sent notification still projects");
        assert!(self_sent.persistence.notification_v1_upserts.is_empty());
        assert_eq!(self_sent.projection.upserts.len(), 1);

        let dotted_type = apply_notification_ws_message(
            "usr_self",
            "https://api.example.test/api/1",
            7,
            &ws(
                "notification",
                json!({
                    "id": "notif_dotted",
                    "senderUserId": "usr_friend",
                    "type": "group.announcement"
                }),
            ),
        )
        .expect("dotted v1 notification still projects");
        assert!(dotted_type.persistence.notification_v1_upserts.is_empty());
    }

    #[test]
    fn notification_v2_routes_seen_and_boop_legacy_fields() {
        let output = apply_notification_ws_message(
            "usr_self",
            "https://api.example.test/api/1/",
            7,
            &ws(
                "notification-v2",
                json!({
                    "id": "notif_v2",
                    "type": "boop",
                    "title": "Boop",
                    "seen": true,
                    "details": { "emojiId": "default_smile" }
                }),
            ),
        )
        .expect("v2 notification output");

        assert_eq!(output.persistence.notification_v2_upserts.len(), 1);
        let notification = &output.projection.upserts[0].notification;
        assert_eq!(notification["version"], json!(2));
        assert_eq!(notification["title"], json!(""));
        assert_eq!(notification["message"], json!("Boop smile"));
        assert_eq!(notification["imageUrl"], json!("default_smile"));
        assert_eq!(notification["createdAt"], json!("2026-06-08T10:00:00Z"));
        assert!(!output.projection.upserts[0].notify_menu);
        assert!(output.projection.upserts[0].deliver_runtime);
        assert!(output.projection.upserts[0].run_automation);
    }

    #[test]
    fn notification_v2_update_routes_update_and_seen_projection() {
        let output = apply_notification_ws_message(
            "usr_self",
            "https://api.example.test/api/1",
            7,
            &ws(
                "notification-v2-update",
                json!({
                    "id": "notif_v2",
                    "updates": {
                        "seen": true,
                        "data": "{\"slot\":1}",
                        "responses": "[{\"text\":\"OK\"}]",
                        "details": "{\"emojiId\":\"emoji_custom\",\"emojiVersion\":3}",
                        "type": "invite"
                    }
                }),
            ),
        )
        .expect("v2 update output");

        assert_eq!(output.persistence.notification_v2_updates.len(), 1);
        let update = &output.persistence.notification_v2_updates[0];
        assert_eq!(update.id, "notif_v2");
        assert_eq!(update.received_at, "2026-06-08T10:00:00Z");
        assert_eq!(update.updates["data"]["slot"], json!(1));
        assert_eq!(update.updates["responses"][0]["text"], json!("OK"));
        assert_eq!(update.updates["details"]["emojiId"], json!("emoji_custom"));
        assert_eq!(output.projection.seen_ids, vec!["notif_v2"]);
        assert!(output.projection.clear_menu_if_no_unseen);
        let upsert = &output.projection.upserts[0];
        assert_eq!(
            upsert.insert_defaults.as_ref().unwrap()["seen"],
            json!(false)
        );
        assert!(!upsert.deliver_runtime);
        assert!(!upsert.run_automation);
    }

    #[test]
    fn notification_terminal_routes_seen_and_expire_ids() {
        let delete = apply_notification_ws_message(
            "usr_self",
            "https://api.example.test/api/1",
            7,
            &ws("notification-v2-delete", json!({ "ids": ["a", "", "b"] })),
        )
        .expect("delete output");
        assert_eq!(delete.projection.expired_ids, vec!["a", "b"]);
        assert_eq!(delete.projection.seen_ids, vec!["a", "b"]);
        assert_eq!(delete.persistence.notification_expirations.len(), 2);
        assert!(delete.projection.clear_menu_if_no_unseen);

        let seen = apply_notification_ws_message(
            "usr_self",
            "https://api.example.test/api/1",
            7,
            &ws("see-notification", json!("seen_id")),
        )
        .expect("see output");
        assert_eq!(seen.persistence.notification_seen, vec!["seen_id"]);
        assert_eq!(seen.projection.seen_ids, vec!["seen_id"]);

        let hidden = apply_notification_ws_message(
            "usr_self",
            "https://api.example.test/api/1",
            7,
            &ws(
                "hide-notification",
                json!({ "notificationId": "hidden_id" }),
            ),
        )
        .expect("hide output");
        assert_eq!(hidden.projection.expired_ids, vec!["hidden_id"]);
        assert_eq!(
            hidden.persistence.notification_expirations[0].expired_at,
            "2026-06-08T10:00:00Z"
        );

        let response = apply_notification_ws_message(
            "usr_self",
            "https://api.example.test/api/1",
            7,
            &ws("response-notification", json!({ "id": "response_id" })),
        )
        .expect("response output");
        assert_eq!(response.projection.expired_ids, vec!["response_id"]);
        assert_eq!(response.projection.seen_ids, vec!["response_id"]);
    }

    #[test]
    fn instance_closed_routes_to_v1_notification_batch() {
        let output = apply_instance_closed_ws_message(
            7,
            &ws(
                "instance-closed",
                json!({ "instanceLocation": "wrld_1:123" }),
            ),
        )
        .expect("instance closed output");

        assert_eq!(output.projection.generation, 7);
        assert_eq!(
            output.projection.notification["type"],
            json!("instance.closed")
        );
        assert_eq!(
            output.projection.feed_entry["location"],
            json!("wrld_1:123")
        );
        assert_eq!(output.persistence.notification_v1_upserts.len(), 1);
        assert!(apply_instance_closed_ws_message(7, &ws("notification", json!({}))).is_none());
    }
}
