#![allow(non_snake_case)]

use std::collections::HashMap;

use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use tauri::State;
use vrcx_0_persistence::common::{DbParams, ParamsBuilder};
use vrcx_0_persistence::database::{DatabaseService, DatabaseWriteTransaction};
use vrcx_0_persistence::game_log::{
    ensure_game_log_tables, write_batch as write_game_log_batch, GameLogEventEntry,
    GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogLocationTimeUpdate,
    GameLogPortalSpawnEntry, GameLogResourceLoadEntry, GameLogVideoPlayEntry, GameLogWriteBatch,
};
use vrcx_0_persistence::realtime::{
    ensure_realtime_tables, normalize_user_table_prefix, write_realtime_batch,
    RealtimePersistenceBatch,
};

use crate::error::AppError;
use crate::state::AppState;

use super::local_data_types::*;

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

fn normalize_config_key(key: &str) -> String {
    let key = key.trim();
    if key.starts_with("config:") {
        return key.to_string();
    }
    let stripped = key.strip_prefix("VRCX_").unwrap_or(key);
    format!("config:vrcx_{}", stripped.to_ascii_lowercase())
}

fn normalize_kind(kind: &str) -> Result<(&'static str, &'static str, &'static str), AppError> {
    match kind.trim() {
        "friend" => Ok(("favorite_friend", "user_id", "@user_id")),
        "avatar" => Ok(("favorite_avatar", "avatar_id", "@avatar_id")),
        "world" => Ok(("favorite_world", "world_id", "@world_id")),
        _ => Err(AppError::Custom("unsupported favorite kind".into())),
    }
}

fn value_as_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.to_string(),
        other => other.to_string(),
    }
}

fn value_as_i64(value: &Value) -> i64 {
    if let Some(value) = value.as_i64() {
        return value;
    }
    value_as_string(value).parse::<i64>().unwrap_or(0)
}

fn row_value(row: &[Value], index: usize) -> &Value {
    row.get(index).unwrap_or(&Value::Null)
}

fn row_string(row: &[Value], index: usize) -> String {
    value_as_string(row_value(row, index))
}

fn row_i64(row: &[Value], index: usize) -> i64 {
    value_as_i64(row_value(row, index))
}

fn parse_json_value(value: &Value, fallback: Value) -> Value {
    let text = value_as_string(value);
    if text.trim().is_empty() {
        return fallback;
    }
    serde_json::from_str(&text).unwrap_or(fallback)
}

