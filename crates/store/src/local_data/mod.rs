#![allow(non_snake_case)]

use std::collections::{HashMap, HashSet};

use crate::common::{DbParams, ParamsBuilder};
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::game_log::{
    ensure_game_log_tables, write_batch as write_game_log_batch, GameLogEventEntry,
    GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogLocationTimeUpdate,
    GameLogPortalSpawnEntry, GameLogResourceLoadEntry, GameLogVideoPlayEntry, GameLogWriteBatch,
};
use crate::realtime::{
    ensure_realtime_tables, normalize_user_table_prefix, write_realtime_batch,
    RealtimePersistenceBatch,
};
use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};
use serde_json::{json, Value};

use crate::Error;

mod helpers;
pub mod types;

use helpers::*;
use types::*;

const ACTIVITY_FULL_CACHE_BATCH_DAYS: i64 = 30;
const ACTIVITY_INITIAL_RANGE_DAYS: i64 = 90;
const ACTIVITY_MAX_RANGE_DAYS: i64 = 3650;
const ACTIVITY_ONLINE_SESSION_MERGE_GAP_MS: i64 = 5 * 60 * 1000;
const ACTIVITY_DAY_MS: i64 = 86_400_000;
const ACTIVITY_MAX_INFERRED_SESSION_MS: i64 = 24 * 60 * 60 * 1000;

fn count_table(db: &DatabaseService, table_name: &str) -> Result<i64, Error> {
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

fn max_friend_log_number(db: &DatabaseService, user_prefix: &str) -> Result<i64, Error> {
    Ok(db
        .execute(
            &format!("SELECT MAX(friend_number) FROM {user_prefix}_friend_log_current"),
            &Default::default(),
        )?
        .first()
        .map(|row| row_i64(row, 0))
        .unwrap_or(0))
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

fn feed_entry_value<'a>(entry: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let object = entry.as_object()?;
    keys.iter()
        .find_map(|key| object.get(*key).filter(|value| !value.is_null()))
}

fn feed_entry_string(entry: &Value, keys: &[&str]) -> String {
    feed_entry_value(entry, keys)
        .map(value_as_string)
        .unwrap_or_default()
}

fn feed_entry_details_location(entry: &Value) -> String {
    entry
        .get("details")
        .and_then(|details| feed_entry_value(details, &["location"]))
        .map(value_as_string)
        .unwrap_or_default()
}

fn feed_row_key(row: &Value) -> String {
    if let Some(id) = feed_entry_value(row, &["id"]) {
        return format!("id:{}", value_as_string(id));
    }
    if let Some(row_id) = feed_entry_value(row, &["rowId", "row_id"]) {
        return format!(
            "row:{}:{}",
            feed_entry_string(row, &["type"]),
            value_as_string(row_id)
        );
    }

    let location = {
        let direct = feed_entry_string(row, &["location"]);
        if direct.is_empty() {
            feed_entry_details_location(row)
        } else {
            direct
        }
    };
    format!(
        "{}:{}:{}:{}:{}",
        feed_entry_string(row, &["type"]),
        feed_entry_string(row, &["created_at", "createdAt"]),
        feed_entry_string(
            row,
            &["userId", "user_id", "senderUserId", "sender_user_id"]
        ),
        location,
        feed_entry_string(row, &["message"])
    )
}

fn feed_search_matches(row: &Value, search: &str) -> bool {
    let query = search.trim().to_uppercase();
    if query.is_empty() {
        return true;
    }

    if (query.starts_with("WRLD_") || query.starts_with("GRP_"))
        && feed_entry_string(row, &["location"])
            .to_uppercase()
            .contains(&query)
    {
        return true;
    }

    [
        feed_entry_string(row, &["displayName", "display_name"]),
        feed_entry_string(row, &["worldName", "world_name"]),
        feed_entry_string(row, &["groupName", "group_name"]),
        feed_entry_string(row, &["status"]),
        feed_entry_string(row, &["statusDescription", "status_description"]),
        feed_entry_string(row, &["previousStatus", "previous_status"]),
        feed_entry_string(
            row,
            &["previousStatusDescription", "previous_status_description"],
        ),
        feed_entry_string(row, &["bio"]),
        feed_entry_string(row, &["previousBio", "previous_bio"]),
        feed_entry_string(row, &["avatarName", "avatar_name"]),
        feed_entry_string(row, &["message"]),
    ]
    .iter()
    .any(|value| value.to_uppercase().contains(&query))
}

fn feed_live_entry_matches(
    row: &Value,
    context: &FeedLiveRowsMergeContext<'_>,
    favorite_user_ids: &HashSet<String>,
) -> bool {
    if !row.is_object() {
        return false;
    }

    let owner_user_id = feed_entry_string(row, &["ownerUserId", "owner_user_id"]);
    if !owner_user_id.is_empty() && owner_user_id != context.current_user_id {
        return false;
    }

    let active_filters = context
        .filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    if !active_filters.is_empty() && !active_filters.contains(&feed_entry_string(row, &["type"])) {
        return false;
    }

    if context.favorites_only {
        let user_id = feed_entry_string(row, &["userId", "user_id"]);
        if user_id.is_empty() || !favorite_user_ids.contains(&user_id) {
            return false;
        }
    }

    let created_at = feed_entry_string(row, &["created_at", "createdAt"]);
    if !context.date_from.trim().is_empty()
        && !created_at.is_empty()
        && created_at.as_str() < context.date_from
    {
        return false;
    }
    if !context.date_to.trim().is_empty()
        && !created_at.is_empty()
        && created_at.as_str() > context.date_to
    {
        return false;
    }

    feed_search_matches(row, context.search)
}

fn feed_row_output_to_value(row: FeedRowOutput) -> Value {
    serde_json::to_value(row).unwrap_or(Value::Null)
}

struct FeedLiveRowsMergeContext<'a> {
    current_user_id: &'a str,
    filters: &'a [String],
    search: &'a str,
    date_from: &'a str,
    date_to: &'a str,
    favorites_only: bool,
    favorite_user_ids: &'a [String],
    max_rows: i64,
}

fn merge_feed_rows_with_live(
    rows: Vec<Value>,
    live_entries: &[FeedLiveEntryInput],
    min_live_sequence: i64,
    context: FeedLiveRowsMergeContext<'_>,
) -> FeedReadModelOutput {
    let favorite_user_ids = context
        .favorite_user_ids
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    let mut max_sequence = min_live_sequence;
    let mut matching_entries = Vec::new();

    for live_entry in live_entries
        .iter()
        .filter(|entry| entry.sequence > min_live_sequence)
    {
        max_sequence = max_sequence.max(live_entry.sequence);
        if feed_live_entry_matches(&live_entry.entry, &context, &favorite_user_ids) {
            matching_entries.push(live_entry.entry.clone());
        }
    }

    let max_rows = if context.max_rows > 0 {
        context.max_rows as usize
    } else {
        rows.len().saturating_add(matching_entries.len())
    };
    let mut seen = HashSet::new();
    let mut output_rows = Vec::new();

    for entry in matching_entries.into_iter().rev() {
        let key = feed_row_key(&entry);
        if seen.insert(key) {
            output_rows.push(entry);
        }
    }
    for row in rows {
        let key = feed_row_key(&row);
        if seen.insert(key) {
            output_rows.push(row);
        }
    }
    output_rows.truncate(max_rows);

    FeedReadModelOutput {
        rows: output_rows,
        max_sequence,
    }
}

