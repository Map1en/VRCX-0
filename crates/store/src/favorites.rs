#![allow(non_snake_case)]
#![allow(unused_imports)]

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::common::{DbParams, ParamsBuilder};
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::domain_support::*;
use crate::game_log::{
    ensure_game_log_tables, write_batch as write_game_log_batch, GameLogEventEntry,
    GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogLocationTimeUpdate,
    GameLogPortalSpawnEntry, GameLogResourceLoadEntry, GameLogVideoPlayEntry, GameLogWriteBatch,
};
use crate::realtime::{
    ensure_realtime_tables, normalize_user_table_prefix, write_realtime_batch,
    RealtimePersistenceBatch,
};
use crate::Error;

pub fn app__favorite_list(db: &DatabaseService, kind: String) -> Result<Vec<Value>, Error> {
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

pub fn app__favorite_add(
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

pub fn app__favorite_remove(
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

pub fn app__favorite_group_rename(
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

pub fn app__favorite_group_delete(
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
