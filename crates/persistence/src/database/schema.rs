use std::collections::HashSet;

use serde_json::Value;

use crate::common::ParamsBuilder;
use crate::database::DatabaseService;
use crate::ownership::{ensure_owner_table, COL_OWNER_ID};
use crate::realtime::ensure_realtime_tables;
use crate::Error;

const GLOBAL_STORE_SCHEMA_KEY: &str = "global-store";
const FAVORITE_UNIQUE_INDEX_SCHEMA_KEY: &str = "global-store:favorite-unique-indexes";

pub(crate) fn ensure_global_store_tables(db: &DatabaseService) -> Result<(), Error> {
    db.ensure_schema_once(GLOBAL_STORE_SCHEMA_KEY, || {
        ensure_owner_table(db)?;
        for sql in [
            "CREATE TABLE IF NOT EXISTS cache_avatar (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER)",
            "CREATE TABLE IF NOT EXISTS cache_world (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER)",
            "CREATE TABLE IF NOT EXISTS cache_file (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', owner_id TEXT NOT NULL DEFAULT '', fetched_at TEXT NOT NULL DEFAULT '')",
            "CREATE TABLE IF NOT EXISTS favorite_world (id INTEGER PRIMARY KEY, created_at TEXT, world_id TEXT, group_name TEXT)",
            "CREATE TABLE IF NOT EXISTS favorite_avatar (id INTEGER PRIMARY KEY, created_at TEXT, avatar_id TEXT, group_name TEXT)",
            "CREATE TABLE IF NOT EXISTS favorite_friend (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, group_name TEXT, owner_id INTEGER NOT NULL DEFAULT 0)",
            "CREATE TABLE IF NOT EXISTS favorite_group_collection (id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, name TEXT NOT NULL, group_ids TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)",
            "CREATE UNIQUE INDEX IF NOT EXISTS favorite_group_collection_owner_name_idx ON favorite_group_collection (owner_id, name)",
            "CREATE INDEX IF NOT EXISTS favorite_group_collection_owner_created_idx ON favorite_group_collection (owner_id, created_at, id)",
            "CREATE TABLE IF NOT EXISTS memos (user_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)",
            "CREATE TABLE IF NOT EXISTS world_memos (world_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)",
            "CREATE TABLE IF NOT EXISTS avatar_memos (avatar_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)",
            "CREATE TABLE IF NOT EXISTS avatar_tags (avatar_id TEXT NOT NULL, tag TEXT NOT NULL, color TEXT, PRIMARY KEY (avatar_id, tag))",
            "CREATE TABLE IF NOT EXISTS favorite_screenshot (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL)",
        ] {
            db.execute_non_query(sql, &Default::default())?;
        }
        add_column_if_missing(
            db,
            "favorite_friend",
            COL_OWNER_ID,
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        for table in ["favorite_world", "favorite_avatar", "favorite_friend"] {
            add_column_if_missing(db, table, "sort_order", "INTEGER")?;
        }
        db.execute_non_query(
            "DROP INDEX IF EXISTS favorite_friend_user_id_group_idx",
            &Default::default(),
        )?;
        Ok(())
    })?;
    db.ensure_schema_until_stable(FAVORITE_UNIQUE_INDEX_SCHEMA_KEY, || {
        ensure_favorite_unique_indexes(db)
    })
}

const FAVORITE_UNIQUE_INDEX_TABLES: [(&str, &str, &str); 2] = [
    (
        "favorite_world",
        "world_id",
        "favorite_world_world_id_group",
    ),
    (
        "favorite_avatar",
        "avatar_id",
        "favorite_avatar_avatar_id_group",
    ),
];

fn ensure_favorite_unique_indexes(db: &DatabaseService) -> Result<bool, Error> {
    let mut stable = true;
    for (table, column, index_stem) in FAVORITE_UNIQUE_INDEX_TABLES {
        stable &= ensure_favorite_index(db, table, &format!("{column}, group_name"), index_stem)?;
    }
    stable &= ensure_favorite_index(
        db,
        "favorite_friend",
        "owner_id, user_id, group_name",
        "favorite_friend_owner_user_id_group",
    )?;
    Ok(stable)
}

fn ensure_favorite_index(
    db: &DatabaseService,
    table: &str,
    columns: &str,
    index_stem: &str,
) -> Result<bool, Error> {
    let unique_index = format!("{index_stem}_idx");
    let lookup_index = format!("{index_stem}_lookup_idx");
    if favorite_index_exists(db, &unique_index)? {
        return Ok(true);
    }
    if favorite_index_exists(db, &lookup_index)? {
        if favorite_duplicates_exist(db, table, columns)? {
            return Ok(false);
        }
        db.execute_non_query(
            &format!("CREATE UNIQUE INDEX IF NOT EXISTS {unique_index} ON {table} ({columns})"),
            &Default::default(),
        )?;
        db.execute_non_query(
            &format!("DROP INDEX IF EXISTS {lookup_index}"),
            &Default::default(),
        )?;
        return Ok(true);
    }

    if favorite_duplicates_exist(db, table, columns)? {
        tracing::warn!(
            table,
            index = unique_index,
            "preserving duplicate legacy favorite rows and creating a non-unique lookup index"
        );
        db.execute_non_query(
            &format!("CREATE INDEX IF NOT EXISTS {lookup_index} ON {table} ({columns})"),
            &Default::default(),
        )?;
        Ok(false)
    } else {
        db.execute_non_query(
            &format!("CREATE UNIQUE INDEX IF NOT EXISTS {unique_index} ON {table} ({columns})"),
            &Default::default(),
        )?;
        Ok(true)
    }
}

fn favorite_duplicates_exist(
    db: &DatabaseService,
    table: &str,
    columns: &str,
) -> Result<bool, Error> {
    let non_null_columns = columns
        .split(',')
        .map(str::trim)
        .map(|column| format!("{column} IS NOT NULL"))
        .collect::<Vec<_>>()
        .join(" AND ");
    Ok(!db
        .execute(
            &format!(
                "SELECT 1 FROM {table} WHERE {non_null_columns} GROUP BY {columns} HAVING COUNT(*) > 1 LIMIT 1"
            ),
            &Default::default(),
        )?
        .is_empty())
}

fn favorite_index_exists(db: &DatabaseService, index_name: &str) -> Result<bool, Error> {
    Ok(!db
        .execute(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = @name",
            &ParamsBuilder::new()
                .set("name", index_name.to_string())
                .build(),
        )?
        .is_empty())
}

pub(crate) fn ensure_assistant_tables(db: &DatabaseService) -> Result<(), Error> {
    db.ensure_schema_once("assistant", || {
        ensure_owner_table(db)?;
        for sql in [
            "CREATE TABLE IF NOT EXISTS assistant_session (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', entity_panel_open INTEGER NOT NULL DEFAULT 0, surfaced_entities TEXT NOT NULL DEFAULT '[]', owner_id INTEGER NOT NULL DEFAULT 0)",
            "CREATE TABLE IF NOT EXISTS assistant_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '')",
            "CREATE INDEX IF NOT EXISTS assistant_message_session_seq_idx ON assistant_message (session_id, seq)",
        ] {
            db.execute_non_query(sql, &Default::default())?;
        }
        add_column_if_missing(
            db,
            "assistant_session",
            "entity_panel_open",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            db,
            "assistant_session",
            COL_OWNER_ID,
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
    })
}

pub(crate) fn ensure_user_store_tables(
    db: &DatabaseService,
    user_prefix: &str,
) -> Result<(), Error> {
    ensure_realtime_tables(db, user_prefix)?;
    db.ensure_schema_once(&format!("user_store:{user_prefix}"), || {
        ensure_user_store_statements(db, user_prefix)
    })
}

fn ensure_user_store_statements(db: &DatabaseService, user_prefix: &str) -> Result<(), Error> {
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
            "CREATE TABLE IF NOT EXISTS {user_prefix}_activity_page_cache (
                user_id TEXT NOT NULL,
                range_days INTEGER NOT NULL,
                payload_version INTEGER NOT NULL DEFAULT 1,
                built_from_cursor TEXT NOT NULL DEFAULT '',
                payload_json TEXT NOT NULL DEFAULT '{{}}',
                built_at TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (user_id, range_days)
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
            "CREATE TABLE IF NOT EXISTS {user_prefix}_mutual_graph_meta (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0, total_count INTEGER)"
        ),
    ] {
        db.execute_non_query(&sql, &Default::default())?;
    }
    add_column_if_missing(
        db,
        &format!("{user_prefix}_mutual_graph_meta"),
        "total_count",
        "INTEGER",
    )?;
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
    Ok(column_names_from_rows(db.execute(
        &format!("PRAGMA table_info({table_name})"),
        &Default::default(),
    )?))
}

