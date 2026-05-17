#![allow(dead_code)]
#![allow(unused_imports)]

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};
use serde_json::{json, Value};
use vrcx_0_core::json::RawJson;

use crate::activity::*;
use crate::avatars::*;
use crate::cache_entities::CacheEntityInput;
use crate::common::{DbParams, ParamsBuilder};
use crate::database::maintenance::*;
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::feed::*;
use crate::friends::*;
use crate::game_log::{
    ensure_game_log_tables, write_batch as write_game_log_batch, GameLogEventEntry,
    GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogLocationTimeUpdate,
    GameLogPortalSpawnEntry, GameLogQueryInput, GameLogResourceLoadEntry, GameLogVideoPlayEntry,
    GameLogWriteBatch,
};
use crate::local_moderation::*;
use crate::memos::*;
use crate::notifications::*;
use crate::player_list::*;
use crate::realtime::{
    ensure_realtime_tables, normalize_user_table_prefix, write_realtime_batch,
    RealtimePersistenceBatch,
};
use crate::worlds::*;
use crate::Error;

pub(crate) fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
pub(crate) fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}
pub(crate) fn normalize_config_key(key: &str) -> String {
    let key = key.trim();
    if key.starts_with("config:") {
        return key.to_string();
    }
    let stripped = key.strip_prefix("VRCX_").unwrap_or(key);
    format!("config:vrcx_{}", stripped.to_ascii_lowercase())
}
pub(crate) fn normalize_kind(
    kind: &str,
) -> Result<(&'static str, &'static str, &'static str), Error> {
    match kind.trim() {
        "friend" => Ok(("favorite_friend", "user_id", "@user_id")),
        "avatar" => Ok(("favorite_avatar", "avatar_id", "@avatar_id")),
        "world" => Ok(("favorite_world", "world_id", "@world_id")),
        _ => Err(Error::Custom("unsupported favorite kind".into())),
    }
}
pub(crate) fn value_as_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.to_string(),
        other => other.to_string(),
    }
}
pub(crate) fn value_as_i64(value: &Value) -> i64 {
    if let Some(value) = value.as_i64() {
        return value;
    }
    value_as_string(value).parse::<i64>().unwrap_or(0)
}
pub(crate) fn row_value(row: &[Value], index: usize) -> &Value {
    row.get(index).unwrap_or(&Value::Null)
}
pub(crate) fn row_string(row: &[Value], index: usize) -> String {
    value_as_string(row_value(row, index))
}
pub(crate) fn row_i64(row: &[Value], index: usize) -> i64 {
    value_as_i64(row_value(row, index))
}
pub(crate) fn parse_json_value(value: &Value, fallback: Value) -> Value {
    let text = value_as_string(value);
    if text.trim().is_empty() {
        return fallback;
    }
    serde_json::from_str(&text).unwrap_or(fallback)
}
pub(crate) fn cache_entity_from_row(row: &[Value]) -> AvatarCacheOutput {
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
pub(crate) fn world_summary_from_row(row: &[Value]) -> WorldSummaryOutput {
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
pub(crate) fn player_location_from_row(row: &[Value]) -> PlayerLocationOutput {
    PlayerLocationOutput {
        created_at: row_string(row, 0),
        location: row_string(row, 1),
        world_id: row_string(row, 2),
        world_name: row_string(row, 3),
        time: row_i64(row, 4),
        group_name: row_string(row, 5),
    }
}
pub(crate) fn player_join_leave_from_row(row: &[Value]) -> PlayerJoinLeaveOutput {
    PlayerJoinLeaveOutput {
        id: row_i64(row, 0),
        created_at: row_string(row, 1),
        r#type: row_string(row, 2),
        display_name: row_string(row, 3),
        user_id: row_string(row, 4),
        time: row_i64(row, 5),
    }
}
pub(crate) fn instance_activity_from_row(row: &[Value]) -> InstanceActivityRowOutput {
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
pub(crate) fn activity_location_from_row(row: &[Value]) -> ActivitySourceLocationOutput {
    ActivitySourceLocationOutput {
        created_at: row_string(row, 0),
        time: row_i64(row, 1),
    }
}
pub(crate) fn activity_presence_from_row(row: &[Value]) -> ActivityPresenceOutput {
    ActivityPresenceOutput {
        created_at: row_string(row, 0),
        r#type: row_string(row, 1),
    }
}
pub(crate) fn activity_session_from_row(row: &[Value]) -> ActivitySessionOutput {
    ActivitySessionOutput {
        start: row_i64(row, 0),
        end: row_i64(row, 1),
        is_open_tail: row_i64(row, 2) != 0,
        source_revision: row_string(row, 3),
    }
}
pub(crate) fn is_traveling_location(location: &str) -> bool {
    matches!(location.trim(), "traveling" | "traveling:traveling")
}
pub(crate) fn notification_v1_from_row(row: &[Value]) -> NotificationV1RowOutput {
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
pub(crate) fn notification_v2_from_row(row: &[Value]) -> NotificationV2RowOutput {
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
pub(crate) fn build_type_filter(filters: &[String]) -> (String, DbParams) {
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
pub(crate) fn row_json(row: &[Value], index: usize) -> Value {
    row.get(index).cloned().unwrap_or(Value::Null)
}
pub(crate) fn add_list_params(
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

pub(crate) const ACTIVITY_FULL_CACHE_BATCH_DAYS: i64 = 30;
pub(crate) const ACTIVITY_INITIAL_RANGE_DAYS: i64 = 90;
pub(crate) const ACTIVITY_MAX_RANGE_DAYS: i64 = 3650;
pub(crate) const ACTIVITY_ONLINE_SESSION_MERGE_GAP_MS: i64 = 5 * 60 * 1000;
pub(crate) const ACTIVITY_DAY_MS: i64 = 86_400_000;
pub(crate) const ACTIVITY_MAX_INFERRED_SESSION_MS: i64 = 24 * 60 * 60 * 1000;

pub(crate) fn count_table(db: &DatabaseService, table_name: &str) -> Result<i64, Error> {
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

pub(crate) fn max_friend_log_number(db: &DatabaseService, user_prefix: &str) -> Result<i64, Error> {
    Ok(db
        .execute(
            &format!("SELECT MAX(friend_number) FROM {user_prefix}_friend_log_current"),
            &Default::default(),
        )?
        .first()
        .map(|row| row_i64(row, 0))
        .unwrap_or(0))
}

pub(crate) fn feed_row_from_unified_row(row: &[Value]) -> FeedRowOutput {
    FeedRowOutput {
        row_id: row_json(row, 0).into(),
        created_at: row_json(row, 1).into(),
        user_id: row_json(row, 2).into(),
        display_name: row_json(row, 3).into(),
        r#type: row_json(row, 4).into(),
        location: row_json(row, 5).into(),
        world_name: row_json(row, 6).into(),
        previous_location: row_json(row, 7).into(),
        time: row_json(row, 8).into(),
        group_name: row_json(row, 9).into(),
        status: row_json(row, 10).into(),
        status_description: row_json(row, 11).into(),
        previous_status: row_json(row, 12).into(),
        previous_status_description: row_json(row, 13).into(),
        bio: row_json(row, 14).into(),
        previous_bio: row_json(row, 15).into(),
        owner_id: row_json(row, 16).into(),
        avatar_name: row_json(row, 17).into(),
        current_avatar_image_url: row_json(row, 18).into(),
        current_avatar_thumbnail_image_url: row_json(row, 19).into(),
        previous_current_avatar_image_url: row_json(row, 20).into(),
        previous_current_avatar_thumbnail_image_url: row_json(row, 21).into(),
    }
}

#[derive(Default)]
pub(crate) struct FeedFilterFlags {
    pub(crate) gps: bool,
    pub(crate) status: bool,
    pub(crate) bio: bool,
    pub(crate) avatar: bool,
    pub(crate) online: bool,
    pub(crate) offline: bool,
}

pub(crate) fn feed_filter_flags(filters: &[String], include_profile: bool) -> FeedFilterFlags {
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

pub(crate) fn push_feed_online_offline_select(
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

pub(crate) fn feed_base_columns() -> &'static str {
    "id, created_at, user_id, display_name, type, location, world_name, previous_location, time, group_name, status, status_description, previous_status, previous_status_description, bio, previous_bio, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url"
}

pub(crate) fn feed_entry_value<'a>(entry: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let object = entry.as_object()?;
    keys.iter()
        .find_map(|key| object.get(*key).filter(|value| !value.is_null()))
}

pub(crate) fn feed_entry_string(entry: &Value, keys: &[&str]) -> String {
    feed_entry_value(entry, keys)
        .map(value_as_string)
        .unwrap_or_default()
}

pub(crate) fn feed_entry_details_location(entry: &Value) -> String {
    entry
        .get("details")
        .and_then(|details| feed_entry_value(details, &["location"]))
        .map(value_as_string)
        .unwrap_or_default()
}

pub(crate) fn feed_row_key(row: &Value) -> String {
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

pub(crate) fn feed_search_matches(row: &Value, search: &str) -> bool {
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

pub(crate) fn feed_live_entry_matches(
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

pub(crate) fn feed_row_output_to_value(row: FeedRowOutput) -> Value {
    serde_json::to_value(row).unwrap_or(Value::Null)
}

pub(crate) struct FeedLiveRowsMergeContext<'a> {
    pub(crate) current_user_id: &'a str,
    pub(crate) filters: &'a [String],
    pub(crate) search: &'a str,
    pub(crate) date_from: &'a str,
    pub(crate) date_to: &'a str,
    pub(crate) favorites_only: bool,
    pub(crate) favorite_user_ids: &'a [String],
    pub(crate) max_rows: i64,
}

pub(crate) fn merge_feed_rows_with_live(
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
        if feed_live_entry_matches(live_entry.entry.as_value(), &context, &favorite_user_ids) {
            matching_entries.push(live_entry.entry.clone().into_value());
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
        rows: output_rows.into_iter().map(RawJson::from).collect(),
        max_sequence,
    }
}

pub(crate) fn merge_feed_live_rows(query: FeedLiveRowsMergeInput) -> FeedReadModelOutput {
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
        query.rows.into_iter().map(RawJson::into_value).collect(),
        &query.live_entries,
        query.min_live_sequence,
        context,
    )
}

pub(crate) fn game_log_row_from_unified_row(row: &[Value]) -> Value {
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

pub(crate) fn game_log_location_segment_from_row(row: &[Value]) -> Value {
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

pub(crate) fn game_log_base_columns(include_extra: bool) -> &'static str {
    if include_extra {
        "id, created_at, type, display_name, location, user_id, time, world_id, world_name, group_name, instance_id, video_url, video_name, video_id, resource_url, resource_type, data, message"
    } else {
        "id, created_at, type, display_name, location, user_id, time, world_id, world_name, group_name, instance_id, video_url, video_name, video_id, resource_url, resource_type"
    }
}

#[derive(Default)]
pub(crate) struct GameLogFilterFlags {
    pub(crate) location: bool,
    pub(crate) onplayerjoined: bool,
    pub(crate) onplayerleft: bool,
    pub(crate) portalspawn: bool,
    pub(crate) event: bool,
    pub(crate) external: bool,
    pub(crate) videoplay: bool,
    pub(crate) stringload: bool,
    pub(crate) imageload: bool,
}

pub(crate) fn game_log_filter_flags(filters: &[String], include_extra: bool) -> GameLogFilterFlags {
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

pub(crate) fn query_param_string(params: &Value, key: &str) -> String {
    params
        .get(key)
        .map(value_as_string)
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub(crate) fn query_param_i64(params: &Value, key: &str, fallback: i64) -> i64 {
    params.get(key).map(value_as_i64).unwrap_or(fallback)
}

pub(crate) fn query_param_bool(params: &Value, key: &str) -> bool {
    params.get(key).and_then(Value::as_bool).unwrap_or(false)
}

pub(crate) fn query_param_string_array(params: &Value, key: &str) -> Vec<String> {
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

pub(crate) fn object_field<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.as_object().and_then(|object| object.get(key))
}

pub(crate) fn object_field_string(value: &Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(field) = object_field(value, key) {
            return value_as_string(field);
        }
    }
    String::new()
}

pub(crate) fn object_field_optional_string(value: &Value, keys: &[&str]) -> Value {
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

pub(crate) fn object_field_bool(value: &Value, key: &str) -> bool {
    object_field(value, key)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

pub(crate) fn is_json_value_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|number| number != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

pub(crate) fn object_field_json(value: &Value, key: &str, fallback: Value) -> String {
    object_field(value, key)
        .filter(|value| is_json_value_truthy(value))
        .cloned()
        .unwrap_or(fallback)
        .to_string()
}

pub(crate) fn game_log_batch_for_kind(kind: &str, entries: Vec<Value>) -> GameLogWriteBatch {
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

pub(crate) fn ensure_config_table(db: &DatabaseService) -> Result<(), Error> {
    db.execute_non_query(
        "CREATE TABLE IF NOT EXISTS configs (`key` TEXT PRIMARY KEY, `value` TEXT)",
        &Default::default(),
    )?;
    Ok(())
}

pub(crate) fn ensure_global_store_tables(db: &DatabaseService) -> Result<(), Error> {
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

pub(crate) fn ensure_moderation_table(
    db: &DatabaseService,
    user_prefix: &str,
) -> Result<(), Error> {
    ensure_user_store_tables(db, user_prefix)?;
    db.execute_non_query(
        &format!("CREATE TABLE IF NOT EXISTS {user_prefix}_moderation (user_id TEXT PRIMARY KEY, updated_at TEXT, display_name TEXT, block INTEGER, mute INTEGER)"),
        &Default::default(),
    )?;
    Ok(())
}

pub(crate) fn ensure_avatar_history_table(
    db: &DatabaseService,
    user_prefix: &str,
) -> Result<(), Error> {
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

pub(crate) fn ensure_user_store_tables(
    db: &DatabaseService,
    user_prefix: &str,
) -> Result<(), Error> {
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

pub(crate) fn normalize_avatar_tag_entry(entry: AvatarTagInput) -> Option<(String, Value)> {
    let tag = normalize_text(entry.tag);
    if tag.is_empty() {
        return None;
    }
    Some((tag, entry.color))
}

pub(crate) fn normalize_avatar_tag_map(
    entries: Vec<AvatarTagInput>,
) -> std::collections::BTreeMap<String, Value> {
    entries
        .into_iter()
        .filter_map(normalize_avatar_tag_entry)
        .collect()
}

pub(crate) fn nullish_color(value: &Value) -> Option<Value> {
    if value.is_null() {
        None
    } else {
        Some(value.clone())
    }
}

pub(crate) fn safe_identifier(identifier: &str, label: &str) -> Result<String, Error> {
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

pub(crate) fn select_table_names(
    db: &DatabaseService,
    where_sql: &str,
) -> Result<Vec<String>, Error> {
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

pub(crate) fn table_column_names(
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

pub(crate) fn add_column_if_missing(
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

pub(crate) fn drop_column_if_exists(
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

pub(crate) fn add_v17_global_indexes(db: &DatabaseService) -> Result<(), Error> {
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

pub(crate) fn add_notification_indexes(db: &DatabaseService) -> Result<(), Error> {
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

pub(crate) fn add_legacy_indexes(db: &DatabaseService) -> Result<(), Error> {
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

pub(crate) fn add_friend_log_history_entry(
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

pub(crate) fn current_friend_trust_level(entry: &FriendLogCurrentEntryInput) -> String {
    entry
        .trust_level
        .clone()
        .unwrap_or_else(|| "Visitor".to_string())
}

pub(crate) fn upsert_cache_entity(
    db: &DatabaseService,
    table_name: &str,
    entry: CacheEntityInput,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
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

pub(crate) fn save_memo(
    db: &DatabaseService,
    table_name: &str,
    id_column: &str,
    entity_id: String,
    memo: String,
) -> Result<MemoSaveResult, Error> {
    ensure_global_store_tables(db)?;
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

pub(crate) fn set_local_moderation_row(
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

pub(crate) fn delete_local_moderation_row(
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
