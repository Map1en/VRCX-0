use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::game_log::ensure_game_log_tables;
use crate::ownership::{ensure_owner_table, OwnerId};
use crate::realtime::normalize_user_table_prefix;
use crate::{Error, Result};

const SOURCE_SCHEMA: &str = "remote_legacy_source";
const IMPORTS_TABLE: &str = "remote_legacy_imports";
const ROWS_TABLE: &str = "remote_legacy_import_rows";

const GLOBAL_TABLES: &[&str] = &[
    "gamelog_location",
    "gamelog_join_leave",
    "gamelog_portal_spawn",
    "gamelog_video_play",
    "gamelog_resource_load",
    "gamelog_event",
    "gamelog_external",
    "cache_avatar",
    "cache_world",
    "cache_file",
    "favorite_world",
    "favorite_avatar",
    "favorite_friend",
    "favorite_group_collection",
    "memos",
    "world_memos",
    "avatar_memos",
    "avatar_tags",
    "assistant_session",
    "assistant_message",
];

const USER_TABLE_SUFFIXES: &[&str] = &[
    "feed_gps",
    "feed_status",
    "feed_bio",
    "feed_avatar",
    "feed_online_offline",
    "self_profile_log",
    "friend_log_current",
    "friend_log_history",
    "notifications",
    "notifications_v2",
    "avatar_history",
    "avatar_wear_log",
    "profile_bio",
    "moderation",
    "notes",
    "mutual_graph_friends",
    "mutual_graph_links",
    "mutual_graph_meta",
];

const OWNER_ID_TABLES: &[&str] = &[
    "gamelog_location",
    "gamelog_join_leave",
    "gamelog_portal_spawn",
    "gamelog_video_play",
    "gamelog_resource_load",
    "gamelog_event",
    "gamelog_external",
    "favorite_friend",
    "favorite_group_collection",
    "assistant_session",
];

/// Counts returned after a legacy snapshot has been merged into the active server database.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteLegacyImportCounts {
    pub tables: usize,
    pub inserted_rows: usize,
    pub skipped_rows: usize,
}

/// Merges user data from a normalized legacy SQLite snapshot without replacing server data.
/// The source hash must identify the original uploaded snapshot, so retrying the same upload is
/// idempotent even when server-side normalization creates a different temporary database file.
pub fn merge_remote_legacy(
    target_db: &DatabaseService,
    normalized_snapshot_path: &Path,
    original_snapshot_sha256: &str,
    owner_user_id: &str,
) -> Result<RemoteLegacyImportCounts> {
    if target_db.is_remote() {
        return Err(Error::Database(
            "Legacy snapshot merge requires the server's local database.".into(),
        ));
    }
    if original_snapshot_sha256.len() != 64
        || !original_snapshot_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(Error::InvalidData(
            "Legacy snapshot SHA-256 must contain 64 hexadecimal characters.".into(),
        ));
    }
    let owner_user_id = owner_user_id.trim();
    if owner_user_id.is_empty() {
        return Err(Error::InvalidData(
            "Legacy snapshot import requires the authenticated owner user ID.".into(),
        ));
    }
    let owner_prefix = normalize_user_table_prefix(owner_user_id)?;

    let source_path = normalized_snapshot_path.canonicalize()?;
    let source_users = read_source_owner_ids(&source_path)?;
    ensure_import_schema(target_db, &source_users, owner_user_id)?;

    let source_path = source_path
        .to_str()
        .ok_or_else(|| Error::InvalidData("Legacy snapshot path is not valid UTF-8.".into()))?;
    let mut attach_args = std::collections::HashMap::new();
    attach_args.insert(
        "@path".to_owned(),
        serde_json::Value::String(source_path.to_owned()),
    );
    target_db.execute_non_query_exclusive(
        &format!("ATTACH DATABASE @path AS {SOURCE_SCHEMA}"),
        &attach_args,
    )?;

    let merge_result = merge_attached_snapshot(
        target_db,
        original_snapshot_sha256,
        owner_user_id,
        &owner_prefix,
    );
    let detach_result = target_db.execute_non_query_exclusive(
        &format!("DETACH DATABASE {SOURCE_SCHEMA}"),
        &Default::default(),
    );
    match (merge_result, detach_result) {
        (Ok(counts), Ok(_)) => Ok(counts),
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(error),
    }
}

