pub use vrcx_0_contracts::{FavoriteRow, LocalFavoriteGroup};
use vrcx_0_core::FavoriteEntityKind;

use crate::common::{normalize_text, now_iso, row_i64, row_string, ParamsBuilder};
use crate::database::schema::ensure_global_store_tables;
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::ownership::{owner_id_for_filter, owner_id_get_or_insert, OwnerId, OwnerRowId};
use crate::Error;

pub(crate) mod group_refs;
pub(crate) mod migration_v1;

pub(crate) const GROUP_TABLE: &str = "vrcx0_favorite_group";
pub(crate) const ITEM_TABLE: &str = "vrcx0_favorite_item";

const VISIBLE_GROUP: &str = "g.kind = @kind AND g.owner_id IN (0, @owner_id)";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FavoriteMoveResult {
    pub removed: i64,
    pub added: i64,
}

pub fn favorite_group_list(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
) -> Result<Vec<LocalFavoriteGroup>, Error> {
    ensure_global_store_tables(db)?;
    let owner_id = read_owner(db, kind, owner_user_id)?;
    Ok(db
        .execute(&group_list_sql(), &scope_params(kind, owner_id).build())?
        .into_iter()
        .map(|row| group_from_row(kind, &row))
        .collect())
}

fn group_list_sql() -> String {
    format!(
        "SELECT g.id, g.name, g.owner_id FROM {GROUP_TABLE} g WHERE {VISIBLE_GROUP} ORDER BY (g.owner_id = 0), g.sort_order, g.id"
    )
}

pub fn favorite_group_create(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
    name: &str,
) -> Result<LocalFavoriteGroup, Error> {
    ensure_global_store_tables(db)?;
    let name = require_group_name(name)?;
    let owner_id = write_owner(db, kind, owner_user_id)?;
    db.write_transaction(|tx| ensure_group_in_realm(tx, kind, owner_id, &name))
}

pub fn favorite_group_rename(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
    group_id: i64,
    name: &str,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let name = require_group_name(name)?;
    let owner_id = read_owner(db, kind, owner_user_id)?;
    db.write_transaction(|tx| {
        let (group_owner, current_name) = visible_group(tx, kind, owner_id, group_id)?;
        if current_name == name {
            return Ok(0);
        }
        let clash = tx.execute(
            &format!(
                "SELECT 1 FROM {GROUP_TABLE} WHERE kind = @kind AND owner_id = @owner_id AND name = @name AND id <> @group_id"
            ),
            &scope_params(kind, group_owner)
                .set("name", name.clone())
                .set("group_id", group_id)
                .build(),
        )?;
        if !clash.is_empty() {
            return Err(Error::Custom(
                "A local favorite group with this name already exists.".into(),
            ));
        }
        tx.execute_non_query(
            &format!("UPDATE {GROUP_TABLE} SET name = @name WHERE id = @group_id"),
            &ParamsBuilder::new()
                .set("name", name.clone())
                .set("group_id", group_id)
                .build(),
        )
    })
}

pub fn favorite_group_delete(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
    group_id: i64,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let owner_id = read_owner(db, kind, owner_user_id)?;
    db.write_transaction(|tx| {
        visible_group(tx, kind, owner_id, group_id)?;
        let params = ParamsBuilder::new().set("group_id", group_id).build();
        let removed = tx.execute_non_query(
            &format!("DELETE FROM {ITEM_TABLE} WHERE group_id = @group_id"),
            &params,
        )?;
        tx.execute_non_query(
            &format!("DELETE FROM {GROUP_TABLE} WHERE id = @group_id"),
            &params,
        )?;
        Ok(removed)
    })
}

