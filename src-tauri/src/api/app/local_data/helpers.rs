use std::collections::HashMap;

use chrono::{SecondsFormat, Utc};
use serde_json::Value;
use vrcx_0_store::common::DbParams;

use crate::error::AppError;

use super::types::*;

pub(super) fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub(super) fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

pub(super) fn normalize_config_key(key: &str) -> String {
    let key = key.trim();
    if key.starts_with("config:") {
        return key.to_string();
    }
    let stripped = key.strip_prefix("VRCX_").unwrap_or(key);
    format!("config:vrcx_{}", stripped.to_ascii_lowercase())
}

pub(super) fn normalize_kind(
    kind: &str,
) -> Result<(&'static str, &'static str, &'static str), AppError> {
    match kind.trim() {
        "friend" => Ok(("favorite_friend", "user_id", "@user_id")),
        "avatar" => Ok(("favorite_avatar", "avatar_id", "@avatar_id")),
        "world" => Ok(("favorite_world", "world_id", "@world_id")),
        _ => Err(AppError::Custom("unsupported favorite kind".into())),
    }
}

pub(super) fn value_as_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.to_string(),
        other => other.to_string(),
    }
}

pub(super) fn value_as_i64(value: &Value) -> i64 {
    if let Some(value) = value.as_i64() {
        return value;
    }
    value_as_string(value).parse::<i64>().unwrap_or(0)
}

pub(super) fn row_value(row: &[Value], index: usize) -> &Value {
    row.get(index).unwrap_or(&Value::Null)
}

pub(super) fn row_string(row: &[Value], index: usize) -> String {
    value_as_string(row_value(row, index))
}

pub(super) fn row_i64(row: &[Value], index: usize) -> i64 {
    value_as_i64(row_value(row, index))
}

pub(super) fn parse_json_value(value: &Value, fallback: Value) -> Value {
    let text = value_as_string(value);
    if text.trim().is_empty() {
        return fallback;
    }
    serde_json::from_str(&text).unwrap_or(fallback)
}

pub(super) fn cache_entity_from_row(row: &[Value]) -> AvatarCacheOutput {
    AvatarCacheOutput {
        id: row_string(row, 0),
        author_id: row_string(row, 1),
        author_name: row_string(row, 2),
        created_at: row_string(row, 3),
        description: row_string(row, 4),
        image_url: row_string(row, 5),
        name: row_string(row, 6),
        release_status: row_string(row, 7),
        thumbnail_image_url: row_string(row, 8),
        updated_at: row_string(row, 9),
        version: row_i64(row, 10),
    }
}

pub(super) fn world_summary_from_row(row: &[Value]) -> WorldSummaryOutput {
    WorldSummaryOutput {
        id: row_string(row, 0),
        author_id: row_string(row, 1),
        author_name: row_string(row, 2),
        created_at: row_string(row, 3),
        description: row_string(row, 4),
        image_url: row_string(row, 5),
        name: row_string(row, 6),
        release_status: row_string(row, 7),
        thumbnail_image_url: row_string(row, 8),
        updated_at: row_string(row, 9),
        version: row_i64(row, 10),
    }
}

pub(super) fn player_location_from_row(row: &[Value]) -> PlayerLocationOutput {
    PlayerLocationOutput {
        created_at: row_string(row, 0),
        location: row_string(row, 1),
        world_id: row_string(row, 2),
        world_name: row_string(row, 3),
        time: row_i64(row, 4),
        group_name: row_string(row, 5),
    }
}

pub(super) fn player_join_leave_from_row(row: &[Value]) -> PlayerJoinLeaveOutput {
    PlayerJoinLeaveOutput {
        id: row_i64(row, 0),
        created_at: row_string(row, 1),
        r#type: row_string(row, 2),
        display_name: row_string(row, 3),
        user_id: row_string(row, 4),
        time: row_i64(row, 5),
    }
}

pub(super) fn instance_activity_from_row(row: &[Value]) -> InstanceActivityRowOutput {
    InstanceActivityRowOutput {
        id: row_i64(row, 0),
        created_at: row_string(row, 1),
        r#type: row_string(row, 2),
        display_name: row_string(row, 3),
        location: row_string(row, 4),
        user_id: row_string(row, 5),
        time: row_i64(row, 6),
    }
}

pub(super) fn activity_location_from_row(row: &[Value]) -> ActivitySourceLocationOutput {
    ActivitySourceLocationOutput {
        created_at: row_string(row, 0),
        time: row_i64(row, 1),
    }
}

pub(super) fn activity_presence_from_row(row: &[Value]) -> ActivityPresenceOutput {
    ActivityPresenceOutput {
        created_at: row_string(row, 0),
        r#type: row_string(row, 1),
    }
}

pub(super) fn activity_session_from_row(row: &[Value]) -> ActivitySessionOutput {
    ActivitySessionOutput {
        start: row_i64(row, 0),
        end: row_i64(row, 1),
        is_open_tail: row_i64(row, 2) != 0,
        source_revision: row_string(row, 3),
    }
}

pub(super) fn is_traveling_location(location: &str) -> bool {
    matches!(location.trim(), "traveling" | "traveling:traveling")
}

pub(super) fn notification_v1_from_row(row: &[Value]) -> NotificationV1RowOutput {
    NotificationV1RowOutput {
        id: row_string(row, 0),
        created_at: row_string(row, 1),
        r#type: row_string(row, 2),
        sender_user_id: row_string(row, 3),
        sender_username: row_string(row, 4),
        receiver_user_id: row_string(row, 5),
        message: row_string(row, 6),
        world_id: row_string(row, 7),
        world_name: row_string(row, 8),
        image_url: row_string(row, 9),
        invite_message: row_string(row, 10),
        request_message: row_string(row, 11),
        response_message: row_string(row, 12),
        expired: row_i64(row, 13),
    }
}

pub(super) fn notification_v2_from_row(row: &[Value]) -> NotificationV2RowOutput {
    NotificationV2RowOutput {
        id: row_string(row, 0),
        created_at: row_string(row, 1),
        updated_at: row_string(row, 2),
        expires_at: row_string(row, 3),
        r#type: row_string(row, 4),
        link: row_string(row, 5),
        link_text: row_string(row, 6),
        message: row_string(row, 7),
        title: row_string(row, 8),
        image_url: row_string(row, 9),
        seen: row_i64(row, 10),
        sender_user_id: row_string(row, 11),
        sender_username: row_string(row, 12),
        data: row_string(row, 13),
        responses: row_string(row, 14),
        details: row_string(row, 15),
    }
}

pub(super) fn build_type_filter(filters: &[String]) -> (String, DbParams) {
    let mut params = HashMap::new();
    let filters = filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if filters.is_empty() {
        return (String::new(), params);
    }

    let mut placeholders = Vec::with_capacity(filters.len());
    for (index, filter) in filters.into_iter().enumerate() {
        let key = format!("@type_{index}");
        params.insert(key.clone(), Value::String(filter));
        placeholders.push(key);
    }
    (
        format!(" WHERE type IN ({})", placeholders.join(", ")),
        params,
    )
}

pub(super) fn row_json(row: &[Value], index: usize) -> Value {
    row.get(index).cloned().unwrap_or(Value::Null)
}

pub(super) fn add_list_params(
    params: &mut DbParams,
    values: &[String],
    prefix: &str,
) -> Vec<String> {
    values
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .enumerate()
        .map(|(index, value)| {
            let key = format!("@{prefix}_{index}");
            params.insert(key.clone(), Value::String(value));
            key
        })
        .collect()
}