fn merge_feed_live_rows(query: FeedLiveRowsMergeInput) -> FeedReadModelOutput {
    let context = FeedLiveRowsMergeContext {
        current_user_id: &query.current_user_id,
        filters: &query.filters,
        search: &query.search,
        date_from: &query.date_from,
        date_to: &query.date_to,
        favorites_only: query.favorites_only,
        favorite_user_ids: &query.favorite_user_ids,
        max_rows: query.max_rows,
    };
    merge_feed_rows_with_live(
        query.rows,
        &query.live_entries,
        query.min_live_sequence,
        context,
    )
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

fn ensure_config_table(db: &DatabaseService) -> Result<(), Error> {
    db.execute_non_query(
        "CREATE TABLE IF NOT EXISTS configs (`key` TEXT PRIMARY KEY, `value` TEXT)",
        &Default::default(),
    )?;
    Ok(())
}

fn ensure_global_local_data_tables(db: &DatabaseService) -> Result<(), Error> {
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

fn ensure_moderation_table(db: &DatabaseService, user_prefix: &str) -> Result<(), Error> {
    ensure_user_local_tables(db, user_prefix)?;
    db.execute_non_query(
        &format!("CREATE TABLE IF NOT EXISTS {user_prefix}_moderation (user_id TEXT PRIMARY KEY, updated_at TEXT, display_name TEXT, block INTEGER, mute INTEGER)"),
        &Default::default(),
    )?;
    Ok(())
}

fn ensure_avatar_history_table(db: &DatabaseService, user_prefix: &str) -> Result<(), Error> {
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

fn ensure_user_local_tables(db: &DatabaseService, user_prefix: &str) -> Result<(), Error> {
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

fn safe_identifier(identifier: &str, label: &str) -> Result<String, Error> {
    if identifier.is_empty()
        || !identifier
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        || identifier
            .chars()
            .next()
            .is_some_and(|ch| ch.is_ascii_digit())
    {
        return Err(Error::Custom(format!(
            "{label} contains invalid characters."
        )));
    }
    Ok(identifier.to_string())
}

fn select_table_names(db: &DatabaseService, where_sql: &str) -> Result<Vec<String>, Error> {
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
) -> Result<std::collections::HashSet<String>, Error> {
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
) -> Result<bool, Error> {
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
) -> Result<bool, Error> {
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

fn add_v17_global_indexes(db: &DatabaseService) -> Result<(), Error> {
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

fn add_notification_indexes(db: &DatabaseService) -> Result<(), Error> {
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

fn add_legacy_indexes(db: &DatabaseService) -> Result<(), Error> {
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
) -> Result<(), crate::Error> {
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
) -> Result<i64, Error> {
    ensure_global_local_data_tables(db)?;
    let now = now_iso();
    db.execute_non_query(
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
    )
}

fn save_memo(
    db: &DatabaseService,
    table_name: &str,
    id_column: &str,
    entity_id: String,
    memo: String,
) -> Result<MemoSaveResult, Error> {
    ensure_global_local_data_tables(db)?;
    let normalized_id = normalize_text(entity_id);
    if normalized_id.is_empty() {
        return Err(Error::Custom("memo save requires an entity id".into()));
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
) -> Result<(), Error> {
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
) -> Result<(), Error> {
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

pub fn app__config_set_values(
    db: &DatabaseService,
    entries: Vec<ConfigWriteEntry>,
) -> Result<(), Error> {
    ensure_config_table(db)?;
    db.write_transaction(|tx| {
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

pub fn app__config_list_values(db: &DatabaseService) -> Result<Vec<ConfigReadEntry>, Error> {
    ensure_config_table(db)?;
    Ok(db
        .execute("SELECT key, value FROM configs", &Default::default())?
        .into_iter()
        .map(|row| ConfigReadEntry {
            key: row_string(&row, 0),
            value: row_string(&row, 1),
        })
        .collect())
}

pub fn app__config_remove_value(db: &DatabaseService, key: String) -> Result<i64, Error> {
    ensure_config_table(db)?;
    db.execute_non_query(
        "DELETE FROM configs WHERE key = @key",
        &ParamsBuilder::new()
            .set("key", normalize_config_key(&key))
            .build(),
    )
}

pub fn app__user_tables_ensure(
    db: &DatabaseService,
    user_id: String,
) -> Result<UserTableContextOutput, Error> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    Ok(UserTableContextOutput {
        user_id,
        user_prefix,
    })
}

pub fn app__database_maintenance_run(db: &DatabaseService, task: String) -> Result<(), Error> {
    let task = normalize_text(task);
    run_database_maintenance_task(db, &task)
}

fn run_database_maintenance_task(db: &DatabaseService, task: &str) -> Result<(), Error> {
    match task {
        "initGlobalTables" => {
            ensure_game_log_tables(db)?;
            ensure_global_local_data_tables(db)?;
            add_legacy_indexes(db)?;
            if db
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
                add_v17_global_indexes(db)?;
            }
        }
        "vacuum" => {
            db.execute_non_query("VACUUM", &Default::default())?;
        }
        "optimize" => {
            db.execute_non_query("PRAGMA optimize", &Default::default())?;
        }
        "updateTableForGroupNames" => {
            for table_name in select_table_names(
                db,
                "name LIKE '%_feed_gps' OR name LIKE '%_feed_online_offline' OR name = 'gamelog_location'",
            )? {
                add_column_if_missing(db, &table_name, "group_name", "TEXT DEFAULT ''")?;
            }
            let mut columns = table_column_names(db, "gamelog_location")?;
            if columns.contains("groupName") {
                if !columns.contains("group_name") {
                    add_column_if_missing(db, "gamelog_location", "group_name", "TEXT DEFAULT ''")?;
                    columns = table_column_names(db, "gamelog_location")?;
                }
                if columns.contains("group_name") {
                    db.execute_non_query(
                        "UPDATE gamelog_location SET group_name = groupName WHERE (group_name IS NULL OR group_name = '') AND groupName IS NOT NULL AND groupName != ''",
                        &Default::default(),
                    )?;
                }
                drop_column_if_exists(db, "gamelog_location", "groupName")?;
            }
        }
        "addFriendLogFriendNumber" => {
            for table_name in select_table_names(
                db,
                "name LIKE '%_friend_log_current' OR name LIKE '%_friend_log_history'",
            )? {
                add_column_if_missing(db, &table_name, "friend_number", "INTEGER DEFAULT 0")?;
            }
        }
        "updateTableForAvatarHistory" => {
            for table_name in select_table_names(db, "name LIKE '%_avatar_history'")? {
                add_column_if_missing(db, &table_name, "time", "INTEGER DEFAULT 0")?;
            }
        }
        "addLegacyPerformanceIndexes" => add_legacy_indexes(db)?,
        "addV17GlobalPerformanceIndexes" => add_v17_global_indexes(db)?,
        "addNotificationPerformanceIndexes" => add_notification_indexes(db)?,
        "addV17PerformanceIndexes" => {
            add_v17_global_indexes(db)?;
            add_notification_indexes(db)?;
        }
        "addPerformanceIndexes" => {
            add_legacy_indexes(db)?;
            add_v17_global_indexes(db)?;
            add_notification_indexes(db)?;
        }
        "upgradeDatabaseVersion" => {
            run_database_maintenance_task(db, "updateTableForGroupNames")?;
            run_database_maintenance_task(db, "addFriendLogFriendNumber")?;
            run_database_maintenance_task(db, "updateTableForAvatarHistory")?;
            add_legacy_indexes(db)?;
        }
        "cleanLegendFromFriendLog" => {
            for table_name in select_table_names(db, "name LIKE '%_friend_log_history'")? {
                db.execute_non_query(
                    &format!("DELETE FROM {table_name} WHERE type = 'TrustLevel' AND created_at > '2022-05-04T01:00:00.000Z' AND ((trust_level = 'Veteran User' AND previous_trust_level = 'Trusted User') OR (trust_level = 'Trusted User' AND previous_trust_level = 'Veteran User'))"),
                    &Default::default(),
                )?;
            }
        }
        "fixGameLogTraveling" => {
            let traveling = db.execute(
                "SELECT * FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND location = 'traveling'",
                &Default::default(),
            )?;
            for row in traveling.into_iter().rev() {
                let row_id = row.first().cloned().unwrap_or(Value::Null);
                let created_at = row.get(1).cloned().unwrap_or(Value::Null);
                let display_name = row.get(3).cloned().unwrap_or(Value::Null);
                let join_rows = db.execute(
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
                db.execute_non_query(
                    "UPDATE gamelog_join_leave SET location = @location WHERE id = @row_id",
                    &ParamsBuilder::new()
                        .set("row_id", row_id)
                        .set("location", location.to_string())
                        .build(),
                )?;
            }
        }
        "fixNegativeGPS" => {
            for table_name in select_table_names(db, "name LIKE '%_gps'")? {
                db.execute_non_query(
                    &format!("UPDATE {table_name} SET time = 0 WHERE time < 0"),
                    &Default::default(),
                )?;
            }
        }
        "fixBrokenLeaveEntries" => {
            let mut instance_times = std::collections::HashMap::<String, i64>::new();
            for row in db.execute(
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
            for row in db.execute("SELECT location, time, id FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND time > 0", &Default::default())? {
                let location = row.first().and_then(Value::as_str).unwrap_or_default();
                let time = row.get(1).map(value_as_i64).unwrap_or(0);
                let id = row.get(2).cloned().unwrap_or(Value::Null);
                if instance_times.get(location).is_some_and(|instance_time| time > *instance_time) {
                    db.execute_non_query(
                        "UPDATE gamelog_join_leave SET time = 0 WHERE id = @id",
                        &ParamsBuilder::new().set("id", id).build(),
                    )?;
                }
            }
        }
        "fixBrokenGroupInvites" => {
            for table_name in select_table_names(db, "name LIKE '%_notifications'")? {
                db.execute_non_query(
                    &format!("DELETE FROM {table_name} WHERE type LIKE '%.%'"),
                    &Default::default(),
                )?;
            }
        }
        "fixBrokenNotifications" => {
            for table_name in select_table_names(db, "name LIKE '%_notifications'")? {
                db.execute_non_query(
                    &format!(
                        "DELETE FROM {table_name} WHERE (created_at is null or created_at = '')"
                    ),
                    &Default::default(),
                )?;
            }
        }
        "fixBrokenGroupChange" => {
            for table_name in select_table_names(db, "name LIKE '%_notifications'")? {
                db.execute_non_query(&format!("DELETE FROM {table_name} WHERE type = 'groupChange' AND created_at < '2024-04-23T03:00:00.000Z'"), &Default::default())?;
            }
        }
        "fixCancelFriendRequestTypo" => {
            for table_name in select_table_names(db, "name LIKE '%_friend_log_history'")? {
                db.execute_non_query(&format!("UPDATE {table_name} SET type = 'CancelFriendRequest' WHERE type = 'CancelFriendRequst'"), &Default::default())?;
            }
        }
        "fixBrokenGameLogDisplayNames" => {
            for row in db.execute(
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
                db.execute_non_query(
                    "UPDATE gamelog_join_leave SET display_name = @new_display_name WHERE id = @id",
                    &ParamsBuilder::new()
                        .set("new_display_name", new_display_name)
                        .set("id", id)
                        .build(),
                )?;
            }
        }
        _ => return Err(Error::Custom(format!("Unknown maintenance task: {task}"))),
    }
    Ok(())
}

pub fn app__database_maintenance_table_sizes_get(
    db: &DatabaseService,
    user_id: String,
) -> Result<MaintenanceTableSizesOutput, Error> {
    ensure_game_log_tables(db)?;
    ensure_global_local_data_tables(db)?;

    let user_id = normalize_text(user_id);
    let mut output = MaintenanceTableSizesOutput {
        gps: 0,
        status: 0,
        bio: 0,
        avatar: 0,
        online_offline: 0,
        friend_log_history: 0,
        notification: 0,
        location: count_table(db, "gamelog_location")?,
        join_leave: count_table(db, "gamelog_join_leave")?,
        portal_spawn: count_table(db, "gamelog_portal_spawn")?,
        video_play: count_table(db, "gamelog_video_play")?,
        event: count_table(db, "gamelog_event")?,
        external: count_table(db, "gamelog_external")?,
        resource_load: count_table(db, "gamelog_resource_load")?,
    };
    if !user_id.is_empty() {
        let user_prefix = normalize_user_table_prefix(&user_id)?;
        ensure_user_local_tables(db, &user_prefix)?;
        output.gps = count_table(db, &format!("{user_prefix}_feed_gps"))?;
        output.status = count_table(db, &format!("{user_prefix}_feed_status"))?;
        output.bio = count_table(db, &format!("{user_prefix}_feed_bio"))?;
        output.avatar = count_table(db, &format!("{user_prefix}_feed_avatar"))?;
        output.online_offline = count_table(db, &format!("{user_prefix}_feed_online_offline"))?;
        output.friend_log_history = count_table(db, &format!("{user_prefix}_friend_log_history"))?;
        output.notification = count_table(db, &format!("{user_prefix}_notifications"))?;
    }
    Ok(output)
}

pub fn app__database_maintenance_max_friend_log_number_get(
    db: &DatabaseService,
    user_id: String,
) -> Result<i64, Error> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(0);
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    max_friend_log_number(db, &user_prefix)
}

pub fn app__database_maintenance_broken_leave_entries_get(
    db: &DatabaseService,
) -> Result<Vec<Value>, Error> {
    ensure_game_log_tables(db)?;
    let mut instance_times = HashMap::<String, i64>::new();
    for row in db.execute(
        "SELECT location, time FROM gamelog_location",
        &Default::default(),
    )? {
        let location = row_string(&row, 0);
        let time = row_i64(&row, 1);
        *instance_times.entry(location).or_default() += time;
    }
    let mut bad_entries = Vec::new();
    for row in db.execute("SELECT location, time, id FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND time > 0", &Default::default())? {
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

pub fn app__database_maintenance_broken_game_log_display_names_get(
    db: &DatabaseService,
) -> Result<Vec<BrokenGameLogDisplayNameOutput>, Error> {
    ensure_game_log_tables(db)?;
    Ok(db
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

pub fn app__avatar_cache_upsert(
    db: &DatabaseService,
    entry: CacheEntityInput,
) -> Result<i64, Error> {
    upsert_cache_entity(db, "cache_avatar", entry)
}

pub fn app__avatar_cache_get(
    db: &DatabaseService,
    avatar_id: String,
) -> Result<Option<AvatarCacheOutput>, Error> {
    ensure_global_local_data_tables(db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_avatar WHERE id = @avatar_id LIMIT 1",
            &ParamsBuilder::new().set("avatar_id", avatar_id).build(),
        )?
        .first()
        .map(|row| cache_entity_from_row(row)))
}

pub fn app__avatar_cache_list(db: &DatabaseService) -> Result<Vec<AvatarCacheOutput>, Error> {
    ensure_global_local_data_tables(db)?;
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_avatar",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| cache_entity_from_row(&row))
        .collect())
}

pub fn app__avatar_cache_remove(db: &DatabaseService, avatar_id: String) -> Result<(), Error> {
    ensure_global_local_data_tables(db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        "DELETE FROM cache_avatar WHERE id = @avatar_id",
        &ParamsBuilder::new().set("avatar_id", avatar_id).build(),
    )?;
    Ok(())
}

pub fn app__avatar_history_add(
    db: &DatabaseService,
    user_id: String,
    avatar_id: String,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        &format!("INSERT INTO {user_prefix}_avatar_history (avatar_id, created_at, time) VALUES (@avatar_id, @created_at, 0) ON CONFLICT(avatar_id) DO UPDATE SET created_at = @created_at"),
        &ParamsBuilder::new()
            .set("avatar_id", avatar_id)
            .set("created_at", now_iso())
            .build(),
    )?;
    Ok(())
}

pub fn app__avatar_time_spent_add(
    db: &DatabaseService,
    user_id: String,
    avatar_id: String,
    time_spent: i64,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        &format!("INSERT INTO {user_prefix}_avatar_history (avatar_id, created_at, time) VALUES (@avatar_id, @created_at, @time_spent) ON CONFLICT(avatar_id) DO UPDATE SET time = time + @time_spent"),
        &ParamsBuilder::new()
            .set("avatar_id", avatar_id)
            .set("created_at", now_iso())
            .set("time_spent", time_spent)
            .build(),
    )?;
    Ok(())
}

pub fn app__avatar_history_list(
    db: &DatabaseService,
    user_id: String,
    limit: i64,
) -> Result<Vec<AvatarCacheOutput>, Error> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    ensure_global_local_data_tables(db)?;
    Ok(db
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

pub fn app__avatar_time_spent_get(
    db: &DatabaseService,
    user_id: String,
    avatar_id: String,
) -> Result<AvatarTimeSpentOutput, Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    let avatar_id = normalize_text(avatar_id);
    let time_spent = if avatar_id.is_empty() {
        0
    } else {
        db.execute(
            &format!("SELECT time FROM {user_prefix}_avatar_history WHERE avatar_id = @avatar_id"),
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

pub fn app__avatar_time_spent_list(
    db: &DatabaseService,
    user_id: String,
) -> Result<Vec<AvatarTimeSpentOutput>, Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    Ok(db
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

pub fn app__avatar_history_clear(db: &DatabaseService, user_id: String) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    ensure_global_local_data_tables(db)?;
    db.execute_non_query(
        &format!("DELETE FROM {user_prefix}_avatar_history"),
        &Default::default(),
    )?;
    db.execute_non_query("DELETE FROM cache_avatar", &Default::default())?;
    Ok(())
}

pub fn app__avatar_tag_add(
    db: &DatabaseService,
    avatar_id: String,
    tag: Value,
    color: Value,
) -> Result<i64, Error> {
    ensure_global_local_data_tables(db)?;
    db.execute_non_query(
        "INSERT OR IGNORE INTO avatar_tags (avatar_id, tag, color) VALUES (@avatar_id, @tag, @color)",
        &ParamsBuilder::new()
            .set("avatar_id", normalize_text(avatar_id))
            .set("tag", tag)
            .set("color", color)
            .build(),
    )
}

pub fn app__avatar_tags_get(
    db: &DatabaseService,
    avatar_id: String,
) -> Result<Vec<AvatarTagOutput>, Error> {
    ensure_global_local_data_tables(db)?;
    let avatar_id = normalize_text(avatar_id);
    Ok(db
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

pub fn app__avatar_tags_list(db: &DatabaseService) -> Result<Vec<AvatarTagOutput>, Error> {
    ensure_global_local_data_tables(db)?;
    Ok(db
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

pub fn app__avatar_tags_distinct(db: &DatabaseService) -> Result<Vec<String>, Error> {
    ensure_global_local_data_tables(db)?;
    Ok(db
        .execute(
            "SELECT DISTINCT tag FROM avatar_tags ORDER BY tag",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| row_string(&row, 0))
        .filter(|tag| !tag.is_empty())
        .collect())
}

pub fn app__avatar_tag_update_color(
    db: &DatabaseService,
    avatar_id: String,
    tag: Value,
    color: Value,
) -> Result<i64, Error> {
    ensure_global_local_data_tables(db)?;
    db.execute_non_query(
        "UPDATE avatar_tags SET color = @color WHERE avatar_id = @avatar_id AND tag = @tag",
        &ParamsBuilder::new()
            .set("avatar_id", normalize_text(avatar_id))
            .set("tag", tag)
            .set("color", color)
            .build(),
    )
}

pub fn app__avatar_tag_remove(
    db: &DatabaseService,
    avatar_id: String,
    tag: Value,
) -> Result<i64, Error> {
    ensure_global_local_data_tables(db)?;
    db.execute_non_query(
        "DELETE FROM avatar_tags WHERE avatar_id = @avatar_id AND tag = @tag",
        &ParamsBuilder::new()
            .set("avatar_id", normalize_text(avatar_id))
            .set("tag", tag)
            .build(),
    )
}

pub fn app__avatar_tags_remove_all(db: &DatabaseService, avatar_id: String) -> Result<i64, Error> {
    ensure_global_local_data_tables(db)?;
    db.execute_non_query(
        "DELETE FROM avatar_tags WHERE avatar_id = @avatar_id",
        &ParamsBuilder::new()
            .set("avatar_id", normalize_text(avatar_id))
            .build(),
    )
}

pub fn app__avatar_tags_replace(
    db: &DatabaseService,
    avatar_id: String,
    entries: Vec<AvatarTagInput>,
) -> Result<(), Error> {
    ensure_global_local_data_tables(db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }

    let entries = entries
        .into_iter()
        .filter_map(normalize_avatar_tag_entry)
        .collect::<Vec<_>>();

    db.write_transaction(|tx| {
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

pub fn app__avatar_tags_patch(
    db: &DatabaseService,
    avatar_id: String,
    patch: AvatarTagsPatchInput,
) -> Result<(), Error> {
    ensure_global_local_data_tables(db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }

    let previous_entries = normalize_avatar_tag_map(patch.previous_entries);
    let next_entries = normalize_avatar_tag_map(patch.next_entries);

    db.write_transaction(|tx| {
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

pub fn app__feed_add_entry(
    db: &DatabaseService,
    user_id: String,
    entry: Value,
) -> Result<(), Error> {
    write_realtime_batch(
        db,
        &user_id,
        &RealtimePersistenceBatch {
            feed_entries: vec![entry],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    Ok(())
}

pub fn app__feed_avatar_purge(
    db: &DatabaseService,
    user_id: String,
    cutoff_date: Option<String>,
) -> Result<i64, Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    if let Some(cutoff_date) = cutoff_date.filter(|value| !value.trim().is_empty()) {
        return db.execute_non_query(
            &format!("DELETE FROM {user_prefix}_feed_avatar WHERE created_at < @cutoff"),
            &ParamsBuilder::new().set("cutoff", cutoff_date).build(),
        );
    }
    db.execute_non_query(
        &format!("DELETE FROM {user_prefix}_feed_avatar"),
        &Default::default(),
    )
}

fn query_feed_rows(
    db: &DatabaseService,
    query: &FeedRowsQueryInput,
) -> Result<Vec<FeedRowOutput>, Error> {
    let user_id = normalize_text(&query.user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;

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
            params.insert("@date_from".into(), Value::String(query.date_from.clone()));
        }
        if !query.date_to.trim().is_empty() {
            date_query.push_str("AND created_at <= @date_to ");
            params.insert("@date_to".into(), Value::String(query.date_to.clone()));
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

    Ok(db
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

fn query_feed_read_model(
    db: &DatabaseService,
    query: FeedReadModelQueryInput,
) -> Result<FeedReadModelOutput, Error> {
    let rows_query = FeedRowsQueryInput {
        user_id: query.user_id.clone(),
        mode: query.mode.clone(),
        search: query.search.clone(),
        filters: query.filters.clone(),
        vip_list: query.vip_list.clone(),
        max_entries: query.max_entries,
        date_from: query.date_from.clone(),
        date_to: query.date_to.clone(),
    };
    let rows = query_feed_rows(db, &rows_query)?
        .into_iter()
        .map(feed_row_output_to_value)
        .collect::<Vec<_>>();
    let max_rows = if query.max_rows > 0 {
        query.max_rows
    } else {
        query.max_entries
    };

    Ok(merge_feed_live_rows(FeedLiveRowsMergeInput {
        rows,
        current_user_id: query.user_id,
        filters: query.filters,
        search: query.search,
        date_from: query.date_from,
        date_to: query.date_to,
        favorites_only: query.favorites_only,
        favorite_user_ids: query.favorite_user_ids,
        live_entries: query.live_entries,
        min_live_sequence: query.min_live_sequence,
        max_rows,
    }))
}

pub fn app__feed_rows_query(
    db: &DatabaseService,
    query: FeedRowsQueryInput,
) -> Result<Vec<FeedRowOutput>, Error> {
    query_feed_rows(db, &query)
}

pub fn app__feed_read_model_query(
    db: &DatabaseService,
    query: FeedReadModelQueryInput,
) -> Result<FeedReadModelOutput, Error> {
    query_feed_read_model(db, query)
}

pub fn app__feed_live_rows_merge(query: FeedLiveRowsMergeInput) -> FeedReadModelOutput {
    merge_feed_live_rows(query)
}

pub fn app__game_log_entries_add(
    db: &DatabaseService,
    kind: String,
    entries: Vec<Value>,
) -> Result<(), Error> {
    let batch = game_log_batch_for_kind(&kind, entries);
    write_game_log_batch(db, &batch)?;
    Ok(())
}

pub fn app__game_log_instance_delete_by_location(
    db: &DatabaseService,
    location: String,
) -> Result<i64, Error> {
    ensure_game_log_tables(db)?;
    db.execute_non_query(
        "DELETE FROM gamelog_location WHERE location = @location",
        &ParamsBuilder::new()
            .set("location", normalize_text(location))
            .build(),
    )
}

pub fn app__game_log_instance_delete(
    db: &DatabaseService,
    location: String,
    event_ids: Vec<i64>,
) -> Result<i64, Error> {
    ensure_game_log_tables(db)?;
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
    db.execute_non_query(
        &format!(
            "DELETE FROM gamelog_join_leave WHERE (location = @location) AND (id IN ({}))",
            placeholders.join(", ")
        ),
        &params.build(),
    )
}

pub fn app__game_log_entry_delete(
    db: &DatabaseService,
    kind: String,
    entry: Value,
) -> Result<i64, Error> {
    ensure_game_log_tables(db)?;
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
        return db.execute_non_query(
            &format!("DELETE FROM {table_name} WHERE id = @id"),
            &ParamsBuilder::new().set("id", row_id).build(),
        );
    }
    db.execute_non_query(
        &format!("DELETE FROM {table_name} WHERE created_at = @created_at AND {fallback_column} = @fallback_value"),
        &ParamsBuilder::new()
            .set("created_at", object_field_string(&entry, &["created_at", "createdAt"]))
            .set("fallback_value", fallback_value)
        .build(),
    )
}

pub fn app__game_log_query(db: &DatabaseService, query: GameLogQueryInput) -> Result<Value, Error> {
    ensure_game_log_tables(db)?;
    let params = query.params;
    let kind = normalize_text(&query.kind);
    match kind.as_str() {
        "recentDatabase" => {
            let date_offset = query_param_string(&params, "dateOffset");
            let limit = query_param_i64(&params, "maxTableSize", 500);
            let mut rows = Vec::new();
            for row in db.execute(
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
            for row in db.execute(
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
            for row in db.execute(
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
            for row in db.execute(
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
            for row in db.execute(
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
            for row in db.execute(
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
            for row in db.execute(
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
                db.execute(
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
            let row = db
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
            let count = db
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
            let time_spent = db
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
            let created_at = db
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
            for row in db.execute(
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
            let row = db
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
            let count = db
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
            let time_spent = db
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
            let last_seen = db
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
            let stats = db
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
            for row in db.execute(
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
                db.execute(
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
                if let Some(date) = db
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
                db
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
                db.execute(
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
                db
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
            let row = db
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
                db.execute(
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
                db.execute(
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
                db.execute(
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
            db.execute(
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
                if let Some(row) = db
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
            for row in db.execute(
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
                db
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
                db
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
                db
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
                db.execute(
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
                db
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
            let world_name = db
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
            let user_id = db
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
                db.execute(
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
                db.execute(
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
            for row in db.execute(
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
            for row in db.execute(
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
                db.execute(
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
        _ => Err(Error::Custom(format!(
            "Unknown game log query: {}",
            query.kind
        ))),
    }
}

pub fn app__player_list_location_get(
    db: &DatabaseService,
    location: String,
) -> Result<Option<PlayerLocationOutput>, Error> {
    ensure_game_log_tables(db)?;
    let location = normalize_text(location);
    if location.is_empty() {
        return Ok(None);
    }
    Ok(db
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

pub fn app__player_list_latest_location_get(
    db: &DatabaseService,
) -> Result<Option<PlayerLocationOutput>, Error> {
    ensure_game_log_tables(db)?;
    Ok(db
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

pub fn app__player_list_join_leave_rows(
    db: &DatabaseService,
    location: String,
    started_at: String,
) -> Result<Vec<PlayerJoinLeaveOutput>, Error> {
    ensure_game_log_tables(db)?;
    Ok(db
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

pub fn app__instance_activity_dates_get(
    db: &DatabaseService,
    user_id: String,
) -> Result<Vec<String>, Error> {
    ensure_game_log_tables(db)?;
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }
    Ok(db
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

pub fn app__instance_activity_rows_get(
    db: &DatabaseService,
    start_date: String,
    end_date: String,
) -> Result<Vec<InstanceActivityRowOutput>, Error> {
    ensure_game_log_tables(db)?;
    Ok(db
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

pub fn app__world_summaries_get(
    db: &DatabaseService,
    world_ids: Vec<String>,
) -> Result<HashMap<String, WorldSummaryOutput>, Error> {
    ensure_global_local_data_tables(db)?;
    ensure_game_log_tables(db)?;
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
    for row in db.execute(
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

    for row in db.execute(
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

#[derive(Clone, Debug)]
struct ActivitySourceLocationRow {
    created_at: String,
    time: i64,
}

#[derive(Clone, Debug)]
struct ActivitySessionRow {
    start: i64,
    end: i64,
    is_open_tail: bool,
    source_revision: String,
}

fn activity_now_ms(input: Option<i64>) -> i64 {
    input.unwrap_or_else(|| Utc::now().timestamp_millis())
}

fn activity_iso_from_ms(ms: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms)
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn parse_activity_time_ms(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.timestamp_millis())
        .ok()
        .or_else(|| {
            NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
                .ok()
                .map(|value| value.and_utc().timestamp_millis())
        })
}

fn clamp_activity_range_days(value: &Value, default_value: i64) -> i64 {
    let days = value_as_i64(value);
    let days = if days > 0 { days } else { default_value };
    days.clamp(1, ACTIVITY_MAX_RANGE_DAYS)
}

fn activity_session_output_from_data(session: &ActivitySessionRow) -> ActivitySessionOutput {
    ActivitySessionOutput {
        start: session.start,
        end: session.end,
        is_open_tail: session.is_open_tail,
        source_revision: session.source_revision.clone(),
    }
}

fn activity_session_input_from_data(session: &ActivitySessionRow) -> ActivitySessionInput {
    ActivitySessionInput {
        start: json!(session.start),
        end: json!(session.end),
        is_open_tail: session.is_open_tail,
        source_revision: session.source_revision.clone(),
    }
}

fn read_activity_sessions_data(
    db: &DatabaseService,
    user_prefix: &str,
    user_id: &str,
) -> Result<Vec<ActivitySessionRow>, Error> {
    Ok(db
        .execute(
            &format!("SELECT start_at, end_at, is_open_tail, source_revision FROM {user_prefix}_activity_sessions_v2 WHERE user_id = @user_id ORDER BY start_at"),
            &ParamsBuilder::new().set("user_id", user_id.to_string()).build(),
        )?
        .into_iter()
        .map(|row| ActivitySessionRow {
            start: row_i64(&row, 0),
            end: row_i64(&row, 1),
            is_open_tail: row_i64(&row, 2) != 0,
            source_revision: row_string(&row, 3),
        })
        .collect())
}

fn read_activity_sync_state(
    db: &DatabaseService,
    user_prefix: &str,
    user_id: &str,
) -> Result<Option<ActivitySyncStateOutput>, Error> {
    Ok(db
        .execute(
            &format!("SELECT user_id, updated_at, is_self, source_last_created_at, pending_session_start_at, cached_range_days FROM {user_prefix}_activity_sync_state_v2 WHERE user_id = @user_id LIMIT 1"),
            &ParamsBuilder::new().set("user_id", user_id.to_string()).build(),
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

fn default_activity_sync_state(user_id: &str) -> ActivitySyncStateOutput {
    ActivitySyncStateOutput {
        user_id: user_id.to_string(),
        updated_at: String::new(),
        is_self: true,
        source_last_created_at: String::new(),
        pending_session_start_at: Value::Null,
        cached_range_days: 0,
    }
}

fn read_self_activity_source_slice(
    db: &DatabaseService,
    from_date: &str,
    to_date: &str,
) -> Result<Vec<ActivitySourceLocationRow>, Error> {
    ensure_game_log_tables(db)?;
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
    db_params.insert(
        "@from_date_iso".into(),
        Value::String(from_date.to_string()),
    );
    db_params.insert("@to_date_iso".into(), Value::String(to_date.to_string()));
    Ok(db
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
        .map(|row| ActivitySourceLocationRow {
            created_at: row_string(&row, 0),
            time: row_i64(&row, 1),
        })
        .collect())
}

fn read_self_activity_source_after(
    db: &DatabaseService,
    after_created_at: &str,
    inclusive: bool,
) -> Result<Vec<ActivitySourceLocationRow>, Error> {
    ensure_game_log_tables(db)?;
    let op = if inclusive { ">=" } else { ">" };
    Ok(db
        .execute(
            &format!(
                "SELECT created_at, time
                 FROM gamelog_location
                 WHERE created_at {op} @after_created_at
                 ORDER BY created_at"
            ),
            &ParamsBuilder::new()
                .set("after_created_at", normalize_text(after_created_at))
                .build(),
        )?
        .into_iter()
        .map(|row| ActivitySourceLocationRow {
            created_at: row_string(&row, 0),
            time: row_i64(&row, 1),
        })
        .collect())
}

fn merge_activity_sessions(
    older_sessions: &[ActivitySessionRow],
    newer_sessions: &[ActivitySessionRow],
) -> Vec<ActivitySessionRow> {
    let mut sessions = Vec::with_capacity(older_sessions.len() + newer_sessions.len());
    sessions.extend_from_slice(older_sessions);
    sessions.extend_from_slice(newer_sessions);
    if sessions.is_empty() {
        return sessions;
    }
    sessions.sort_by_key(|session| session.start);

    let mut merged: Vec<ActivitySessionRow> = Vec::new();
    for session in sessions {
        if let Some(last) = merged.last_mut() {
            if session.start <= last.end + ACTIVITY_ONLINE_SESSION_MERGE_GAP_MS {
                last.end = last.end.max(session.end);
                last.is_open_tail = last.is_open_tail || session.is_open_tail;
                if !session.source_revision.is_empty() {
                    last.source_revision = session.source_revision;
                }
                continue;
            }
        }
        merged.push(session);
    }
    merged
}

fn build_sessions_from_gamelog(
    rows: &[ActivitySourceLocationRow],
    now_ms: i64,
    may_have_open_tail: bool,
    source_revision: &str,
) -> Vec<ActivitySessionRow> {
    let mut raw_sessions = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let Some(start) = parse_activity_time_ms(&row.created_at) else {
            continue;
        };
        let mut duration = row.time;
        if duration == 0 {
            duration = if let Some(next) = rows.get(index + 1) {
                parse_activity_time_ms(&next.created_at)
                    .map(|next_start| next_start - start)
                    .unwrap_or(0)
            } else {
                now_ms - start
            };
            duration = duration.min(ACTIVITY_MAX_INFERRED_SESSION_MS);
        }
        if duration > 0 {
            raw_sessions.push(ActivitySessionRow {
                start,
                end: start + duration,
                is_open_tail: false,
                source_revision: source_revision.to_string(),
            });
        }
    }

    let mut sessions = merge_activity_sessions(&[], &raw_sessions);
    if may_have_open_tail {
        if let Some(last) = sessions.last_mut() {
            last.is_open_tail = true;
        }
    }
    sessions
}

fn write_activity_sync_state_data(
    db: &DatabaseService,
    user_prefix: &str,
    user_id: &str,
    sync: &ActivitySyncStateOutput,
) -> Result<(), Error> {
    db.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_activity_sync_state_v2 (user_id, updated_at, is_self, source_last_created_at, pending_session_start_at, cached_range_days) VALUES (@user_id, @updated_at, @is_self, @source_last_created_at, @pending_session_start_at, @cached_range_days)"),
        &ParamsBuilder::new()
            .set("user_id", user_id.to_string())
            .set("updated_at", sync.updated_at.clone())
            .set("is_self", if sync.is_self { 1 } else { 0 })
            .set("source_last_created_at", sync.source_last_created_at.clone())
            .set("pending_session_start_at", sync.pending_session_start_at.clone())
            .set("cached_range_days", sync.cached_range_days)
            .build(),
    )?;
    Ok(())
}

fn write_activity_snapshot(
    db: &DatabaseService,
    user_prefix: &str,
    user_id: &str,
    sync: &ActivitySyncStateOutput,
    sessions: &[ActivitySessionRow],
    replace_from_start_at: Option<i64>,
) -> Result<(), Error> {
    let session_inputs: Vec<ActivitySessionInput> = sessions
        .iter()
        .map(activity_session_input_from_data)
        .collect();
    db.write_transaction(|tx| {
        tx.execute_non_query(
            &format!("INSERT OR REPLACE INTO {user_prefix}_activity_sync_state_v2 (user_id, updated_at, is_self, source_last_created_at, pending_session_start_at, cached_range_days) VALUES (@user_id, @updated_at, @is_self, @source_last_created_at, @pending_session_start_at, @cached_range_days)"),
            &ParamsBuilder::new()
                .set("user_id", user_id.to_string())
                .set("updated_at", sync.updated_at.clone())
                .set("is_self", if sync.is_self { 1 } else { 0 })
                .set("source_last_created_at", sync.source_last_created_at.clone())
                .set("pending_session_start_at", sync.pending_session_start_at.clone())
                .set("cached_range_days", sync.cached_range_days)
                .build(),
        )?;
        match replace_from_start_at {
            Some(replace_from_start_at) => tx.execute_non_query(
                &format!("DELETE FROM {user_prefix}_activity_sessions_v2 WHERE user_id = @user_id AND start_at >= @replace_from_start_at"),
                &ParamsBuilder::new()
                    .set("user_id", user_id.to_string())
                    .set("replace_from_start_at", replace_from_start_at)
                    .build(),
            )?,
            None => tx.execute_non_query(
                &format!("DELETE FROM {user_prefix}_activity_sessions_v2 WHERE user_id = @user_id"),
                &ParamsBuilder::new().set("user_id", user_id.to_string()).build(),
            )?,
        };
        insert_activity_sessions(tx, user_prefix, user_id, &session_inputs)?;
        Ok(())
    })?;
    Ok(())
}

fn activity_refresh_output(
    sync: ActivitySyncStateOutput,
    sessions: Vec<ActivitySessionRow>,
    source_count: usize,
) -> ActivitySelfSessionsRefreshOutput {
    ActivitySelfSessionsRefreshOutput {
        sync,
        sessions: sessions
            .iter()
            .map(activity_session_output_from_data)
            .collect(),
        source_count,
    }
}

pub fn app__activity_self_source_slice(
    db: &DatabaseService,
    query: ActivitySelfSourceSliceInput,
) -> Result<Vec<ActivitySourceLocationOutput>, Error> {
    ensure_game_log_tables(db)?;
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
    Ok(db
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

pub fn app__activity_self_source_after(
    db: &DatabaseService,
    query: ActivitySelfSourceAfterInput,
) -> Result<Vec<ActivitySourceLocationOutput>, Error> {
    ensure_game_log_tables(db)?;
    let op = if query.inclusive { ">=" } else { ">" };
    Ok(db
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

pub fn app__activity_friend_presence_slice(
    db: &DatabaseService,
    query: ActivityFriendPresenceSliceInput,
) -> Result<Vec<ActivityPresenceOutput>, Error> {
    let owner_user_id = normalize_text(query.owner_user_id);
    let user_id = normalize_text(query.user_id);
    if owner_user_id.is_empty() || user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
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
    let mut rows: Vec<ActivityPresenceOutput> = db
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
            db.execute(
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

pub fn app__activity_friend_presence_after(
    db: &DatabaseService,
    query: ActivityFriendPresenceAfterInput,
) -> Result<Vec<ActivityPresenceOutput>, Error> {
    let owner_user_id = normalize_text(query.owner_user_id);
    let user_id = normalize_text(query.user_id);
    if owner_user_id.is_empty() || user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    Ok(db
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

pub fn app__activity_self_sessions_refresh(
    db: &DatabaseService,
    input: ActivitySelfSessionsRefreshInput,
) -> Result<ActivitySelfSessionsRefreshOutput, Error> {
    let user_id = normalize_text(input.user_id);
    if user_id.is_empty() {
        return Err(Error::Custom(
            "ActivitySelfSessionsRefresh requires userId.".into(),
        ));
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_game_log_tables(db)?;
    ensure_user_local_tables(db, &user_prefix)?;

    let now_ms = activity_now_ms(input.now_ms);
    let now_iso = activity_iso_from_ms(now_ms);
    let mode = normalize_text(input.mode).to_ascii_lowercase();
    let mut sync = read_activity_sync_state(db, &user_prefix, &user_id)?
        .unwrap_or_else(|| default_activity_sync_state(&user_id));
    let mut sessions = read_activity_sessions_data(db, &user_prefix, &user_id)?;

    match mode.as_str() {
        "full" => {
            let range_days =
                clamp_activity_range_days(&input.range_days, ACTIVITY_INITIAL_RANGE_DAYS);
            let from_date = activity_iso_from_ms(now_ms - range_days * ACTIVITY_DAY_MS);
            let rows = read_self_activity_source_slice(db, &from_date, "")?;
            let source_last_created_at = rows
                .last()
                .map(|row| row.created_at.clone())
                .unwrap_or_default();
            sessions = build_sessions_from_gamelog(&rows, now_ms, true, &source_last_created_at);
            sync = ActivitySyncStateOutput {
                user_id: user_id.clone(),
                updated_at: now_iso,
                is_self: true,
                source_last_created_at,
                pending_session_start_at: Value::Null,
                cached_range_days: range_days,
            };
            write_activity_snapshot(db, &user_prefix, &user_id, &sync, &sessions, None)?;
            Ok(activity_refresh_output(sync, sessions, rows.len()))
        }
        "incremental" => {
            if sync.source_last_created_at.is_empty() {
                return Ok(activity_refresh_output(sync, sessions, 0));
            }
            let rows = read_self_activity_source_after(db, &sync.source_last_created_at, true)?;
            if rows.is_empty() {
                sync.updated_at = now_iso;
                write_activity_sync_state_data(db, &user_prefix, &user_id, &sync)?;
                return Ok(activity_refresh_output(sync, sessions, 0));
            }
            let source_last_created_at = rows
                .last()
                .map(|row| row.created_at.clone())
                .unwrap_or_default();
            let computed =
                build_sessions_from_gamelog(&rows, now_ms, true, &source_last_created_at);
            let replace_from_start_at = sessions.last().map(|session| session.start);
            sessions = merge_activity_sessions(&sessions, &computed);
            sync.updated_at = now_iso;
            sync.source_last_created_at = source_last_created_at;
            sync.pending_session_start_at = Value::Null;
            let tail_sessions = match replace_from_start_at {
                Some(replace_from_start_at) => sessions
                    .iter()
                    .filter(|session| session.start >= replace_from_start_at)
                    .cloned()
                    .collect::<Vec<_>>(),
                None => sessions.clone(),
            };
            write_activity_snapshot(
                db,
                &user_prefix,
                &user_id,
                &sync,
                &tail_sessions,
                replace_from_start_at,
            )?;
            Ok(activity_refresh_output(sync, sessions, rows.len()))
        }
        "expand" => {
            let range_days = clamp_activity_range_days(
                &input.range_days,
                (sync.cached_range_days + ACTIVITY_FULL_CACHE_BATCH_DAYS)
                    .max(ACTIVITY_INITIAL_RANGE_DAYS),
            );
            let current_days = sync.cached_range_days.max(0);
            if range_days <= current_days {
                return Ok(activity_refresh_output(sync, sessions, 0));
            }
            let from_date = activity_iso_from_ms(now_ms - range_days * ACTIVITY_DAY_MS);
            let to_date = if current_days > 0 {
                activity_iso_from_ms(now_ms - current_days * ACTIVITY_DAY_MS)
            } else {
                String::new()
            };
            let rows = read_self_activity_source_slice(db, &from_date, &to_date)?;
            let computed =
                build_sessions_from_gamelog(&rows, now_ms, false, &sync.source_last_created_at);
            if !computed.is_empty() {
                sessions = merge_activity_sessions(&computed, &sessions);
            }
            sync.cached_range_days = range_days;
            sync.updated_at = now_iso;
            write_activity_snapshot(db, &user_prefix, &user_id, &sync, &sessions, None)?;
            Ok(activity_refresh_output(sync, sessions, rows.len()))
        }
        _ => Err(Error::Custom(format!(
            "Unsupported ActivitySelfSessionsRefresh mode: {mode}"
        ))),
    }
}

pub fn app__activity_sync_state_get(
    db: &DatabaseService,
    user_id: String,
) -> Result<Option<ActivitySyncStateOutput>, Error> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(None);
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    Ok(db
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

pub fn app__activity_sessions_get(
    db: &DatabaseService,
    user_id: String,
) -> Result<Vec<ActivitySessionOutput>, Error> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    Ok(db
        .execute(
            &format!("SELECT start_at, end_at, is_open_tail, source_revision FROM {user_prefix}_activity_sessions_v2 WHERE user_id = @user_id ORDER BY start_at"),
            &ParamsBuilder::new().set("user_id", user_id).build(),
        )?
        .into_iter()
        .map(|row| activity_session_from_row(&row))
        .collect())
}

pub fn app__activity_bucket_cache_get(
    db: &DatabaseService,
    query: ActivityBucketCacheQueryInput,
) -> Result<Option<ActivityBucketCacheOutput>, Error> {
    let owner_user_id = normalize_text(query.owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(None);
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    let target_user_id = normalize_text(query.target_user_id);
    let range_days = value_as_i64(&query.range_days);
    let view_kind = normalize_text(query.view_kind);
    let exclude_key = normalize_text(query.exclude_key);
    Ok(db
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

pub fn app__activity_sync_state_upsert(
    db: &DatabaseService,
    entry: ActivitySyncStateInput,
) -> Result<(), Error> {
    let user_id = normalize_text(&entry.user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    db.execute_non_query(
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
) -> Result<(), crate::Error> {
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

pub fn app__activity_sessions_replace(
    db: &DatabaseService,
    user_id: String,
    sessions: Vec<ActivitySessionInput>,
) -> Result<(), Error> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    db.write_transaction(|tx| {
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_activity_sessions_v2 WHERE user_id = @user_id"),
            &ParamsBuilder::new().set("user_id", user_id.clone()).build(),
        )?;
        insert_activity_sessions(tx, &user_prefix, &user_id, &sessions)?;
        Ok(())
    })?;
    Ok(())
}

pub fn app__activity_sessions_append(
    db: &DatabaseService,
    user_id: String,
    sessions: Vec<ActivitySessionInput>,
    replace_from_start_at: Option<i64>,
) -> Result<(), Error> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    db.write_transaction(|tx| {
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

pub fn app__activity_bucket_cache_upsert(
    db: &DatabaseService,
    entry: ActivityBucketCacheInput,
) -> Result<(), Error> {
    let owner_user_id = normalize_text(&entry.owner_user_id);
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    db.execute_non_query(
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

pub fn app__mutual_graph_tables_ensure(
    db: &DatabaseService,
    user_id: String,
) -> Result<UserTableContextOutput, Error> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    Ok(UserTableContextOutput {
        user_id,
        user_prefix,
    })
}

pub fn app__mutual_graph_snapshot_get(
    db: &DatabaseService,
    user_id: String,
) -> Result<MutualGraphSnapshotOutput, Error> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;

    let friend_ids = db
        .execute(
            &format!("SELECT friend_id FROM {user_prefix}_mutual_graph_friends"),
            &Default::default(),
        )?
        .into_iter()
        .map(|row| row_string(&row, 0))
        .filter(|friend_id| !friend_id.is_empty())
        .collect();
    let links = db
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
    let meta = db
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
) -> Result<(), crate::Error> {
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
) -> Result<(), crate::Error> {
    tx.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_mutual_graph_links (friend_id, mutual_id) VALUES (@friend_id, @mutual_id)"),
        &ParamsBuilder::new()
            .set("friend_id", friend_id.to_string())
            .set("mutual_id", mutual_id.to_string())
            .build(),
    )?;
    Ok(())
}

pub fn app__mutual_graph_snapshot_save(
    db: &DatabaseService,
    user_id: String,
    entries: Vec<MutualGraphSnapshotEntryInput>,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    db.write_transaction(|tx| {
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

pub fn app__mutual_graph_friend_update(
    db: &DatabaseService,
    user_id: String,
    friend_id: String,
    mutual_ids: Vec<String>,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    let friend_id = normalize_text(friend_id);
    if friend_id.is_empty() {
        return Ok(());
    }
    db.write_transaction(|tx| {
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

pub fn app__mutual_graph_meta_upsert(
    db: &DatabaseService,
    user_id: String,
    entry: MutualGraphMetaInput,
) -> Result<(), Error> {
    app__mutual_graph_meta_bulk_upsert(db, user_id, vec![entry])
}

pub fn app__mutual_graph_meta_bulk_upsert(
    db: &DatabaseService,
    user_id: String,
    entries: Vec<MutualGraphMetaInput>,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    let now = now_iso();
    db.write_transaction(|tx| {
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

pub fn app__world_cache_upsert(
    db: &DatabaseService,
    entry: CacheEntityInput,
) -> Result<i64, Error> {
    upsert_cache_entity(db, "cache_world", entry)
}

pub fn app__world_cache_remove(db: &DatabaseService, world_id: String) -> Result<(), Error> {
    ensure_global_local_data_tables(db)?;
    let world_id = normalize_text(world_id);
    if world_id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        "DELETE FROM cache_world WHERE id = @world_id",
        &ParamsBuilder::new().set("world_id", world_id).build(),
    )?;
    Ok(())
}

pub fn app__world_cache_list(db: &DatabaseService) -> Result<Vec<WorldSummaryOutput>, Error> {
    ensure_global_local_data_tables(db)?;
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_world",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| world_summary_from_row(&row))
        .collect())
}

pub fn app__world_cache_get(
    db: &DatabaseService,
    world_id: String,
) -> Result<Option<WorldSummaryOutput>, Error> {
    ensure_global_local_data_tables(db)?;
    let world_id = normalize_text(world_id);
    if world_id.is_empty() {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_world WHERE id = @world_id LIMIT 1",
            &ParamsBuilder::new().set("world_id", world_id).build(),
        )?
        .first()
        .map(|row| world_summary_from_row(row)))
}

pub fn app__favorite_list(db: &DatabaseService, kind: String) -> Result<Vec<Value>, Error> {
    ensure_global_local_data_tables(db)?;
    let (table, column, _) = normalize_kind(&kind)?;
    let id_key = match kind.trim() {
        "friend" => "userId",
        "avatar" => "avatarId",
        "world" => "worldId",
        _ => "entityId",
    };
    Ok(db
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

pub fn app__favorite_add(
    db: &DatabaseService,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64, Error> {
    ensure_global_local_data_tables(db)?;
    let (table, column, entity_param) = normalize_kind(&kind)?;
    db.execute_non_query(
        &format!("INSERT OR REPLACE INTO {table} ({column}, group_name, created_at) VALUES ({entity_param}, @group_name, @created_at)"),
        &ParamsBuilder::new()
            .set(entity_param, normalize_text(entity_id))
            .set("group_name", normalize_text(group_name))
            .set("created_at", now_iso())
            .build(),
    )
}

pub fn app__favorite_remove(
    db: &DatabaseService,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64, Error> {
    ensure_global_local_data_tables(db)?;
    let (table, column, _) = normalize_kind(&kind)?;
    db.execute_non_query(
        &format!("DELETE FROM {table} WHERE {column} = @entity_id AND group_name = @group_name"),
        &ParamsBuilder::new()
            .set("entity_id", normalize_text(entity_id))
            .set("group_name", normalize_text(group_name))
            .build(),
    )
}

pub fn app__favorite_group_rename(
    db: &DatabaseService,
    kind: String,
    group_name: String,
    new_group_name: String,
) -> Result<i64, Error> {
    ensure_global_local_data_tables(db)?;
    let (table, _, _) = normalize_kind(&kind)?;
    db.execute_non_query(
        &format!("UPDATE {table} SET group_name = @new_group_name WHERE group_name = @group_name"),
        &ParamsBuilder::new()
            .set("new_group_name", normalize_text(new_group_name))
            .set("group_name", normalize_text(group_name))
            .build(),
    )
}

pub fn app__favorite_group_delete(
    db: &DatabaseService,
    kind: String,
    group_name: String,
) -> Result<i64, Error> {
    ensure_global_local_data_tables(db)?;
    let (table, _, _) = normalize_kind(&kind)?;
    db.execute_non_query(
        &format!("DELETE FROM {table} WHERE group_name = @group_name"),
        &ParamsBuilder::new()
            .set("group_name", normalize_text(group_name))
            .build(),
    )
}

pub fn app__memo_get_user(
    db: &DatabaseService,
    user_id: String,
) -> Result<Option<UserMemoOutput>, Error> {
    ensure_global_local_data_tables(db)?;
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(None);
    }
    Ok(db
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

pub fn app__memo_list_users(db: &DatabaseService) -> Result<Vec<UserMemoOutput>, Error> {
    ensure_global_local_data_tables(db)?;
    Ok(db
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

pub fn app__memo_list_user_notes(
    db: &DatabaseService,
    owner_user_id: String,
) -> Result<Vec<UserNoteOutput>, Error> {
    let owner_user_id = normalize_text(owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_local_tables(db, &user_prefix)?;
    Ok(db
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

pub fn app__memo_get_world(
    db: &DatabaseService,
    world_id: String,
) -> Result<Option<WorldMemoOutput>, Error> {
    ensure_global_local_data_tables(db)?;
    let world_id = normalize_text(world_id);
    if world_id.is_empty() {
        return Ok(None);
    }
    Ok(db
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

pub fn app__memo_get_avatar(
    db: &DatabaseService,
    avatar_id: String,
) -> Result<Option<AvatarMemoOutput>, Error> {
    ensure_global_local_data_tables(db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(None);
    }
    Ok(db
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

pub fn app__memo_save_user(
    db: &DatabaseService,
    user_id: String,
    memo: String,
) -> Result<MemoSaveResult, Error> {
    save_memo(db, "memos", "user_id", user_id, memo)
}

pub fn app__memo_save_world(
    db: &DatabaseService,
    world_id: String,
    memo: String,
) -> Result<MemoSaveResult, Error> {
    save_memo(db, "world_memos", "world_id", world_id, memo)
}

pub fn app__memo_save_avatar(
    db: &DatabaseService,
    avatar_id: String,
    memo: String,
) -> Result<MemoSaveResult, Error> {
    save_memo(db, "avatar_memos", "avatar_id", avatar_id, memo)
}

pub fn app__friend_log_current_list(
    db: &DatabaseService,
    user_id: String,
) -> Result<Vec<FriendLogCurrentOutput>, Error> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    Ok(db
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

pub fn app__friend_log_history_query(
    db: &DatabaseService,
    query: FriendLogHistoryQueryInput,
) -> Result<Vec<FriendLogHistoryOutput>, Error> {
    let user_id = normalize_text(query.user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
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
    Ok(db
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

pub fn app__friend_log_replace_current(
    db: &DatabaseService,
    user_id: String,
    entries: Vec<FriendLogCurrentEntryInput>,
    options: FriendLogReplaceOptionsInput,
) -> Result<FriendLogMutationResult, Error> {
    let owner_user_id = normalize_text(&user_id);
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let history_count = db.write_transaction(|tx| {
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
        Ok::<i64, crate::Error>(written_history_count)
    })?;
    Ok(FriendLogMutationResult {
        user_id: owner_user_id,
        target_user_id: String::new(),
        count: entries.len() as i64,
        inserted: None,
        history_count,
    })
}

pub fn app__friend_log_delete_current_array(
    db: &DatabaseService,
    user_id: String,
    target_user_ids: Vec<String>,
    options: FriendLogDeleteOptionsInput,
) -> Result<FriendLogMutationResult, Error> {
    let owner_user_id = normalize_text(&user_id);
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
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
    let result = db.write_transaction(|tx| {
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
        Ok::<(i64, i64), crate::Error>((deleted_count, written_history_count))
    })?;
    Ok(FriendLogMutationResult {
        user_id: owner_user_id,
        target_user_id: String::new(),
        count: result.0,
        inserted: None,
        history_count: result.1,
    })
}

pub fn app__friend_log_upsert_current(
    db: &DatabaseService,
    user_id: String,
    entry: FriendLogCurrentEntryInput,
    options: FriendLogUpsertOptionsInput,
) -> Result<FriendLogMutationResult, Error> {
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
    ensure_realtime_tables(db, &user_prefix)?;
    let result = db.write_transaction(|tx| {
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
        Ok::<(bool, i64), crate::Error>((inserted, history_count))
    })?;
    Ok(FriendLogMutationResult {
        user_id: owner_user_id,
        target_user_id,
        count: 1,
        inserted: Some(result.0),
        history_count: result.1,
    })
}

pub fn app__friend_log_delete_current(
    db: &DatabaseService,
    user_id: String,
    target_user_id: String,
) -> Result<i64, Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    db.execute_non_query(
        &format!("DELETE FROM {user_prefix}_friend_log_current WHERE user_id = @user_id"),
        &ParamsBuilder::new()
            .set("user_id", normalize_text(target_user_id))
            .build(),
    )
}

pub fn app__friend_log_history_add(
    db: &DatabaseService,
    user_id: String,
    entries: Vec<FriendLogHistoryEntryInput>,
) -> Result<i64, Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let count = db.write_transaction(|tx| {
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
        Ok::<i64, crate::Error>(written_count)
    })?;
    Ok(count)
}

pub fn app__friend_log_history_delete(
    db: &DatabaseService,
    user_id: String,
    entry: FriendLogHistoryEntryInput,
) -> Result<i64, Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let row_id = value_as_i64(&entry.row_id);
    if row_id > 0 {
        return db.execute_non_query(
            &format!("DELETE FROM {user_prefix}_friend_log_history WHERE id = @row_id"),
            &ParamsBuilder::new().set("row_id", row_id).build(),
        );
    }
    db.execute_non_query(
        &format!("DELETE FROM {user_prefix}_friend_log_history WHERE created_at = @created_at AND type = @type AND user_id = @user_id"),
        &ParamsBuilder::new()
            .set("created_at", entry.created_at)
            .set("type", entry.r#type)
            .set("user_id", normalize_text(entry.user_id))
        .build(),
    )
}

fn notification_filter_params(
    filters: &[String],
    search: &str,
    search_columns: &[&str],
) -> (String, DbParams) {
    let mut params = HashMap::new();
    let mut clauses = Vec::new();
    let filters = filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let type_placeholders = add_list_params(&mut params, &filters, "notification_type");
    if !type_placeholders.is_empty() {
        clauses.push(format!("type IN ({})", type_placeholders.join(", ")));
    }

    let search = normalize_text(search).to_lowercase();
    if !search.is_empty() {
        params.insert("@search_like".into(), Value::String(format!("%{search}%")));
        clauses.push(format!(
            "({})",
            search_columns
                .iter()
                .map(|column| format!("LOWER(COALESCE({column}, '')) LIKE @search_like"))
                .collect::<Vec<_>>()
                .join(" OR ")
        ));
    }

    if clauses.is_empty() {
        (String::new(), params)
    } else {
        (format!(" WHERE {}", clauses.join(" AND ")), params)
    }
}

fn notification_date_millis(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.timestamp_millis())
        .unwrap_or(0)
}

fn notification_expires_at_expired(value: &str, now: DateTime<Utc>) -> bool {
    if value.trim().is_empty() {
        return false;
    }
    DateTime::parse_from_rfc3339(value)
        .map(|date| date <= now)
        .unwrap_or(false)
}

fn notification_value_text(value: &Value, key: &str) -> String {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .map(value_as_string)
        .unwrap_or_default()
}

fn notification_matches_search(notification: &NotificationListItemOutput, search: &str) -> bool {
    let search = normalize_text(search).to_lowercase();
    if search.is_empty() {
        return true;
    }

    [
        notification.r#type.clone(),
        notification.sender_username.clone(),
        notification.sender_user_id.clone(),
        notification.title.clone(),
        notification.message.clone(),
        notification.link_text.clone(),
        notification.link.clone(),
        notification_value_text(&notification.details, "worldName"),
        notification_value_text(&notification.details, "worldId"),
        notification_value_text(&notification.details, "inviteMessage"),
        notification_value_text(&notification.details, "requestMessage"),
        notification_value_text(&notification.details, "responseMessage"),
        notification_value_text(&notification.data, "groupName"),
    ]
    .iter()
    .any(|value| value.to_lowercase().contains(&search))
}

fn notification_matches_filters(
    notification: &NotificationListItemOutput,
    filters: &[String],
) -> bool {
    let filters = filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    filters.is_empty() || filters.iter().any(|filter| filter == &notification.r#type)
}

fn notification_v1_list_item(row: NotificationV1RowOutput) -> NotificationListItemOutput {
    let details = json!({
        "worldId": row.world_id,
        "worldName": row.world_name,
        "imageUrl": row.image_url,
        "inviteMessage": row.invite_message,
        "requestMessage": row.request_message,
        "responseMessage": row.response_message,
    });
    NotificationListItemOutput {
        id: row.id,
        version: 1,
        created_at: row.created_at.clone(),
        created_at_legacy: row.created_at,
        updated_at: String::new(),
        expires_at: String::new(),
        r#type: row.r#type,
        link: String::new(),
        link_text: String::new(),
        message: row.message,
        title: String::new(),
        image_url: row.image_url,
        seen: false,
        sender_user_id: row.sender_user_id,
        sender_username: row.sender_username,
        receiver_user_id: row.receiver_user_id,
        data: json!({}),
        responses: json!([]),
        details,
        expired: row.expired == 1,
    }
}

fn notification_v2_list_item(
    row: NotificationV2RowOutput,
    now: DateTime<Utc>,
) -> NotificationListItemOutput {
    let expires_at = row.expires_at;
    let expired = notification_expires_at_expired(&expires_at, now);
    let data = parse_json_value(&Value::String(row.data), json!({}));
    let responses = parse_json_value(&Value::String(row.responses), json!([]));
    let details = parse_json_value(&Value::String(row.details), json!({}));
    NotificationListItemOutput {
        id: row.id,
        version: 2,
        created_at: row.created_at.clone(),
        created_at_legacy: row.created_at,
        updated_at: row.updated_at,
        expires_at,
        r#type: row.r#type,
        link: row.link,
        link_text: row.link_text,
        message: row.message,
        title: row.title,
        image_url: row.image_url,
        seen: row.seen == 1,
        sender_user_id: row.sender_user_id,
        sender_username: row.sender_username,
        receiver_user_id: String::new(),
        data: if data.is_object() { data } else { json!({}) },
        responses: if responses.is_array() {
            responses
        } else {
            json!([])
        },
        details: if details.is_object() {
            details
        } else {
            json!({})
        },
        expired,
    }
}

fn notification_push_dedup(
    deduped: &mut HashMap<String, NotificationListItemOutput>,
    notification: NotificationListItemOutput,
) {
    if notification.id.trim().is_empty() {
        return;
    }
    let should_replace = deduped
        .get(&notification.id)
        .map(|existing| notification.version >= existing.version)
        .unwrap_or(true);
    if should_replace {
        deduped.insert(notification.id.clone(), notification);
    }
}

pub fn app__notification_rows_query(
    db: &DatabaseService,
    query: NotificationRowsQueryInput,
) -> Result<NotificationRowsOutput, Error> {
    let user_id = normalize_text(query.user_id);
    if user_id.is_empty() {
        return Ok(NotificationRowsOutput {
            v1_rows: Vec::new(),
            v2_rows: Vec::new(),
            unseen_v2_rows: Vec::new(),
        });
    }

    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let limit = if query.per_table_limit > 0 {
        query.per_table_limit
    } else {
        500
    };
    let (where_sql, mut params) = build_type_filter(&query.filters);
    params.insert("@limit".into(), Value::from(limit));

    let v1_rows = db
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
    let v2_rows = db
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
        db
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

fn query_notification_list(
    db: &DatabaseService,
    query: NotificationListQueryInput,
) -> Result<Vec<NotificationListItemOutput>, Error> {
    let user_id = normalize_text(query.user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }

    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let per_table_limit = if query.per_table_limit > 0 {
        query.per_table_limit
    } else {
        500
    };
    let final_limit = if query.limit > 0 { query.limit } else { 500 };
    let search = normalize_text(query.search);
    let now = Utc::now();

    let v1_search_columns = [
        "type",
        "sender_username",
        "sender_user_id",
        "message",
        "world_id",
        "world_name",
        "invite_message",
        "request_message",
        "response_message",
    ];
    let v2_search_columns = [
        "type",
        "sender_username",
        "sender_user_id",
        "title",
        "message",
        "link_text",
        "link",
        "data",
        "details",
    ];
    let (v1_where_sql, mut v1_params) =
        notification_filter_params(&query.filters, &search, &v1_search_columns);
    let (v2_where_sql, mut v2_params) =
        notification_filter_params(&query.filters, &search, &v2_search_columns);
    v1_params.insert("@limit".into(), Value::from(per_table_limit));
    v2_params.insert("@limit".into(), Value::from(per_table_limit));

    let v1_rows = db
        .execute(
            &format!(
                "SELECT id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired
                 FROM {user_prefix}_notifications{v1_where_sql}
                 ORDER BY created_at DESC, id DESC
                 LIMIT @limit"
            ),
            &v1_params,
        )?
        .into_iter()
        .map(|row| notification_v1_from_row(&row));
    let v2_rows = db
        .execute(
            &format!(
                "SELECT id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details
                 FROM {user_prefix}_notifications_v2{v2_where_sql}
                 ORDER BY created_at DESC, id DESC
                 LIMIT @limit"
            ),
            &v2_params,
        )?
        .into_iter()
        .map(|row| notification_v2_from_row(&row));
    let unseen_v2_rows = if query.include_unseen {
        db.execute(
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
        .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let mut deduped = HashMap::new();
    for row in v1_rows {
        notification_push_dedup(&mut deduped, notification_v1_list_item(row));
    }
    for row in v2_rows {
        notification_push_dedup(&mut deduped, notification_v2_list_item(row, now));
    }
    for row in unseen_v2_rows {
        notification_push_dedup(&mut deduped, notification_v2_list_item(row, now));
    }

    let mut notifications = deduped
        .into_values()
        .filter(|notification| notification_matches_filters(notification, &query.filters))
        .filter(|notification| notification_matches_search(notification, &search))
        .collect::<Vec<_>>();
    notifications.sort_by(|left, right| {
        notification_date_millis(&right.created_at)
            .cmp(&notification_date_millis(&left.created_at))
            .then_with(|| right.id.cmp(&left.id))
    });
    notifications.truncate(final_limit as usize);
    Ok(notifications)
}

pub fn app__notification_list_query(
    db: &DatabaseService,
    query: NotificationListQueryInput,
) -> Result<Vec<NotificationListItemOutput>, Error> {
    query_notification_list(db, query)
}

pub fn app__notification_add_v1(
    db: &DatabaseService,
    user_id: String,
    notification: Value,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;

    let id = object_field_string(&notification, &["id"]);
    let created_at = object_field_string(&notification, &["created_at", "createdAt"]);
    let notification_type = object_field_string(&notification, &["type"]);
    if id.is_empty() || created_at.is_empty() || notification_type.is_empty() {
        return Err(Error::Custom(
            "Notification is missing required field".into(),
        ));
    }

    let details = object_field(&notification, "details").unwrap_or(&Value::Null);
    let image_url = object_field_string(&notification, &["imageUrl"]);
    let detail_image_url = object_field_string(details, &["imageUrl"]);
    db.execute_non_query(
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

pub fn app__notification_add_v2(
    db: &DatabaseService,
    user_id: String,
    notification: Value,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = object_field_string(&notification, &["id"]);
    if id.is_empty() {
        return Ok(());
    }

    db.execute_non_query(
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

pub fn app__notification_v2_expire(
    db: &DatabaseService,
    user_id: String,
    id: String,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        &format!("UPDATE {user_prefix}_notifications_v2 SET expires_at = @expires_at, seen = 1 WHERE id = @id"),
        &ParamsBuilder::new().set("id", id).set("expires_at", now_iso()).build(),
    )?;
    Ok(())
}

pub fn app__notification_v2_mark_seen(
    db: &DatabaseService,
    user_id: String,
    id: String,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        &format!("UPDATE {user_prefix}_notifications_v2 SET seen = 1 WHERE id = @id"),
        &ParamsBuilder::new().set("id", id).build(),
    )?;
    Ok(())
}

pub fn app__notification_update_expired(
    db: &DatabaseService,
    user_id: String,
    id: String,
    expired: bool,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        &format!("UPDATE {user_prefix}_notifications SET expired = @expired WHERE id = @id"),
        &ParamsBuilder::new()
            .set("id", id)
            .set("expired", if expired { 1 } else { 0 })
            .build(),
    )?;
    Ok(())
}

pub fn app__notification_delete(
    db: &DatabaseService,
    user_id: String,
    id: String,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    db.write_transaction(|tx| {
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

pub fn app__notification_expire(
    db: &DatabaseService,
    user_id: String,
    id: String,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    let now = now_iso();
    db.write_transaction(|tx| {
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

pub fn app__notification_mark_seen_local_bulk(
    db: &DatabaseService,
    user_id: String,
    ids: Vec<String>,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let ids: Vec<String> = ids
        .into_iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect();
    db.write_transaction(|tx| {
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

pub fn app__local_moderation_list(
    db: &DatabaseService,
    owner_user_id: String,
) -> Result<Vec<LocalModerationOutput>, Error> {
    let owner_user_id = normalize_text(&owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_moderation_table(db, &user_prefix)?;
    Ok(db
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

pub fn app__local_moderation_get(
    db: &DatabaseService,
    owner_user_id: String,
    user_id: String,
) -> Result<Option<LocalModerationOutput>, Error> {
    let owner_user_id = normalize_text(&owner_user_id);
    let user_id = normalize_text(user_id);
    if owner_user_id.is_empty() || user_id.is_empty() {
        return Ok(None);
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_moderation_table(db, &user_prefix)?;
    Ok(db
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

pub fn app__local_moderation_set(
    db: &DatabaseService,
    owner_user_id: String,
    entry: LocalModerationInput,
) -> Result<(), Error> {
    set_local_moderation_row(db, &owner_user_id, &entry)
}

pub fn app__local_moderation_delete(
    db: &DatabaseService,
    owner_user_id: String,
    user_id: String,
) -> Result<(), Error> {
    delete_local_moderation_row(db, &owner_user_id, &user_id)
}

pub fn app__local_moderation_sync_snapshot(
    db: &DatabaseService,
    owner_user_id: String,
    rows: Vec<RemoteModerationInput>,
) -> Result<Vec<LocalModerationOutput>, Error> {
    use std::collections::{HashMap, HashSet};

    let owner_user_id = normalize_text(&owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_moderation_table(db, &user_prefix)?;

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
    let existing = db.execute(
        &format!("SELECT user_id FROM {user_prefix}_moderation"),
        &Default::default(),
    )?;

    db.write_transaction(|tx| {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-{name}-{}-{}",
                std::process::id(),
                Utc::now().timestamp_nanos_opt().unwrap_or_default()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn insert_notification_v1(
        db: &DatabaseService,
        user_prefix: &str,
        id: &str,
        created_at: &str,
        message: &str,
        world_name: &str,
    ) {
        db.execute_non_query(
            &format!("INSERT INTO {user_prefix}_notifications (id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired) VALUES (@id, @created_at, 'invite', 'usr_sender', 'Sender', 'usr_owner', @message, 'wrld_1', @world_name, '', '', '', '', 0)"),
            &ParamsBuilder::new()
                .set("id", id)
                .set("created_at", created_at)
                .set("message", message)
                .set("world_name", world_name)
                .build(),
        )
        .unwrap();
    }

    fn insert_notification_v2(
        db: &DatabaseService,
        user_prefix: &str,
        id: &str,
        created_at: &str,
        message: &str,
        seen: i64,
    ) {
        db.execute_non_query(
            &format!("INSERT INTO {user_prefix}_notifications_v2 (id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details) VALUES (@id, @created_at, '', '2099-01-01T00:00:00.000Z', 'invite', '', '', @message, '', '', @seen, 'usr_sender', 'Sender', @data, '[]', @details)"),
            &ParamsBuilder::new()
                .set("id", id)
                .set("created_at", created_at)
                .set("message", message)
                .set("seen", seen)
                .set("data", json!({ "groupName": "Searchable Group" }).to_string())
                .set("details", json!({ "worldName": "Searchable World" }).to_string())
                .build(),
        )
        .unwrap();
    }

    fn insert_feed_gps_row(
        db: &DatabaseService,
        user_prefix: &str,
        id: i64,
        created_at: &str,
        user_id: &str,
        display_name: &str,
    ) {
        db.execute_non_query(
            &format!("INSERT INTO {user_prefix}_feed_gps (id, created_at, user_id, display_name, location, world_name, previous_location, time, group_name) VALUES (@id, @created_at, @user_id, @display_name, 'wrld_1:123', 'World One', '', 0, '')"),
            &ParamsBuilder::new()
                .set("id", id)
                .set("created_at", created_at)
                .set("user_id", user_id)
                .set("display_name", display_name)
                .build(),
        )
        .unwrap();
    }

    #[test]
    fn feed_read_model_merges_live_entries_before_persisted_and_dedups_by_type_row_id() {
        let dir = TestDir::new("feed-read-model-query");
        let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();
        let user_id = "usr_owner";
        let user_prefix = normalize_user_table_prefix(user_id).unwrap();
        ensure_realtime_tables(&db, &user_prefix).unwrap();
        insert_feed_gps_row(
            &db,
            &user_prefix,
            1,
            "2026-01-01T00:00:00.000Z",
            "usr_friend",
            "Persisted old",
        );

        let output = query_feed_read_model(
            &db,
            FeedReadModelQueryInput {
                user_id: user_id.into(),
                mode: "lookup".into(),
                search: String::new(),
                filters: vec!["GPS".into()],
                vip_list: Vec::new(),
                max_entries: 10,
                date_from: String::new(),
                date_to: String::new(),
                live_entries: vec![
                    FeedLiveEntryInput {
                        sequence: 1,
                        entry: json!({
                            "rowId": 99,
                            "type": "GPS",
                            "userId": "usr_friend",
                            "displayName": "Ignored before cursor",
                            "created_at": "2026-01-02T00:00:00.000Z"
                        }),
                    },
                    FeedLiveEntryInput {
                        sequence: 2,
                        entry: json!({
                            "rowId": 1,
                            "type": "GPS",
                            "userId": "usr_friend",
                            "displayName": "Live update",
                            "created_at": "2026-01-03T00:00:00.000Z"
                        }),
                    },
                    FeedLiveEntryInput {
                        sequence: 3,
                        entry: json!({
                            "rowId": 2,
                            "type": "GPS",
                            "userId": "usr_friend",
                            "displayName": "Live new",
                            "created_at": "2026-01-04T00:00:00.000Z"
                        }),
                    },
                    FeedLiveEntryInput {
                        sequence: 4,
                        entry: json!({
                            "rowId": 3,
                            "type": "GPS",
                            "ownerUserId": "usr_other",
                            "userId": "usr_friend",
                            "displayName": "Wrong owner",
                            "created_at": "2026-01-05T00:00:00.000Z"
                        }),
                    },
                ],
                min_live_sequence: 1,
                favorites_only: false,
                favorite_user_ids: Vec::new(),
                max_rows: 10,
            },
        )
        .unwrap();

        assert_eq!(output.max_sequence, 4);
        assert_eq!(output.rows.len(), 2);
        assert_eq!(output.rows[0]["displayName"], "Live new");
        assert_eq!(output.rows[1]["displayName"], "Live update");
        assert!(!output
            .rows
            .iter()
            .any(|row| row["displayName"] == "Persisted old"));
    }

    #[test]
    fn feed_live_rows_merge_applies_frontend_view_filters_to_live_entries_only() {
        let output = merge_feed_live_rows(FeedLiveRowsMergeInput {
            rows: vec![json!({
                "rowId": 10,
                "type": "Status",
                "userId": "usr_status",
                "displayName": "Existing status",
                "created_at": "2026-01-03T00:00:00.000Z"
            })],
            current_user_id: "usr_owner".into(),
            filters: vec!["GPS".into()],
            search: "needle".into(),
            date_from: "2026-01-01T00:00:00.000Z".into(),
            date_to: "2026-01-31T23:59:59.999Z".into(),
            favorites_only: true,
            favorite_user_ids: vec!["usr_friend".into()],
            live_entries: vec![
                FeedLiveEntryInput {
                    sequence: 1,
                    entry: json!({
                        "rowId": 1,
                        "type": "GPS",
                        "userId": "usr_friend",
                        "displayName": "Ignored before cursor",
                        "created_at": "2026-01-02T00:00:00.000Z"
                    }),
                },
                FeedLiveEntryInput {
                    sequence: 2,
                    entry: json!({
                        "rowId": 2,
                        "type": "GPS",
                        "userId": "usr_other",
                        "displayName": "Needle but not favorite",
                        "created_at": "2026-01-03T00:00:00.000Z"
                    }),
                },
                FeedLiveEntryInput {
                    sequence: 3,
                    entry: json!({
                        "rowId": 3,
                        "type": "Status",
                        "userId": "usr_friend",
                        "displayName": "Needle but wrong type",
                        "created_at": "2026-01-04T00:00:00.000Z"
                    }),
                },
                FeedLiveEntryInput {
                    sequence: 4,
                    entry: json!({
                        "rowId": 4,
                        "type": "GPS",
                        "ownerUserId": "usr_owner",
                        "userId": "usr_friend",
                        "displayName": "Needle friend",
                        "created_at": "2026-01-05T00:00:00.000Z"
                    }),
                },
            ],
            min_live_sequence: 1,
            max_rows: 10,
        });

        assert_eq!(output.max_sequence, 4);
        assert_eq!(output.rows.len(), 2);
        assert_eq!(output.rows[0]["displayName"], "Needle friend");
        assert_eq!(output.rows[1]["displayName"], "Existing status");
    }

    #[test]
    fn notification_v1_list_item_preserves_frontend_contract_shape() {
        let item = notification_v1_list_item(NotificationV1RowOutput {
            id: "notif_1".into(),
            created_at: "2026-01-02T03:04:05.000Z".into(),
            r#type: "invite".into(),
            sender_user_id: "usr_sender".into(),
            sender_username: "Sender".into(),
            receiver_user_id: "usr_receiver".into(),
            message: "hello".into(),
            world_id: "wrld_1".into(),
            world_name: "World".into(),
            image_url: "https://example.test/image.png".into(),
            invite_message: "join".into(),
            request_message: "request".into(),
            response_message: "response".into(),
            expired: 1,
        });

        assert_eq!(item.version, 1);
        assert_eq!(item.created_at, "2026-01-02T03:04:05.000Z");
        assert_eq!(item.created_at_legacy, "2026-01-02T03:04:05.000Z");
        assert_eq!(item.receiver_user_id, "usr_receiver");
        assert_eq!(item.details["worldName"], "World");
        assert_eq!(item.details["inviteMessage"], "join");
        assert!(item.responses.as_array().is_some_and(Vec::is_empty));
        assert!(item.expired);
    }

    #[test]
    fn notification_v2_list_item_parses_json_and_expiry() {
        let now = DateTime::parse_from_rfc3339("2026-01-02T00:00:00.000Z")
            .unwrap()
            .with_timezone(&Utc);
        let item = notification_v2_list_item(
            NotificationV2RowOutput {
                id: "notif_2".into(),
                created_at: "2026-01-01T00:00:00.000Z".into(),
                updated_at: "2026-01-01T01:00:00.000Z".into(),
                expires_at: "2026-01-01T02:00:00.000Z".into(),
                r#type: "group.announcement".into(),
                link: "https://example.test".into(),
                link_text: "Open".into(),
                message: "message".into(),
                title: "title".into(),
                image_url: "https://example.test/image.png".into(),
                seen: 1,
                sender_user_id: "usr_sender".into(),
                sender_username: "Sender".into(),
                data: r#"{"groupName":"Group"}"#.into(),
                responses: r#"[{"text":"OK"}]"#.into(),
                details: r#"{"worldId":"wrld_1"}"#.into(),
            },
            now,
        );

        assert_eq!(item.version, 2);
        assert!(item.seen);
        assert!(item.expired);
        assert_eq!(item.data["groupName"], "Group");
        assert_eq!(item.details["worldId"], "wrld_1");
        assert_eq!(item.responses.as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn notification_dedup_prefers_v2_contract() {
        let mut deduped = HashMap::new();
        notification_push_dedup(
            &mut deduped,
            notification_v1_list_item(NotificationV1RowOutput {
                id: "notif_same".into(),
                created_at: "2026-01-01T00:00:00.000Z".into(),
                r#type: "invite".into(),
                sender_user_id: String::new(),
                sender_username: String::new(),
                receiver_user_id: String::new(),
                message: "v1".into(),
                world_id: String::new(),
                world_name: String::new(),
                image_url: String::new(),
                invite_message: String::new(),
                request_message: String::new(),
                response_message: String::new(),
                expired: 0,
            }),
        );
        notification_push_dedup(
            &mut deduped,
            notification_v2_list_item(
                NotificationV2RowOutput {
                    id: "notif_same".into(),
                    created_at: "2026-01-01T00:00:00.000Z".into(),
                    updated_at: String::new(),
                    expires_at: String::new(),
                    r#type: "invite".into(),
                    link: String::new(),
                    link_text: String::new(),
                    message: "v2".into(),
                    title: String::new(),
                    image_url: String::new(),
                    seen: 0,
                    sender_user_id: String::new(),
                    sender_username: String::new(),
                    data: "{}".into(),
                    responses: "[]".into(),
                    details: "{}".into(),
                },
                Utc::now(),
            ),
        );

        assert_eq!(deduped.get("notif_same").map(|item| item.version), Some(2));
        assert_eq!(
            deduped.get("notif_same").map(|item| item.message.as_str()),
            Some("v2")
        );
    }

    #[test]
    fn notification_filter_params_contract_includes_type_and_search() {
        let (where_sql, params) =
            notification_filter_params(&["invite".into()], "World", &["message", "details"]);

        assert!(where_sql.contains("type IN (@notification_type_0)"));
        assert!(where_sql.contains("LOWER(COALESCE(message, '')) LIKE @search_like"));
        assert_eq!(
            params.get("@notification_type_0").and_then(Value::as_str),
            Some("invite")
        );
        assert_eq!(
            params.get("@search_like").and_then(Value::as_str),
            Some("%world%")
        );
    }

    #[test]
    fn notification_list_query_applies_db_filter_dedup_unseen_sort_and_limit() {
        let dir = TestDir::new("notification-list-query");
        let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();
        let user_id = "usr_owner";
        let user_prefix = normalize_user_table_prefix(user_id).unwrap();
        ensure_realtime_tables(&db, &user_prefix).unwrap();

        insert_notification_v1(
            &db,
            &user_prefix,
            "notif_same",
            "2026-01-01T00:00:00.000Z",
            "v1 message",
            "Searchable World",
        );
        insert_notification_v2(
            &db,
            &user_prefix,
            "notif_same",
            "2026-01-01T00:00:00.000Z",
            "v2 message",
            1,
        );
        insert_notification_v2(
            &db,
            &user_prefix,
            "notif_unseen",
            "2026-01-02T00:00:00.000Z",
            "unseen message",
            0,
        );

        let default_rows = query_notification_list(
            &db,
            NotificationListQueryInput {
                user_id: user_id.into(),
                search: String::new(),
                filters: Vec::new(),
                per_table_limit: 10,
                limit: 2,
                include_unseen: true,
            },
        )
        .unwrap();
        assert_eq!(
            default_rows
                .iter()
                .map(|row| row.id.as_str())
                .collect::<Vec<_>>(),
            vec!["notif_unseen", "notif_same"]
        );
        assert_eq!(
            default_rows
                .iter()
                .find(|row| row.id == "notif_same")
                .map(|row| (row.version, row.message.as_str())),
            Some((2, "v2 message"))
        );

        let filtered_rows = query_notification_list(
            &db,
            NotificationListQueryInput {
                user_id: user_id.into(),
                search: "searchable group".into(),
                filters: vec!["invite".into()],
                per_table_limit: 10,
                limit: 10,
                include_unseen: false,
            },
        )
        .unwrap();
        assert_eq!(filtered_rows.len(), 2);
        assert!(filtered_rows
            .iter()
            .all(|row| row.r#type == "invite" && row.data["groupName"] == "Searchable Group"));

        let unseen_filtered_rows = query_notification_list(
            &db,
            NotificationListQueryInput {
                user_id: user_id.into(),
                search: String::new(),
                filters: vec!["friendRequest".into()],
                per_table_limit: 10,
                limit: 10,
                include_unseen: true,
            },
        )
        .unwrap();
        assert!(unseen_filtered_rows.is_empty());
    }
}