fn column_names_from_rows(rows: Vec<Vec<Value>>) -> HashSet<String> {
    rows.into_iter()
        .filter_map(|row| row.get(1).and_then(Value::as_str).map(str::to_string))
        .collect()
}

fn alter_column_if(
    db: &DatabaseService,
    table_name: &str,
    column_name: &str,
    should_alter: impl FnOnce(bool) -> bool,
    alter_sql: String,
) -> Result<bool, Error> {
    db.write_transaction(|tx| {
        let columns = column_names_from_rows(tx.execute(
            &format!("PRAGMA table_info({table_name})"),
            &Default::default(),
        )?);
        if !should_alter(columns.contains(column_name)) {
            return Ok(false);
        }
        tx.execute_non_query(&alter_sql, &Default::default())?;
        Ok(true)
    })
}

pub(crate) fn add_column_if_missing(
    db: &DatabaseService,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> Result<bool, Error> {
    let table_name = safe_identifier(table_name, "Table name")?;
    let column_name = safe_identifier(column_name, "Column name")?;
    alter_column_if(
        db,
        &table_name,
        &column_name,
        |exists| !exists,
        format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}"),
    )
}

pub(crate) fn drop_column_if_exists(
    db: &DatabaseService,
    table_name: &str,
    column_name: &str,
) -> Result<bool, Error> {
    let table_name = safe_identifier(table_name, "Table name")?;
    let column_name = safe_identifier(column_name, "Column name")?;
    alter_column_if(
        db,
        &table_name,
        &column_name,
        |exists| exists,
        format!("ALTER TABLE {table_name} DROP COLUMN {column_name}"),
    )
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

/// VRCX-0's own schema generation, stored under `VRCX_0_databaseVersion`.
/// It is a separate number line from upstream VRCX's `databaseVersion`; the two
/// are never compared or copied into each other.
pub const VRCX0_SCHEMA_VERSION: i64 = 18;

pub const VRCX0_SCHEMA_VERSION_KEY: &str = "VRCX_0_databaseVersion";
/// Upstream VRCX's schema generation, as written by upstream into an imported
/// database. VRCX-0 only advances it after applying upstream's own catch-up
/// fixes, so it always names the upstream layout the database matches.
const UPSTREAM_SCHEMA_VERSION_KEY: &str = "databaseVersion";

fn parse_version(value: &str) -> i64 {
    value.trim().parse::<i64>().unwrap_or(0)
}

pub fn read_vrcx0_schema_version(db: &DatabaseService) -> Result<i64, Error> {
    Ok(parse_version(&crate::config::get_string(
        db,
        VRCX0_SCHEMA_VERSION_KEY,
        "0",
    )?))
}

pub fn write_vrcx0_schema_version(db: &DatabaseService, version: i64) -> Result<(), Error> {
    crate::config::set_string(db, VRCX0_SCHEMA_VERSION_KEY, &version.to_string())
}

pub fn read_upstream_schema_version(db: &DatabaseService) -> Result<i64, Error> {
    Ok(parse_version(&crate::config::get_string(
        db,
        UPSTREAM_SCHEMA_VERSION_KEY,
        "0",
    )?))
}

pub fn write_upstream_schema_version(db: &DatabaseService, version: i64) -> Result<(), Error> {
    crate::config::set_string(db, UPSTREAM_SCHEMA_VERSION_KEY, &version.to_string())
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

    fn read_finishes_while_writer_is_busy(
        db: &DatabaseService,
        read: impl FnOnce() -> Result<(), Error> + Send,
    ) -> bool {
        std::thread::scope(|scope| {
            let (finished, receiver) = std::sync::mpsc::channel();
            db.write_transaction(|_| {
                scope.spawn(move || {
                    let _ = finished.send(read().is_ok());
                });
                Ok(receiver
                    .recv_timeout(std::time::Duration::from_secs(2))
                    .unwrap_or(false))
            })
            .unwrap()
        })
    }

    #[test]
    fn user_store_reads_do_not_wait_for_the_writer_once_tables_exist() {
        let db = test_db("schema-user-store-read-while-writing");
        let owner = crate::ownership::OwnerId::new("usr_self".to_string());
        crate::local_moderation::local_moderation_list(&db, owner.clone()).unwrap();

        assert!(read_finishes_while_writer_is_busy(&db, || {
            crate::local_moderation::local_moderation_list(&db, owner).map(|_| ())
        }));
    }

    #[test]
    fn assistant_reads_do_not_wait_for_the_writer_once_tables_exist() {
        let db = test_db("schema-assistant-read-while-writing");
        let owner = crate::ownership::OwnerId::new("usr_self".to_string());
        crate::assistant::assistant_sessions_load(&db, &owner).unwrap();

        assert!(read_finishes_while_writer_is_busy(&db, || {
            crate::assistant::assistant_sessions_load(&db, &owner).map(|_| ())
        }));
    }

    #[test]
    fn schema_version_lines_are_independent() {
        let db = test_db("schema-version-lines");
        assert_eq!(read_vrcx0_schema_version(&db).unwrap(), 0);
        assert_eq!(read_upstream_schema_version(&db).unwrap(), 0);

        write_upstream_schema_version(&db, 17).unwrap();
        assert_eq!(read_vrcx0_schema_version(&db).unwrap(), 0);

        write_vrcx0_schema_version(&db, VRCX0_SCHEMA_VERSION).unwrap();
        assert_eq!(read_upstream_schema_version(&db).unwrap(), 17);
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
    fn concurrent_column_adds_on_the_same_table_all_succeed() {
        let db = test_db("schema-concurrent-column-add");
        db.execute_non_query(
            "CREATE TABLE sample_table (id TEXT PRIMARY KEY)",
            &Default::default(),
        )
        .unwrap();

        let barrier = std::sync::Barrier::new(8);
        let added = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..8)
                .map(|_| {
                    scope.spawn(|| {
                        barrier.wait();
                        add_column_if_missing(&db, "sample_table", "sort_order", "INTEGER")
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap().unwrap())
                .filter(|added| *added)
                .count()
        });

        assert_eq!(added, 1);
        assert!(table_column_names(&db, "sample_table")
            .unwrap()
            .contains("sort_order"));
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