fn read_source_owner_ids(path: &Path) -> Result<Vec<String>> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(Error::sqlite)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(Error::sqlite)?;
    let has_owners = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'owners')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(Error::sqlite)?;
    if !has_owners {
        return Ok(Vec::new());
    }
    let mut statement = connection
        .prepare("SELECT user_id FROM owners WHERE TRIM(user_id) <> '' ORDER BY user_id")
        .map_err(Error::sqlite)?;
    let users = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(Error::sqlite)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Error::sqlite)?;
    Ok(users)
}

fn ensure_import_schema(
    target_db: &DatabaseService,
    source_users: &[String],
    owner_user_id: &str,
) -> Result<()> {
    ensure_owner_table(target_db)?;
    crate::database::schema::ensure_global_store_tables(target_db)?;
    ensure_game_log_tables(target_db)?;
    crate::database::schema::ensure_assistant_tables(target_db)?;
    let mut owner_user_ids = source_users.to_vec();
    owner_user_ids.push(owner_user_id.to_owned());
    for user_id in &owner_user_ids {
        let owner = OwnerId::new(user_id);
        let prefix = normalize_user_table_prefix(owner.as_str())?;
        crate::database::schema::ensure_user_store_tables(target_db, &prefix)?;
        target_db.execute_non_query(
            &format!(
                "CREATE TABLE IF NOT EXISTS {prefix}_profile_bio (user_id TEXT PRIMARY KEY, bio TEXT NOT NULL DEFAULT '', checked_at TEXT NOT NULL DEFAULT '')"
            ),
            &Default::default(),
        )?;
    }
    Ok(())
}

fn merge_attached_snapshot(
    target_db: &DatabaseService,
    source_sha256: &str,
    owner_user_id: &str,
    owner_prefix: &str,
) -> Result<RemoteLegacyImportCounts> {
    target_db.write_transaction(|tx| {
        tx.execute_non_query(
            &format!(
                "CREATE TABLE IF NOT EXISTS {IMPORTS_TABLE} (
                    source_sha256 TEXT PRIMARY KEY,
                    tables INTEGER NOT NULL,
                    inserted_rows INTEGER NOT NULL,
                    skipped_rows INTEGER NOT NULL
                )"
            ),
            &Default::default(),
        )?;
        tx.execute_non_query(
            &format!(
                "CREATE TABLE IF NOT EXISTS {ROWS_TABLE} (
                    source_sha256 TEXT NOT NULL,
                    table_name TEXT NOT NULL,
                    source_row_key TEXT NOT NULL,
                    PRIMARY KEY (source_sha256, table_name, source_row_key)
                )"
            ),
            &Default::default(),
        )?;

        let mut hash_args = std::collections::HashMap::new();
        hash_args.insert(
            "@hash".to_owned(),
            serde_json::Value::String(source_sha256.to_ascii_lowercase()),
        );
        if let Some(row) = tx
            .execute(
                &format!(
                    "SELECT tables, inserted_rows, skipped_rows FROM {IMPORTS_TABLE} WHERE source_sha256 = @hash"
                ),
                &hash_args,
            )?
            .first()
        {
            return Ok(RemoteLegacyImportCounts {
                tables: value_usize(&row[0]),
                inserted_rows: value_usize(&row[1]),
                skipped_rows: value_usize(&row[2]),
            });
        }

        let mut import_args = hash_args;
        import_args.insert(
            "@owner_user_id".to_owned(),
            serde_json::Value::String(owner_user_id.to_owned()),
        );
        import_source_owners(tx, &import_args)?;
        let owner_id = tx
            .execute(
                "SELECT id FROM owners WHERE user_id = @owner_user_id LIMIT 1",
                &import_args,
            )?
            .first()
            .and_then(|row| row.first())
            .and_then(serde_json::Value::as_i64)
            .ok_or_else(|| Error::Database("Legacy import owner could not be resolved.".into()))?;
        import_args.insert("@selected_owner_id".to_owned(), serde_json::json!(owner_id));
        let table_names = allowed_source_tables(tx, owner_prefix)?;
        let mut counts = RemoteLegacyImportCounts::default();
        for table_name in table_names {
            let (inserted, skipped) = merge_table(tx, &table_name, &import_args)?;
            counts.tables += 1;
            counts.inserted_rows += inserted;
            counts.skipped_rows += skipped;
        }
        let mut record_args = import_args;
        record_args.insert(
            "@tables".to_owned(),
            serde_json::json!(counts.tables as i64),
        );
        record_args.insert(
            "@inserted".to_owned(),
            serde_json::json!(counts.inserted_rows as i64),
        );
        record_args.insert(
            "@skipped".to_owned(),
            serde_json::json!(counts.skipped_rows as i64),
        );
        tx.execute_non_query(
            &format!(
                "INSERT INTO {IMPORTS_TABLE} (source_sha256, tables, inserted_rows, skipped_rows)
                 VALUES (@hash, @tables, @inserted, @skipped)"
            ),
            &record_args,
        )?;
        Ok(counts)
    })
}