fn cache_entity_from_row(row: &[Value]) -> AvatarCacheOutput {
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

fn world_summary_from_row(row: &[Value]) -> WorldSummaryOutput {
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

fn player_location_from_row(row: &[Value]) -> PlayerLocationOutput {
    PlayerLocationOutput {
        created_at: row_string(row, 0),
        location: row_string(row, 1),
        world_id: row_string(row, 2),
        world_name: row_string(row, 3),
        time: row_i64(row, 4),
        group_name: row_string(row, 5),
    }
}

fn player_join_leave_from_row(row: &[Value]) -> PlayerJoinLeaveOutput {
    PlayerJoinLeaveOutput {
        id: row_i64(row, 0),
        created_at: row_string(row, 1),
        r#type: row_string(row, 2),
        display_name: row_string(row, 3),
        user_id: row_string(row, 4),
        time: row_i64(row, 5),
    }
}

fn instance_activity_from_row(row: &[Value]) -> InstanceActivityRowOutput {
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

fn activity_location_from_row(row: &[Value]) -> ActivitySourceLocationOutput {
    ActivitySourceLocationOutput {
        created_at: row_string(row, 0),
        time: row_i64(row, 1),
    }
}

fn activity_presence_from_row(row: &[Value]) -> ActivityPresenceOutput {
    ActivityPresenceOutput {
        created_at: row_string(row, 0),
        r#type: row_string(row, 1),
    }
}

fn activity_session_from_row(row: &[Value]) -> ActivitySessionOutput {
    ActivitySessionOutput {
        start: row_i64(row, 0),
        end: row_i64(row, 1),
        is_open_tail: row_i64(row, 2) != 0,
        source_revision: row_string(row, 3),
    }
}

fn is_traveling_location(location: &str) -> bool {
    matches!(location.trim(), "traveling" | "traveling:traveling")
}

fn notification_v1_from_row(row: &[Value]) -> NotificationV1RowOutput {
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

fn notification_v2_from_row(row: &[Value]) -> NotificationV2RowOutput {
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

fn build_type_filter(filters: &[String]) -> (String, DbParams) {
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

fn row_json(row: &[Value], index: usize) -> Value {
    row.get(index).cloned().unwrap_or(Value::Null)
}

fn count_table(db: &DatabaseService, table_name: &str) -> Result<i64, AppError> {
    let table_name = safe_identifier(table_name, "Table name")?;
    Ok(db
        .execute(
            &format!("SELECT COUNT(*) FROM {table_name}"),
            &Default::default(),
        )?
        .first()
        .map(|row| row_i64(row, 0))
        .unwrap_or(0))
}

fn max_friend_log_number(db: &DatabaseService, user_prefix: &str) -> Result<i64, AppError> {
    Ok(db
        .execute(
            &format!("SELECT MAX(friend_number) FROM {user_prefix}_friend_log_current"),
            &Default::default(),
        )?
        .first()
        .map(|row| row_i64(row, 0))
        .unwrap_or(0))
}

fn add_list_params(params: &mut DbParams, values: &[String], prefix: &str) -> Vec<String> {
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

fn feed_row_from_unified_row(row: &[Value]) -> FeedRowOutput {
    FeedRowOutput {
        row_id: row_json(row, 0),
        created_at: row_json(row, 1),
        user_id: row_json(row, 2),
        display_name: row_json(row, 3),
        r#type: row_json(row, 4),
        location: row_json(row, 5),
        world_name: row_json(row, 6),
        previous_location: row_json(row, 7),
        time: row_json(row, 8),
        group_name: row_json(row, 9),
        status: row_json(row, 10),
        status_description: row_json(row, 11),
        previous_status: row_json(row, 12),
        previous_status_description: row_json(row, 13),
        bio: row_json(row, 14),
        previous_bio: row_json(row, 15),
        owner_id: row_json(row, 16),
        avatar_name: row_json(row, 17),
        current_avatar_image_url: row_json(row, 18),
        current_avatar_thumbnail_image_url: row_json(row, 19),
        previous_current_avatar_image_url: row_json(row, 20),
        previous_current_avatar_thumbnail_image_url: row_json(row, 21),
    }
}

#[derive(Default)]
struct FeedFilterFlags {
    gps: bool,
    status: bool,
    bio: bool,
    avatar: bool,
    online: bool,
    offline: bool,
}

fn feed_filter_flags(filters: &[String], include_profile: bool) -> FeedFilterFlags {
    let mut flags = FeedFilterFlags {
        gps: true,
        status: include_profile,
        bio: include_profile,
        avatar: include_profile,
        online: true,
        offline: true,
    };
    let filters = filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if filters.is_empty() {
        return flags;
    }

    flags = FeedFilterFlags::default();
    for filter in filters {
        match filter.as_str() {
            "GPS" => flags.gps = true,
            "Status" if include_profile => flags.status = true,
            "Bio" if include_profile => flags.bio = true,
            "Avatar" if include_profile => flags.avatar = true,
            "Online" => flags.online = true,
            "Offline" => flags.offline = true,
            _ => {}
        }
    }
    flags
}

fn push_feed_online_offline_select(
    selects: &mut Vec<String>,
    user_prefix: &str,
    where_sql: &str,
    type_filter: &str,
    vip_query: &str,
) {
    selects.push(format!(
        "SELECT * FROM (SELECT id, created_at, user_id, display_name, type, location, world_name, NULL AS previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_online_offline WHERE {where_sql} {type_filter} {vip_query} ORDER BY id DESC LIMIT @per_table)"
    ));
}

fn feed_base_columns() -> &'static str {
    "id, created_at, user_id, display_name, type, location, world_name, previous_location, time, group_name, status, status_description, previous_status, previous_status_description, bio, previous_bio, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url"
}

fn game_log_row_from_unified_row(row: &[Value]) -> Value {
    let event_type = row_string(row, 2);
    let mut object = serde_json::Map::new();
    object.insert("rowId".into(), row_json(row, 0));
    object.insert("created_at".into(), row_json(row, 1));
    object.insert("type".into(), Value::String(event_type.clone()));
    match event_type.as_str() {
        "Location" => {
            object.insert("location".into(), row_json(row, 4));
            object.insert("worldId".into(), row_json(row, 7));
            object.insert("worldName".into(), row_json(row, 8));
            object.insert("time".into(), row_json(row, 6));
            object.insert("groupName".into(), row_json(row, 9));
        }
        "OnPlayerJoined" | "OnPlayerLeft" => {
            object.insert("displayName".into(), row_json(row, 3));
            object.insert("location".into(), row_json(row, 4));
            object.insert("userId".into(), row_json(row, 5));
            object.insert("time".into(), row_json(row, 6));
        }
        "PortalSpawn" => {
            object.insert("displayName".into(), row_json(row, 3));
            object.insert("location".into(), row_json(row, 4));
            object.insert("userId".into(), row_json(row, 5));
            object.insert("instanceId".into(), row_json(row, 10));
            object.insert("worldName".into(), row_json(row, 8));
        }
        "VideoPlay" => {
            object.insert("videoUrl".into(), row_json(row, 11));
            object.insert("videoName".into(), row_json(row, 12));
            object.insert("videoId".into(), row_json(row, 13));
            object.insert("location".into(), row_json(row, 4));
            object.insert("displayName".into(), row_json(row, 3));
            object.insert("userId".into(), row_json(row, 5));
        }
        "Event" => {
            object.insert("data".into(), row_json(row, 16));
        }
        "External" => {
            object.insert("message".into(), row_json(row, 17));
            object.insert("displayName".into(), row_json(row, 3));
            object.insert("userId".into(), row_json(row, 5));
            object.insert("location".into(), row_json(row, 4));
        }
        "StringLoad" | "ImageLoad" => {
            object.insert("resourceUrl".into(), row_json(row, 14));
            object.insert("location".into(), row_json(row, 4));
        }
        _ => {}
    }
    Value::Object(object)
}

fn game_log_location_segment_from_row(row: &[Value]) -> Value {
    json!({
        "id": row_json(row, 0),
        "created_at": row_json(row, 1),
        "location": row_json(row, 2),
        "worldId": row_json(row, 3),
        "worldName": row_json(row, 4),
        "time": row_json(row, 5),
        "groupName": row_json(row, 6)
    })
}

fn game_log_base_columns(include_extra: bool) -> &'static str {
    if include_extra {
        "id, created_at, type, display_name, location, user_id, time, world_id, world_name, group_name, instance_id, video_url, video_name, video_id, resource_url, resource_type, data, message"
    } else {
        "id, created_at, type, display_name, location, user_id, time, world_id, world_name, group_name, instance_id, video_url, video_name, video_id, resource_url, resource_type"
    }
}

#[derive(Default)]
struct GameLogFilterFlags {
    location: bool,
    onplayerjoined: bool,
    onplayerleft: bool,
    portalspawn: bool,
    event: bool,
    external: bool,
    videoplay: bool,
    stringload: bool,
    imageload: bool,
}

fn game_log_filter_flags(filters: &[String], include_extra: bool) -> GameLogFilterFlags {
    let mut flags = GameLogFilterFlags {
        location: true,
        onplayerjoined: true,
        onplayerleft: true,
        portalspawn: true,
        event: include_extra,
        external: include_extra,
        videoplay: true,
        stringload: true,
        imageload: true,
    };
    let filters = filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if filters.is_empty() {
        return flags;
    }
    flags = GameLogFilterFlags::default();
    for filter in filters {
        match filter.as_str() {
            "Location" => flags.location = true,
            "OnPlayerJoined" => flags.onplayerjoined = true,
            "OnPlayerLeft" => flags.onplayerleft = true,
            "PortalSpawn" => flags.portalspawn = true,
            "Event" if include_extra => flags.event = true,
            "External" if include_extra => flags.external = true,
            "VideoPlay" => flags.videoplay = true,
            "StringLoad" => flags.stringload = true,
            "ImageLoad" => flags.imageload = true,
            _ => {}
        }
    }
    flags
}

fn query_param_string(params: &Value, key: &str) -> String {
    params
        .get(key)
        .map(value_as_string)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn query_param_i64(params: &Value, key: &str, fallback: i64) -> i64 {
    params.get(key).map(value_as_i64).unwrap_or(fallback)
}

fn query_param_bool(params: &Value, key: &str) -> bool {
    params.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn query_param_string_array(params: &Value, key: &str) -> Vec<String> {
    params
        .get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .map(value_as_string)
                .filter(|value| !value.trim().is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn object_field<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.as_object().and_then(|object| object.get(key))
}

fn object_field_string(value: &Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(field) = object_field(value, key) {
            return value_as_string(field);
        }
    }
    String::new()
}

fn object_field_optional_string(value: &Value, keys: &[&str]) -> Value {
    for key in keys {
        if let Some(field) = object_field(value, key) {
            return match field {
                Value::Null => Value::Null,
                Value::String(value) => Value::String(value.clone()),
                other => Value::String(other.to_string()),
            };
        }
    }
    Value::Null
}

fn object_field_bool(value: &Value, key: &str) -> bool {
    object_field(value, key)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn is_json_value_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|number| number != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

fn object_field_json(value: &Value, key: &str, fallback: Value) -> String {
    object_field(value, key)
        .filter(|value| is_json_value_truthy(value))
        .cloned()
        .unwrap_or(fallback)
        .to_string()
}

fn game_log_batch_for_kind(kind: &str, entries: Vec<Value>) -> GameLogWriteBatch {
    let mut batch = GameLogWriteBatch::default();
    match kind {
        "Location" => {
            batch.locations = entries
                .into_iter()
                .map(|entry| GameLogLocationEntry {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    location: object_field_string(&entry, &["location"]),
                    world_id: object_field_string(&entry, &["worldId", "world_id"]),
                    world_name: object_field_string(&entry, &["worldName", "world_name"]),
                    time: value_as_i64(object_field(&entry, "time").unwrap_or(&Value::Null)),
                    group_name: object_field_string(&entry, &["groupName", "group_name"]),
                })
                .collect();
        }
        "LocationTime" => {
            batch.location_time_updates = entries
                .into_iter()
                .map(|entry| GameLogLocationTimeUpdate {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    time: value_as_i64(object_field(&entry, "time").unwrap_or(&Value::Null)),
                })
                .collect();
        }
        "JoinLeave" => {
            batch.join_leave = entries
                .into_iter()
                .map(|entry| GameLogJoinLeaveEntry {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    event_type: object_field_string(&entry, &["type", "eventType"]),
                    display_name: object_field_string(&entry, &["displayName", "display_name"]),
                    location: object_field_string(&entry, &["location"]),
                    user_id: object_field_string(&entry, &["userId", "user_id"]),
                    time: value_as_i64(object_field(&entry, "time").unwrap_or(&Value::Null)),
                })
                .collect();
        }
        "PortalSpawn" => {
            batch.portal_spawns = entries
                .into_iter()
                .map(|entry| GameLogPortalSpawnEntry {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    display_name: object_field_string(&entry, &["displayName", "display_name"]),
                    location: object_field_string(&entry, &["location"]),
                    user_id: object_field_string(&entry, &["userId", "user_id"]),
                    instance_id: object_field_string(&entry, &["instanceId", "instance_id"]),
                    world_name: object_field_string(&entry, &["worldName", "world_name"]),
                })
                .collect();
        }
        "VideoPlay" => {
            batch.video_plays = entries
                .into_iter()
                .map(|entry| GameLogVideoPlayEntry {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    video_url: object_field_string(&entry, &["videoUrl", "video_url"]),
                    video_name: object_field_string(&entry, &["videoName", "video_name"]),
                    video_id: object_field_string(&entry, &["videoId", "video_id"]),
                    location: object_field_string(&entry, &["location"]),
                    display_name: object_field_string(&entry, &["displayName", "display_name"]),
                    user_id: object_field_string(&entry, &["userId", "user_id"]),
                })
                .collect();
        }
        "ResourceLoad" | "StringLoad" | "ImageLoad" => {
            batch.resource_loads = entries
                .into_iter()
                .map(|entry| GameLogResourceLoadEntry {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    resource_url: object_field_string(&entry, &["resourceUrl", "resource_url"]),
                    resource_type: object_field_string(
                        &entry,
                        &["type", "resourceType", "resource_type"],
                    ),
                    location: object_field_string(&entry, &["location"]),
                })
                .collect();
        }
        "Event" => {
            batch.events = entries
                .into_iter()
                .map(|entry| GameLogEventEntry {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    data: object_field_string(&entry, &["data"]),
                })
                .collect();
        }
        "External" => {
            batch.externals = entries
                .into_iter()
                .map(|entry| GameLogExternalEntry {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    message: object_field_string(&entry, &["message"]),
                    display_name: object_field_string(&entry, &["displayName", "display_name"]),
                    user_id: object_field_string(&entry, &["userId", "user_id"]),
                    location: object_field_string(&entry, &["location"]),
                })
                .collect();
        }
        _ => {}
    }
    batch
}

fn ensure_config_table(db: &DatabaseService) -> Result<(), AppError> {
    db.execute_non_query(
        "CREATE TABLE IF NOT EXISTS configs (`key` TEXT PRIMARY KEY, `value` TEXT)",
        &Default::default(),
    )?;
    Ok(())
}

fn ensure_global_local_data_tables(db: &DatabaseService) -> Result<(), AppError> {
    for sql in [
        "CREATE TABLE IF NOT EXISTS cache_avatar (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER)",
        "CREATE TABLE IF NOT EXISTS cache_world (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER)",
        "CREATE TABLE IF NOT EXISTS favorite_world (id INTEGER PRIMARY KEY, created_at TEXT, world_id TEXT, group_name TEXT)",
        "CREATE TABLE IF NOT EXISTS favorite_avatar (id INTEGER PRIMARY KEY, created_at TEXT, avatar_id TEXT, group_name TEXT)",
        "CREATE TABLE IF NOT EXISTS favorite_friend (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, group_name TEXT)",
        "CREATE TABLE IF NOT EXISTS memos (user_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)",
        "CREATE TABLE IF NOT EXISTS world_memos (world_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)",
        "CREATE TABLE IF NOT EXISTS avatar_memos (avatar_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)",
        "CREATE TABLE IF NOT EXISTS avatar_tags (avatar_id TEXT NOT NULL, tag TEXT NOT NULL, color TEXT, PRIMARY KEY (avatar_id, tag))",
    ] {
        db.execute_non_query(sql, &Default::default())?;
    }
    Ok(())
}

fn ensure_moderation_table(db: &DatabaseService, user_prefix: &str) -> Result<(), AppError> {
    ensure_user_local_tables(db, user_prefix)?;
    db.execute_non_query(
        &format!("CREATE TABLE IF NOT EXISTS {user_prefix}_moderation (user_id TEXT PRIMARY KEY, updated_at TEXT, display_name TEXT, block INTEGER, mute INTEGER)"),
        &Default::default(),
    )?;
    Ok(())
}

fn ensure_avatar_history_table(db: &DatabaseService, user_prefix: &str) -> Result<(), AppError> {
    db.execute_non_query(
        &format!(
            "CREATE TABLE IF NOT EXISTS {user_prefix}_avatar_history (
                avatar_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT '',
                time INTEGER NOT NULL DEFAULT 0
            )"
        ),
        &Default::default(),
    )?;
    Ok(())
}

fn ensure_user_local_tables(db: &DatabaseService, user_prefix: &str) -> Result<(), AppError> {
    ensure_realtime_tables(db, user_prefix)?;
    ensure_avatar_history_table(db, user_prefix)?;
    for sql in [
        format!(
            "CREATE TABLE IF NOT EXISTS {user_prefix}_activity_sync_state_v2 (
                user_id TEXT PRIMARY KEY,
                updated_at TEXT NOT NULL DEFAULT '',
                is_self INTEGER NOT NULL DEFAULT 0,
                source_last_created_at TEXT NOT NULL DEFAULT '',
                pending_session_start_at INTEGER,
                cached_range_days INTEGER NOT NULL DEFAULT 0
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS {user_prefix}_activity_sessions_v2 (
                session_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                start_at INTEGER NOT NULL,
                end_at INTEGER NOT NULL,
                is_open_tail INTEGER NOT NULL DEFAULT 0,
                source_revision TEXT NOT NULL DEFAULT ''
            )"
        ),
        format!(
            "CREATE INDEX IF NOT EXISTS {user_prefix}_activity_sessions_v2_user_start_idx ON {user_prefix}_activity_sessions_v2 (user_id, start_at)"
        ),
        format!(
            "CREATE INDEX IF NOT EXISTS {user_prefix}_activity_sessions_v2_user_end_idx ON {user_prefix}_activity_sessions_v2 (user_id, end_at)"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS {user_prefix}_activity_bucket_cache_v2 (
                user_id TEXT NOT NULL,
                target_user_id TEXT NOT NULL DEFAULT '',
                range_days INTEGER NOT NULL,
                view_kind TEXT NOT NULL,
                exclude_key TEXT NOT NULL DEFAULT '',
                bucket_version INTEGER NOT NULL DEFAULT 1,
                raw_buckets_json TEXT NOT NULL DEFAULT '[]',
                normalized_buckets_json TEXT NOT NULL DEFAULT '[]',
                built_from_cursor TEXT NOT NULL DEFAULT '',
                summary_json TEXT NOT NULL DEFAULT '{{}}',
                built_at TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (user_id, target_user_id, range_days, view_kind, exclude_key)
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS {user_prefix}_moderation (user_id TEXT PRIMARY KEY, updated_at TEXT, display_name TEXT, block INTEGER, mute INTEGER)"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS {user_prefix}_notes (user_id TEXT PRIMARY KEY, display_name TEXT, note TEXT, created_at TEXT)"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS {user_prefix}_mutual_graph_friends (friend_id TEXT PRIMARY KEY)"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS {user_prefix}_mutual_graph_links (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS {user_prefix}_mutual_graph_meta (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)"
        ),
    ] {
        db.execute_non_query(&sql, &Default::default())?;
    }
    Ok(())
}

fn normalize_avatar_tag_entry(entry: AvatarTagInput) -> Option<(String, Value)> {
    let tag = normalize_text(entry.tag);
    if tag.is_empty() {
        return None;
    }
    Some((tag, entry.color))
}

fn normalize_avatar_tag_map(
    entries: Vec<AvatarTagInput>,
) -> std::collections::BTreeMap<String, Value> {
    entries
        .into_iter()
        .filter_map(normalize_avatar_tag_entry)
        .collect()
}

fn nullish_color(value: &Value) -> Option<Value> {
    if value.is_null() {
        None
    } else {
        Some(value.clone())
    }
}

fn safe_identifier(identifier: &str, label: &str) -> Result<String, AppError> {
    if identifier.is_empty()
        || !identifier
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        || identifier
            .chars()
            .next()
            .is_some_and(|ch| ch.is_ascii_digit())
    {
        return Err(AppError::Custom(format!(
            "{label} contains invalid characters."
        )));
    }
    Ok(identifier.to_string())
}

fn select_table_names(db: &DatabaseService, where_sql: &str) -> Result<Vec<String>, AppError> {
    let rows = db.execute(
        &format!("SELECT name FROM sqlite_schema WHERE type='table' AND ({where_sql})"),
        &Default::default(),
    )?;
    Ok(rows
        .into_iter()
        .filter_map(|row| row.first().and_then(Value::as_str).map(str::to_string))
        .filter(|table| safe_identifier(table, "Table name").is_ok())
        .collect())
}

fn table_column_names(
    db: &DatabaseService,
    table_name: &str,
) -> Result<std::collections::HashSet<String>, AppError> {
    let table_name = safe_identifier(table_name, "Table name")?;
    let rows = db.execute(
        &format!("PRAGMA table_info({table_name})"),
        &Default::default(),
    )?;
    Ok(rows
        .into_iter()
        .filter_map(|row| row.get(1).and_then(Value::as_str).map(str::to_string))
        .collect())
}

fn add_column_if_missing(
    db: &DatabaseService,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> Result<bool, AppError> {
    let table_name = safe_identifier(table_name, "Table name")?;
    let column_name = safe_identifier(column_name, "Column name")?;
    if table_column_names(db, &table_name)?.contains(&column_name) {
        return Ok(false);
    }
    db.execute_non_query(
        &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}"),
        &Default::default(),
    )?;
    Ok(true)
}

fn drop_column_if_exists(
    db: &DatabaseService,
    table_name: &str,
    column_name: &str,
) -> Result<bool, AppError> {
    let table_name = safe_identifier(table_name, "Table name")?;
    let column_name = safe_identifier(column_name, "Column name")?;
    if !table_column_names(db, &table_name)?.contains(&column_name) {
        return Ok(false);
    }
    db.execute_non_query(
        &format!("ALTER TABLE {table_name} DROP COLUMN {column_name}"),
        &Default::default(),
    )?;
    Ok(true)
}

fn add_v17_global_indexes(db: &DatabaseService) -> Result<(), AppError> {
    for sql in [
        "CREATE INDEX IF NOT EXISTS idx_gamelog_location_location_id ON gamelog_location (location, id)",
        "CREATE INDEX IF NOT EXISTS idx_gamelog_jl_location_id ON gamelog_join_leave (location, id)",
        "CREATE INDEX IF NOT EXISTS idx_gamelog_portal_spawn_location_created ON gamelog_portal_spawn (location, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_gamelog_video_play_location_created ON gamelog_video_play (location, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_gamelog_resource_load_location_created ON gamelog_resource_load (location, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_gamelog_jl_left_created ON gamelog_join_leave (created_at) WHERE type = 'OnPlayerLeft'",
    ] {
        db.execute_non_query(sql, &Default::default())?;
    }
    Ok(())
}

fn add_notification_indexes(db: &DatabaseService) -> Result<(), AppError> {
    for table_name in select_table_names(db, "name GLOB '*_notifications'")? {
        let table_name = safe_identifier(&table_name, "Table name")?;
        db.execute_non_query(
            &format!("CREATE INDEX IF NOT EXISTS {table_name}_created_id_idx ON {table_name} (created_at DESC, id DESC)"),
            &Default::default(),
        )?;
    }
    for table_name in select_table_names(db, "name GLOB '*_notifications_v2'")? {
        let table_name = safe_identifier(&table_name, "Table name")?;
        db.execute_non_query(
            &format!("CREATE INDEX IF NOT EXISTS {table_name}_created_id_idx ON {table_name} (created_at DESC, id DESC)"),
            &Default::default(),
        )?;
        db.execute_non_query(
            &format!("CREATE INDEX IF NOT EXISTS {table_name}_seen_created_id_idx ON {table_name} (seen, created_at DESC, id DESC)"),
            &Default::default(),
        )?;
        db.execute_non_query(
            &format!("CREATE INDEX IF NOT EXISTS {table_name}_type_created_id_idx ON {table_name} (type, created_at DESC, id DESC)"),
            &Default::default(),
        )?;
    }
    Ok(())
}

fn add_legacy_indexes(db: &DatabaseService) -> Result<(), AppError> {
    for sql in [
        "CREATE INDEX IF NOT EXISTS gamelog_location_created_at_idx ON gamelog_location (created_at)",
        "CREATE INDEX IF NOT EXISTS idx_gamelog_location_world_created ON gamelog_location (world_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_gamelog_jl_location ON gamelog_join_leave (location)",
        "CREATE INDEX IF NOT EXISTS idx_gamelog_jl_user_created ON gamelog_join_leave (user_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_gamelog_jl_display_created ON gamelog_join_leave (display_name, created_at)",
    ] {
        db.execute_non_query(sql, &Default::default())?;
    }
    for table_name in select_table_names(db, "name LIKE '%_friend_log_history'")? {
        let table_name = safe_identifier(&table_name, "Table name")?;
        db.execute_non_query(
            &format!(
                "CREATE INDEX IF NOT EXISTS {table_name}_user_id_idx ON {table_name} (user_id)"
            ),
            &Default::default(),
        )?;
    }
    Ok(())
}

fn add_friend_log_history_entry(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &FriendLogHistoryEntryInput,
) -> Result<(), vrcx_0_persistence::Error> {
    if entry.r#type.trim().is_empty() || entry.user_id.trim().is_empty() {
        return Ok(());
    }
    tx.execute_non_query(
        &format!("INSERT INTO {user_prefix}_friend_log_history (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number) VALUES (@created_at, @type, @user_id, @display_name, @previous_display_name, @trust_level, @previous_trust_level, @friend_number)"),
        &ParamsBuilder::new()
            .set("created_at", entry.created_at.clone())
            .set("type", entry.r#type.clone())
            .set("user_id", normalize_text(&entry.user_id))
            .set("display_name", entry.display_name.clone())
            .set("previous_display_name", entry.previous_display_name.clone())
            .set("trust_level", entry.trust_level.clone())
            .set("previous_trust_level", entry.previous_trust_level.clone())
            .set("friend_number", value_as_i64(&entry.friend_number))
            .build(),
    )?;
    Ok(())
}

fn current_friend_trust_level(entry: &FriendLogCurrentEntryInput) -> String {
    entry
        .trust_level
        .clone()
        .unwrap_or_else(|| "Visitor".to_string())
}

fn upsert_cache_entity(
    db: &DatabaseService,
    table_name: &str,
    entry: CacheEntityInput,
) -> Result<i64, AppError> {
    ensure_global_local_data_tables(db)?;
    let now = now_iso();
    Ok(db.execute_non_query(
        &format!("INSERT OR REPLACE INTO {table_name} (id, added_at, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version) VALUES (@id, @added_at, @author_id, @author_name, @created_at, @description, @image_url, @name, @release_status, @thumbnail_image_url, @updated_at, @version)"),
        &ParamsBuilder::new()
            .set("id", entry.id)
            .set("added_at", now)
            .set("author_id", entry.author_id)
            .set("author_name", entry.author_name)
            .set("created_at", entry.created_at)
            .set("description", entry.description)
            .set("image_url", entry.image_url)
            .set("name", entry.name)
            .set("release_status", entry.release_status)
            .set("thumbnail_image_url", entry.thumbnail_image_url)
            .set("updated_at", entry.updated_at)
            .set("version", entry.version)
            .build(),
    )?)
}

fn save_memo(
    db: &DatabaseService,
    table_name: &str,
    id_column: &str,
    entity_id: String,
    memo: String,
) -> Result<MemoSaveResult, AppError> {
    ensure_global_local_data_tables(db)?;
    let normalized_id = normalize_text(entity_id);
    if normalized_id.is_empty() {
        return Err(AppError::Custom("memo save requires an entity id".into()));
    }
    let next_memo = memo;
    if next_memo.is_empty() {
        db.execute_non_query(
            &format!("DELETE FROM {table_name} WHERE {id_column} = @entity_id"),
            &ParamsBuilder::new()
                .set("entity_id", normalized_id.clone())
                .build(),
        )?;
        return Ok(MemoSaveResult {
            entity_id: normalized_id,
            edited_at: String::new(),
            memo: String::new(),
        });
    }
    let edited_at = now_iso();
    db.execute_non_query(
        &format!("INSERT OR REPLACE INTO {table_name} ({id_column}, edited_at, memo) VALUES (@entity_id, @edited_at, @memo)"),
        &ParamsBuilder::new()
            .set("entity_id", normalized_id.clone())
            .set("edited_at", edited_at.clone())
            .set("memo", next_memo.clone())
            .build(),
    )?;
    Ok(MemoSaveResult {
        entity_id: normalized_id,
        edited_at,
        memo: next_memo,
    })
}

fn set_local_moderation_row(
    db: &DatabaseService,
    owner_user_id: &str,
    entry: &LocalModerationInput,
) -> Result<(), AppError> {
    let owner_user_id = normalize_text(owner_user_id);
    let user_id = normalize_text(&entry.user_id);
    if owner_user_id.is_empty() || user_id.is_empty() {
        return Ok(());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_moderation_table(db, &user_prefix)?;
    db.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_moderation (user_id, updated_at, display_name, block, mute) VALUES (@user_id, @updated_at, @display_name, @block, @mute)"),
        &ParamsBuilder::new()
            .set("user_id", user_id)
            .set("updated_at", entry.updated_at.clone())
            .set("display_name", entry.display_name.clone())
            .set("block", if entry.block { 1 } else { 0 })
            .set("mute", if entry.mute { 1 } else { 0 })
            .build(),
    )?;
    Ok(())
}

fn delete_local_moderation_row(
    db: &DatabaseService,
    owner_user_id: &str,
    user_id: &str,
) -> Result<(), AppError> {
    let owner_user_id = normalize_text(owner_user_id);
    let user_id = normalize_text(user_id);
    if owner_user_id.is_empty() || user_id.is_empty() {
        return Ok(());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_moderation_table(db, &user_prefix)?;
    db.execute_non_query(
        &format!("DELETE FROM {user_prefix}_moderation WHERE user_id = @user_id"),
        &ParamsBuilder::new().set("user_id", user_id).build(),
    )?;
    Ok(())
}

#[tauri::command]
pub fn app__config_set_values(
    state: State<'_, AppState>,
    entries: Vec<ConfigWriteEntry>,
) -> Result<(), AppError> {
    ensure_config_table(&state.db)?;
    state.db.write_transaction(|tx| {
        for entry in &entries {
            tx.execute_non_query(
                "INSERT OR REPLACE INTO configs (key, value) VALUES (@key, @value)",
                &ParamsBuilder::new()
                    .set("key", normalize_config_key(&entry.key))
                    .set("value", entry.value.clone())
                    .build(),
            )?;
        }
        Ok(())
    })?;
    Ok(())
}

#[tauri::command]
pub fn app__config_list_values(
    state: State<'_, AppState>,
) -> Result<Vec<ConfigReadEntry>, AppError> {
    ensure_config_table(&state.db)?;
    Ok(state
        .db
        .execute("SELECT key, value FROM configs", &Default::default())?
        .into_iter()
        .map(|row| ConfigReadEntry {
            key: row_string(&row, 0),
            value: row_string(&row, 1),
        })
        .collect())
}

#[tauri::command]
pub fn app__config_remove_value(state: State<'_, AppState>, key: String) -> Result<i64, AppError> {
    ensure_config_table(&state.db)?;
    Ok(state.db.execute_non_query(
        "DELETE FROM configs WHERE key = @key",
        &ParamsBuilder::new()
            .set("key", normalize_config_key(&key))
            .build(),
    )?)
}

#[tauri::command]
pub fn app__user_tables_ensure(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<UserTableContextOutput, AppError> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    Ok(UserTableContextOutput {
        user_id,
        user_prefix,
    })
}

#[tauri::command]
pub fn app__database_maintenance_run(
    state: State<'_, AppState>,
    task: String,
) -> Result<(), AppError> {
    match task.as_str() {
        "initGlobalTables" => {
            ensure_game_log_tables(&state.db)?;
            ensure_global_local_data_tables(&state.db)?;
            add_legacy_indexes(&state.db)?;
            if state
                .db
                .execute(
                    "SELECT value FROM configs WHERE key = 'config:vrcx_databaseversion' LIMIT 1",
                    &Default::default(),
                )
                .ok()
                .and_then(|rows| rows.first().and_then(|row| row.first()).cloned())
                .and_then(|value| value_as_string(&value).parse::<i64>().ok())
                .unwrap_or(0)
                >= 17
            {
                add_v17_global_indexes(&state.db)?;
            }
        }
        "vacuum" => {
            state.db.execute_non_query("VACUUM", &Default::default())?;
        }
        "optimize" => {
            state
                .db
                .execute_non_query("PRAGMA optimize", &Default::default())?;
        }
        "updateTableForGroupNames" => {
            for table_name in select_table_names(
                &state.db,
                "name LIKE '%_feed_gps' OR name LIKE '%_feed_online_offline' OR name = 'gamelog_location'",
            )? {
                add_column_if_missing(&state.db, &table_name, "group_name", "TEXT DEFAULT ''")?;
            }
            let mut columns = table_column_names(&state.db, "gamelog_location")?;
            if columns.contains("groupName") {
                if !columns.contains("group_name") {
                    add_column_if_missing(
                        &state.db,
                        "gamelog_location",
                        "group_name",
                        "TEXT DEFAULT ''",
                    )?;
                    columns = table_column_names(&state.db, "gamelog_location")?;
                }
                if columns.contains("group_name") {
                    state.db.execute_non_query(
                        "UPDATE gamelog_location SET group_name = groupName WHERE (group_name IS NULL OR group_name = '') AND groupName IS NOT NULL AND groupName != ''",
                        &Default::default(),
                    )?;
                }
                drop_column_if_exists(&state.db, "gamelog_location", "groupName")?;
            }
        }
        "addFriendLogFriendNumber" => {
            for table_name in select_table_names(
                &state.db,
                "name LIKE '%_friend_log_current' OR name LIKE '%_friend_log_history'",
            )? {
                add_column_if_missing(
                    &state.db,
                    &table_name,
                    "friend_number",
                    "INTEGER DEFAULT 0",
                )?;
            }
        }
        "updateTableForAvatarHistory" => {
            for table_name in select_table_names(&state.db, "name LIKE '%_avatar_history'")? {
                add_column_if_missing(&state.db, &table_name, "time", "INTEGER DEFAULT 0")?;
            }
        }
        "addLegacyPerformanceIndexes" => add_legacy_indexes(&state.db)?,
        "addV17GlobalPerformanceIndexes" => add_v17_global_indexes(&state.db)?,
        "addNotificationPerformanceIndexes" => add_notification_indexes(&state.db)?,
        "addV17PerformanceIndexes" => {
            add_v17_global_indexes(&state.db)?;
            add_notification_indexes(&state.db)?;
        }
        "addPerformanceIndexes" => {
            add_legacy_indexes(&state.db)?;
            add_v17_global_indexes(&state.db)?;
            add_notification_indexes(&state.db)?;
        }
        "upgradeDatabaseVersion" => {
            app__database_maintenance_run(state.clone(), "updateTableForGroupNames".into())?;
            app__database_maintenance_run(state.clone(), "addFriendLogFriendNumber".into())?;
            app__database_maintenance_run(state.clone(), "updateTableForAvatarHistory".into())?;
            add_legacy_indexes(&state.db)?;
        }
        "cleanLegendFromFriendLog" => {
            for table_name in select_table_names(&state.db, "name LIKE '%_friend_log_history'")? {
                state.db.execute_non_query(
                    &format!("DELETE FROM {table_name} WHERE type = 'TrustLevel' AND created_at > '2022-05-04T01:00:00.000Z' AND ((trust_level = 'Veteran User' AND previous_trust_level = 'Trusted User') OR (trust_level = 'Trusted User' AND previous_trust_level = 'Veteran User'))"),
                    &Default::default(),
                )?;
            }
        }
        "fixGameLogTraveling" => {
            let traveling = state.db.execute(
                "SELECT * FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND location = 'traveling'",
                &Default::default(),
            )?;
            for row in traveling.into_iter().rev() {
                let row_id = row.first().cloned().unwrap_or(Value::Null);
                let created_at = row.get(1).cloned().unwrap_or(Value::Null);
                let display_name = row.get(3).cloned().unwrap_or(Value::Null);
                let join_rows = state.db.execute(
                    "SELECT * FROM gamelog_join_leave WHERE type = 'OnPlayerJoined' AND display_name = @display_name AND created_at <= @created_at ORDER BY created_at DESC LIMIT 1",
                    &ParamsBuilder::new()
                        .set("display_name", display_name)
                        .set("created_at", created_at)
                        .build(),
                )?;
                let Some(location) = join_rows
                    .first()
                    .and_then(|row| row.get(4))
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                else {
                    continue;
                };
                state.db.execute_non_query(
                    "UPDATE gamelog_join_leave SET location = @location WHERE id = @row_id",
                    &ParamsBuilder::new()
                        .set("row_id", row_id)
                        .set("location", location.to_string())
                        .build(),
                )?;
            }
        }
        "fixNegativeGPS" => {
            for table_name in select_table_names(&state.db, "name LIKE '%_gps'")? {
                state.db.execute_non_query(
                    &format!("UPDATE {table_name} SET time = 0 WHERE time < 0"),
                    &Default::default(),
                )?;
            }
        }
        "fixBrokenLeaveEntries" => {
            let mut instance_times = std::collections::HashMap::<String, i64>::new();
            for row in state.db.execute(
                "SELECT location, time FROM gamelog_location",
                &Default::default(),
            )? {
                let location = row
                    .first()
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let time = row.get(1).map(value_as_i64).unwrap_or(0);
                *instance_times.entry(location).or_default() += time;
            }
            for row in state.db.execute("SELECT location, time, id FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND time > 0", &Default::default())? {
                let location = row.first().and_then(Value::as_str).unwrap_or_default();
                let time = row.get(1).map(value_as_i64).unwrap_or(0);
                let id = row.get(2).cloned().unwrap_or(Value::Null);
                if instance_times.get(location).is_some_and(|instance_time| time > *instance_time) {
                    state.db.execute_non_query(
                        "UPDATE gamelog_join_leave SET time = 0 WHERE id = @id",
                        &ParamsBuilder::new().set("id", id).build(),
                    )?;
                }
            }
        }
        "fixBrokenGroupInvites" => {
            for table_name in select_table_names(&state.db, "name LIKE '%_notifications'")? {
                state.db.execute_non_query(
                    &format!("DELETE FROM {table_name} WHERE type LIKE '%.%'"),
                    &Default::default(),
                )?;
            }
        }
        "fixBrokenNotifications" => {
            for table_name in select_table_names(&state.db, "name LIKE '%_notifications'")? {
                state.db.execute_non_query(
                    &format!(
                        "DELETE FROM {table_name} WHERE (created_at is null or created_at = '')"
                    ),
                    &Default::default(),
                )?;
            }
        }
        "fixBrokenGroupChange" => {
            for table_name in select_table_names(&state.db, "name LIKE '%_notifications'")? {
                state.db.execute_non_query(&format!("DELETE FROM {table_name} WHERE type = 'groupChange' AND created_at < '2024-04-23T03:00:00.000Z'"), &Default::default())?;
            }
        }
        "fixCancelFriendRequestTypo" => {
            for table_name in select_table_names(&state.db, "name LIKE '%_friend_log_history'")? {
                state.db.execute_non_query(&format!("UPDATE {table_name} SET type = 'CancelFriendRequest' WHERE type = 'CancelFriendRequst'"), &Default::default())?;
            }
        }
        "fixBrokenGameLogDisplayNames" => {
            for row in state.db.execute(
                "SELECT id, display_name FROM gamelog_join_leave WHERE display_name LIKE '% (%'",
                &Default::default(),
            )? {
                let id = row.first().cloned().unwrap_or(Value::Null);
                let display_name = row.get(1).and_then(Value::as_str).unwrap_or_default();
                let new_display_name = display_name
                    .split(" (")
                    .next()
                    .unwrap_or_default()
                    .to_string();
                state.db.execute_non_query(
                    "UPDATE gamelog_join_leave SET display_name = @new_display_name WHERE id = @id",
                    &ParamsBuilder::new()
                        .set("new_display_name", new_display_name)
                        .set("id", id)
                        .build(),
                )?;
            }
        }
        _ => {
            return Err(AppError::Custom(format!(
                "Unknown maintenance task: {task}"
            )))
        }
    }
    Ok(())
}

#[tauri::command]
pub fn app__database_maintenance_table_sizes_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<MaintenanceTableSizesOutput, AppError> {
    ensure_game_log_tables(&state.db)?;
    ensure_global_local_data_tables(&state.db)?;

    let user_id = normalize_text(user_id);
    let mut output = MaintenanceTableSizesOutput {
        gps: 0,
        status: 0,
        bio: 0,
        avatar: 0,
        online_offline: 0,
        friend_log_history: 0,
        notification: 0,
        location: count_table(&state.db, "gamelog_location")?,
        join_leave: count_table(&state.db, "gamelog_join_leave")?,
        portal_spawn: count_table(&state.db, "gamelog_portal_spawn")?,
        video_play: count_table(&state.db, "gamelog_video_play")?,
        event: count_table(&state.db, "gamelog_event")?,
        external: count_table(&state.db, "gamelog_external")?,
        resource_load: count_table(&state.db, "gamelog_resource_load")?,
    };
    if !user_id.is_empty() {
        let user_prefix = normalize_user_table_prefix(&user_id)?;
        ensure_user_local_tables(&state.db, &user_prefix)?;
        output.gps = count_table(&state.db, &format!("{user_prefix}_feed_gps"))?;
        output.status = count_table(&state.db, &format!("{user_prefix}_feed_status"))?;
        output.bio = count_table(&state.db, &format!("{user_prefix}_feed_bio"))?;
        output.avatar = count_table(&state.db, &format!("{user_prefix}_feed_avatar"))?;
        output.online_offline =
            count_table(&state.db, &format!("{user_prefix}_feed_online_offline"))?;
        output.friend_log_history =
            count_table(&state.db, &format!("{user_prefix}_friend_log_history"))?;
        output.notification = count_table(&state.db, &format!("{user_prefix}_notifications"))?;
    }
    Ok(output)
}

#[tauri::command]
pub fn app__database_maintenance_max_friend_log_number_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<i64, AppError> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(0);
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    max_friend_log_number(&state.db, &user_prefix)
}

#[tauri::command]
pub fn app__database_maintenance_broken_leave_entries_get(
    state: State<'_, AppState>,
) -> Result<Vec<Value>, AppError> {
    ensure_game_log_tables(&state.db)?;
    let mut instance_times = HashMap::<String, i64>::new();
    for row in state.db.execute(
        "SELECT location, time FROM gamelog_location",
        &Default::default(),
    )? {
        let location = row_string(&row, 0);
        let time = row_i64(&row, 1);
        *instance_times.entry(location).or_default() += time;
    }
    let mut bad_entries = Vec::new();
    for row in state.db.execute("SELECT location, time, id FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND time > 0", &Default::default())? {
        let location = row_string(&row, 0);
        let time = row_i64(&row, 1);
        if instance_times
            .get(&location)
            .is_some_and(|instance_time| time > *instance_time)
        {
            bad_entries.push(row_json(&row, 2));
        }
    }
    Ok(bad_entries)
}

#[tauri::command]
pub fn app__database_maintenance_broken_game_log_display_names_get(
    state: State<'_, AppState>,
) -> Result<Vec<BrokenGameLogDisplayNameOutput>, AppError> {
    ensure_game_log_tables(&state.db)?;
    Ok(state
        .db
        .execute(
            "SELECT id, display_name FROM gamelog_join_leave WHERE display_name LIKE '% (%'",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| BrokenGameLogDisplayNameOutput {
            id: row_json(&row, 0),
            display_name: row_json(&row, 1),
        })
        .collect())
}

#[tauri::command]
pub fn app__avatar_cache_upsert(
    state: State<'_, AppState>,
    entry: CacheEntityInput,
) -> Result<i64, AppError> {
    upsert_cache_entity(&state.db, "cache_avatar", entry)
}

#[tauri::command]
pub fn app__avatar_cache_get(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<Option<AvatarCacheOutput>, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(None);
    }
    Ok(state
        .db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_avatar WHERE id = @avatar_id LIMIT 1",
            &ParamsBuilder::new().set("avatar_id", avatar_id).build(),
        )?
        .first()
        .map(|row| cache_entity_from_row(row)))
}

#[tauri::command]
pub fn app__avatar_cache_list(
    state: State<'_, AppState>,
) -> Result<Vec<AvatarCacheOutput>, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    Ok(state
        .db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_avatar",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| cache_entity_from_row(&row))
        .collect())
}

#[tauri::command]
pub fn app__avatar_cache_remove(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<(), AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }
    state.db.execute_non_query(
        "DELETE FROM cache_avatar WHERE id = @avatar_id",
        &ParamsBuilder::new().set("avatar_id", avatar_id).build(),
    )?;
    Ok(())
}

#[tauri::command]
pub fn app__avatar_history_add(
    state: State<'_, AppState>,
    user_id: String,
    avatar_id: String,
) -> Result<(), AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }
    state.db.execute_non_query(
        &format!("INSERT INTO {user_prefix}_avatar_history (avatar_id, created_at, time) VALUES (@avatar_id, @created_at, 0) ON CONFLICT(avatar_id) DO UPDATE SET created_at = @created_at"),
        &ParamsBuilder::new()
            .set("avatar_id", avatar_id)
            .set("created_at", now_iso())
            .build(),
    )?;
    Ok(())
}

#[tauri::command]
pub fn app__avatar_time_spent_add(
    state: State<'_, AppState>,
    user_id: String,
    avatar_id: String,
    time_spent: i64,
) -> Result<(), AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }
    state.db.execute_non_query(
        &format!("INSERT INTO {user_prefix}_avatar_history (avatar_id, created_at, time) VALUES (@avatar_id, @created_at, @time_spent) ON CONFLICT(avatar_id) DO UPDATE SET time = time + @time_spent"),
        &ParamsBuilder::new()
            .set("avatar_id", avatar_id)
            .set("created_at", now_iso())
            .set("time_spent", time_spent)
            .build(),
    )?;
    Ok(())
}

