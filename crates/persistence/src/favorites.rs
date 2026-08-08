#![allow(non_snake_case)]

use serde::Serialize;
use serde_json::json;
use vrcx_0_core::FavoriteEntityKind;

use crate::common::{normalize_text, now_iso, row_string, ParamsBuilder};
use crate::config::{ensure_config_table, resolve_config_key};
use crate::database::schema::ensure_global_store_tables;
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::ownership::{owner_id_for_filter, owner_id_get_or_insert};
use crate::Error;

const LOCAL_GROUP_CONFIG_UPSERT_SQL: &str =
    "INSERT OR REPLACE INTO configs (key, value) VALUES (@key, @value)";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FavoriteMoveResult {
    pub removed: i64,
    pub added: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteRow {
    pub created_at: String,
    pub group_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_id: Option<String>,
}

impl FavoriteRow {
    fn new(
        kind: FavoriteEntityKind,
        created_at: String,
        entity_id: String,
        group_name: String,
    ) -> Self {
        let mut row = Self {
            created_at,
            group_name,
            user_id: None,
            avatar_id: None,
            world_id: None,
        };
        match kind {
            FavoriteEntityKind::Friend => row.user_id = Some(entity_id),
            FavoriteEntityKind::Avatar => row.avatar_id = Some(entity_id),
            FavoriteEntityKind::World => row.world_id = Some(entity_id),
        }
        row
    }

    pub fn entity_id(&self) -> &str {
        self.user_id
            .as_deref()
            .or(self.avatar_id.as_deref())
            .or(self.world_id.as_deref())
            .unwrap_or_default()
    }
}

pub fn favorite_list(
    db: &DatabaseService,
    owner_user_id: Option<&str>,
    kind: FavoriteEntityKind,
) -> Result<Vec<FavoriteRow>, Error> {
    ensure_global_store_tables(db)?;
    let (table, column, _) = normalize_kind(kind);
    let owner_id = owner_id_for_kind_read(db, kind, owner_user_id)?;
    Ok(db
        .execute(
            &format!(
                "SELECT created_at, {column}, group_name FROM {table} {}",
                visible_owner_where(kind)
            ),
            &ParamsBuilder::new().set("owner_id", owner_id).build(),
        )?
        .into_iter()
        .map(|row| {
            FavoriteRow::new(
                kind,
                row_string(&row, 0),
                row_string(&row, 1),
                row_string(&row, 2),
            )
        })
        .collect())
}

pub fn favorite_add(
    db: &DatabaseService,
    owner_user_id: Option<&str>,
    kind: FavoriteEntityKind,
    entity_id: String,
    group_name: String,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let (table, column, entity_param) = normalize_kind(kind);
    let owner_id = owner_id_for_kind_write(db, kind, owner_user_id)?;
    let OwnerInsertParts {
        column_sql: owner_column,
        value_sql: owner_value,
    } = owner_insert_parts(kind);
    db.execute_non_query(
        &format!(
            "INSERT OR IGNORE INTO {table} ({column}, group_name, created_at{owner_column}) SELECT {entity_param}, @group_name, @created_at{owner_value} WHERE NOT EXISTS (SELECT 1 FROM {table} WHERE {column} = {entity_param} AND group_name = @group_name {})",
            visible_owner_and(kind)
        ),
        &ParamsBuilder::new()
            .set(entity_param, normalize_text(entity_id))
            .set("group_name", normalize_text(group_name))
            .set("created_at", now_iso())
            .set("owner_id", owner_id)
            .build(),
    )
}

pub fn favorite_remove(
    db: &DatabaseService,
    owner_user_id: Option<&str>,
    kind: FavoriteEntityKind,
    entity_id: String,
    group_name: String,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let (table, column, _) = normalize_kind(kind);
    let owner_id = owner_id_for_kind_read(db, kind, owner_user_id)?;
    db.execute_non_query(
        &format!(
            "DELETE FROM {table} WHERE {column} = @entity_id AND group_name = @group_name {}",
            visible_owner_and(kind)
        ),
        &ParamsBuilder::new()
            .set("entity_id", normalize_text(entity_id))
            .set("group_name", normalize_text(group_name))
            .set("owner_id", owner_id)
            .build(),
    )
}

pub fn favorite_move(
    db: &DatabaseService,
    owner_user_id: Option<&str>,
    kind: FavoriteEntityKind,
    entity_id: String,
    source_group_name: String,
    target_group_name: String,
) -> Result<FavoriteMoveResult, Error> {
    ensure_global_store_tables(db)?;
    let (table, column, entity_param) = normalize_kind(kind);
    let normalized_entity_id = normalize_text(entity_id);
    let normalized_source_group_name = normalize_text(source_group_name);
    let normalized_target_group_name = normalize_text(target_group_name);
    let owner_id = owner_id_for_kind_write(db, kind, owner_user_id)?;
    let OwnerInsertParts {
        column_sql: owner_column,
        value_sql: owner_value,
    } = owner_insert_parts(kind);
    if normalized_entity_id.is_empty() {
        return Err(Error::Custom("favorite_move requires entity id".into()));
    }
    if normalized_source_group_name.is_empty() {
        return Err(Error::Custom(
            "favorite_move requires source group name".into(),
        ));
    }

    db.write_transaction(|tx| {
        let removed = tx.execute_non_query(
            &format!("DELETE FROM {table} WHERE {column} = @entity_id AND group_name = @group_name {}", visible_owner_and(kind)),
            &ParamsBuilder::new()
                .set("entity_id", normalized_entity_id.clone())
                .set("group_name", normalized_source_group_name)
                .set("owner_id", owner_id)
                .build(),
        )?;
        if normalized_target_group_name.is_empty() {
            return Err(Error::Custom(
                "favorite_move requires target group name".into(),
            ));
        }
        let added = tx.execute_non_query(
            &format!(
                "INSERT OR IGNORE INTO {table} ({column}, group_name, created_at{owner_column}) SELECT {entity_param}, @group_name, @created_at{owner_value} WHERE NOT EXISTS (SELECT 1 FROM {table} WHERE {column} = {entity_param} AND group_name = @group_name {})",
                visible_owner_and(kind)
            ),
            &ParamsBuilder::new()
                .set(entity_param, normalized_entity_id)
                .set("group_name", normalized_target_group_name)
                .set("created_at", now_iso())
                .set("owner_id", owner_id)
                .build(),
        )?;
        Ok(FavoriteMoveResult { removed, added })
    })
}

pub fn favorite_group_rename(
    db: &DatabaseService,
    owner_user_id: Option<&str>,
    kind: FavoriteEntityKind,
    group_name: String,
    new_group_name: String,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let (table, column, _) = normalize_kind(kind);
    let normalized_group_name = normalize_text(group_name);
    let normalized_new_group_name = normalize_text(new_group_name);
    let owner_id = owner_id_for_kind_read(db, kind, owner_user_id)?;
    let owner_scope = visible_owner_and(kind);
    db.write_transaction(|tx| {
        let deduped = delete_rows_already_in_group(
            tx,
            table,
            column,
            &normalized_group_name,
            &normalized_new_group_name,
            owner_scope,
            owner_id,
        )?;
        let renamed = tx.execute_non_query(
            &format!(
                "UPDATE {table} SET group_name = @new_group_name WHERE group_name = @group_name {owner_scope}"
            ),
            &ParamsBuilder::new()
                .set("new_group_name", normalized_new_group_name)
                .set("group_name", normalized_group_name)
                .set("owner_id", owner_id)
                .build(),
        )?;
        Ok(deduped + renamed)
    })
}

fn delete_rows_already_in_group(
    tx: &mut DatabaseWriteTransaction<'_>,
    table: &str,
    column: &str,
    group_name: &str,
    new_group_name: &str,
    owner_scope: &str,
    owner_id: i64,
) -> Result<i64, Error> {
    tx.execute_non_query(
        &format!(
            "DELETE FROM {table} WHERE group_name = @group_name {owner_scope} AND {column} IN (SELECT {column} FROM {table} WHERE group_name = @new_group_name {owner_scope})"
        ),
        &ParamsBuilder::new()
            .set("group_name", group_name.to_string())
            .set("new_group_name", new_group_name.to_string())
            .set("owner_id", owner_id)
            .build(),
    )
}

pub fn favorite_group_delete(
    db: &DatabaseService,
    owner_user_id: Option<&str>,
    kind: FavoriteEntityKind,
    group_name: String,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let (table, _, _) = normalize_kind(kind);
    let owner_id = owner_id_for_kind_read(db, kind, owner_user_id)?;
    db.execute_non_query(
        &format!(
            "DELETE FROM {table} WHERE group_name = @group_name {}",
            visible_owner_and(kind)
        ),
        &ParamsBuilder::new()
            .set("group_name", normalize_text(group_name))
            .set("owner_id", owner_id)
            .build(),
    )
}

pub fn favorite_group_rename_with_config(
    db: &DatabaseService,
    owner_user_id: Option<&str>,
    kind: FavoriteEntityKind,
    config_key: &str,
    group_name: &str,
    new_group_name: &str,
    config_groups: &[String],
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    ensure_config_table(db)?;
    let (table, column, _) = normalize_kind(kind);
    let stored_key = resolve_config_key(config_key);
    let config_value = json!(config_groups).to_string();
    let normalized_group_name = normalize_text(group_name);
    let normalized_new_group_name = normalize_text(new_group_name);
    let (owner_scope, owner_id) = config_realm_owner_scope(db, kind, config_key, owner_user_id)?;
    db.write_transaction(|tx| {
        delete_rows_already_in_group(
            tx,
            table,
            column,
            &normalized_group_name,
            &normalized_new_group_name,
            owner_scope,
            owner_id,
        )?;
        let affected = tx.execute_non_query(
            &format!(
                "UPDATE {table} SET group_name = @new_group_name WHERE group_name = @group_name {owner_scope}"
            ),
            &ParamsBuilder::new()
                .set("new_group_name", normalized_new_group_name.clone())
                .set("group_name", normalized_group_name.clone())
                .set("owner_id", owner_id)
                .build(),
        )?;
        tx.execute_non_query(
            LOCAL_GROUP_CONFIG_UPSERT_SQL,
            &ParamsBuilder::new()
                .set("key", stored_key)
                .set("value", config_value)
                .build(),
        )?;
        Ok(affected)
    })
}

pub fn favorite_group_delete_with_config(
    db: &DatabaseService,
    owner_user_id: Option<&str>,
    kind: FavoriteEntityKind,
    config_key: &str,
    group_name: &str,
    config_groups: &[String],
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    ensure_config_table(db)?;
    let (table, _, _) = normalize_kind(kind);
    let stored_key = resolve_config_key(config_key);
    let config_value = json!(config_groups).to_string();
    let (owner_scope, owner_id) = config_realm_owner_scope(db, kind, config_key, owner_user_id)?;
    db.write_transaction(|tx| {
        let affected = tx.execute_non_query(
            &format!("DELETE FROM {table} WHERE group_name = @group_name {owner_scope}"),
            &ParamsBuilder::new()
                .set("group_name", normalize_text(group_name))
                .set("owner_id", owner_id)
                .build(),
        )?;
        tx.execute_non_query(
            LOCAL_GROUP_CONFIG_UPSERT_SQL,
            &ParamsBuilder::new()
                .set("key", stored_key)
                .set("value", config_value)
                .build(),
        )?;
        Ok(affected)
    })
}

fn owner_id_for_kind_read(
    db: &DatabaseService,
    kind: FavoriteEntityKind,
    owner_user_id: Option<&str>,
) -> Result<i64, Error> {
    if kind == FavoriteEntityKind::Friend {
        owner_id_for_filter(db, owner_user_id.unwrap_or_default())
    } else {
        Ok(0)
    }
}

fn owner_id_for_kind_write(
    db: &DatabaseService,
    kind: FavoriteEntityKind,
    owner_user_id: Option<&str>,
) -> Result<i64, Error> {
    if kind == FavoriteEntityKind::Friend {
        owner_id_get_or_insert(db, owner_user_id.unwrap_or_default())
    } else {
        Ok(0)
    }
}

fn visible_owner_where(kind: FavoriteEntityKind) -> &'static str {
    if kind == FavoriteEntityKind::Friend {
        "WHERE owner_id IN (0, @owner_id)"
    } else {
        ""
    }
}

