use serde_json::json;
pub use vrcx_0_contracts::FavoriteRow;
use vrcx_0_core::FavoriteEntityKind;

use crate::common::{normalize_text, now_iso, row_string, ParamsBuilder};
use crate::config::{ensure_config_table, resolve_config_key};
use crate::database::schema::ensure_global_store_tables;
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::ownership::{owner_id_for_filter, owner_id_get_or_insert, OwnerId, OwnerRowId};
use crate::Error;

const LOCAL_GROUP_CONFIG_UPSERT_SQL: &str =
    "INSERT OR REPLACE INTO configs (key, value) VALUES (@key, @value)";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FavoriteMoveResult {
    pub removed: i64,
    pub added: i64,
}

pub fn favorite_list(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
) -> Result<Vec<FavoriteRow>, Error> {
    favorite_list_ordered(db, owner_user_id, kind, "id")
}

pub fn favorite_list_custom_order(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
) -> Result<Vec<FavoriteRow>, Error> {
    favorite_list_ordered(db, owner_user_id, kind, "COALESCE(sort_order, -id), id")
}

fn favorite_list_ordered(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
    order_by: &str,
) -> Result<Vec<FavoriteRow>, Error> {
    ensure_global_store_tables(db)?;
    let (table, column, _) = normalize_kind(kind);
    let owner_id = owner_id_for_kind_read(db, kind, owner_user_id)?;
    Ok(db
        .execute(
            &format!(
                "SELECT created_at, {column}, group_name FROM {table} {} ORDER BY {order_by}",
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
    owner_user_id: Option<&OwnerId>,
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
    owner_user_id: Option<&OwnerId>,
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
    owner_user_id: Option<&OwnerId>,
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

pub fn favorite_reorder(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
    group_name: String,
    entity_ids: Vec<String>,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let (table, column, _) = normalize_kind(kind);
    let normalized_group_name = normalize_text(group_name);
    if normalized_group_name.is_empty() {
        return Err(Error::Custom("favorite_reorder requires group name".into()));
    }
    let owner_id = owner_id_for_kind_read(db, kind, owner_user_id)?;
    let sql = format!(
        "UPDATE {table} SET sort_order = @sort_order WHERE {column} = @entity_id AND group_name = @group_name {}",
        visible_owner_and(kind)
    );
    db.write_transaction(|tx| {
        let mut affected = 0;
        for (position, entity_id) in entity_ids.into_iter().enumerate() {
            affected += tx.execute_non_query(
                &sql,
                &ParamsBuilder::new()
                    .set("sort_order", position as i64)
                    .set("entity_id", normalize_text(entity_id))
                    .set("group_name", normalized_group_name.clone())
                    .set("owner_id", owner_id)
                    .build(),
            )?;
        }
        Ok(affected)
    })
}

fn delete_rows_already_in_group(
    tx: &mut DatabaseWriteTransaction<'_>,
    table: &str,
    column: &str,
    group_name: &str,
    new_group_name: &str,
    owner_scope: &str,
    owner_id: OwnerRowId,
) -> Result<i64, Error> {
    if group_name == new_group_name {
        return Ok(0);
    }
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

pub fn favorite_group_rename_with_config(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
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
        let affected = if normalized_group_name == normalized_new_group_name {
            0
        } else {
            delete_rows_already_in_group(
                tx,
                table,
                column,
                &normalized_group_name,
                &normalized_new_group_name,
                owner_scope,
                owner_id,
            )?;
            tx.execute_non_query(
                &format!(
                    "UPDATE {table} SET group_name = @new_group_name WHERE group_name = @group_name {owner_scope}"
                ),
                &ParamsBuilder::new()
                    .set("new_group_name", normalized_new_group_name.clone())
                    .set("group_name", normalized_group_name.clone())
                    .set("owner_id", owner_id)
                    .build(),
            )?
        };
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
    owner_user_id: Option<&OwnerId>,
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
    owner_user_id: Option<&OwnerId>,
) -> Result<OwnerRowId, Error> {
    match owner_user_id {
        Some(owner_user_id) if kind == FavoriteEntityKind::Friend => {
            owner_id_for_filter(db, owner_user_id)
        }
        _ => Ok(OwnerRowId::UNASSIGNED),
    }
}

fn owner_id_for_kind_write(
    db: &DatabaseService,
    kind: FavoriteEntityKind,
    owner_user_id: Option<&OwnerId>,
) -> Result<OwnerRowId, Error> {
    match owner_user_id {
        Some(owner_user_id) if kind == FavoriteEntityKind::Friend => {
            owner_id_get_or_insert(db, owner_user_id)
        }
        _ => Ok(OwnerRowId::UNASSIGNED),
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
    owner_user_id: Option<&OwnerId>,
) -> Result<(&'static str, OwnerRowId), Error> {
    if kind != FavoriteEntityKind::Friend {
        return Ok(("", OwnerRowId::UNASSIGNED));
    }
    if config_key == "localFavoriteFriendGroups" {
        Ok(("AND owner_id = 0", OwnerRowId::UNASSIGNED))
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
mod tests;