#[tauri::command]
pub fn app__avatar_history_list(
    state: State<'_, AppState>,
    user_id: String,
    limit: i64,
) -> Result<Vec<AvatarCacheOutput>, AppError> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    ensure_global_local_data_tables(&state.db)?;
    Ok(state
        .db
        .execute(
            &format!(
                "SELECT cache_avatar.id, cache_avatar.author_id, cache_avatar.author_name, cache_avatar.created_at, cache_avatar.description, cache_avatar.image_url, cache_avatar.name, cache_avatar.release_status, cache_avatar.thumbnail_image_url, cache_avatar.updated_at, cache_avatar.version
                 FROM {user_prefix}_avatar_history
                 INNER JOIN cache_avatar ON cache_avatar.id = {user_prefix}_avatar_history.avatar_id
                 WHERE author_id != @current_user_id
                 ORDER BY {user_prefix}_avatar_history.created_at DESC
                 LIMIT @limit"
            ),
            &ParamsBuilder::new()
                .set("current_user_id", user_id)
                .set("limit", if limit > 0 { limit } else { 100 })
                .build(),
        )?
        .into_iter()
        .map(|row| cache_entity_from_row(&row))
        .collect())
}

#[tauri::command]
pub fn app__avatar_time_spent_get(
    state: State<'_, AppState>,
    user_id: String,
    avatar_id: String,
) -> Result<AvatarTimeSpentOutput, AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    let avatar_id = normalize_text(avatar_id);
    let time_spent = if avatar_id.is_empty() {
        0
    } else {
        state
            .db
            .execute(
                &format!(
                    "SELECT time FROM {user_prefix}_avatar_history WHERE avatar_id = @avatar_id"
                ),
                &ParamsBuilder::new()
                    .set("avatar_id", avatar_id.clone())
                    .build(),
            )?
            .first()
            .map(|row| row_i64(row, 0))
            .unwrap_or(0)
    };
    Ok(AvatarTimeSpentOutput {
        avatar_id,
        time_spent,
    })
}

#[tauri::command]
pub fn app__avatar_time_spent_list(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Vec<AvatarTimeSpentOutput>, AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    Ok(state
        .db
        .execute(
            &format!("SELECT avatar_id, time FROM {user_prefix}_avatar_history"),
            &Default::default(),
        )?
        .into_iter()
        .map(|row| AvatarTimeSpentOutput {
            avatar_id: row_string(&row, 0),
            time_spent: row_i64(&row, 1),
        })
        .collect())
}

#[tauri::command]
pub fn app__avatar_history_clear(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<(), AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    ensure_global_local_data_tables(&state.db)?;
    state.db.execute_non_query(
        &format!("DELETE FROM {user_prefix}_avatar_history"),
        &Default::default(),
    )?;
    state
        .db
        .execute_non_query("DELETE FROM cache_avatar", &Default::default())?;
    Ok(())
}

#[tauri::command]
pub fn app__avatar_tag_add(
    state: State<'_, AppState>,
    avatar_id: String,
    tag: Value,
    color: Value,
) -> Result<i64, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    Ok(state.db.execute_non_query(
        "INSERT OR IGNORE INTO avatar_tags (avatar_id, tag, color) VALUES (@avatar_id, @tag, @color)",
        &ParamsBuilder::new()
            .set("avatar_id", normalize_text(avatar_id))
            .set("tag", tag)
            .set("color", color)
            .build(),
    )?)
}

#[tauri::command]
pub fn app__avatar_tags_get(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<Vec<AvatarTagOutput>, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let avatar_id = normalize_text(avatar_id);
    Ok(state
        .db
        .execute(
            "SELECT avatar_id, tag, color FROM avatar_tags WHERE avatar_id = @avatar_id",
            &ParamsBuilder::new().set("avatar_id", avatar_id).build(),
        )?
        .into_iter()
        .map(|row| AvatarTagOutput {
            avatar_id: row_string(&row, 0),
            tag: row_string(&row, 1),
            color: row.get(2).cloned().unwrap_or(Value::Null),
        })
        .collect())
}

#[tauri::command]
pub fn app__avatar_tags_list(state: State<'_, AppState>) -> Result<Vec<AvatarTagOutput>, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    Ok(state
        .db
        .execute(
            "SELECT avatar_id, tag, color FROM avatar_tags",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| AvatarTagOutput {
            avatar_id: row_string(&row, 0),
            tag: row_string(&row, 1),
            color: row.get(2).cloned().unwrap_or(Value::Null),
        })
        .collect())
}

#[tauri::command]
pub fn app__avatar_tags_distinct(state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    Ok(state
        .db
        .execute(
            "SELECT DISTINCT tag FROM avatar_tags ORDER BY tag",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| row_string(&row, 0))
        .filter(|tag| !tag.is_empty())
        .collect())
}

#[tauri::command]
pub fn app__avatar_tag_update_color(
    state: State<'_, AppState>,
    avatar_id: String,
    tag: Value,
    color: Value,
) -> Result<i64, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    Ok(state.db.execute_non_query(
        "UPDATE avatar_tags SET color = @color WHERE avatar_id = @avatar_id AND tag = @tag",
        &ParamsBuilder::new()
            .set("avatar_id", normalize_text(avatar_id))
            .set("tag", tag)
            .set("color", color)
            .build(),
    )?)
}

#[tauri::command]
pub fn app__avatar_tag_remove(
    state: State<'_, AppState>,
    avatar_id: String,
    tag: Value,
) -> Result<i64, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    Ok(state.db.execute_non_query(
        "DELETE FROM avatar_tags WHERE avatar_id = @avatar_id AND tag = @tag",
        &ParamsBuilder::new()
            .set("avatar_id", normalize_text(avatar_id))
            .set("tag", tag)
            .build(),
    )?)
}

#[tauri::command]
pub fn app__avatar_tags_remove_all(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<i64, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    Ok(state.db.execute_non_query(
        "DELETE FROM avatar_tags WHERE avatar_id = @avatar_id",
        &ParamsBuilder::new()
            .set("avatar_id", normalize_text(avatar_id))
            .build(),
    )?)
}

#[tauri::command]
pub fn app__avatar_tags_replace(
    state: State<'_, AppState>,
    avatar_id: String,
    entries: Vec<AvatarTagInput>,
) -> Result<(), AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }

    let entries = entries
        .into_iter()
        .filter_map(normalize_avatar_tag_entry)
        .collect::<Vec<_>>();

    state.db.write_transaction(|tx| {
        tx.execute_non_query(
            "DELETE FROM avatar_tags WHERE avatar_id = @avatar_id",
            &ParamsBuilder::new()
                .set("avatar_id", avatar_id.clone())
                .build(),
        )?;
        for (tag, color) in &entries {
            tx.execute_non_query(
                "INSERT OR REPLACE INTO avatar_tags (avatar_id, tag, color) VALUES (@avatar_id, @tag, @color)",
                &ParamsBuilder::new()
                    .set("avatar_id", avatar_id.clone())
                    .set("tag", tag.clone())
                    .set("color", color.clone())
                    .build(),
            )?;
        }
        Ok(())
    })?;
    Ok(())
}

#[tauri::command]
pub fn app__avatar_tags_patch(
    state: State<'_, AppState>,
    avatar_id: String,
    patch: AvatarTagsPatchInput,
) -> Result<(), AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }

    let previous_entries = normalize_avatar_tag_map(patch.previous_entries);
    let next_entries = normalize_avatar_tag_map(patch.next_entries);

    state.db.write_transaction(|tx| {
        for tag in previous_entries.keys() {
            if !next_entries.contains_key(tag) {
                tx.execute_non_query(
                    "DELETE FROM avatar_tags WHERE avatar_id = @avatar_id AND tag = @tag",
                    &ParamsBuilder::new()
                        .set("avatar_id", avatar_id.clone())
                        .set("tag", tag.clone())
                        .build(),
                )?;
            }
        }
        for (tag, color) in &next_entries {
            match previous_entries.get(tag) {
                None => {
                    tx.execute_non_query(
                        "INSERT OR IGNORE INTO avatar_tags (avatar_id, tag, color) VALUES (@avatar_id, @tag, @color)",
                        &ParamsBuilder::new()
                            .set("avatar_id", avatar_id.clone())
                            .set("tag", tag.clone())
                            .set("color", color.clone())
                            .build(),
                    )?;
                }
                Some(previous_color) if nullish_color(previous_color) != nullish_color(color) => {
                    tx.execute_non_query(
                        "UPDATE avatar_tags SET color = @color WHERE avatar_id = @avatar_id AND tag = @tag",
                        &ParamsBuilder::new()
                            .set("avatar_id", avatar_id.clone())
                            .set("tag", tag.clone())
                            .set("color", color.clone())
                            .build(),
                    )?;
                }
                _ => {}
            }
        }
        Ok(())
    })?;
    Ok(())
}

#[tauri::command]
pub fn app__feed_add_entry(
    state: State<'_, AppState>,
    user_id: String,
    entry: Value,
) -> Result<(), AppError> {
    write_realtime_batch(
        &state.db,
        &user_id,
        &RealtimePersistenceBatch {
            feed_entries: vec![entry],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    Ok(())
}

#[tauri::command]
pub fn app__feed_avatar_purge(
    state: State<'_, AppState>,
    user_id: String,
    cutoff_date: Option<String>,
) -> Result<i64, AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    if let Some(cutoff_date) = cutoff_date.filter(|value| !value.trim().is_empty()) {
        return Ok(state.db.execute_non_query(
            &format!("DELETE FROM {user_prefix}_feed_avatar WHERE created_at < @cutoff"),
            &ParamsBuilder::new().set("cutoff", cutoff_date).build(),
        )?);
    }
    Ok(state.db.execute_non_query(
        &format!("DELETE FROM {user_prefix}_feed_avatar"),
        &Default::default(),
    )?)
}

#[tauri::command]
pub fn app__feed_rows_query(
    state: State<'_, AppState>,
    query: FeedRowsQueryInput,
) -> Result<Vec<FeedRowOutput>, AppError> {
    let user_id = normalize_text(query.user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;

    let mut params = HashMap::new();
    let max_entries = if query.max_entries > 0 {
        query.max_entries
    } else {
        500
    };
    params.insert("@limit".into(), Value::from(max_entries));
    params.insert("@per_table".into(), Value::from(max_entries));

    let vip_placeholders = add_list_params(&mut params, &query.vip_list, "vip");
    let vip_query = if vip_placeholders.is_empty() {
        String::new()
    } else {
        format!("AND user_id IN ({})", vip_placeholders.join(", "))
    };

    let mode = normalize_text(&query.mode);
    let search = normalize_text(&query.search);
    let instance_mode = mode == "instance"
        || (mode == "search" && (search.starts_with("wrld_") || search.starts_with("grp_")));
    let flags = feed_filter_flags(&query.filters, !instance_mode);
    let mut selects = Vec::new();

    if instance_mode {
        params.insert(
            "@instance_like".into(),
            Value::String(format!("%{search}%")),
        );
        if flags.gps {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'GPS' AS type, location, world_name, previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_gps WHERE location LIKE @instance_like {vip_query} ORDER BY created_at DESC, id DESC LIMIT @per_table)"
            ));
        }
        if flags.online || flags.offline {
            let type_filter = match (flags.online, flags.offline) {
                (true, false) => "AND type = 'Online'",
                (false, true) => "AND type = 'Offline'",
                _ => "",
            };
            push_feed_online_offline_select(
                &mut selects,
                &user_prefix,
                "location LIKE @instance_like",
                type_filter,
                &vip_query,
            );
        }
    } else if mode == "lookup" {
        if flags.gps {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'GPS' AS type, location, world_name, previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_gps WHERE 1=1 {vip_query} ORDER BY id DESC LIMIT @per_table)"
            ));
        }
        if flags.status {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Status' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, status, status_description, previous_status, previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_status WHERE 1=1 {vip_query} ORDER BY id DESC LIMIT @per_table)"
            ));
        }
        if flags.bio {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Bio' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, bio, previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_bio WHERE 1=1 {vip_query} ORDER BY id DESC LIMIT @per_table)"
            ));
        }
        if flags.avatar {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Avatar' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_avatar WHERE 1=1 {vip_query} ORDER BY id DESC LIMIT @per_table)"
            ));
        }
        if flags.online || flags.offline {
            let type_filter = match (flags.online, flags.offline) {
                (true, false) => "AND type = 'Online'",
                (false, true) => "AND type = 'Offline'",
                _ => "",
            };
            push_feed_online_offline_select(
                &mut selects,
                &user_prefix,
                "1=1",
                type_filter,
                &vip_query,
            );
        }
    } else {
        params.insert("@search_like".into(), Value::String(format!("%{search}%")));
        let mut date_query = String::new();
        if !query.date_from.trim().is_empty() {
            date_query.push_str("AND created_at >= @date_from ");
            params.insert("@date_from".into(), Value::String(query.date_from));
        }
        if !query.date_to.trim().is_empty() {
            date_query.push_str("AND created_at <= @date_to ");
            params.insert("@date_to".into(), Value::String(query.date_to));
        }
        if flags.gps {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'GPS' AS type, location, world_name, previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_gps WHERE (display_name LIKE @search_like OR world_name LIKE @search_like OR group_name LIKE @search_like) {date_query} {vip_query} ORDER BY created_at DESC, id DESC LIMIT @per_table)"
            ));
        }
        if flags.status {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Status' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, status, status_description, previous_status, previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_status WHERE (display_name LIKE @search_like OR status LIKE @search_like OR status_description LIKE @search_like) {date_query} {vip_query} ORDER BY created_at DESC, id DESC LIMIT @per_table)"
            ));
        }
        if flags.bio {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Bio' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, bio, previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_bio WHERE (display_name LIKE @search_like OR bio LIKE @search_like) {date_query} {vip_query} ORDER BY created_at DESC, id DESC LIMIT @per_table)"
            ));
        }
        if flags.avatar {
            let avatar_query = if search.contains("private") {
                "OR user_id = owner_id"
            } else if search.contains("public") {
                "OR user_id != owner_id"
            } else {
                ""
            };
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Avatar' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_avatar WHERE (display_name LIKE @search_like OR avatar_name LIKE @search_like) {avatar_query} {date_query} {vip_query} ORDER BY created_at DESC, id DESC LIMIT @per_table)"
            ));
        }
        if flags.online || flags.offline {
            let type_filter = match (flags.online, flags.offline) {
                (true, false) => "AND type = 'Online'",
                (false, true) => "AND type = 'Offline'",
                _ => "",
            };
            let where_sql =
                "(display_name LIKE @search_like OR world_name LIKE @search_like OR group_name LIKE @search_like)";
            push_feed_online_offline_select(
                &mut selects,
                &user_prefix,
                where_sql,
                &format!("{type_filter} {date_query}"),
                &vip_query,
            );
        }
    }

    if selects.is_empty() {
        return Ok(Vec::new());
    }

    Ok(state
        .db
        .execute(
            &format!(
                "SELECT {} FROM ({}) ORDER BY created_at DESC, id DESC LIMIT @limit",
                feed_base_columns(),
                selects.join(" UNION ALL ")
            ),
            &params,
        )?
        .into_iter()
        .map(|row| feed_row_from_unified_row(&row))
        .collect())
}