fn visible_owner_and(kind: FavoriteEntityKind) -> &'static str {
    if kind == FavoriteEntityKind::Friend {
        "AND owner_id IN (0, @owner_id)"
    } else {
        ""
    }
}

struct OwnerInsertParts {
    column_sql: &'static str,
    value_sql: &'static str,
}

fn owner_insert_parts(kind: FavoriteEntityKind) -> OwnerInsertParts {
    if kind == FavoriteEntityKind::Friend {
        OwnerInsertParts {
            column_sql: ", owner_id",
            value_sql: ", @owner_id",
        }
    } else {
        OwnerInsertParts {
            column_sql: "",
            value_sql: "",
        }
    }
}

fn config_realm_owner_scope(
    db: &DatabaseService,
    kind: FavoriteEntityKind,
    config_key: &str,
    owner_user_id: Option<&str>,
) -> Result<(&'static str, i64), Error> {
    if kind != FavoriteEntityKind::Friend {
        return Ok(("", 0));
    }
    if config_key == "localFavoriteFriendGroups" {
        Ok(("AND owner_id = 0", 0))
    } else {
        Ok((
            "AND owner_id = @owner_id",
            owner_id_for_kind_write(db, kind, owner_user_id)?,
        ))
    }
}

pub(crate) const fn normalize_kind(
    kind: FavoriteEntityKind,
) -> (&'static str, &'static str, &'static str) {
    match kind {
        FavoriteEntityKind::Friend => ("favorite_friend", "user_id", "@user_id"),
        FavoriteEntityKind::Avatar => ("favorite_avatar", "avatar_id", "@avatar_id"),
        FavoriteEntityKind::World => ("favorite_world", "world_id", "@world_id"),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use super::*;
    use crate::config::get_json;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn test_db(name: &str) -> (TestDir, Arc<DatabaseService>) {
        let dir = TestDir::new(name);
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
        (dir, db)
    }

    fn group_names(db: &DatabaseService, kind: FavoriteEntityKind) -> Vec<String> {
        favorite_list(db, None, kind)
            .unwrap()
            .into_iter()
            .map(|row| row.group_name)
            .collect()
    }

    fn config_array(db: &DatabaseService, key: &str) -> Vec<String> {
        get_json(db, key, serde_json::Value::Null)
            .unwrap()
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|value| value.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn rename_updates_favorites_and_config_atomically() {
        let (_dir, db) = test_db("favorite-rename-with-config");
        favorite_add(
            &db,
            None,
            FavoriteEntityKind::Friend,
            "usr_1".into(),
            "old".into(),
        )
        .unwrap();

        let affected = favorite_group_rename_with_config(
            &db,
            None,
            FavoriteEntityKind::Friend,
            "localFavoriteFriendGroups",
            "old",
            "new",
            &["new".to_string()],
        )
        .unwrap();

        assert_eq!(affected, 1);
        assert_eq!(
            group_names(&db, FavoriteEntityKind::Friend),
            vec!["new".to_string()]
        );
        assert_eq!(
            config_array(&db, "localFavoriteFriendGroups"),
            vec!["new".to_string()]
        );
    }

    #[test]
    fn rename_merges_into_existing_group_despite_unique_index() {
        let (_dir, db) = test_db("favorite-rename-merge");
        favorite_add(
            &db,
            None,
            FavoriteEntityKind::World,
            "wrld_1".into(),
            "a".into(),
        )
        .unwrap();
        favorite_add(
            &db,
            None,
            FavoriteEntityKind::World,
            "wrld_1".into(),
            "b".into(),
        )
        .unwrap();
        favorite_add(
            &db,
            None,
            FavoriteEntityKind::World,
            "wrld_2".into(),
            "a".into(),
        )
        .unwrap();

        favorite_group_rename(&db, None, FavoriteEntityKind::World, "a".into(), "b".into())
            .unwrap();

        let mut groups = group_names(&db, FavoriteEntityKind::World);
        groups.sort();
        assert_eq!(groups, vec!["b".to_string(), "b".to_string()]);
    }

    #[test]
    fn rename_with_config_merges_into_existing_group_despite_unique_index() {
        let (_dir, db) = test_db("favorite-rename-merge-with-config");
        favorite_add(
            &db,
            None,
            FavoriteEntityKind::Friend,
            "usr_1".into(),
            "a".into(),
        )
        .unwrap();
        favorite_add(
            &db,
            None,
            FavoriteEntityKind::Friend,
            "usr_1".into(),
            "b".into(),
        )
        .unwrap();

        favorite_group_rename_with_config(
            &db,
            None,
            FavoriteEntityKind::Friend,
            "localFavoriteFriendGroups",
            "a",
            "b",
            &["b".to_string()],
        )
        .unwrap();

        assert_eq!(
            group_names(&db, FavoriteEntityKind::Friend),
            vec!["b".to_string()]
        );
        assert_eq!(
            config_array(&db, "localFavoriteFriendGroups"),
            vec!["b".to_string()]
        );
    }

    #[test]
    fn write_transaction_rolls_back_favorite_write_on_error() {
        let (_dir, db) = test_db("favorite-tx-rollback");
        favorite_add(
            &db,
            None,
            FavoriteEntityKind::Friend,
            "usr_1".into(),
            "keep".into(),
        )
        .unwrap();

        let result = db.write_transaction(|tx| {
            tx.execute_non_query(
                "UPDATE favorite_friend SET group_name = @new WHERE group_name = @old",
                &ParamsBuilder::new()
                    .set("new", "changed")
                    .set("old", "keep")
                    .build(),
            )?;
            Err::<(), Error>(Error::Custom("forced failure".into()))
        });

        assert!(result.is_err());
        assert_eq!(
            group_names(&db, FavoriteEntityKind::Friend),
            vec!["keep".to_string()]
        );
    }

    #[test]
    fn delete_removes_favorites_and_rewrites_config_atomically() {
        let (_dir, db) = test_db("favorite-delete-with-config");
        favorite_add(
            &db,
            None,
            FavoriteEntityKind::Friend,
            "usr_1".into(),
            "doomed".into(),
        )
        .unwrap();

        favorite_group_delete_with_config(
            &db,
            None,
            FavoriteEntityKind::Friend,
            "localFavoriteFriendGroups",
            "doomed",
            &[],
        )
        .unwrap();

        assert!(group_names(&db, FavoriteEntityKind::Friend).is_empty());
        assert!(config_array(&db, "localFavoriteFriendGroups").is_empty());
    }

    #[test]
    fn favorite_add_is_idempotent_for_same_entity_and_group() {
        let (_dir, db) = test_db("favorite-add-idempotent");

        let first = favorite_add(
            &db,
            None,
            FavoriteEntityKind::World,
            "wrld_1".into(),
            "group".into(),
        )
        .unwrap();
        let second = favorite_add(
            &db,
            None,
            FavoriteEntityKind::World,
            "wrld_1".into(),
            "group".into(),
        )
        .unwrap();

        assert_eq!(first, 1);
        assert_eq!(second, 0);
        assert_eq!(
            favorite_list(&db, None, FavoriteEntityKind::World)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn friend_favorites_are_owner_scoped_with_shared_legacy_rows() {
        let (_dir, db) = test_db("favorite-owner-scope");

        assert_eq!(
            favorite_add(
                &db,
                Some("usr_a"),
                FavoriteEntityKind::Friend,
                "usr_same".into(),
                "group".into(),
            )
            .unwrap(),
            1
        );
        assert_eq!(
            favorite_add(
                &db,
                Some("usr_b"),
                FavoriteEntityKind::Friend,
                "usr_same".into(),
                "group".into(),
            )
            .unwrap(),
            1
        );
        assert_eq!(
            favorite_add(
                &db,
                Some("usr_a"),
                FavoriteEntityKind::Friend,
                "usr_same".into(),
                "group".into(),
            )
            .unwrap(),
            0
        );
        favorite_add(
            &db,
            None,
            FavoriteEntityKind::Friend,
            "usr_shared".into(),
            "legacy".into(),
        )
        .unwrap();

        let a = favorite_list(&db, Some("usr_a"), FavoriteEntityKind::Friend).unwrap();
        let b = favorite_list(&db, Some("usr_b"), FavoriteEntityKind::Friend).unwrap();
        assert_eq!(a.len(), 2);
        assert_eq!(b.len(), 2);

        let first_world = favorite_add(
            &db,
            Some("usr_a"),
            FavoriteEntityKind::World,
            "wrld_1".into(),
            "group".into(),
        )
        .unwrap();
        let duplicate_world = favorite_add(
            &db,
            Some("usr_b"),
            FavoriteEntityKind::World,
            "wrld_1".into(),
            "group".into(),
        )
        .unwrap();
        assert_eq!((first_world, duplicate_world), (1, 0));
    }

    #[test]
    fn favorite_list_upgrades_legacy_friend_table_before_owner_scoped_read() {
        let (_dir, db) = test_db("favorite-legacy-owner-upgrade");
        db.execute_non_query(
            "CREATE TABLE favorite_friend (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, group_name TEXT)",
            &Default::default(),
        )
        .unwrap();
        db.execute_non_query(
            "CREATE UNIQUE INDEX favorite_friend_user_id_group_idx ON favorite_friend (user_id, group_name)",
            &Default::default(),
        )
        .unwrap();
        db.execute_non_query(
            "INSERT INTO favorite_friend (created_at, user_id, group_name) VALUES ('2026-07-01T00:00:00.000Z', 'usr_legacy', 'legacy')",
            &Default::default(),
        )
        .unwrap();

        let rows = favorite_list(&db, Some("usr_owner"), FavoriteEntityKind::Friend).unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].user_id.as_deref(), Some("usr_legacy"));
        assert_eq!(rows[0].group_name, "legacy");
        let columns = crate::database::schema::table_column_names(&db, "favorite_friend").unwrap();
        assert!(columns.contains("owner_id"));
    }

    #[test]
    fn ensure_global_store_tables_preserves_dirty_duplicates_and_promotes_unique_index_once_clean()
    {
        let (_dir, db) = test_db("favorite-dirty-duplicate-index");
        db.execute_non_query(
            "CREATE TABLE IF NOT EXISTS favorite_world (id INTEGER PRIMARY KEY, created_at TEXT, world_id TEXT, group_name TEXT)",
            &Default::default(),
        )
        .unwrap();
        db.execute_non_query(
            "INSERT INTO favorite_world (created_at, world_id, group_name) VALUES ('2026-01-01T00:00:00.000Z', 'wrld_1', 'group')",
            &Default::default(),
        )
        .unwrap();
        db.execute_non_query(
            "INSERT INTO favorite_world (created_at, world_id, group_name) VALUES ('2026-01-02T00:00:00.000Z', 'wrld_1', 'group')",
            &Default::default(),
        )
        .unwrap();

        ensure_global_store_tables(&db).unwrap();

        assert_eq!(
            favorite_list(&db, None, FavoriteEntityKind::World)
                .unwrap()
                .len(),
            2
        );

        assert_eq!(
            favorite_add(
                &db,
                None,
                FavoriteEntityKind::World,
                "wrld_1".into(),
                "group".into(),
            )
            .unwrap(),
            0
        );
        assert_eq!(
            favorite_list(&db, None, FavoriteEntityKind::World)
                .unwrap()
                .len(),
            2
        );
        assert!(!db
            .execute(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'favorite_world_world_id_group_lookup_idx'",
                &Default::default(),
            )
            .unwrap()
            .is_empty());

        db.execute_non_query(
            "DELETE FROM favorite_world WHERE created_at = '2026-01-02T00:00:00.000Z'",
            &Default::default(),
        )
        .unwrap();
        ensure_global_store_tables(&db).unwrap();

        assert!(db
            .execute(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'favorite_world_world_id_group_lookup_idx'",
                &Default::default(),
            )
            .unwrap()
            .is_empty());
        assert!(!db
            .execute(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'favorite_world_world_id_group_idx'",
                &Default::default(),
            )
            .unwrap()
            .is_empty());
    }
}