fn import_source_owners(
    tx: &DatabaseWriteTransaction<'_>,
    args: &std::collections::HashMap<String, serde_json::Value>,
) -> Result<()> {
    tx.execute_non_query(
        "INSERT OR IGNORE INTO owners (user_id) VALUES (@owner_user_id)",
        args,
    )?;
    let has_owners = tx
        .execute(
            "SELECT 1 FROM remote_legacy_source.sqlite_schema WHERE type = 'table' AND name = 'owners' LIMIT 1",
            &Default::default(),
        )?
        .len()
        > 0;
    if has_owners {
        tx.execute_non_query(
            "INSERT OR IGNORE INTO owners (user_id)
             SELECT DISTINCT TRIM(user_id) FROM remote_legacy_source.owners
             WHERE TRIM(user_id) <> ''",
            args,
        )?;
    }
    Ok(())
}

fn allowed_source_tables(
    tx: &DatabaseWriteTransaction<'_>,
    authenticated_prefix: &str,
) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for table in GLOBAL_TABLES {
        if source_table_exists(tx, table)? {
            names.push((*table).to_owned());
        }
    }
    let owner_rows = if source_table_exists(tx, "owners")? {
        tx.execute(
            "SELECT user_id FROM remote_legacy_source.owners WHERE TRIM(user_id) <> '' ORDER BY user_id",
            &Default::default(),
        )?
    } else {
        Vec::new()
    };
    let mut prefixes = HashSet::new();
    for row in owner_rows {
        let Some(user_id) = row.first().and_then(serde_json::Value::as_str) else {
            continue;
        };
        if let Ok(prefix) = normalize_user_table_prefix(user_id) {
            prefixes.insert(prefix);
        }
    }
    let mut prefixes = prefixes.into_iter().collect::<Vec<_>>();
    prefixes.sort();
    for prefix in prefixes {
        for suffix in USER_TABLE_SUFFIXES {
            let table = format!("{prefix}_{suffix}");
            if source_table_exists(tx, &table)? {
                names.push(table);
            }
        }
    }
    // Older VRCX databases did not have an owners table. Their per-user tables already
    // contain the account prefix, so import only the authenticated account's allowlisted
    // tables and never infer an account from arbitrary table names.
    for suffix in USER_TABLE_SUFFIXES {
        let table = format!("{authenticated_prefix}_{suffix}");
        if source_table_exists(tx, &table)? && !names.contains(&table) {
            names.push(table);
        }
    }
    names.sort();
    Ok(names)
}