#[tauri::command]
pub fn app__game_log_entries_add(
    state: State<'_, AppState>,
    kind: String,
    entries: Vec<Value>,
) -> Result<(), AppError> {
    let batch = game_log_batch_for_kind(&kind, entries);
    write_game_log_batch(&state.db, &batch)?;
    Ok(())
}

#[tauri::command]
pub fn app__game_log_instance_delete_by_location(
    state: State<'_, AppState>,
    location: String,
) -> Result<i64, AppError> {
    ensure_game_log_tables(&state.db)?;
    Ok(state.db.execute_non_query(
        "DELETE FROM gamelog_location WHERE location = @location",
        &ParamsBuilder::new()
            .set("location", normalize_text(location))
            .build(),
    )?)
}

#[tauri::command]
pub fn app__game_log_instance_delete(
    state: State<'_, AppState>,
    location: String,
    event_ids: Vec<i64>,
) -> Result<i64, AppError> {
    ensure_game_log_tables(&state.db)?;
    let location = normalize_text(location);
    let event_ids: Vec<i64> = event_ids.into_iter().filter(|value| *value > 0).collect();
    if event_ids.is_empty() {
        return Ok(0);
    }
    let mut params = ParamsBuilder::new().set("location", location);
    let mut placeholders = Vec::with_capacity(event_ids.len());
    for (index, event_id) in event_ids.iter().enumerate() {
        let key = format!("event_id_{index}");
        params = params.set(&key, *event_id);
        placeholders.push(format!("@{key}"));
    }
    Ok(state.db.execute_non_query(
        &format!(
            "DELETE FROM gamelog_join_leave WHERE (location = @location) AND (id IN ({}))",
            placeholders.join(", ")
        ),
        &params.build(),
    )?)
}

#[tauri::command]
pub fn app__game_log_entry_delete(
    state: State<'_, AppState>,
    kind: String,
    entry: Value,
) -> Result<i64, AppError> {
    ensure_game_log_tables(&state.db)?;
    let row_id = value_as_i64(
        object_field(&entry, "rowId")
            .or_else(|| object_field(&entry, "id"))
            .unwrap_or(&Value::Null),
    );
    let (table_name, fallback_column, fallback_value) = match kind.as_str() {
        "VideoPlay" => (
            "gamelog_video_play",
            "video_url",
            object_field_string(&entry, &["videoUrl", "video_url"]),
        ),
        "Event" => (
            "gamelog_event",
            "data",
            object_field_string(&entry, &["data"]),
        ),
        "External" => (
            "gamelog_external",
            "message",
            object_field_string(&entry, &["message"]),
        ),
        "StringLoad" | "ImageLoad" | "ResourceLoad" => (
            "gamelog_resource_load",
            "resource_url",
            object_field_string(&entry, &["resourceUrl", "resource_url"]),
        ),
        _ => return Ok(0),
    };
    if row_id > 0 {
        return Ok(state.db.execute_non_query(
            &format!("DELETE FROM {table_name} WHERE id = @id"),
            &ParamsBuilder::new().set("id", row_id).build(),
        )?);
    }
    Ok(state.db.execute_non_query(
        &format!("DELETE FROM {table_name} WHERE created_at = @created_at AND {fallback_column} = @fallback_value"),
        &ParamsBuilder::new()
            .set("created_at", object_field_string(&entry, &["created_at", "createdAt"]))
            .set("fallback_value", fallback_value)
        .build(),
    )?)
}

