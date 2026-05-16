#![allow(non_snake_case)]

use chrono::{SecondsFormat, Utc};
use serde_json::Value;
use tauri::State;
use vrcx_0_persistence::common::ParamsBuilder;
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
pub fn app__avatar_cache_upsert(
    state: State<'_, AppState>,
    entry: CacheEntityInput,
) -> Result<i64, AppError> {
    upsert_cache_entity(&state.db, "cache_avatar", entry)
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