pub fn favorite_group_reorder(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
    group_ids: &[i64],
) -> Result<Vec<LocalFavoriteGroup>, Error> {
    ensure_global_store_tables(db)?;
    let owner_id = read_owner(db, kind, owner_user_id)?;
    db.write_transaction(|tx| {
        let current = tx
            .execute(&group_list_sql(), &scope_params(kind, owner_id).build())?
            .into_iter()
            .map(|row| row_i64(&row, 0))
            .collect::<Vec<_>>();
        let mut order: Vec<i64> = Vec::with_capacity(current.len());
        for group_id in group_ids.iter().chain(current.iter()) {
            if current.contains(group_id) && !order.contains(group_id) {
                order.push(*group_id);
            }
        }
        for (position, group_id) in order.iter().enumerate() {
            tx.execute_non_query(
                &format!("UPDATE {GROUP_TABLE} SET sort_order = @sort_order WHERE id = @group_id"),
                &ParamsBuilder::new()
                    .set("sort_order", position as i64)
                    .set("group_id", *group_id)
                    .build(),
            )?;
        }
        Ok(())
    })?;
    favorite_group_list(db, owner_user_id, kind)
}

pub fn favorite_list(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
) -> Result<Vec<FavoriteRow>, Error> {
    favorite_list_ordered(db, owner_user_id, kind, "i.id")
}

pub fn favorite_list_custom_order(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
) -> Result<Vec<FavoriteRow>, Error> {
    favorite_list_ordered(
        db,
        owner_user_id,
        kind,
        "COALESCE(i.sort_order, -i.id), i.id",
    )
}

fn favorite_list_ordered(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
    order_by: &str,
) -> Result<Vec<FavoriteRow>, Error> {
    ensure_global_store_tables(db)?;
    let owner_id = read_owner(db, kind, owner_user_id)?;
    Ok(db
        .execute(
            &format!(
                "SELECT i.created_at, i.entity_id, g.id, g.name FROM {ITEM_TABLE} i JOIN {GROUP_TABLE} g ON g.id = i.group_id WHERE {VISIBLE_GROUP} ORDER BY {order_by}"
            ),
            &scope_params(kind, owner_id).build(),
        )?
        .into_iter()
        .map(|row| {
            FavoriteRow::new(
                kind,
                row_string(&row, 0),
                row_string(&row, 1),
                row_i64(&row, 2),
                row_string(&row, 3),
            )
        })
        .collect())
}

pub fn favorite_add(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
    entity_id: String,
    group_id: i64,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let entity_id = require_entity_id(entity_id)?;
    let owner_id = read_owner(db, kind, owner_user_id)?;
    db.write_transaction(|tx| {
        visible_group(tx, kind, owner_id, group_id)?;
        insert_item(tx, group_id, &entity_id)
    })
}

pub fn favorite_remove(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
    entity_id: String,
    group_id: i64,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let owner_id = read_owner(db, kind, owner_user_id)?;
    db.execute_non_query(
        &format!(
            "DELETE FROM {ITEM_TABLE} WHERE group_id = @group_id AND entity_id = @entity_id AND group_id IN (SELECT g.id FROM {GROUP_TABLE} g WHERE {VISIBLE_GROUP})"
        ),
        &scope_params(kind, owner_id)
            .set("group_id", group_id)
            .set("entity_id", normalize_text(entity_id))
            .build(),
    )
}

pub fn favorite_move(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
    entity_id: String,
    source_group_id: i64,
    target_group_id: i64,
) -> Result<FavoriteMoveResult, Error> {
    ensure_global_store_tables(db)?;
    let entity_id = require_entity_id(entity_id)?;
    let owner_id = read_owner(db, kind, owner_user_id)?;
    db.write_transaction(|tx| {
        visible_group(tx, kind, owner_id, source_group_id)?;
        visible_group(tx, kind, owner_id, target_group_id)?;
        if source_group_id == target_group_id {
            return Ok(FavoriteMoveResult {
                removed: 0,
                added: 0,
            });
        }
        let removed = tx.execute_non_query(
            &format!(
                "DELETE FROM {ITEM_TABLE} WHERE group_id = @group_id AND entity_id = @entity_id"
            ),
            &ParamsBuilder::new()
                .set("group_id", source_group_id)
                .set("entity_id", entity_id.clone())
                .build(),
        )?;
        let added = insert_item(tx, target_group_id, &entity_id)?;
        Ok(FavoriteMoveResult { removed, added })
    })
}