#[tauri::command]
pub fn app__game_log_query(
    state: State<'_, AppState>,
    query: GameLogQueryInput,
) -> Result<Value, AppError> {
    ensure_game_log_tables(&state.db)?;
    let params = query.params;
    let kind = normalize_text(&query.kind);
    match kind.as_str() {
        "recentDatabase" => {
            let date_offset = query_param_string(&params, "dateOffset");
            let limit = query_param_i64(&params, "maxTableSize", 500);
            let mut rows = Vec::new();
            for row in state.db.execute(
                "SELECT id, created_at, 'Location' AS type, NULL AS display_name, location, NULL AS user_id, time, world_id, world_name, group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message
                 FROM gamelog_location
                 WHERE created_at >= date(@date_offset)
                 ORDER BY id DESC
                 LIMIT @limit",
                &ParamsBuilder::new()
                    .set("date_offset", date_offset.clone())
                    .set("limit", limit)
                    .build(),
            )? {
                rows.push(game_log_row_from_unified_row(&row));
            }
            for row in state.db.execute(
                "SELECT id, created_at, type, display_name, location, user_id, time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message
                 FROM gamelog_join_leave
                 WHERE created_at >= date(@date_offset)
                 ORDER BY id DESC
                 LIMIT @limit",
                &ParamsBuilder::new()
                    .set("date_offset", date_offset.clone())
                    .set("limit", limit)
                    .build(),
            )? {
                rows.push(game_log_row_from_unified_row(&row));
            }
            for row in state.db.execute(
                "SELECT id, created_at, 'PortalSpawn' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, world_name, NULL AS group_name, instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message
                 FROM gamelog_portal_spawn
                 WHERE created_at >= date(@date_offset)
                 ORDER BY id DESC
                 LIMIT @limit",
                &ParamsBuilder::new()
                    .set("date_offset", date_offset.clone())
                    .set("limit", limit)
                    .build(),
            )? {
                rows.push(game_log_row_from_unified_row(&row));
            }
            for row in state.db.execute(
                "SELECT id, created_at, 'VideoPlay' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, video_url, video_name, video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message
                 FROM gamelog_video_play
                 WHERE created_at >= date(@date_offset)
                 ORDER BY id DESC
                 LIMIT @limit",
                &ParamsBuilder::new()
                    .set("date_offset", date_offset.clone())
                    .set("limit", limit)
                    .build(),
            )? {
                rows.push(game_log_row_from_unified_row(&row));
            }
            for row in state.db.execute(
                "SELECT id, created_at, resource_type AS type, NULL AS display_name, location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, resource_url, resource_type, NULL AS data, NULL AS message
                 FROM gamelog_resource_load
                 WHERE created_at >= date(@date_offset)
                 ORDER BY id DESC
                 LIMIT @limit",
                &ParamsBuilder::new()
                    .set("date_offset", date_offset.clone())
                    .set("limit", limit)
                    .build(),
            )? {
                rows.push(game_log_row_from_unified_row(&row));
            }
            for row in state.db.execute(
                "SELECT id, created_at, 'Event' AS type, NULL AS display_name, NULL AS location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, data, NULL AS message
                 FROM gamelog_event
                 WHERE created_at >= date(@date_offset)
                 ORDER BY id DESC
                 LIMIT @limit",
                &ParamsBuilder::new()
                    .set("date_offset", date_offset.clone())
                    .set("limit", limit)
                    .build(),
            )? {
                rows.push(game_log_row_from_unified_row(&row));
            }
            for row in state.db.execute(
                "SELECT id, created_at, 'External' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, message
                 FROM gamelog_external
                 WHERE created_at >= date(@date_offset)
                 ORDER BY id DESC
                 LIMIT @limit",
                &ParamsBuilder::new()
                    .set("date_offset", date_offset)
                    .set("limit", limit)
                    .build(),
            )? {
                rows.push(game_log_row_from_unified_row(&row));
            }
            rows.sort_by(|left, right| {
                let left_date = left
                    .get("created_at")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let right_date = right
                    .get("created_at")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                left_date.cmp(right_date)
            });
            if rows.len() > limit as usize {
                rows.drain(0..rows.len() - limit as usize);
            }
            Ok(Value::Array(rows))
        }
        "rowsByLocation" | "lookupRows" | "searchRows" => {
            let mode = kind.as_str();
            let include_extra = mode != "rowsByLocation";
            let filters = query_param_string_array(&params, "filters");
            let flags = game_log_filter_flags(&filters, include_extra);
            let vip_list = query_param_string_array(&params, "vipList");
            let mut db_params = HashMap::new();
            let max_entries = query_param_i64(&params, "maxEntries", 500);
            db_params.insert("@limit".into(), Value::from(max_entries));
            db_params.insert("@per_table".into(), Value::from(max_entries));
            let vip_placeholders = add_list_params(&mut db_params, &vip_list, "vip");
            let vip_query = if vip_placeholders.is_empty() {
                String::new()
            } else {
                format!("AND user_id IN ({})", vip_placeholders.join(", "))
            };
            let mut selects = Vec::new();

            if mode == "rowsByLocation" {
                let instance_id = query_param_string(&params, "instanceId");
                db_params.insert(
                    "@location_like".into(),
                    Value::String(format!("%{instance_id}%")),
                );
                db_params.insert(
                    "@current_user_id".into(),
                    Value::String(query_param_string(&params, "currentUserId")),
                );
                if flags.location {
                    selects.push(
                        "SELECT * FROM (SELECT id, created_at, 'Location' AS type, NULL AS display_name, location, NULL AS user_id, time, world_id, world_name, group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type FROM gamelog_location WHERE location LIKE @location_like ORDER BY id DESC LIMIT @per_table)".to_string()
                    );
                }
                if flags.onplayerjoined || flags.onplayerleft {
                    let query = match (flags.onplayerjoined, flags.onplayerleft) {
                        (true, false) => "AND type = 'OnPlayerJoined'",
                        (false, true) => "AND type = 'OnPlayerLeft'",
                        _ => "",
                    };
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, type, display_name, location, user_id, time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type FROM gamelog_join_leave WHERE (location LIKE @location_like AND user_id != @current_user_id) {vip_query} {query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.portalspawn {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'PortalSpawn' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, world_name, NULL AS group_name, instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type FROM gamelog_portal_spawn WHERE location LIKE @location_like {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.videoplay {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'VideoPlay' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, video_url, video_name, video_id, NULL AS resource_url, NULL AS resource_type FROM gamelog_video_play WHERE location LIKE @location_like {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.stringload || flags.imageload {
                    let check_string = if flags.stringload {
                        ""
                    } else {
                        "AND resource_type != 'StringLoad'"
                    };
                    let check_image = if flags.imageload {
                        ""
                    } else {
                        "AND resource_type != 'ImageLoad'"
                    };
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, resource_type AS type, NULL AS display_name, location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, resource_url, resource_type FROM gamelog_resource_load WHERE location LIKE @location_like {check_string} {check_image} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
            } else if mode == "lookupRows" {
                if flags.location {
                    selects.push(
                        "SELECT * FROM (SELECT id, created_at, 'Location' AS type, NULL AS display_name, location, NULL AS user_id, time, world_id, world_name, group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_location ORDER BY id DESC LIMIT @per_table)".to_string()
                    );
                }
                if flags.onplayerjoined || flags.onplayerleft {
                    let query = match (flags.onplayerjoined, flags.onplayerleft) {
                        (true, false) => "AND type = 'OnPlayerJoined'",
                        (false, true) => "AND type = 'OnPlayerLeft'",
                        _ => "",
                    };
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, type, display_name, location, user_id, time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_join_leave WHERE 1=1 {vip_query} {query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.portalspawn {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'PortalSpawn' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, world_name, NULL AS group_name, instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_portal_spawn WHERE 1=1 {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.event {
                    selects.push(
                        "SELECT * FROM (SELECT id, created_at, 'Event' AS type, NULL AS display_name, NULL AS location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, data, NULL AS message FROM gamelog_event ORDER BY id DESC LIMIT @per_table)".to_string()
                    );
                }
                if flags.external {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'External' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, message FROM gamelog_external WHERE 1=1 {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.videoplay {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'VideoPlay' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, video_url, video_name, video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_video_play WHERE 1=1 {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.stringload || flags.imageload {
                    let check_string = if flags.stringload {
                        ""
                    } else {
                        "AND resource_type != 'StringLoad'"
                    };
                    let check_image = if flags.imageload {
                        ""
                    } else {
                        "AND resource_type != 'ImageLoad'"
                    };
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, resource_type AS type, NULL AS display_name, location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, resource_url, resource_type, NULL AS data, NULL AS message FROM gamelog_resource_load WHERE 1=1 {check_string} {check_image} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
            } else {
                let search = query_param_string(&params, "search");
                db_params.insert("@search_like".into(), Value::String(format!("%{search}%")));
                db_params.insert(
                    "@current_user_id".into(),
                    Value::String(query_param_string(&params, "currentUserId")),
                );
                if flags.location {
                    selects.push(
                        "SELECT * FROM (SELECT id, created_at, 'Location' AS type, NULL AS display_name, location, NULL AS user_id, time, world_id, world_name, group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_location WHERE (world_name LIKE @search_like OR group_name LIKE @search_like) ORDER BY id DESC LIMIT @per_table)".to_string()
                    );
                }
                if flags.onplayerjoined || flags.onplayerleft {
                    let query = match (flags.onplayerjoined, flags.onplayerleft) {
                        (true, false) => "AND type = 'OnPlayerJoined'",
                        (false, true) => "AND type = 'OnPlayerLeft'",
                        _ => "",
                    };
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, type, display_name, location, user_id, time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_join_leave WHERE ((display_name LIKE @search_like OR user_id LIKE @search_like) AND user_id != @current_user_id) {vip_query} {query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.portalspawn {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'PortalSpawn' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, world_name, NULL AS group_name, instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_portal_spawn WHERE (display_name LIKE @search_like OR user_id LIKE @search_like OR world_name LIKE @search_like) {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.event {
                    selects.push(
                        "SELECT * FROM (SELECT id, created_at, 'Event' AS type, NULL AS display_name, NULL AS location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, data, NULL AS message FROM gamelog_event WHERE data LIKE @search_like ORDER BY id DESC LIMIT @per_table)".to_string()
                    );
                }
                if flags.external {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'External' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, message FROM gamelog_external WHERE (display_name LIKE @search_like OR user_id LIKE @search_like OR message LIKE @search_like) {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.videoplay {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'VideoPlay' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, video_url, video_name, video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_video_play WHERE (video_url LIKE @search_like OR video_name LIKE @search_like OR display_name LIKE @search_like OR user_id LIKE @search_like) {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.stringload || flags.imageload {
                    let check_string = if flags.stringload {
                        ""
                    } else {
                        "AND resource_type != 'StringLoad'"
                    };
                    let check_image = if flags.imageload {
                        ""
                    } else {
                        "AND resource_type != 'ImageLoad'"
                    };
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, resource_type AS type, NULL AS display_name, location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, resource_url, resource_type, NULL AS data, NULL AS message FROM gamelog_resource_load WHERE resource_url LIKE @search_like {check_string} {check_image} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
            }

            if selects.is_empty() {
                return Ok(Value::Array(Vec::new()));
            }
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        &format!(
                            "SELECT {} FROM ({}) ORDER BY created_at DESC, id DESC LIMIT @limit",
                            game_log_base_columns(include_extra),
                            selects.join(" UNION ALL ")
                        ),
                        &db_params,
                    )?
                    .into_iter()
                    .map(|row| game_log_row_from_unified_row(&row))
                    .collect(),
            ))
        }
        "lastVisit" => {
            let world_id = query_param_string(&params, "worldId");
            let count = if query_param_bool(&params, "currentWorldMatch") {
                2
            } else {
                1
            };
            let row = state
                .db
                .execute(
                    "SELECT created_at, world_id FROM gamelog_location WHERE world_id = @world_id ORDER BY id DESC LIMIT @count",
                    &ParamsBuilder::new()
                        .set("world_id", world_id)
                        .set("count", count)
                        .build(),
                )?
                .last()
                .cloned();
            Ok(row
                .map(|row| json!({ "created_at": row_json(&row, 0), "worldId": row_json(&row, 1) }))
                .unwrap_or_else(|| json!({ "created_at": "", "worldId": "" })))
        }
        "visitCount" => {
            let world_id = query_param_string(&params, "worldId");
            let count = state
                .db
                .execute(
                    "SELECT COUNT(DISTINCT location) FROM gamelog_location WHERE world_id = @world_id",
                    &ParamsBuilder::new().set("world_id", world_id.clone()).build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(json!({ "visitCount": count, "worldId": world_id }))
        }
        "timeSpentInWorld" => {
            let world_id = query_param_string(&params, "worldId");
            let time_spent = state
                .db
                .execute(
                    "SELECT COALESCE(SUM(time), 0) FROM gamelog_location WHERE world_id = @world_id",
                    &ParamsBuilder::new().set("world_id", world_id.clone()).build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(json!({ "timeSpent": time_spent, "worldId": world_id }))
        }
        "lastGroupVisit" => {
            let group_id = query_param_string(&params, "groupId");
            let created_at = state
                .db
                .execute(
                    "SELECT created_at FROM gamelog_location WHERE location LIKE @group_id ORDER BY id DESC LIMIT 1",
                    &ParamsBuilder::new()
                        .set("group_id", format!("%{group_id}%"))
                        .build(),
                )?
                .first()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            Ok(json!({ "created_at": created_at }))
        }
        "previousInstancesByGroupId" => {
            let group_id = query_param_string(&params, "groupId");
            let mut by_location = HashMap::<String, Value>::new();
            let mut location_order = Vec::<String>::new();
            for row in state.db.execute(
                "SELECT created_at, location, time, world_name, group_name
                 FROM gamelog_location
                 WHERE location LIKE @group_id
                 ORDER BY id DESC",
                &ParamsBuilder::new()
                    .set("group_id", format!("%{group_id}%"))
                    .build(),
            )? {
                let location = row_string(&row, 1);
                if !by_location.contains_key(&location) {
                    location_order.push(location.clone());
                }
                let time = row_i64(&row, 2)
                    + by_location
                        .get(&location)
                        .and_then(|value| value.get("time"))
                        .map(value_as_i64)
                        .unwrap_or(0);
                by_location.insert(
                    location.clone(),
                    json!({
                        "created_at": row_json(&row, 0),
                        "location": location,
                        "time": time,
                        "worldName": row_json(&row, 3),
                        "groupName": row_json(&row, 4)
                    }),
                );
            }
            Ok(Value::Array(
                location_order
                    .into_iter()
                    .filter_map(|location| by_location.remove(&location))
                    .collect(),
            ))
        }
        "lastSeen" => {
            let user_id = query_param_string(&params, "userId");
            let display_name = query_param_string(&params, "displayName");
            let count = if query_param_bool(&params, "inCurrentWorld") {
                2
            } else {
                1
            };
            let row = state
                .db
                .execute(
                    "SELECT created_at, user_id FROM gamelog_join_leave WHERE user_id = @user_id OR display_name = @display_name ORDER BY id DESC LIMIT @count",
                    &ParamsBuilder::new()
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name)
                        .set("count", count)
                        .build(),
                )?
                .last()
                .cloned();
            Ok(row
                .map(|row| {
                    let row_user_id = row_string(&row, 1);
                    json!({
                        "created_at": row_json(&row, 0),
                        "userId": if row_user_id.is_empty() { user_id } else { row_user_id }
                    })
                })
                .unwrap_or_else(|| json!({ "created_at": "", "userId": "" })))
        }
        "joinCount" => {
            let user_id = query_param_string(&params, "userId");
            let display_name = query_param_string(&params, "displayName");
            let count = state
                .db
                .execute(
                    "SELECT COUNT(DISTINCT location) FROM gamelog_join_leave WHERE (type = 'OnPlayerJoined') AND (user_id = @user_id OR display_name = @display_name)",
                    &ParamsBuilder::new()
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name)
                        .build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(json!({ "joinCount": count, "userId": user_id }))
        }
        "timeSpent" => {
            let user_id = query_param_string(&params, "userId");
            let display_name = query_param_string(&params, "displayName");
            let time_spent = state
                .db
                .execute(
                    "SELECT COALESCE(SUM(time), 0)
                     FROM gamelog_join_leave
                     WHERE type = 'OnPlayerLeft'
                       AND (user_id = @user_id OR display_name = @display_name)",
                    &ParamsBuilder::new()
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name)
                        .build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(json!({ "timeSpent": time_spent, "userId": user_id }))
        }
        "userStats" => {
            let user_id = query_param_string(&params, "userId");
            let display_name = query_param_string(&params, "displayName");
            let count = if query_param_bool(&params, "inCurrentWorld") {
                2
            } else {
                1
            };
            let last_seen = state
                .db
                .execute(
                    "SELECT created_at FROM gamelog_join_leave WHERE user_id = @user_id OR display_name = @display_name ORDER BY id DESC LIMIT @count",
                    &ParamsBuilder::new()
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name.clone())
                        .set("count", count)
                        .build(),
                )?
                .last()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            let stats = state
                .db
                .execute(
                    "SELECT
                        COALESCE(SUM(CASE WHEN type = 'OnPlayerLeft' THEN time ELSE 0 END), 0),
                        COUNT(DISTINCT NULLIF(location, ''))
                     FROM gamelog_join_leave
                     WHERE user_id = @user_id OR display_name = @display_name",
                    &ParamsBuilder::new()
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name.clone())
                        .build(),
                )?
                .first()
                .cloned();
            let mut previous_names = Vec::new();
            for row in state.db.execute(
                "SELECT display_name, MAX(created_at)
                 FROM gamelog_join_leave
                 WHERE user_id = @user_id
                   AND display_name != ''
                   AND display_name != @display_name
                 GROUP BY display_name
                 ORDER BY MAX(created_at) DESC",
                &ParamsBuilder::new()
                    .set("user_id", user_id.clone())
                    .set("display_name", display_name)
                    .build(),
            )? {
                previous_names.push(json!({
                    "displayName": row_json(&row, 0),
                    "created_at": row_json(&row, 1)
                }));
            }
            Ok(json!({
                "timeSpent": stats.as_ref().map(|row| row_i64(row, 0)).unwrap_or(0),
                "lastSeen": last_seen,
                "joinCount": stats.as_ref().map(|row| row_i64(row, 1)).unwrap_or(0),
                "userId": user_id,
                "previousDisplayNames": previous_names
            }))
        }
        "allUserStats" => {
            let user_ids = query_param_string_array(&params, "userIds");
            let display_names = query_param_string_array(&params, "displayNames");
            if user_ids.is_empty() && display_names.is_empty() {
                return Ok(Value::Array(Vec::new()));
            }
            let mut db_params = HashMap::new();
            let mut clauses = Vec::new();
            let user_placeholders = add_list_params(&mut db_params, &user_ids, "stat_user_id");
            if !user_placeholders.is_empty() {
                clauses.push(format!("g.user_id IN ({})", user_placeholders.join(", ")));
            }
            let name_placeholders =
                add_list_params(&mut db_params, &display_names, "stat_display_name");
            if !name_placeholders.is_empty() {
                clauses.push(format!(
                    "g.display_name IN ({})",
                    name_placeholders.join(", ")
                ));
            }
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        &format!(
                            "SELECT
                                g.created_at,
                                g.user_id,
                                SUM(g.time) AS timeSpent,
                                COUNT(DISTINCT g.location) AS joinCount,
                                g.display_name,
                                MAX(g.id) AS max_id
                            FROM
                                gamelog_join_leave g
                            WHERE
                                {}
                            GROUP BY
                                g.user_id,
                                g.display_name
                            ORDER BY
                                g.user_id DESC",
                            clauses.join("\n                OR ")
                        ),
                        &db_params,
                    )?
                    .into_iter()
                    .map(|row| {
                        json!({
                            "lastSeen": row_json(&row, 0),
                            "userId": row_json(&row, 1),
                            "timeSpent": row_json(&row, 2),
                            "joinCount": row_json(&row, 3),
                            "displayName": row_json(&row, 4)
                        })
                    })
                    .collect(),
            ))
        }
        "lastDate" => {
            let mut dates = Vec::new();
            for table in [
                "gamelog_location",
                "gamelog_join_leave",
                "gamelog_portal_spawn",
                "gamelog_event",
                "gamelog_video_play",
                "gamelog_resource_load",
            ] {
                if let Some(date) = state
                    .db
                    .execute(
                        &format!("SELECT created_at FROM {table} ORDER BY id DESC LIMIT 1"),
                        &Default::default(),
                    )?
                    .first()
                    .map(|row| row_string(row, 0))
                    .filter(|value| !value.is_empty())
                {
                    dates.push(date);
                }
            }
            dates.sort();
            Ok(Value::String(dates.pop().unwrap_or_default()))
        }
        "previousInstancesByUserIdRows" => {
            let user_id = query_param_string(&params, "userId");
            if user_id.is_empty() {
                return Ok(Value::Array(Vec::new()));
            }
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        "WITH grouped_locations AS (
                            SELECT DISTINCT location, world_name, group_name
                            FROM gamelog_location
                        )
                        SELECT gamelog_join_leave.created_at,
                               strftime('%s', gamelog_join_leave.created_at) * 1000 created_at_ts,
                               gamelog_join_leave.location,
                               gamelog_join_leave.time,
                               grouped_locations.world_name,
                               grouped_locations.group_name,
                               gamelog_join_leave.id,
                               gamelog_join_leave.type
                        FROM gamelog_join_leave
                        INNER JOIN grouped_locations ON gamelog_join_leave.location = grouped_locations.location
                        WHERE user_id = @user_id
                        ORDER BY gamelog_join_leave.id ASC",
                        &ParamsBuilder::new().set("user_id", user_id).build(),
                    )?
                    .into_iter()
                    .map(|row| {
                        json!({
                            "created_at": row_json(&row, 0),
                            "createdAtTs": row_json(&row, 1),
                            "location": row_json(&row, 2),
                            "time": row_json(&row, 3),
                            "worldName": row_json(&row, 4),
                            "groupName": row_json(&row, 5),
                            "eventId": row_json(&row, 6),
                            "eventType": row_json(&row, 7)
                        })
                    })
                    .collect(),
            ))
        }
        "previousInstancesByWorldId" => {
            let world_id = query_param_string(&params, "worldId");
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        "SELECT id, created_at, location, time, world_name, group_name
                         FROM gamelog_location
                         WHERE world_id = @world_id
                         ORDER BY id DESC",
                        &ParamsBuilder::new().set("world_id", world_id).build(),
                    )?
                    .into_iter()
                    .map(|row| {
                        json!({
                            "id": row_json(&row, 0),
                            "created_at": row_json(&row, 1),
                            "location": row_json(&row, 2),
                            "time": row_i64(&row, 3),
                            "worldName": row_json(&row, 4),
                            "groupName": row_json(&row, 5)
                        })
                    })
                    .collect(),
            ))
        }
        "playersFromInstanceRows" => {
            let location = query_param_string(&params, "location");
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        "SELECT id, created_at, display_name, user_id, time, type FROM gamelog_join_leave WHERE location = @location ORDER BY id ASC",
                        &ParamsBuilder::new().set("location", location).build(),
                    )?
                    .into_iter()
                    .map(|row| {
                        json!({
                            "rowId": row_json(&row, 0),
                            "created_at": row_json(&row, 1),
                            "displayName": row_json(&row, 2),
                            "userId": row_json(&row, 3),
                            "time": row_i64(&row, 4),
                            "type": row_json(&row, 5)
                        })
                    })
                    .collect(),
            ))
        }
        "locationBeforeOrAt" => {
            let created_at = query_param_string(&params, "createdAt");
            let row = state
                .db
                .execute(
                    "SELECT created_at, location, world_id, world_name, group_name
                     FROM gamelog_location
                     WHERE created_at <= @created_at
                     ORDER BY created_at DESC
                     LIMIT 1",
                    &ParamsBuilder::new().set("created_at", created_at).build(),
                )?
                .first()
                .cloned();
            Ok(row
                .map(|row| {
                    json!({
                        "created_at": row_json(&row, 0),
                        "location": row_json(&row, 1),
                        "worldId": row_json(&row, 2),
                        "worldName": row_json(&row, 3),
                        "groupName": row_json(&row, 4)
                    })
                })
                .unwrap_or(Value::Null))
        }
        "joinLeaveRange" => {
            let location = query_param_string(&params, "location");
            let after_date = query_param_string(&params, "afterDate");
            let before_date = query_param_string(&params, "beforeDate");
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        "SELECT created_at, type, display_name, user_id
                         FROM gamelog_join_leave
                         WHERE location = @location
                           AND created_at >= @after_date
                           AND created_at <= @before_date
                         ORDER BY created_at ASC",
                        &ParamsBuilder::new()
                            .set("location", location)
                            .set("after_date", after_date)
                            .set("before_date", before_date)
                            .build(),
                    )?
                    .into_iter()
                    .map(|row| {
                        json!({
                            "created_at": row_json(&row, 0),
                            "type": row_json(&row, 1),
                            "displayName": row_json(&row, 2),
                            "userId": row_json(&row, 3)
                        })
                    })
                    .collect(),
            ))
        }
        "playerDetailFromInstance" => {
            let location = query_param_string(&params, "location");
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        "SELECT created_at, display_name, user_id, time
                         FROM gamelog_join_leave
                         WHERE location = @location AND type = 'OnPlayerLeft'
                         ORDER BY created_at ASC",
                        &ParamsBuilder::new().set("location", location).build(),
                    )?
                    .into_iter()
                    .map(|row| {
                        json!({
                            "created_at": row_json(&row, 0),
                            "display_name": row_json(&row, 1),
                            "user_id": row_json(&row, 2),
                            "time": row_i64(&row, 3)
                        })
                    })
                    .collect(),
            ))
        }
        "previousDisplayNamesByUserId" => {
            let user_id = query_param_string(&params, "userId");
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        "SELECT created_at, display_name
                         FROM gamelog_join_leave
                         WHERE user_id = @user_id
                         ORDER BY id DESC",
                        &ParamsBuilder::new().set("user_id", user_id).build(),
                    )?
                    .into_iter()
                    .map(|row| {
                        json!({
                            "created_at": row_json(&row, 0),
                            "displayName": row_json(&row, 1)
                        })
                    })
                    .collect(),
            ))
        }
        "instanceTimes" => Ok(Value::Array(
            state
                .db
                .execute(
                    "SELECT location, time FROM gamelog_location",
                    &Default::default(),
                )?
                .into_iter()
                .map(|row| json!({ "location": row_json(&row, 0), "time": row_i64(&row, 1) }))
                .collect(),
        )),
        "onlineSessions" => {
            let from_date = query_param_string(&params, "fromDate");
            let to_date = query_param_string(&params, "toDate");
            let mut rows = Vec::new();
            if !from_date.is_empty() {
                if let Some(row) = state
                    .db
                    .execute(
                        "SELECT created_at, time FROM gamelog_location WHERE created_at < @from_date ORDER BY created_at DESC LIMIT 1",
                        &ParamsBuilder::new().set("from_date", from_date.clone()).build(),
                    )?
                    .first()
                    .cloned()
                {
                    rows.push(json!({ "created_at": row_json(&row, 0), "time": row_i64(&row, 1) }));
                }
            }
            let mut clauses = Vec::new();
            let mut db_params = HashMap::new();
            if !from_date.is_empty() {
                clauses.push("created_at >= @from_date");
                db_params.insert("@from_date".into(), Value::String(from_date));
            }
            if !to_date.is_empty() {
                clauses.push("created_at < @to_date");
                db_params.insert("@to_date".into(), Value::String(to_date));
            }
            let date_clause = if clauses.is_empty() {
                String::new()
            } else {
                format!("WHERE {}", clauses.join(" AND "))
            };
            for row in state.db.execute(
                &format!("SELECT created_at, time FROM gamelog_location {date_clause} ORDER BY created_at"),
                &db_params,
            )? {
                rows.push(json!({ "created_at": row_json(&row, 0), "time": row_i64(&row, 1) }));
            }
            Ok(Value::Array(rows))
        }
        "onlineSessionsAfter" => {
            let after = query_param_string(&params, "afterCreatedAt");
            let op = if query_param_bool(&params, "inclusive") {
                ">="
            } else {
                ">"
            };
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        &format!("SELECT created_at, time FROM gamelog_location WHERE created_at {op} @after ORDER BY created_at"),
                        &ParamsBuilder::new().set("after", after).build(),
                    )?
                    .into_iter()
                    .map(|row| json!({ "created_at": row_json(&row, 0), "time": row_i64(&row, 1) }))
                    .collect(),
            ))
        }
        "topWorlds" => {
            let days = query_param_i64(&params, "days", 0);
            let limit = query_param_i64(&params, "limit", 5);
            let sort_by = query_param_string(&params, "sortBy");
            let exclude_world_id = query_param_string(&params, "excludeWorldId");
            let where_clause = if days > 0 {
                "AND created_at >= datetime('now', @days_offset)"
            } else {
                ""
            };
            let exclude_clause = if exclude_world_id.is_empty() {
                ""
            } else {
                "AND world_id != @exclude_world_id"
            };
            let order_by = if sort_by == "count" {
                "visit_count DESC"
            } else {
                "total_time DESC"
            };
            let mut db_params = HashMap::new();
            db_params.insert("@limit".into(), Value::from(limit));
            if days > 0 {
                db_params.insert(
                    "@days_offset".into(),
                    Value::String(format!("-{days} days")),
                );
            }
            if !exclude_world_id.is_empty() {
                db_params.insert("@exclude_world_id".into(), Value::String(exclude_world_id));
            }
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        &format!(
                            "SELECT world_id, world_name, COUNT(*) AS visit_count, SUM(time) AS total_time
                             FROM gamelog_location
                             WHERE world_id IS NOT NULL
                               AND world_id != ''
                               AND world_id LIKE 'wrld_%'
                               {where_clause}
                               {exclude_clause}
                             GROUP BY world_id
                             ORDER BY {order_by}
                             LIMIT @limit"
                        ),
                        &db_params,
                    )?
                    .into_iter()
                    .map(|row| {
                        let world_id = row_string(&row, 0);
                        let world_name = row_string(&row, 1);
                        json!({
                            "worldId": world_id,
                            "worldName": if world_name.is_empty() { row_json(&row, 0) } else { row_json(&row, 1) },
                            "visitCount": row_json(&row, 2),
                            "totalTime": row_i64(&row, 3)
                        })
                    })
                    .collect(),
            ))
        }
        "instanceActivityRows" => {
            let start_date = query_param_string(&params, "startDate");
            let end_date = query_param_string(&params, "endDate");
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        "SELECT id, created_at, type, display_name, location, user_id, time
                         FROM gamelog_join_leave
                         WHERE type = 'OnPlayerLeft'
                           AND (
                             strftime('%Y-%m-%dT%H:%M:%SZ', created_at, '-' || (time * 1.0 / 1000) || ' seconds') BETWEEN @utc_start_date AND @utc_end_date
                             OR created_at BETWEEN @utc_start_date AND @utc_end_date
                           )",
                        &ParamsBuilder::new()
                            .set("utc_start_date", start_date)
                            .set("utc_end_date", end_date)
                            .build(),
                    )?
                    .into_iter()
                    .map(|row| {
                        json!({
                            "id": row_json(&row, 0),
                            "created_at": row_json(&row, 1),
                            "type": row_json(&row, 2),
                            "display_name": row_json(&row, 3),
                            "location": row_json(&row, 4),
                            "user_id": row_json(&row, 5),
                            "time": row_json(&row, 6)
                        })
                    })
                    .collect(),
            ))
        }
        "dateOfInstanceActivity" => {
            let user_id = query_param_string(&params, "userId");
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        "SELECT created_at FROM gamelog_join_leave WHERE user_id = @user_id",
                        &ParamsBuilder::new().set("user_id", user_id).build(),
                    )?
                    .into_iter()
                    .map(|row| row_json(&row, 0))
                    .collect(),
            ))
        }
        "instanceJoinHistory" => {
            let user_id = query_param_string(&params, "userId");
            let created_at = query_param_string(&params, "createdAt");
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        "SELECT created_at, location FROM gamelog_join_leave WHERE user_id = @user_id AND created_at > @created_at ORDER BY created_at DESC",
                        &ParamsBuilder::new()
                            .set("user_id", user_id)
                            .set("created_at", created_at)
                            .build(),
                    )?
                    .into_iter()
                    .map(|row| json!({ "created_at": row_json(&row, 0), "location": row_json(&row, 1) }))
                    .collect(),
            ))
        }
        "worldNameByWorldId" => {
            let world_id = query_param_string(&params, "worldId");
            let world_name = state
                .db
                .execute(
                    "SELECT world_name FROM gamelog_location WHERE world_id = @world_id ORDER BY id DESC LIMIT 1",
                    &ParamsBuilder::new().set("world_id", world_id).build(),
                )?
                .first()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            Ok(Value::String(world_name))
        }
        "userIdFromDisplayName" => {
            let display_name = query_param_string(&params, "displayName");
            let user_id = state
                .db
                .execute(
                    "SELECT user_id FROM gamelog_join_leave WHERE display_name = @display_name AND user_id != '' ORDER BY id DESC LIMIT 1",
                    &ParamsBuilder::new().set("display_name", display_name).build(),
                )?
                .first()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            Ok(Value::String(user_id))
        }
        "sessionsLocationSegments" => {
            let before_id = params
                .get("beforeId")
                .filter(|value| !value.is_null())
                .map(value_as_i64)
                .filter(|value| *value > 0);
            let limit = query_param_i64(&params, "limit", 100);
            let cursor_clause = if before_id.is_some() {
                "AND id < @before_id"
            } else {
                ""
            };
            let mut db_params = HashMap::new();
            db_params.insert("@limit".into(), Value::from(limit));
            if let Some(before_id) = before_id {
                db_params.insert("@before_id".into(), Value::from(before_id));
            }
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        &format!(
                            "SELECT id, created_at, location, world_id, world_name, time, group_name
                             FROM gamelog_location
                             WHERE 1=1 {cursor_clause}
                             ORDER BY id DESC
                             LIMIT @limit"
                        ),
                        &db_params,
                    )?
                    .into_iter()
                    .map(|row| game_log_location_segment_from_row(&row))
                    .collect(),
            ))
        }
        "sessionsLocationSegmentsByDateRange" => {
            let after_date = query_param_string(&params, "afterDate");
            let before_date = query_param_string(&params, "beforeDate");
            let limit = query_param_i64(&params, "limit", 100);
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        "SELECT id, created_at, location, world_id, world_name, time, group_name
                         FROM gamelog_location
                         WHERE created_at >= @after_date
                           AND created_at <= @before_date
                         ORDER BY id DESC
                         LIMIT @limit",
                        &ParamsBuilder::new()
                            .set("after_date", after_date)
                            .set("before_date", before_date)
                            .set("limit", limit)
                            .build(),
                    )?
                    .into_iter()
                    .map(|row| game_log_location_segment_from_row(&row))
                    .collect(),
            ))
        }
        "sessionsEventsForSegments" => {
            let location_tags = query_param_string_array(&params, "locationTags");
            if location_tags.is_empty() {
                return Ok(Value::Array(Vec::new()));
            }
            let after_date = query_param_string(&params, "afterDate");
            let before_date = query_param_string(&params, "beforeDate");
            let current_user_id = query_param_string(&params, "currentUserId");
            let mut db_params = HashMap::new();
            db_params.insert("@after_date".into(), Value::String(after_date));
            db_params.insert("@before_date".into(), Value::String(before_date));
            db_params.insert("@self_id".into(), Value::String(current_user_id));
            let placeholders = add_list_params(&mut db_params, &location_tags, "location_tag");
            let location_in = placeholders.join(", ");
            let mut rows = Vec::new();
            for row in state.db.execute(
                &format!(
                    "SELECT type, created_at, display_name, user_id, location
                     FROM gamelog_join_leave
                     WHERE location IN ({location_in})
                       AND user_id != @self_id
                       AND created_at >= @after_date
                       AND created_at <= @before_date
                     ORDER BY created_at ASC"
                ),
                &db_params,
            )? {
                rows.push(json!({
                    "type": row_json(&row, 0),
                    "created_at": row_json(&row, 1),
                    "displayName": row_json(&row, 2),
                    "userId": row_json(&row, 3),
                    "location": row_json(&row, 4)
                }));
            }
            for row in state.db.execute(
                &format!(
                    "SELECT created_at, video_url, video_name, video_id, display_name, user_id, location
                     FROM gamelog_video_play
                     WHERE location IN ({location_in})
                       AND created_at >= @after_date
                       AND created_at <= @before_date
                     ORDER BY created_at ASC"
                ),
                &db_params,
            )? {
                rows.push(json!({
                    "type": "VideoPlay",
                    "created_at": row_json(&row, 0),
                    "videoUrl": row_json(&row, 1),
                    "videoName": row_json(&row, 2),
                    "videoId": row_json(&row, 3),
                    "displayName": row_json(&row, 4),
                    "userId": row_json(&row, 5),
                    "location": row_json(&row, 6)
                }));
            }
            Ok(Value::Array(rows))
        }
        "sessionsLocationSegmentsByAnchor" => {
            let since_date = query_param_string(&params, "sinceDate");
            let limit = query_param_i64(&params, "limit", 100);
            Ok(Value::Array(
                state
                    .db
                    .execute(
                        "SELECT id, created_at, location, world_id, world_name, time, group_name
                         FROM gamelog_location
                         WHERE created_at >= @since_date
                         ORDER BY id DESC
                         LIMIT @limit",
                        &ParamsBuilder::new()
                            .set("since_date", since_date)
                            .set("limit", limit)
                            .build(),
                    )?
                    .into_iter()
                    .map(|row| game_log_location_segment_from_row(&row))
                    .collect(),
            ))
        }
        _ => Err(AppError::Custom(format!(
            "Unknown game log query: {}",
            query.kind
        ))),
    }
}