fn source_table_exists(tx: &DatabaseWriteTransaction<'_>, table_name: &str) -> Result<bool> {
    let mut args = std::collections::HashMap::new();
    args.insert(
        "@name".to_owned(),
        serde_json::Value::String(table_name.to_owned()),
    );
    Ok(!tx
        .execute(
            "SELECT 1 FROM remote_legacy_source.sqlite_schema WHERE type = 'table' AND name = @name LIMIT 1",
            &args,
        )?
        .is_empty())
}

#[derive(Clone)]
struct Column {
    name: String,
    declared_type: String,
    primary_key_order: i64,
}

fn table_columns(
    tx: &DatabaseWriteTransaction<'_>,
    schema: &str,
    table: &str,
) -> Result<Vec<Column>> {
    let pragma = match schema {
        "main" => format!("PRAGMA main.table_info({})", quote_identifier(table)),
        SOURCE_SCHEMA => format!(
            "PRAGMA {SOURCE_SCHEMA}.table_info({})",
            quote_identifier(table)
        ),
        _ => return Err(Error::InvalidData("Invalid import database schema.".into())),
    };
    tx.execute(&pragma, &Default::default())?
        .into_iter()
        .map(|row| {
            Ok(Column {
                name: row
                    .get(1)
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                declared_type: row
                    .get(2)
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_ascii_uppercase(),
                primary_key_order: row.get(5).and_then(serde_json::Value::as_i64).unwrap_or(0),
            })
        })
        .collect()
}