pub fn favorite_reorder(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    kind: FavoriteEntityKind,
    group_id: i64,
    entity_ids: Vec<String>,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let owner_id = read_owner(db, kind, owner_user_id)?;
    db.write_transaction(|tx| {
        visible_group(tx, kind, owner_id, group_id)?;
        let mut affected = 0;
        for (position, entity_id) in entity_ids.into_iter().enumerate() {
            affected += tx.execute_non_query(
                &format!(
                    "UPDATE {ITEM_TABLE} SET sort_order = @sort_order WHERE group_id = @group_id AND entity_id = @entity_id"
                ),
                &ParamsBuilder::new()
                    .set("sort_order", position as i64)
                    .set("group_id", group_id)
                    .set("entity_id", normalize_text(entity_id))
                    .build(),
            )?;
        }
        Ok(affected)
    })
}

fn ensure_group_in_realm(
    tx: &DatabaseWriteTransaction<'_>,
    kind: FavoriteEntityKind,
    owner_id: OwnerRowId,
    name: &str,
) -> Result<LocalFavoriteGroup, Error> {
    let params = scope_params(kind, owner_id)
        .set("name", name.to_string())
        .set("created_at", now_iso())
        .build();
    tx.execute_non_query(
        &format!(
            "INSERT OR IGNORE INTO {GROUP_TABLE} (kind, owner_id, name, sort_order, created_at) SELECT @kind, @owner_id, @name, COALESCE(MAX(sort_order) + 1, 0), @created_at FROM {GROUP_TABLE} WHERE kind = @kind AND owner_id = @owner_id"
        ),
        &params,
    )?;
    let rows = tx.execute(
        &format!(
            "SELECT g.id, g.name, g.owner_id FROM {GROUP_TABLE} g WHERE g.kind = @kind AND g.owner_id = @owner_id AND g.name = @name"
        ),
        &params,
    )?;
    rows.first()
        .map(|row| group_from_row(kind, row))
        .ok_or_else(|| {
            Error::Database("Local favorite group was not available after insertion.".into())
        })
}

fn insert_item(
    tx: &DatabaseWriteTransaction<'_>,
    group_id: i64,
    entity_id: &str,
) -> Result<i64, Error> {
    tx.execute_non_query(
        &format!(
            "INSERT OR IGNORE INTO {ITEM_TABLE} (group_id, entity_id, created_at) VALUES (@group_id, @entity_id, @created_at)"
        ),
        &ParamsBuilder::new()
            .set("group_id", group_id)
            .set("entity_id", entity_id.to_string())
            .set("created_at", now_iso())
            .build(),
    )
}

fn visible_group(
    tx: &DatabaseWriteTransaction<'_>,
    kind: FavoriteEntityKind,
    owner_id: OwnerRowId,
    group_id: i64,
) -> Result<(OwnerRowId, String), Error> {
    let rows = tx.execute(
        &format!(
            "SELECT g.owner_id, g.name FROM {GROUP_TABLE} g WHERE g.id = @group_id AND {VISIBLE_GROUP}"
        ),
        &scope_params(kind, owner_id)
            .set("group_id", group_id)
            .build(),
    )?;
    rows.first()
        .map(|row| (OwnerRowId::from_value(row_i64(row, 0)), row_string(row, 1)))
        .ok_or_else(|| Error::Custom("Local favorite group was not found.".into()))
}

fn group_from_row(kind: FavoriteEntityKind, row: &[serde_json::Value]) -> LocalFavoriteGroup {
    LocalFavoriteGroup {
        id: row_i64(row, 0),
        kind,
        name: row_string(row, 1),
        shared: kind == FavoriteEntityKind::Friend && row_i64(row, 2) == 0,
    }
}

fn scope_params(kind: FavoriteEntityKind, owner_id: OwnerRowId) -> ParamsBuilder {
    ParamsBuilder::new()
        .set("kind", kind.as_str())
        .set("owner_id", owner_id)
}

fn require_group_name(name: &str) -> Result<String, Error> {
    let name = normalize_text(name);
    if name.is_empty() {
        return Err(Error::Custom(
            "Local favorite group name is required.".into(),
        ));
    }
    Ok(name)
}

fn require_entity_id(entity_id: String) -> Result<String, Error> {
    let entity_id = normalize_text(entity_id);
    if entity_id.is_empty() {
        return Err(Error::Custom("Favorite entity id is required.".into()));
    }
    Ok(entity_id)
}

fn read_owner(
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

fn write_owner(
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

#[cfg(test)]
mod tests;