#[tauri::command]
pub fn app__player_list_location_get(
    state: State<'_, AppState>,
    location: String,
) -> Result<Option<PlayerLocationOutput>, AppError> {
    ensure_game_log_tables(&state.db)?;
    let location = normalize_text(location);
    if location.is_empty() {
        return Ok(None);
    }
    Ok(state
        .db
        .execute(
            "SELECT created_at, location, world_id, world_name, time, group_name
             FROM gamelog_location
             WHERE location = @location
             ORDER BY id DESC
             LIMIT 1",
            &ParamsBuilder::new().set("location", location).build(),
        )?
        .first()
        .map(|row| player_location_from_row(row)))
}

#[tauri::command]
pub fn app__player_list_latest_location_get(
    state: State<'_, AppState>,
) -> Result<Option<PlayerLocationOutput>, AppError> {
    ensure_game_log_tables(&state.db)?;
    Ok(state
        .db
        .execute(
            "SELECT created_at, location, world_id, world_name, time, group_name
             FROM gamelog_location
             ORDER BY id DESC
             LIMIT 1",
            &Default::default(),
        )?
        .first()
        .map(|row| player_location_from_row(row)))
}

#[tauri::command]
pub fn app__player_list_join_leave_rows(
    state: State<'_, AppState>,
    location: String,
    started_at: String,
) -> Result<Vec<PlayerJoinLeaveOutput>, AppError> {
    ensure_game_log_tables(&state.db)?;
    Ok(state
        .db
        .execute(
            "SELECT id, created_at, type, display_name, user_id, time
             FROM gamelog_join_leave
             WHERE location = @location
               AND (@started_at = '' OR created_at >= @started_at)
             ORDER BY id ASC",
            &ParamsBuilder::new()
                .set("location", normalize_text(location))
                .set("started_at", normalize_text(started_at))
                .build(),
        )?
        .into_iter()
        .map(|row| player_join_leave_from_row(&row))
        .collect())
}

#[tauri::command]
pub fn app__instance_activity_dates_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Vec<String>, AppError> {
    ensure_game_log_tables(&state.db)?;
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }
    Ok(state
        .db
        .execute(
            "SELECT created_at
             FROM gamelog_join_leave
             WHERE user_id = @user_id
             ORDER BY created_at DESC",
            &ParamsBuilder::new().set("user_id", user_id).build(),
        )?
        .into_iter()
        .map(|row| row_string(&row, 0))
        .filter(|created_at| !created_at.is_empty())
        .collect())
}

#[tauri::command]
pub fn app__instance_activity_rows_get(
    state: State<'_, AppState>,
    start_date: String,
    end_date: String,
) -> Result<Vec<InstanceActivityRowOutput>, AppError> {
    ensure_game_log_tables(&state.db)?;
    Ok(state
        .db
        .execute(
            "SELECT id, created_at, type, display_name, location, user_id, time
             FROM gamelog_join_leave
             WHERE type = 'OnPlayerLeft'
               AND (
                 strftime('%Y-%m-%dT%H:%M:%SZ', created_at, '-' || (time * 1.0 / 1000) || ' seconds')
                    BETWEEN @utc_start_date AND @utc_end_date
                 OR created_at BETWEEN @utc_start_date AND @utc_end_date
               )
             ORDER BY created_at ASC, id ASC",
            &ParamsBuilder::new()
                .set("utc_start_date", start_date)
                .set("utc_end_date", end_date)
                .build(),
        )?
        .into_iter()
        .map(|row| instance_activity_from_row(&row))
        .filter(|row| !is_traveling_location(&row.location))
        .collect())
}

fn empty_world_summary(id: String, name: String) -> WorldSummaryOutput {
    WorldSummaryOutput {
        id,
        author_id: String::new(),
        author_name: String::new(),
        created_at: String::new(),
        description: String::new(),
        image_url: String::new(),
        name,
        release_status: String::new(),
        thumbnail_image_url: String::new(),
        updated_at: String::new(),
        version: 0,
    }
}

#[tauri::command]
pub fn app__world_summaries_get(
    state: State<'_, AppState>,
    world_ids: Vec<String>,
) -> Result<HashMap<String, WorldSummaryOutput>, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    ensure_game_log_tables(&state.db)?;
    let world_ids = world_ids
        .into_iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if world_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let mut params = ParamsBuilder::new();
    let mut placeholders = Vec::with_capacity(world_ids.len());
    for (index, world_id) in world_ids.iter().enumerate() {
        let key = format!("world_id_{index}");
        params = params.set(&key, world_id.clone());
        placeholders.push(format!("@{key}"));
    }
    let params = params.build();
    let in_clause = placeholders.join(", ");

    let mut summaries = HashMap::new();
    for row in state.db.execute(
        &format!(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version
             FROM cache_world
             WHERE id IN ({in_clause})"
        ),
        &params,
    )? {
        let world = world_summary_from_row(&row);
        if !world.id.is_empty() {
            summaries.insert(world.id.clone(), world);
        }
    }

    for row in state.db.execute(
        &format!(
            "SELECT gl.world_id, gl.world_name
             FROM gamelog_location gl
             INNER JOIN (
                 SELECT world_id, MAX(id) AS max_id
                 FROM gamelog_location
                 WHERE world_id IN ({in_clause})
                   AND world_name IS NOT NULL
                   AND world_name != ''
                 GROUP BY world_id
             ) latest
                 ON latest.world_id = gl.world_id
                AND latest.max_id = gl.id"
        ),
        &params,
    )? {
        let world_id = row_string(&row, 0);
        let world_name = row_string(&row, 1);
        if world_id.is_empty() || world_name.is_empty() {
            continue;
        }
        if summaries
            .get(&world_id)
            .is_some_and(|world| !world.name.is_empty())
        {
            continue;
        }
        summaries.insert(world_id.clone(), empty_world_summary(world_id, world_name));
    }

    Ok(summaries)
}

#[tauri::command]
pub fn app__activity_self_source_slice(
    state: State<'_, AppState>,
    query: ActivitySelfSourceSliceInput,
) -> Result<Vec<ActivitySourceLocationOutput>, AppError> {
    ensure_game_log_tables(&state.db)?;
    let from_date = normalize_text(query.from_date_iso);
    let to_date = normalize_text(query.to_date_iso);
    let to_filter = if to_date.is_empty() {
        ""
    } else {
        "AND created_at < @to_date_iso"
    };
    let to_tail = if to_date.is_empty() {
        String::new()
    } else {
        "UNION ALL
         SELECT created_at, time, 2 AS sort_group
         FROM (
             SELECT created_at, time
             FROM gamelog_location
             WHERE created_at >= @to_date_iso
             ORDER BY created_at
             LIMIT 1
         )"
        .to_string()
    };
    let mut db_params = HashMap::new();
    db_params.insert("@from_date_iso".into(), Value::String(from_date));
    db_params.insert("@to_date_iso".into(), Value::String(to_date));
    Ok(state
        .db
        .execute(
            &format!(
                "SELECT created_at, time
                 FROM (
                     SELECT created_at, time, 0 AS sort_group
                     FROM (
                         SELECT created_at, time
                         FROM gamelog_location
                         WHERE created_at < @from_date_iso
                         ORDER BY created_at DESC
                         LIMIT 1
                     )
                     UNION ALL
                     SELECT created_at, time, 1 AS sort_group
                     FROM gamelog_location
                     WHERE created_at >= @from_date_iso
                       {to_filter}
                     {to_tail}
                 )
                 ORDER BY created_at ASC, sort_group ASC"
            ),
            &db_params,
        )?
        .into_iter()
        .map(|row| activity_location_from_row(&row))
        .collect())
}

#[tauri::command]
pub fn app__activity_self_source_after(
    state: State<'_, AppState>,
    query: ActivitySelfSourceAfterInput,
) -> Result<Vec<ActivitySourceLocationOutput>, AppError> {
    ensure_game_log_tables(&state.db)?;
    let op = if query.inclusive { ">=" } else { ">" };
    Ok(state
        .db
        .execute(
            &format!(
                "SELECT created_at, time
                 FROM gamelog_location
                 WHERE created_at {op} @after_created_at
                 ORDER BY created_at"
            ),
            &ParamsBuilder::new()
                .set("after_created_at", normalize_text(query.after_created_at))
                .build(),
        )?
        .into_iter()
        .map(|row| activity_location_from_row(&row))
        .collect())
}

#[tauri::command]
pub fn app__activity_friend_presence_slice(
    state: State<'_, AppState>,
    query: ActivityFriendPresenceSliceInput,
) -> Result<Vec<ActivityPresenceOutput>, AppError> {
    let owner_user_id = normalize_text(query.owner_user_id);
    let user_id = normalize_text(query.user_id);
    if owner_user_id.is_empty() || user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    let table_name = format!("{user_prefix}_feed_online_offline");
    let to_date = normalize_text(query.to_date_iso);
    let to_filter = if to_date.is_empty() {
        ""
    } else {
        "AND created_at < @to_date_iso"
    };
    let mut db_params = HashMap::new();
    db_params.insert("@user_id".into(), Value::String(user_id.clone()));
    db_params.insert(
        "@from_date_iso".into(),
        Value::String(normalize_text(query.from_date_iso)),
    );
    db_params.insert("@to_date_iso".into(), Value::String(to_date.clone()));
    let mut rows: Vec<ActivityPresenceOutput> = state
        .db
        .execute(
            &format!(
                "SELECT created_at, type
                 FROM (
                     SELECT created_at, type, 0 AS sort_group
                     FROM (
                         SELECT created_at, type
                         FROM {table_name}
                         WHERE user_id = @user_id
                           AND (type = 'Online' OR type = 'Offline')
                           AND created_at < @from_date_iso
                         ORDER BY created_at DESC
                         LIMIT 1
                     )
                     UNION ALL
                     SELECT created_at, type, 1 AS sort_group
                     FROM {table_name}
                     WHERE user_id = @user_id
                       AND (type = 'Online' OR type = 'Offline')
                       AND created_at >= @from_date_iso
                       {to_filter}
                 )
                 ORDER BY created_at ASC, sort_group ASC"
            ),
            &db_params,
        )?
        .into_iter()
        .map(|row| activity_presence_from_row(&row))
        .collect();
    if !to_date.is_empty() {
        rows.extend(
            state
                .db
                .execute(
                    &format!(
                        "SELECT created_at, type
                         FROM {table_name}
                         WHERE user_id = @user_id
                           AND (type = 'Online' OR type = 'Offline')
                           AND created_at >= @to_date_iso
                         ORDER BY created_at ASC
                         LIMIT 1"
                    ),
                    &db_params,
                )?
                .into_iter()
                .map(|row| activity_presence_from_row(&row)),
        );
        rows.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    }
    Ok(rows)
}

#[tauri::command]
pub fn app__activity_friend_presence_after(
    state: State<'_, AppState>,
    query: ActivityFriendPresenceAfterInput,
) -> Result<Vec<ActivityPresenceOutput>, AppError> {
    let owner_user_id = normalize_text(query.owner_user_id);
    let user_id = normalize_text(query.user_id);
    if owner_user_id.is_empty() || user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    Ok(state
        .db
        .execute(
            &format!(
                "SELECT created_at, type
                 FROM {user_prefix}_feed_online_offline
                 WHERE user_id = @user_id
                   AND (type = 'Online' OR type = 'Offline')
                   AND created_at > @after_created_at
                 ORDER BY created_at"
            ),
            &ParamsBuilder::new()
                .set("user_id", user_id)
                .set("after_created_at", normalize_text(query.after_created_at))
                .build(),
        )?
        .into_iter()
        .map(|row| activity_presence_from_row(&row))
        .collect())
}

#[tauri::command]
pub fn app__activity_sync_state_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Option<ActivitySyncStateOutput>, AppError> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(None);
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    Ok(state
        .db
        .execute(
            &format!("SELECT user_id, updated_at, is_self, source_last_created_at, pending_session_start_at, cached_range_days FROM {user_prefix}_activity_sync_state_v2 WHERE user_id = @user_id LIMIT 1"),
            &ParamsBuilder::new().set("user_id", user_id.clone()).build(),
        )?
        .first()
        .map(|row| ActivitySyncStateOutput {
            user_id: row_string(row, 0),
            updated_at: row_string(row, 1),
            is_self: row_i64(row, 2) != 0,
            source_last_created_at: row_string(row, 3),
            pending_session_start_at: row_json(row, 4),
            cached_range_days: row_i64(row, 5),
        }))
}

#[tauri::command]
pub fn app__activity_sessions_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Vec<ActivitySessionOutput>, AppError> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    Ok(state
        .db
        .execute(
            &format!("SELECT start_at, end_at, is_open_tail, source_revision FROM {user_prefix}_activity_sessions_v2 WHERE user_id = @user_id ORDER BY start_at"),
            &ParamsBuilder::new().set("user_id", user_id).build(),
        )?
        .into_iter()
        .map(|row| activity_session_from_row(&row))
        .collect())
}

#[tauri::command]
pub fn app__activity_bucket_cache_get(
    state: State<'_, AppState>,
    query: ActivityBucketCacheQueryInput,
) -> Result<Option<ActivityBucketCacheOutput>, AppError> {
    let owner_user_id = normalize_text(query.owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(None);
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    let target_user_id = normalize_text(query.target_user_id);
    let range_days = value_as_i64(&query.range_days);
    let view_kind = normalize_text(query.view_kind);
    let exclude_key = normalize_text(query.exclude_key);
    Ok(state
        .db
        .execute(
            &format!("SELECT user_id, target_user_id, range_days, view_kind, exclude_key, bucket_version, built_from_cursor, raw_buckets_json, normalized_buckets_json, summary_json, built_at FROM {user_prefix}_activity_bucket_cache_v2 WHERE user_id = @owner_user_id AND target_user_id = @target_user_id AND range_days = @range_days AND view_kind = @view_kind AND exclude_key = @exclude_key LIMIT 1"),
            &ParamsBuilder::new()
                .set("owner_user_id", owner_user_id)
                .set("target_user_id", target_user_id)
                .set("range_days", range_days)
                .set("view_kind", view_kind)
                .set("exclude_key", exclude_key)
                .build(),
        )?
        .first()
        .map(|row| ActivityBucketCacheOutput {
            owner_user_id: row_string(row, 0),
            target_user_id: row_string(row, 1),
            range_days: row_i64(row, 2),
            view_kind: row_string(row, 3),
            exclude_key: row_string(row, 4),
            bucket_version: row_i64(row, 5),
            built_from_cursor: row_string(row, 6),
            raw_buckets: parse_json_value(row_value(row, 7), Value::Array(Vec::new())),
            normalized_buckets: parse_json_value(row_value(row, 8), Value::Array(Vec::new())),
            summary: parse_json_value(row_value(row, 9), json!({})),
            built_at: row_string(row, 10),
        }))
}

#[tauri::command]
pub fn app__activity_sync_state_upsert(
    state: State<'_, AppState>,
    entry: ActivitySyncStateInput,
) -> Result<(), AppError> {
    let user_id = normalize_text(&entry.user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    state.db.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_activity_sync_state_v2 (user_id, updated_at, is_self, source_last_created_at, pending_session_start_at, cached_range_days) VALUES (@user_id, @updated_at, @is_self, @source_last_created_at, @pending_session_start_at, @cached_range_days)"),
        &ParamsBuilder::new()
            .set("user_id", user_id)
            .set("updated_at", entry.updated_at)
            .set("is_self", if entry.is_self { 1 } else { 0 })
            .set("source_last_created_at", entry.source_last_created_at)
            .set("pending_session_start_at", entry.pending_session_start_at.unwrap_or(Value::Null))
            .set("cached_range_days", value_as_i64(&entry.cached_range_days))
            .build(),
    )?;
    Ok(())
}

fn insert_activity_sessions(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    user_id: &str,
    sessions: &[ActivitySessionInput],
) -> Result<(), vrcx_0_persistence::Error> {
    for session in sessions {
        tx.execute_non_query(
            &format!("INSERT OR REPLACE INTO {user_prefix}_activity_sessions_v2 (user_id, start_at, end_at, is_open_tail, source_revision) VALUES (@user_id, @start_at, @end_at, @is_open_tail, @source_revision)"),
            &ParamsBuilder::new()
                .set("user_id", user_id.to_string())
                .set("start_at", value_as_i64(&session.start))
                .set("end_at", value_as_i64(&session.end))
                .set("is_open_tail", if session.is_open_tail { 1 } else { 0 })
                .set("source_revision", session.source_revision.clone())
                .build(),
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn app__activity_sessions_replace(
    state: State<'_, AppState>,
    user_id: String,
    sessions: Vec<ActivitySessionInput>,
) -> Result<(), AppError> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    state.db.write_transaction(|tx| {
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_activity_sessions_v2 WHERE user_id = @user_id"),
            &ParamsBuilder::new().set("user_id", user_id.clone()).build(),
        )?;
        insert_activity_sessions(tx, &user_prefix, &user_id, &sessions)?;
        Ok(())
    })?;
    Ok(())
}

#[tauri::command]
pub fn app__activity_sessions_append(
    state: State<'_, AppState>,
    user_id: String,
    sessions: Vec<ActivitySessionInput>,
    replace_from_start_at: Option<i64>,
) -> Result<(), AppError> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    state.db.write_transaction(|tx| {
        if let Some(replace_from_start_at) = replace_from_start_at {
            tx.execute_non_query(
                &format!("DELETE FROM {user_prefix}_activity_sessions_v2 WHERE user_id = @user_id AND start_at >= @replace_from_start_at"),
                &ParamsBuilder::new()
                    .set("user_id", user_id.clone())
                    .set("replace_from_start_at", replace_from_start_at)
                    .build(),
            )?;
        }
        insert_activity_sessions(tx, &user_prefix, &user_id, &sessions)?;
        Ok(())
    })?;
    Ok(())
}

#[tauri::command]
pub fn app__activity_bucket_cache_upsert(
    state: State<'_, AppState>,
    entry: ActivityBucketCacheInput,
) -> Result<(), AppError> {
    let owner_user_id = normalize_text(&entry.owner_user_id);
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    state.db.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_activity_bucket_cache_v2 (user_id, target_user_id, range_days, view_kind, exclude_key, bucket_version, built_from_cursor, raw_buckets_json, normalized_buckets_json, summary_json, built_at) VALUES (@owner_user_id, @target_user_id, @range_days, @view_kind, @exclude_key, @bucket_version, @built_from_cursor, @raw_buckets_json, @normalized_buckets_json, @summary_json, @built_at)"),
        &ParamsBuilder::new()
            .set("owner_user_id", owner_user_id)
            .set("target_user_id", normalize_text(entry.target_user_id))
            .set("range_days", value_as_i64(&entry.range_days))
            .set("view_kind", normalize_text(entry.view_kind))
            .set("exclude_key", normalize_text(entry.exclude_key))
            .set("bucket_version", value_as_i64(&entry.bucket_version))
            .set("built_from_cursor", entry.built_from_cursor)
            .set("raw_buckets_json", entry.raw_buckets.to_string())
            .set("normalized_buckets_json", entry.normalized_buckets.to_string())
            .set("summary_json", entry.summary.to_string())
            .set("built_at", entry.built_at)
            .build(),
    )?;
    Ok(())
}

