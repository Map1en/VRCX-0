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

use crate::cache_entities::CacheEntityInput;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldSummaryOutput {
    pub id: String,
    pub author_id: String,
    pub author_name: String,
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub description: String,
    pub image_url: String,
    pub name: String,
    pub release_status: String,
    pub thumbnail_image_url: String,
    #[serde(rename = "updated_at")]
    pub updated_at: String,
    pub version: i64,
}

pub fn app__world_cache_upsert(
    db: &DatabaseService,
    entry: CacheEntityInput,
) -> Result<i64, Error> {
    upsert_cache_entity(db, "cache_world", entry)
}

pub fn app__world_cache_remove(db: &DatabaseService, world_id: String) -> Result<(), Error> {
    ensure_global_store_tables(db)?;
    let world_id = normalize_text(world_id);
    if world_id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        "DELETE FROM cache_world WHERE id = @world_id",
        &ParamsBuilder::new().set("world_id", world_id).build(),
    )?;
    Ok(())
}

pub fn app__world_cache_list(db: &DatabaseService) -> Result<Vec<WorldSummaryOutput>, Error> {
    ensure_global_store_tables(db)?;
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_world",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| world_summary_from_row(&row))
        .collect())
}

pub fn app__world_cache_get(
    db: &DatabaseService,
    world_id: String,
) -> Result<Option<WorldSummaryOutput>, Error> {
    ensure_global_store_tables(db)?;
    let world_id = normalize_text(world_id);
    if world_id.is_empty() {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_world WHERE id = @world_id LIMIT 1",
            &ParamsBuilder::new().set("world_id", world_id).build(),
        )?
        .first()
        .map(|row| world_summary_from_row(row)))
}
