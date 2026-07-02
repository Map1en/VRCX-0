#![allow(non_snake_case)]

use serde_json::{json, Value};

use crate::common::{normalize_text, now_iso, row_json, ParamsBuilder};
use crate::config::{ensure_config_table, resolve_config_key};
use crate::database::schema::ensure_global_store_tables;
use crate::database::DatabaseService;
use crate::Error;

const LOCAL_GROUP_CONFIG_UPSERT_SQL: &str =
    "INSERT OR REPLACE INTO configs (key, value) VALUES (@key, @value)";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FavoriteMoveResult {
    pub removed: i64,
    pub added: i64,
}

pub fn favorite_list(db: &DatabaseService, kind: String) -> Result<Vec<Value>, Error> {
    ensure_global_store_tables(db)?;
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

pub fn favorite_add(
    db: &DatabaseService,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
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

pub fn favorite_remove(
    db: &DatabaseService,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let (table, column, _) = normalize_kind(&kind)?;
    db.execute_non_query(
        &format!("DELETE FROM {table} WHERE {column} = @entity_id AND group_name = @group_name"),
        &ParamsBuilder::new()
            .set("entity_id", normalize_text(entity_id))
            .set("group_name", normalize_text(group_name))
            .build(),
    )
}

pub fn favorite_move(
    db: &DatabaseService,
    kind: String,
    entity_id: String,
    source_group_name: String,
    target_group_name: String,
) -> Result<FavoriteMoveResult, Error> {
    ensure_global_store_tables(db)?;
    let (table, column, entity_param) = normalize_kind(&kind)?;
    let normalized_entity_id = normalize_text(entity_id);
    let normalized_source_group_name = normalize_text(source_group_name);
    let normalized_target_group_name = normalize_text(target_group_name);
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
            &format!("DELETE FROM {table} WHERE {column} = @entity_id AND group_name = @group_name"),
            &ParamsBuilder::new()
                .set("entity_id", normalized_entity_id.clone())
                .set("group_name", normalized_source_group_name)
                .build(),
        )?;
        if normalized_target_group_name.is_empty() {
            return Err(Error::Custom(
                "favorite_move requires target group name".into(),
            ));
        }
        let added = tx.execute_non_query(
            &format!("INSERT OR REPLACE INTO {table} ({column}, group_name, created_at) VALUES ({entity_param}, @group_name, @created_at)"),
            &ParamsBuilder::new()
                .set(entity_param, normalized_entity_id)
                .set("group_name", normalized_target_group_name)
                .set("created_at", now_iso())
                .build(),
        )?;
        Ok(FavoriteMoveResult { removed, added })
    })
}

pub fn favorite_group_rename(
    db: &DatabaseService,
    kind: String,
    group_name: String,
    new_group_name: String,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let (table, _, _) = normalize_kind(&kind)?;
    db.execute_non_query(
        &format!("UPDATE {table} SET group_name = @new_group_name WHERE group_name = @group_name"),
        &ParamsBuilder::new()
            .set("new_group_name", normalize_text(new_group_name))
            .set("group_name", normalize_text(group_name))
            .build(),
    )
}

pub fn favorite_group_delete(
    db: &DatabaseService,
    kind: String,
    group_name: String,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let (table, _, _) = normalize_kind(&kind)?;
    db.execute_non_query(
        &format!("DELETE FROM {table} WHERE group_name = @group_name"),
        &ParamsBuilder::new()
            .set("group_name", normalize_text(group_name))
            .build(),
    )
}

pub fn favorite_group_rename_with_config(
    db: &DatabaseService,
    kind: &str,
    config_key: &str,
    group_name: &str,
    new_group_name: &str,
    config_groups: &[String],
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    ensure_config_table(db)?;
    let (table, _, _) = normalize_kind(kind)?;
    let stored_key = resolve_config_key(config_key);
    let config_value = json!(config_groups).to_string();
    db.write_transaction(|tx| {
        let affected = tx.execute_non_query(
            &format!(
                "UPDATE {table} SET group_name = @new_group_name WHERE group_name = @group_name"
            ),
            &ParamsBuilder::new()
                .set("new_group_name", normalize_text(new_group_name))
                .set("group_name", normalize_text(group_name))
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
    kind: &str,
    config_key: &str,
    group_name: &str,
    config_groups: &[String],
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    ensure_config_table(db)?;
    let (table, _, _) = normalize_kind(kind)?;
    let stored_key = resolve_config_key(config_key);
    let config_value = json!(config_groups).to_string();
    db.write_transaction(|tx| {
        let affected = tx.execute_non_query(
            &format!("DELETE FROM {table} WHERE group_name = @group_name"),
            &ParamsBuilder::new()
                .set("group_name", normalize_text(group_name))
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

    fn group_names(db: &DatabaseService, kind: &str) -> Vec<String> {
        favorite_list(db, kind.into())
            .unwrap()
            .into_iter()
            .map(|row| {
                row.get("groupName")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            })
            .collect()
    }

    fn config_array(db: &DatabaseService, key: &str) -> Vec<String> {
        get_json(db, key, Value::Null)
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
        favorite_add(&db, "friend".into(), "usr_1".into(), "old".into()).unwrap();

        let affected = favorite_group_rename_with_config(
            &db,
            "friend",
            "localFavoriteFriendGroups",
            "old",
            "new",
            &["new".to_string()],
        )
        .unwrap();

        assert_eq!(affected, 1);
        assert_eq!(group_names(&db, "friend"), vec!["new".to_string()]);
        assert_eq!(
            config_array(&db, "localFavoriteFriendGroups"),
            vec!["new".to_string()]
        );
    }

    #[test]
    fn write_transaction_rolls_back_favorite_write_on_error() {
        let (_dir, db) = test_db("favorite-tx-rollback");
        favorite_add(&db, "friend".into(), "usr_1".into(), "keep".into()).unwrap();

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
        assert_eq!(group_names(&db, "friend"), vec!["keep".to_string()]);
    }

    #[test]
    fn delete_removes_favorites_and_rewrites_config_atomically() {
        let (_dir, db) = test_db("favorite-delete-with-config");
        favorite_add(&db, "friend".into(), "usr_1".into(), "doomed".into()).unwrap();

        favorite_group_delete_with_config(
            &db,
            "friend",
            "localFavoriteFriendGroups",
            "doomed",
            &[],
        )
        .unwrap();

        assert!(group_names(&db, "friend").is_empty());
        assert!(config_array(&db, "localFavoriteFriendGroups").is_empty());
    }
}