#[tauri::command]
pub fn app__mutual_graph_tables_ensure(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<UserTableContextOutput, AppError> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    Ok(UserTableContextOutput {
        user_id,
        user_prefix,
    })
}

#[tauri::command]
pub fn app__mutual_graph_snapshot_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<MutualGraphSnapshotOutput, AppError> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;

    let friend_ids = state
        .db
        .execute(
            &format!("SELECT friend_id FROM {user_prefix}_mutual_graph_friends"),
            &Default::default(),
        )?
        .into_iter()
        .map(|row| row_string(&row, 0))
        .filter(|friend_id| !friend_id.is_empty())
        .collect();
    let links = state
        .db
        .execute(
            &format!("SELECT friend_id, mutual_id FROM {user_prefix}_mutual_graph_links"),
            &Default::default(),
        )?
        .into_iter()
        .filter_map(|row| {
            let friend_id = row_string(&row, 0);
            let mutual_id = row_string(&row, 1);
            if friend_id.is_empty() || mutual_id.is_empty() {
                None
            } else {
                Some(MutualGraphLinkOutput {
                    friend_id,
                    mutual_id,
                })
            }
        })
        .collect();
    let meta = state
        .db
        .execute(
            &format!(
                "SELECT friend_id, last_fetched_at, opted_out FROM {user_prefix}_mutual_graph_meta"
            ),
            &Default::default(),
        )?
        .into_iter()
        .filter_map(|row| {
            let friend_id = row_string(&row, 0);
            if friend_id.is_empty() {
                None
            } else {
                Some(MutualGraphMetaOutput {
                    friend_id,
                    last_fetched_at: row_string(&row, 1),
                    opted_out: row_i64(&row, 2) == 1,
                })
            }
        })
        .collect();

    Ok(MutualGraphSnapshotOutput {
        friend_ids,
        links,
        meta,
    })
}

fn insert_mutual_graph_friend(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    friend_id: &str,
) -> Result<(), vrcx_0_persistence::Error> {
    tx.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_mutual_graph_friends (friend_id) VALUES (@friend_id)"),
        &ParamsBuilder::new().set("friend_id", friend_id.to_string()).build(),
    )?;
    Ok(())
}

fn insert_mutual_graph_link(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    friend_id: &str,
    mutual_id: &str,
) -> Result<(), vrcx_0_persistence::Error> {
    tx.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_mutual_graph_links (friend_id, mutual_id) VALUES (@friend_id, @mutual_id)"),
        &ParamsBuilder::new()
            .set("friend_id", friend_id.to_string())
            .set("mutual_id", mutual_id.to_string())
            .build(),
    )?;
    Ok(())
}

#[tauri::command]
pub fn app__mutual_graph_snapshot_save(
    state: State<'_, AppState>,
    user_id: String,
    entries: Vec<MutualGraphSnapshotEntryInput>,
) -> Result<(), AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    state.db.write_transaction(|tx| {
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_mutual_graph_links WHERE friend_id NOT IN (SELECT friend_id FROM {user_prefix}_mutual_graph_meta WHERE opted_out = 1)"),
            &Default::default(),
        )?;
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_mutual_graph_friends WHERE friend_id NOT IN (SELECT friend_id FROM {user_prefix}_mutual_graph_meta WHERE opted_out = 1)"),
            &Default::default(),
        )?;
        for entry in &entries {
            let friend_id = normalize_text(&entry.friend_id);
            if friend_id.is_empty() {
                continue;
            }
            tx.execute_non_query(
                &format!("DELETE FROM {user_prefix}_mutual_graph_links WHERE friend_id = @friend_id"),
                &ParamsBuilder::new().set("friend_id", friend_id.clone()).build(),
            )?;
            insert_mutual_graph_friend(tx, &user_prefix, &friend_id)?;
            for mutual_id in &entry.mutual_ids {
                let mutual_id = normalize_text(mutual_id);
                if !mutual_id.is_empty() {
                    insert_mutual_graph_link(tx, &user_prefix, &friend_id, &mutual_id)?;
                }
            }
        }
        Ok(())
    })?;
    Ok(())
}

#[tauri::command]
pub fn app__mutual_graph_friend_update(
    state: State<'_, AppState>,
    user_id: String,
    friend_id: String,
    mutual_ids: Vec<String>,
) -> Result<(), AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    let friend_id = normalize_text(friend_id);
    if friend_id.is_empty() {
        return Ok(());
    }
    state.db.write_transaction(|tx| {
        insert_mutual_graph_friend(tx, &user_prefix, &friend_id)?;
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_mutual_graph_links WHERE friend_id = @friend_id"),
            &ParamsBuilder::new()
                .set("friend_id", friend_id.clone())
                .build(),
        )?;
        for mutual_id in &mutual_ids {
            let mutual_id = normalize_text(mutual_id);
            if !mutual_id.is_empty() {
                insert_mutual_graph_link(tx, &user_prefix, &friend_id, &mutual_id)?;
            }
        }
        Ok(())
    })?;
    Ok(())
}

#[tauri::command]
pub fn app__mutual_graph_meta_upsert(
    state: State<'_, AppState>,
    user_id: String,
    entry: MutualGraphMetaInput,
) -> Result<(), AppError> {
    app__mutual_graph_meta_bulk_upsert(state, user_id, vec![entry])
}

#[tauri::command]
pub fn app__mutual_graph_meta_bulk_upsert(
    state: State<'_, AppState>,
    user_id: String,
    entries: Vec<MutualGraphMetaInput>,
) -> Result<(), AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    let now = now_iso();
    state.db.write_transaction(|tx| {
        for entry in &entries {
            let friend_id = normalize_text(&entry.friend_id);
            if friend_id.is_empty() {
                continue;
            }
            tx.execute_non_query(
                &format!("INSERT OR REPLACE INTO {user_prefix}_mutual_graph_meta (friend_id, last_fetched_at, opted_out) VALUES (@friend_id, @last_fetched_at, @opted_out)"),
                &ParamsBuilder::new()
                    .set("friend_id", friend_id)
                    .set(
                        "last_fetched_at",
                        if entry.last_fetched_at.trim().is_empty() {
                            now.clone()
                        } else {
                            entry.last_fetched_at.clone()
                        },
                    )
                    .set("opted_out", if entry.opted_out { 1 } else { 0 })
                    .build(),
            )?;
        }
        Ok(())
    })?;
    Ok(())
}

#[tauri::command]
pub fn app__world_cache_upsert(
    state: State<'_, AppState>,
    entry: CacheEntityInput,
) -> Result<i64, AppError> {
    upsert_cache_entity(&state.db, "cache_world", entry)
}

#[tauri::command]
pub fn app__world_cache_remove(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<(), AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let world_id = normalize_text(world_id);
    if world_id.is_empty() {
        return Ok(());
    }
    state.db.execute_non_query(
        "DELETE FROM cache_world WHERE id = @world_id",
        &ParamsBuilder::new().set("world_id", world_id).build(),
    )?;
    Ok(())
}

#[tauri::command]
pub fn app__world_cache_list(
    state: State<'_, AppState>,
) -> Result<Vec<WorldSummaryOutput>, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    Ok(state
        .db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_world",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| world_summary_from_row(&row))
        .collect())
}

#[tauri::command]
pub fn app__world_cache_get(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<Option<WorldSummaryOutput>, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let world_id = normalize_text(world_id);
    if world_id.is_empty() {
        return Ok(None);
    }
    Ok(state
        .db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_world WHERE id = @world_id LIMIT 1",
            &ParamsBuilder::new().set("world_id", world_id).build(),
        )?
        .first()
        .map(|row| world_summary_from_row(row)))
}

#[tauri::command]
pub fn app__favorite_list(
    state: State<'_, AppState>,
    kind: String,
) -> Result<Vec<Value>, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let (table, column, _) = normalize_kind(&kind)?;
    let id_key = match kind.trim() {
        "friend" => "userId",
        "avatar" => "avatarId",
        "world" => "worldId",
        _ => "entityId",
    };
    Ok(state
        .db
        .execute(
            &format!("SELECT created_at, {column}, group_name FROM {table}"),
            &Default::default(),
        )?
        .into_iter()
        .map(|row| {
            json!({
                "created_at": row_json(&row, 0),
                id_key: row_json(&row, 1),
                "groupName": row_json(&row, 2)
            })
        })
        .collect())
}

#[tauri::command]
pub fn app__favorite_add(
    state: State<'_, AppState>,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let (table, column, entity_param) = normalize_kind(&kind)?;
    Ok(state.db.execute_non_query(
        &format!("INSERT OR REPLACE INTO {table} ({column}, group_name, created_at) VALUES ({entity_param}, @group_name, @created_at)"),
        &ParamsBuilder::new()
            .set(entity_param, normalize_text(entity_id))
            .set("group_name", normalize_text(group_name))
            .set("created_at", now_iso())
            .build(),
    )?)
}

#[tauri::command]
pub fn app__favorite_remove(
    state: State<'_, AppState>,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let (table, column, _) = normalize_kind(&kind)?;
    Ok(state.db.execute_non_query(
        &format!("DELETE FROM {table} WHERE {column} = @entity_id AND group_name = @group_name"),
        &ParamsBuilder::new()
            .set("entity_id", normalize_text(entity_id))
            .set("group_name", normalize_text(group_name))
            .build(),
    )?)
}

#[tauri::command]
pub fn app__favorite_group_rename(
    state: State<'_, AppState>,
    kind: String,
    group_name: String,
    new_group_name: String,
) -> Result<i64, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let (table, _, _) = normalize_kind(&kind)?;
    Ok(state.db.execute_non_query(
        &format!("UPDATE {table} SET group_name = @new_group_name WHERE group_name = @group_name"),
        &ParamsBuilder::new()
            .set("new_group_name", normalize_text(new_group_name))
            .set("group_name", normalize_text(group_name))
            .build(),
    )?)
}

#[tauri::command]
pub fn app__favorite_group_delete(
    state: State<'_, AppState>,
    kind: String,
    group_name: String,
) -> Result<i64, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let (table, _, _) = normalize_kind(&kind)?;
    Ok(state.db.execute_non_query(
        &format!("DELETE FROM {table} WHERE group_name = @group_name"),
        &ParamsBuilder::new()
            .set("group_name", normalize_text(group_name))
            .build(),
    )?)
}

#[tauri::command]
pub fn app__memo_get_user(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Option<UserMemoOutput>, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(None);
    }
    Ok(state
        .db
        .execute(
            "SELECT user_id, edited_at, memo FROM memos WHERE user_id = @user_id LIMIT 1",
            &ParamsBuilder::new().set("user_id", user_id).build(),
        )?
        .first()
        .map(|row| UserMemoOutput {
            user_id: row_string(row, 0),
            edited_at: row_string(row, 1),
            memo: row_string(row, 2),
        }))
}

#[tauri::command]
pub fn app__memo_list_users(state: State<'_, AppState>) -> Result<Vec<UserMemoOutput>, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    Ok(state
        .db
        .execute(
            "SELECT user_id, edited_at, memo FROM memos",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| UserMemoOutput {
            user_id: row_string(&row, 0),
            edited_at: row_string(&row, 1),
            memo: row_string(&row, 2),
        })
        .collect())
}

#[tauri::command]
pub fn app__memo_list_user_notes(
    state: State<'_, AppState>,
    owner_user_id: String,
) -> Result<Vec<UserNoteOutput>, AppError> {
    let owner_user_id = normalize_text(owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_local_tables(&state.db, &user_prefix)?;
    Ok(state
        .db
        .execute(
            &format!("SELECT user_id, display_name, note, created_at FROM {user_prefix}_notes"),
            &Default::default(),
        )?
        .into_iter()
        .map(|row| UserNoteOutput {
            user_id: row_string(&row, 0),
            display_name: row_string(&row, 1),
            note: row_string(&row, 2),
            created_at: row_string(&row, 3),
        })
        .collect())
}

#[tauri::command]
pub fn app__memo_get_world(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<Option<WorldMemoOutput>, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let world_id = normalize_text(world_id);
    if world_id.is_empty() {
        return Ok(None);
    }
    Ok(state
        .db
        .execute(
            "SELECT world_id, edited_at, memo FROM world_memos WHERE world_id = @world_id LIMIT 1",
            &ParamsBuilder::new().set("world_id", world_id).build(),
        )?
        .first()
        .map(|row| WorldMemoOutput {
            world_id: row_string(row, 0),
            edited_at: row_string(row, 1),
            memo: row_string(row, 2),
        }))
}

#[tauri::command]
pub fn app__memo_get_avatar(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<Option<AvatarMemoOutput>, AppError> {
    ensure_global_local_data_tables(&state.db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(None);
    }
    Ok(state
        .db
        .execute(
            "SELECT avatar_id, edited_at, memo FROM avatar_memos WHERE avatar_id = @avatar_id LIMIT 1",
            &ParamsBuilder::new().set("avatar_id", avatar_id).build(),
        )?
        .first()
        .map(|row| AvatarMemoOutput {
            avatar_id: row_string(row, 0),
            edited_at: row_string(row, 1),
            memo: row_string(row, 2),
        }))
}

#[tauri::command]
pub fn app__memo_save_user(
    state: State<'_, AppState>,
    user_id: String,
    memo: String,
) -> Result<MemoSaveResult, AppError> {
    save_memo(&state.db, "memos", "user_id", user_id, memo)
}

#[tauri::command]
pub fn app__memo_save_world(
    state: State<'_, AppState>,
    world_id: String,
    memo: String,
) -> Result<MemoSaveResult, AppError> {
    save_memo(&state.db, "world_memos", "world_id", world_id, memo)
}

#[tauri::command]
pub fn app__memo_save_avatar(
    state: State<'_, AppState>,
    avatar_id: String,
    memo: String,
) -> Result<MemoSaveResult, AppError> {
    save_memo(&state.db, "avatar_memos", "avatar_id", avatar_id, memo)
}

#[tauri::command]
pub fn app__friend_log_current_list(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Vec<FriendLogCurrentOutput>, AppError> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    Ok(state
        .db
        .execute(
            &format!("SELECT user_id, display_name, trust_level, friend_number FROM {user_prefix}_friend_log_current ORDER BY friend_number ASC, display_name COLLATE NOCASE ASC, user_id ASC"),
            &Default::default(),
        )?
        .into_iter()
        .map(|row| FriendLogCurrentOutput {
            user_id: row_string(&row, 0),
            display_name: row_string(&row, 1),
            trust_level: row_string(&row, 2),
            friend_number: row_i64(&row, 3),
        })
        .filter(|row| !row.user_id.trim().is_empty())
        .collect())
}

#[tauri::command]
pub fn app__friend_log_history_query(
    state: State<'_, AppState>,
    query: FriendLogHistoryQueryInput,
) -> Result<Vec<FriendLogHistoryOutput>, AppError> {
    let user_id = normalize_text(query.user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    let mut clauses = Vec::new();
    let mut db_params = HashMap::new();
    let target_user_id = normalize_text(query.target_user_id);
    if !target_user_id.is_empty() {
        clauses.push("user_id = @user_id".to_string());
        db_params.insert("@user_id".into(), Value::String(target_user_id));
    }
    let types = query
        .types
        .into_iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let type_placeholders = add_list_params(&mut db_params, &types, "friend_log_type");
    if !type_placeholders.is_empty() {
        clauses.push(format!("type IN ({})", type_placeholders.join(", ")));
    }
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };
    Ok(state
        .db
        .execute(
            &format!("SELECT id, created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number FROM {user_prefix}_friend_log_history{where_sql} ORDER BY created_at DESC, id DESC"),
            &db_params,
        )?
        .into_iter()
        .map(|row| FriendLogHistoryOutput {
            row_id: row_i64(&row, 0),
            created_at: row_string(&row, 1),
            r#type: row_string(&row, 2),
            user_id: row_string(&row, 3),
            display_name: row_string(&row, 4),
            previous_display_name: row_string(&row, 5),
            trust_level: row_string(&row, 6),
            previous_trust_level: row_string(&row, 7),
            friend_number: row_i64(&row, 8),
        })
        .filter(|row| !row.user_id.trim().is_empty())
        .collect())
}

#[tauri::command]
pub fn app__friend_log_replace_current(
    state: State<'_, AppState>,
    user_id: String,
    entries: Vec<FriendLogCurrentEntryInput>,
    options: FriendLogReplaceOptionsInput,
) -> Result<FriendLogMutationResult, AppError> {
    let owner_user_id = normalize_text(&user_id);
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    let history_count = state.db.write_transaction(|tx| {
        let mut written_history_count = 0;
        for entry in &options.history_entries {
            let target_user_id = normalize_text(&entry.user_id);
            if target_user_id.is_empty() {
                continue;
            }
            let affected = tx.execute_non_query(
                &format!("DELETE FROM {user_prefix}_friend_log_current WHERE user_id = @user_id"),
                &ParamsBuilder::new().set("user_id", target_user_id).build(),
            )?;
            if affected > 0 {
                add_friend_log_history_entry(tx, &user_prefix, entry)?;
                written_history_count += 1;
            }
        }
        for entry in &options.added_history_entries {
            let target_user_id = normalize_text(&entry.user_id);
            if target_user_id.is_empty() {
                continue;
            }
            let existing_rows = tx.execute(
                &format!("SELECT user_id FROM {user_prefix}_friend_log_current WHERE user_id = @user_id LIMIT 1"),
                &ParamsBuilder::new().set("user_id", target_user_id).build(),
            )?;
            if existing_rows.is_empty() {
                add_friend_log_history_entry(tx, &user_prefix, entry)?;
                written_history_count += 1;
            }
        }
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_friend_log_current"),
            &Default::default(),
        )?;
        for entry in &entries {
            let target_user_id = normalize_text(&entry.user_id);
            if target_user_id.is_empty() {
                continue;
            }
            tx.execute_non_query(
                &format!("INSERT OR REPLACE INTO {user_prefix}_friend_log_current (user_id, display_name, trust_level, friend_number) VALUES (@user_id, @display_name, @trust_level, @friend_number)"),
                &ParamsBuilder::new()
                    .set("user_id", target_user_id)
                    .set("display_name", entry.display_name.clone())
                    .set("trust_level", current_friend_trust_level(entry))
                    .set("friend_number", value_as_i64(&entry.friend_number))
                    .build(),
            )?;
        }
        Ok::<i64, vrcx_0_persistence::Error>(written_history_count)
    })?;
    Ok(FriendLogMutationResult {
        user_id: owner_user_id,
        target_user_id: String::new(),
        count: entries.len() as i64,
        inserted: None,
        history_count,
    })
}

#[tauri::command]
pub fn app__friend_log_delete_current_array(
    state: State<'_, AppState>,
    user_id: String,
    target_user_ids: Vec<String>,
    options: FriendLogDeleteOptionsInput,
) -> Result<FriendLogMutationResult, AppError> {
    let owner_user_id = normalize_text(&user_id);
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    let normalized_ids: Vec<String> = target_user_ids
        .into_iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect();
    if normalized_ids.is_empty() {
        return Ok(FriendLogMutationResult {
            user_id: owner_user_id,
            target_user_id: String::new(),
            count: 0,
            inserted: None,
            history_count: 0,
        });
    }
    let result = state.db.write_transaction(|tx| {
        let mut deleted_count = 0;
        let mut written_history_count = 0;
        for target_user_id in &normalized_ids {
            let affected = tx.execute_non_query(
                &format!("DELETE FROM {user_prefix}_friend_log_current WHERE user_id = @user_id"),
                &ParamsBuilder::new()
                    .set("user_id", target_user_id.clone())
                    .build(),
            )?;
            if affected > 0 {
                deleted_count += affected;
                if let Some(entry) = options
                    .history_entries
                    .iter()
                    .find(|entry| normalize_text(&entry.user_id) == *target_user_id)
                {
                    add_friend_log_history_entry(tx, &user_prefix, entry)?;
                    written_history_count += 1;
                }
            }
        }
        Ok::<(i64, i64), vrcx_0_persistence::Error>((deleted_count, written_history_count))
    })?;
    Ok(FriendLogMutationResult {
        user_id: owner_user_id,
        target_user_id: String::new(),
        count: result.0,
        inserted: None,
        history_count: result.1,
    })
}

#[tauri::command]
pub fn app__friend_log_upsert_current(
    state: State<'_, AppState>,
    user_id: String,
    entry: FriendLogCurrentEntryInput,
    options: FriendLogUpsertOptionsInput,
) -> Result<FriendLogMutationResult, AppError> {
    let owner_user_id = normalize_text(&user_id);
    let target_user_id = normalize_text(&entry.user_id);
    if target_user_id.is_empty() {
        return Ok(FriendLogMutationResult {
            user_id: owner_user_id,
            target_user_id: String::new(),
            count: 0,
            inserted: Some(false),
            history_count: 0,
        });
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    let result = state.db.write_transaction(|tx| {
        let insert_count = tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_friend_log_current (user_id, display_name, trust_level, friend_number) VALUES (@user_id, @display_name, @trust_level, @friend_number)"),
            &ParamsBuilder::new()
                .set("user_id", target_user_id.clone())
                .set("display_name", entry.display_name.clone())
                .set("trust_level", current_friend_trust_level(&entry))
                .set("friend_number", value_as_i64(&entry.friend_number))
                .build(),
        )?;
        let inserted = insert_count > 0;
        if !inserted {
            tx.execute_non_query(
                &format!("UPDATE {user_prefix}_friend_log_current SET display_name = @display_name, trust_level = @trust_level, friend_number = CASE WHEN @friend_number > 0 THEN @friend_number ELSE friend_number END WHERE user_id = @user_id"),
                &ParamsBuilder::new()
                    .set("user_id", target_user_id.clone())
                    .set("display_name", entry.display_name.clone())
                    .set("trust_level", current_friend_trust_level(&entry))
                    .set("friend_number", value_as_i64(&entry.friend_number))
                    .build(),
            )?;
        }
        let mut history_count = 0;
        if let Some(history_entry) = options
            .history_entry
            .as_ref()
            .filter(|_| inserted || options.force_history)
        {
            let mut history_entry = history_entry.clone();
            history_entry.user_id = target_user_id.clone();
            add_friend_log_history_entry(tx, &user_prefix, &history_entry)?;
            history_count = 1;
        }
        Ok::<(bool, i64), vrcx_0_persistence::Error>((inserted, history_count))
    })?;
    Ok(FriendLogMutationResult {
        user_id: owner_user_id,
        target_user_id,
        count: 1,
        inserted: Some(result.0),
        history_count: result.1,
    })
}

#[tauri::command]
pub fn app__friend_log_delete_current(
    state: State<'_, AppState>,
    user_id: String,
    target_user_id: String,
) -> Result<i64, AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    Ok(state.db.execute_non_query(
        &format!("DELETE FROM {user_prefix}_friend_log_current WHERE user_id = @user_id"),
        &ParamsBuilder::new()
            .set("user_id", normalize_text(target_user_id))
            .build(),
    )?)
}

