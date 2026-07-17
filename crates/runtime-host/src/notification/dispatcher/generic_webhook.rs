use serde_json::{json, Value};
use vrcx_0_application::OverlayActivityDelivery;

use super::RenderedNotification;

const DEFAULT_WEBHOOK_FIELDS: &[&str] = &[
    "version",
    "event",
    "category",
    "title",
    "message",
    "user",
    "location",
    "locationId",
    "worldId",
    "worldName",
    "timestamp",
    "localTime",
];

pub(super) fn default_webhook_fields() -> Vec<String> {
    DEFAULT_WEBHOOK_FIELDS
        .iter()
        .map(|field| (*field).to_string())
        .collect()
}

pub(super) fn generic_webhook_payload(
    delivery: &OverlayActivityDelivery,
    render: &RenderedNotification,
    fields: &[String],
) -> Value {
    let entry = &delivery.entry;
    let payload = json!({
        "version": 1,
        "event": &entry.activity_type,
        "category": entry.category,
        "title": &render.title,
        "message": &render.text,
        "user": {
            "id": &entry.actor_user_id,
            "displayName": &entry.actor_display_name,
        },
        "location": &render.display_location,
        "locationId": &entry.content.location,
        "worldId": &entry.content.world_id,
        "worldName": &entry.content.world_name,
        "timestamp": &entry.created_at,
        "localTime": webhook_local_time_string(&entry.created_at),
    });
    filter_generic_webhook_payload(payload, fields)
}

pub fn filter_generic_webhook_payload(payload: Value, fields: &[String]) -> Value {
    let Some(object) = payload.as_object() else {
        return payload;
    };

    let mut filtered = serde_json::Map::new();
    if fields.is_empty() {
        for field in DEFAULT_WEBHOOK_FIELDS {
            insert_generic_webhook_field(&mut filtered, object, field);
        }
    } else {
        for field in fields {
            let field = field.as_str();
            if is_default_webhook_field(field) {
                insert_generic_webhook_field(&mut filtered, object, field);
            }
        }
    }
    Value::Object(filtered)
}

fn insert_generic_webhook_field(
    target: &mut serde_json::Map<String, Value>,
    source: &serde_json::Map<String, Value>,
    field: &str,
) {
    if let Some(value) = source.get(field) {
        target.insert(field.to_string(), value.clone());
    }
}

pub(super) fn is_default_webhook_field(field: &str) -> bool {
    DEFAULT_WEBHOOK_FIELDS.contains(&field)
}

pub fn webhook_local_time_string(created_at: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(created_at)
        .map(|value| {
            value
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_default()
}