fn merge_table(
    tx: &DatabaseWriteTransaction<'_>,
    table: &str,
    hash_args: &std::collections::HashMap<String, serde_json::Value>,
) -> Result<(usize, usize)> {
    let source_columns = table_columns(tx, SOURCE_SCHEMA, table)?;
    let target_columns = table_columns(tx, "main", table)?;
    let target_names = target_columns
        .iter()
        .map(|column| column.name.as_str())
        .collect::<HashSet<_>>();
    let primary_key = {
        let mut columns = source_columns
            .iter()
            .filter(|column| column.primary_key_order > 0)
            .collect::<Vec<_>>();
        columns.sort_by_key(|column| column.primary_key_order);
        columns
    };
    if primary_key.is_empty() {
        return Err(Error::InvalidData(format!(
            "Legacy import table {table} has no primary key."
        )));
    }
    let source_count = scalar_count(
        tx,
        &format!(
            "SELECT COUNT(*) FROM remote_legacy_source.{}",
            quote_identifier(table)
        ),
    )?;
    let mut projected = source_columns
        .iter()
        .filter(|column| {
            target_names.contains(column.name.as_str())
                && !(column.name.eq_ignore_ascii_case("id")
                    && column.primary_key_order > 0
                    && column.declared_type.contains("INT"))
        })
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    projected.sort_by_key(|name| {
        source_columns
            .iter()
            .position(|column| &column.name == name)
            .unwrap_or(usize::MAX)
    });
    if projected.is_empty() {
        return Err(Error::InvalidData(format!(
            "Legacy import table {table} has no compatible columns."
        )));
    }
    let has_owner_ref = OWNER_ID_TABLES.contains(&table);
    let has_source_owners = source_table_exists(tx, "owners")?;
    let select_columns = projected
        .iter()
        .map(|column| {
            if column == "owner_id" && has_owner_ref {
                "CASE WHEN src.owner_id = 0 THEN @selected_owner_id ELSE mapped_owner.id END AS owner_id".to_owned()
            } else {
                format!(
                    "src.{} AS {}",
                    quote_identifier(column),
                    quote_identifier(column)
                )
            }
        })
        .collect::<Vec<_>>();
    let partition_columns = projected
        .iter()
        .map(|column| {
            if column == "owner_id" && has_owner_ref {
                "CASE WHEN src.owner_id = 0 THEN @selected_owner_id ELSE mapped_owner.id END"
                    .to_owned()
            } else {
                format!("src.{}", quote_identifier(column))
            }
        })
        .collect::<Vec<_>>();
    let target_match = projected
        .iter()
        .map(|column| format!("dst.{0} IS src.{0}", quote_identifier(column)))
        .collect::<Vec<_>>()
        .join(" AND ");
    let source_key = format!(
        "json_array({})",
        primary_key
            .iter()
            .map(|column| format!("src.{}", quote_identifier(&column.name)))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let owner_joins = if has_owner_ref && has_source_owners {
        "LEFT JOIN remote_legacy_source.owners AS source_owner ON source_owner.id = src.owner_id
         LEFT JOIN main.owners AS mapped_owner ON mapped_owner.user_id = TRIM(source_owner.user_id)"
    } else {
        "LEFT JOIN (SELECT 0 AS id) AS mapped_owner ON 1 = 1"
    };
    let owner_filter = if has_owner_ref {
        if has_source_owners {
            "AND (src.owner_id = 0 OR mapped_owner.id IS NOT NULL)"
        } else {
            "AND src.owner_id = 0"
        }
    } else {
        ""
    };
    let select_sql = format!(
        "WITH src_rows AS (
            SELECT {},
                   ROW_NUMBER() OVER (PARTITION BY {} ORDER BY {}) AS occurrence,
                   {source_key} AS source_row_key
            FROM remote_legacy_source.{source_table} AS src
            {owner_joins}
            WHERE 1 = 1 {owner_filter}
        )
        INSERT OR IGNORE INTO main.{target_table} ({target_columns})
        SELECT {selected_columns}
        FROM src_rows AS src
        WHERE src.occurrence > (
            SELECT COUNT(*) FROM main.{target_table} AS dst WHERE {target_match}
        )
          AND NOT EXISTS (
            SELECT 1 FROM main.{ROWS_TABLE} AS ledger
            WHERE ledger.source_sha256 = @hash
              AND ledger.table_name = @table
              AND ledger.source_row_key = src.source_row_key
          )",
        select_columns.join(", "),
        partition_columns.join(", "),
        primary_key
            .iter()
            .map(|column| format!("src.{}", quote_identifier(&column.name)))
            .collect::<Vec<_>>()
            .join(", "),
        source_table = quote_identifier(table),
        target_table = quote_identifier(table),
        target_columns = projected
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", "),
        selected_columns = projected
            .iter()
            .map(|column| format!("src.{}", quote_identifier(column)))
            .collect::<Vec<_>>()
            .join(", "),
    );
    let mut args = hash_args.clone();
    args.insert(
        "@table".to_owned(),
        serde_json::Value::String(table.to_owned()),
    );
    let inserted = tx.execute_non_query(&select_sql, &args)?.max(0) as usize;

    let ledger_sql = format!(
        "INSERT OR IGNORE INTO main.{ROWS_TABLE} (source_sha256, table_name, source_row_key)
         SELECT @hash, @table, {source_key}
         FROM remote_legacy_source.{source_table} AS src
         {owner_joins}
         WHERE 1 = 1 {owner_filter}",
        source_table = quote_identifier(table),
    );
    tx.execute_non_query(&ledger_sql, &args)?;
    Ok((inserted, source_count.saturating_sub(inserted)))
}

fn scalar_count(tx: &DatabaseWriteTransaction<'_>, sql: &str) -> Result<usize> {
    let row = tx
        .execute(sql, &Default::default())?
        .into_iter()
        .next()
        .ok_or_else(|| Error::Database("Legacy import count query returned no row.".into()))?;
    Ok(row
        .first()
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_default()
        .max(0) as usize)
}

fn value_usize(value: &serde_json::Value) -> usize {
    value.as_i64().unwrap_or_default().max(0) as usize
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}