#[tauri::command]
pub fn app__friend_log_history_add(
    state: State<'_, AppState>,
    user_id: String,
    entries: Vec<FriendLogHistoryEntryInput>,
) -> Result<i64, AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    let count = state.db.write_transaction(|tx| {
        let mut written_count = 0;
        for entry in &entries {
            if entry.r#type.trim().is_empty() || entry.user_id.trim().is_empty() {
                continue;
            }
            let affected = tx.execute_non_query(
                &format!("INSERT OR IGNORE INTO {user_prefix}_friend_log_history (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number) VALUES (@created_at, @type, @user_id, @display_name, @previous_display_name, @trust_level, @previous_trust_level, @friend_number)"),
                &ParamsBuilder::new()
                    .set("created_at", entry.created_at.clone())
                    .set("type", entry.r#type.clone())
                    .set("user_id", normalize_text(&entry.user_id))
                    .set("display_name", entry.display_name.clone())
                    .set("previous_display_name", entry.previous_display_name.clone())
                    .set("trust_level", entry.trust_level.clone())
                    .set("previous_trust_level", entry.previous_trust_level.clone())
                    .set("friend_number", value_as_i64(&entry.friend_number))
                    .build(),
            )?;
            written_count += affected;
        }
        Ok::<i64, vrcx_0_persistence::Error>(written_count)
    })?;
    Ok(count)
}

#[tauri::command]
pub fn app__friend_log_history_delete(
    state: State<'_, AppState>,
    user_id: String,
    entry: FriendLogHistoryEntryInput,
) -> Result<i64, AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    let row_id = value_as_i64(&entry.row_id);
    if row_id > 0 {
        return Ok(state.db.execute_non_query(
            &format!("DELETE FROM {user_prefix}_friend_log_history WHERE id = @row_id"),
            &ParamsBuilder::new().set("row_id", row_id).build(),
        )?);
    }
    Ok(state.db.execute_non_query(
        &format!("DELETE FROM {user_prefix}_friend_log_history WHERE created_at = @created_at AND type = @type AND user_id = @user_id"),
        &ParamsBuilder::new()
            .set("created_at", entry.created_at)
            .set("type", entry.r#type)
            .set("user_id", normalize_text(entry.user_id))
        .build(),
    )?)
}

#[tauri::command]
pub fn app__notification_rows_query(
    state: State<'_, AppState>,
    query: NotificationRowsQueryInput,
) -> Result<NotificationRowsOutput, AppError> {
    let user_id = normalize_text(query.user_id);
    if user_id.is_empty() {
        return Ok(NotificationRowsOutput {
            v1_rows: Vec::new(),
            v2_rows: Vec::new(),
            unseen_v2_rows: Vec::new(),
        });
    }

    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    let limit = if query.per_table_limit > 0 {
        query.per_table_limit
    } else {
        500
    };
    let (where_sql, mut params) = build_type_filter(&query.filters);
    params.insert("@limit".into(), Value::from(limit));

    let v1_rows = state
        .db
        .execute(
            &format!(
                "SELECT id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired
                 FROM {user_prefix}_notifications{where_sql}
                 ORDER BY created_at DESC, id DESC
                 LIMIT @limit"
            ),
            &params,
        )?
        .into_iter()
        .map(|row| notification_v1_from_row(&row))
        .collect();
    let v2_rows = state
        .db
        .execute(
            &format!(
                "SELECT id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details
                 FROM {user_prefix}_notifications_v2{where_sql}
                 ORDER BY created_at DESC, id DESC
                 LIMIT @limit"
            ),
            &params,
        )?
        .into_iter()
        .map(|row| notification_v2_from_row(&row))
        .collect();
    let unseen_v2_rows = if query.include_unseen {
        state
            .db
            .execute(
                &format!(
                    "SELECT id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details
                     FROM {user_prefix}_notifications_v2
                     WHERE seen = 0
                       AND (expires_at IS NULL OR expires_at = '' OR expires_at > @now)
                     ORDER BY created_at DESC, id DESC"
                ),
                &ParamsBuilder::new().set("now", now_iso()).build(),
            )?
            .into_iter()
            .map(|row| notification_v2_from_row(&row))
            .collect()
    } else {
        Vec::new()
    };

    Ok(NotificationRowsOutput {
        v1_rows,
        v2_rows,
        unseen_v2_rows,
    })
}

#[tauri::command]
pub fn app__notification_add_v1(
    state: State<'_, AppState>,
    user_id: String,
    notification: Value,
) -> Result<(), AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;

    let id = object_field_string(&notification, &["id"]);
    let created_at = object_field_string(&notification, &["created_at", "createdAt"]);
    let notification_type = object_field_string(&notification, &["type"]);
    if id.is_empty() || created_at.is_empty() || notification_type.is_empty() {
        return Err(AppError::Custom(
            "Notification is missing required field".into(),
        ));
    }

    let details = object_field(&notification, "details").unwrap_or(&Value::Null);
    let image_url = object_field_string(&notification, &["imageUrl"]);
    let detail_image_url = object_field_string(details, &["imageUrl"]);
    state.db.execute_non_query(
        &format!("INSERT OR IGNORE INTO {user_prefix}_notifications (id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired) VALUES (@id, @created_at, @type, @sender_user_id, @sender_username, @receiver_user_id, @message, @world_id, @world_name, @image_url, @invite_message, @request_message, @response_message, @expired)"),
        &ParamsBuilder::new()
            .set("id", id)
            .set("created_at", created_at)
            .set("type", notification_type)
            .set("sender_user_id", object_field_string(&notification, &["senderUserId"]))
            .set("sender_username", object_field_string(&notification, &["senderUsername"]))
            .set("receiver_user_id", object_field_string(&notification, &["receiverUserId"]))
            .set("message", object_field_string(&notification, &["message"]))
            .set("world_id", object_field_string(details, &["worldId"]))
            .set("world_name", object_field_string(details, &["worldName"]))
            .set("image_url", if detail_image_url.is_empty() { image_url } else { detail_image_url })
            .set("invite_message", object_field_string(details, &["inviteMessage"]))
            .set("request_message", object_field_string(details, &["requestMessage"]))
            .set("response_message", object_field_string(details, &["responseMessage"]))
            .set("expired", if object_field_bool(&notification, "$isExpired") { 1 } else { 0 })
            .build(),
    )?;
    Ok(())
}

#[tauri::command]
pub fn app__notification_add_v2(
    state: State<'_, AppState>,
    user_id: String,
    notification: Value,
) -> Result<(), AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    let id = object_field_string(&notification, &["id"]);
    if id.is_empty() {
        return Ok(());
    }

    state.db.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_notifications_v2 (id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details) VALUES (@id, @created_at, @updated_at, @expires_at, @type, @link, @link_text, @message, @title, @image_url, @seen, @sender_user_id, @sender_username, @data, @responses, @details)"),
        &ParamsBuilder::new()
            .set("id", id)
            .set("created_at", object_field_optional_string(&notification, &["createdAt", "created_at"]))
            .set("updated_at", object_field_optional_string(&notification, &["updatedAt", "updated_at"]))
            .set("expires_at", object_field_optional_string(&notification, &["expiresAt", "expires_at"]))
            .set("type", object_field_optional_string(&notification, &["type"]))
            .set("link", object_field_optional_string(&notification, &["link"]))
            .set("link_text", object_field_optional_string(&notification, &["linkText", "link_text"]))
            .set("message", object_field_optional_string(&notification, &["message"]))
            .set("title", object_field_optional_string(&notification, &["title"]))
            .set("image_url", object_field_optional_string(&notification, &["imageUrl", "image_url"]))
            .set("seen", if object_field_bool(&notification, "seen") { 1 } else { 0 })
            .set("sender_user_id", object_field_optional_string(&notification, &["senderUserId", "sender_user_id"]))
            .set("sender_username", object_field_optional_string(&notification, &["senderUsername", "sender_username"]))
            .set("data", object_field_json(&notification, "data", Value::Object(Default::default())))
            .set("responses", object_field_json(&notification, "responses", Value::Array(Vec::new())))
            .set("details", object_field_json(&notification, "details", Value::Object(Default::default())))
            .build(),
    )?;
    Ok(())
}

#[tauri::command]
pub fn app__notification_v2_expire(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    state.db.execute_non_query(
        &format!("UPDATE {user_prefix}_notifications_v2 SET expires_at = @expires_at, seen = 1 WHERE id = @id"),
        &ParamsBuilder::new().set("id", id).set("expires_at", now_iso()).build(),
    )?;
    Ok(())
}

#[tauri::command]
pub fn app__notification_v2_mark_seen(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    state.db.execute_non_query(
        &format!("UPDATE {user_prefix}_notifications_v2 SET seen = 1 WHERE id = @id"),
        &ParamsBuilder::new().set("id", id).build(),
    )?;
    Ok(())
}

#[tauri::command]
pub fn app__notification_update_expired(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
    expired: bool,
) -> Result<(), AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    state.db.execute_non_query(
        &format!("UPDATE {user_prefix}_notifications SET expired = @expired WHERE id = @id"),
        &ParamsBuilder::new()
            .set("id", id)
            .set("expired", if expired { 1 } else { 0 })
            .build(),
    )?;
    Ok(())
}

#[tauri::command]
pub fn app__notification_delete(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    state.db.write_transaction(|tx| {
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_notifications WHERE id = @id"),
            &ParamsBuilder::new().set("id", id.clone()).build(),
        )?;
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_notifications_v2 WHERE id = @id"),
            &ParamsBuilder::new().set("id", id).build(),
        )?;
        Ok(())
    })?;
    Ok(())
}

#[tauri::command]
pub fn app__notification_expire(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    let now = now_iso();
    state.db.write_transaction(|tx| {
        tx.execute_non_query(
            &format!("UPDATE {user_prefix}_notifications SET expired = 1 WHERE id = @id"),
            &ParamsBuilder::new().set("id", id.clone()).build(),
        )?;
        tx.execute_non_query(
            &format!("UPDATE {user_prefix}_notifications_v2 SET expires_at = @expires_at, seen = 1 WHERE id = @id"),
            &ParamsBuilder::new().set("id", id).set("expires_at", now).build(),
        )?;
        Ok(())
    })?;
    Ok(())
}

#[tauri::command]
pub fn app__notification_mark_seen_local_bulk(
    state: State<'_, AppState>,
    user_id: String,
    ids: Vec<String>,
) -> Result<(), AppError> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(&state.db, &user_prefix)?;
    let ids: Vec<String> = ids
        .into_iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect();
    state.db.write_transaction(|tx| {
        for id in &ids {
            tx.execute_non_query(
                &format!("UPDATE {user_prefix}_notifications_v2 SET seen = 1 WHERE id = @id"),
                &ParamsBuilder::new().set("id", id.clone()).build(),
            )?;
        }
        Ok(())
    })?;
    Ok(())
}

#[tauri::command]
pub fn app__local_moderation_list(
    state: State<'_, AppState>,
    owner_user_id: String,
) -> Result<Vec<LocalModerationOutput>, AppError> {
    let owner_user_id = normalize_text(&owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_moderation_table(&state.db, &user_prefix)?;
    Ok(state
        .db
        .execute(
            &format!(
                "SELECT user_id, updated_at, display_name, block, mute FROM {user_prefix}_moderation"
            ),
            &Default::default(),
        )?
        .into_iter()
        .map(|row| LocalModerationOutput {
            user_id: row_string(&row, 0),
            updated_at: row_string(&row, 1),
            display_name: row_string(&row, 2),
            block: row_i64(&row, 3) == 1,
            mute: row_i64(&row, 4) == 1,
        })
        .collect())
}

#[tauri::command]
pub fn app__local_moderation_get(
    state: State<'_, AppState>,
    owner_user_id: String,
    user_id: String,
) -> Result<Option<LocalModerationOutput>, AppError> {
    let owner_user_id = normalize_text(&owner_user_id);
    let user_id = normalize_text(user_id);
    if owner_user_id.is_empty() || user_id.is_empty() {
        return Ok(None);
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_moderation_table(&state.db, &user_prefix)?;
    Ok(state
        .db
        .execute(
            &format!("SELECT user_id, updated_at, display_name, block, mute FROM {user_prefix}_moderation WHERE user_id = @user_id LIMIT 1"),
            &ParamsBuilder::new().set("user_id", user_id).build(),
        )?
        .first()
        .map(|row| LocalModerationOutput {
            user_id: row_string(row, 0),
            updated_at: row_string(row, 1),
            display_name: row_string(row, 2),
            block: row_i64(row, 3) == 1,
            mute: row_i64(row, 4) == 1,
        }))
}

#[tauri::command]
pub fn app__local_moderation_set(
    state: State<'_, AppState>,
    owner_user_id: String,
    entry: LocalModerationInput,
) -> Result<(), AppError> {
    set_local_moderation_row(&state.db, &owner_user_id, &entry)
}

#[tauri::command]
pub fn app__local_moderation_delete(
    state: State<'_, AppState>,
    owner_user_id: String,
    user_id: String,
) -> Result<(), AppError> {
    delete_local_moderation_row(&state.db, &owner_user_id, &user_id)
}

#[tauri::command]
pub fn app__local_moderation_sync_snapshot(
    state: State<'_, AppState>,
    owner_user_id: String,
    rows: Vec<RemoteModerationInput>,
) -> Result<Vec<LocalModerationOutput>, AppError> {
    use std::collections::{HashMap, HashSet};

    let owner_user_id = normalize_text(&owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_moderation_table(&state.db, &user_prefix)?;

    let mut moderation_by_user_id: HashMap<String, LocalModerationOutput> = HashMap::new();
    for row in rows {
        if row.r#type != "block" && row.r#type != "mute" {
            continue;
        }
        let target_user_id = normalize_text(row.target_user_id);
        if target_user_id.is_empty() {
            continue;
        }
        let entry = moderation_by_user_id
            .entry(target_user_id.clone())
            .or_insert_with(|| LocalModerationOutput {
                user_id: target_user_id.clone(),
                updated_at: if row.created.trim().is_empty() {
                    now_iso()
                } else {
                    row.created.clone()
                },
                display_name: row.target_display_name.clone(),
                block: false,
                mute: false,
            });
        if !row.created.trim().is_empty() {
            entry.updated_at = row.created.clone();
        }
        if !row.target_display_name.trim().is_empty() {
            entry.display_name = row.target_display_name.clone();
        }
        if row.r#type == "block" {
            entry.block = true;
        }
        if row.r#type == "mute" {
            entry.mute = true;
        }
    }

    let target_ids: HashSet<String> = moderation_by_user_id.keys().cloned().collect();
    let existing = state.db.execute(
        &format!("SELECT user_id FROM {user_prefix}_moderation"),
        &Default::default(),
    )?;

    state.db.write_transaction(|tx| {
        for row in existing {
            let user_id = row
                .first()
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if !target_ids.contains(&user_id) {
                tx.execute_non_query(
                    &format!("DELETE FROM {user_prefix}_moderation WHERE user_id = @user_id"),
                    &ParamsBuilder::new().set("user_id", user_id).build(),
                )?;
            }
        }
        for entry in moderation_by_user_id.values() {
            tx.execute_non_query(
                &format!("INSERT OR REPLACE INTO {user_prefix}_moderation (user_id, updated_at, display_name, block, mute) VALUES (@user_id, @updated_at, @display_name, @block, @mute)"),
                &ParamsBuilder::new()
                    .set("user_id", entry.user_id.clone())
                    .set("updated_at", entry.updated_at.clone())
                    .set("display_name", entry.display_name.clone())
                    .set("block", if entry.block { 1 } else { 0 })
                    .set("mute", if entry.mute { 1 } else { 0 })
                    .build(),
            )?;
        }
        Ok(())
    })?;

    Ok(moderation_by_user_id.into_values().collect())
}
