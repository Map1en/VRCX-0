use std::collections::HashSet;

use serde_json::Value;

use crate::database::DatabaseService;
use crate::realtime::ensure_realtime_tables;
use crate::Error;

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

pub(crate) fn ensure_assistant_tables(db: &DatabaseService) -> Result<(), Error> {
    for sql in [
        "CREATE TABLE IF NOT EXISTS assistant_session (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', entity_panel_open INTEGER NOT NULL DEFAULT 0, surfaced_entities TEXT NOT NULL DEFAULT '[]')",
        "CREATE TABLE IF NOT EXISTS assistant_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '')",
        "CREATE INDEX IF NOT EXISTS assistant_message_session_seq_idx ON assistant_message (session_id, seq)",
    ] {
        db.execute_non_query(sql, &Default::default())?;
    }
    // Upgrade tables created before the UI-state columns existed.
    add_column_if_missing(
        db,
        "assistant_session",
        "entity_panel_open",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        db,
        "assistant_session",
        "surfaced_entities",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    add_column_if_missing(db, "assistant_session", "endpoint_id", "TEXT")?;
    add_column_if_missing(db, "assistant_session", "model", "TEXT")?;
    add_column_if_missing(
        db,
        "assistant_session",
        "allow_writes",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        db,
        "assistant_session",
        "playbook_mode",
        "TEXT NOT NULL DEFAULT 'auto'",
    )?;
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
) -> Result<HashSet<String>, Error> {
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

pub(crate) const VRCX0_SCHEMA_VERSION: i64 = 18;

const VRCX0_SCHEMA_VERSION_KEY: &str = "VRCX_0_databaseVersion";
const UPSTREAM_DATABASE_VERSION_KEY: &str = "databaseVersion";

fn parse_version(value: &str) -> i64 {
    value.trim().parse::<i64>().unwrap_or(0)
}

pub(crate) fn read_vrcx0_schema_version(db: &DatabaseService) -> Result<i64, Error> {
    Ok(parse_version(&crate::config::get_string(
        db,
        VRCX0_SCHEMA_VERSION_KEY,
        "0",
    )?))
}

pub(crate) fn set_vrcx0_schema_version(db: &DatabaseService, version: i64) -> Result<(), Error> {
    crate::config::set_string(db, VRCX0_SCHEMA_VERSION_KEY, &version.to_string())
}

// Databases predating the private marker key only carry the shared
// `config:vrcx_databaseversion` row. Adopt that value as our generation so the
// upgrade flow sees the true starting point: an earlier VRCX-0 database reports
// 17 (already current), while a freshly imported legacy database reports its
// real version (e.g. 16) instead of 0 — preserving the lighter upgrade path and
// its progress dialog. A value above our own generation is never ours (upstream
// never wrote it), so leave the marker unset.
pub(crate) fn backfill_vrcx0_schema_version(db: &DatabaseService) -> Result<(), Error> {
    if read_vrcx0_schema_version(db)? > 0 {
        return Ok(());
    }
    let shared = parse_version(&crate::config::get_string(
        db,
        UPSTREAM_DATABASE_VERSION_KEY,
        "0",
    )?);
    if (1..=VRCX0_SCHEMA_VERSION).contains(&shared) {
        set_vrcx0_schema_version(db, shared)?;
    }
    Ok(())
}

#[cfg(test)]
mod schema_version_tests {
    use super::*;
    use crate::database::DatabaseService;

    fn test_db(name: &str) -> DatabaseService {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        DatabaseService::new(&dir.join("VRCX-0.sqlite3")).unwrap()
    }

    #[test]
    fn backfills_marker_from_existing_vrcx0_database() {
        let db = test_db("schema-version-backfill");
        crate::config::set_string(
            &db,
            UPSTREAM_DATABASE_VERSION_KEY,
            &VRCX0_SCHEMA_VERSION.to_string(),
        )
        .unwrap();

        backfill_vrcx0_schema_version(&db).unwrap();

        assert_eq!(
            read_vrcx0_schema_version(&db).unwrap(),
            VRCX0_SCHEMA_VERSION
        );
    }

    #[test]
    fn adopts_legacy_version_for_imported_database() {
        let db = test_db("schema-version-legacy");
        crate::config::set_string(&db, UPSTREAM_DATABASE_VERSION_KEY, "16").unwrap();

        backfill_vrcx0_schema_version(&db).unwrap();

        assert_eq!(read_vrcx0_schema_version(&db).unwrap(), 16);
    }

    #[test]
    fn does_not_adopt_version_above_generation() {
        let db = test_db("schema-version-above");
        crate::config::set_string(&db, UPSTREAM_DATABASE_VERSION_KEY, "99").unwrap();

        backfill_vrcx0_schema_version(&db).unwrap();

        assert_eq!(read_vrcx0_schema_version(&db).unwrap(), 0);
    }

    #[test]
    fn backfill_is_noop_when_marker_already_set() {
        let db = test_db("schema-version-existing-marker");
        set_vrcx0_schema_version(&db, VRCX0_SCHEMA_VERSION).unwrap();
        crate::config::set_string(&db, UPSTREAM_DATABASE_VERSION_KEY, "99").unwrap();

        backfill_vrcx0_schema_version(&db).unwrap();

        assert_eq!(
            read_vrcx0_schema_version(&db).unwrap(),
            VRCX0_SCHEMA_VERSION
        );
    }

    #[test]
    fn column_add_and_drop_helpers_are_idempotent() {
        let db = test_db("schema-version-column-idempotent");
        db.execute_non_query(
            "CREATE TABLE sample_table (id TEXT PRIMARY KEY)",
            &Default::default(),
        )
        .unwrap();

        assert!(add_column_if_missing(
            &db,
            "sample_table",
            "display_name",
            "TEXT NOT NULL DEFAULT ''"
        )
        .unwrap());
        assert!(!add_column_if_missing(
            &db,
            "sample_table",
            "display_name",
            "TEXT NOT NULL DEFAULT ''"
        )
        .unwrap());
        assert!(table_column_names(&db, "sample_table")
            .unwrap()
            .contains("display_name"));

        assert!(drop_column_if_exists(&db, "sample_table", "display_name").unwrap());
        assert!(!drop_column_if_exists(&db, "sample_table", "display_name").unwrap());
        assert!(!table_column_names(&db, "sample_table")
            .unwrap()
            .contains("display_name"));
    }

    #[test]
    fn column_helpers_reject_invalid_identifiers() {
        let db = test_db("schema-version-invalid-identifiers");
        db.execute_non_query(
            "CREATE TABLE sample_table (id TEXT PRIMARY KEY)",
            &Default::default(),
        )
        .unwrap();

        let table_error =
            add_column_if_missing(&db, "sample-table", "display_name", "TEXT").unwrap_err();
        let column_error = drop_column_if_exists(&db, "sample_table", "display-name").unwrap_err();

        assert!(table_error
            .to_string()
            .contains("Table name contains invalid characters"));
        assert!(column_error
            .to_string()
            .contains("Column name contains invalid characters"));
    }
}
