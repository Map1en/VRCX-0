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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoSaveResult {
    pub entity_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMemoOutput {
    pub user_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldMemoOutput {
    pub world_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarMemoOutput {
    pub avatar_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserNoteOutput {
    pub user_id: String,
    pub display_name: String,
    pub note: String,
    pub created_at: String,
}

pub fn app__memo_get_user(
    db: &DatabaseService,
    user_id: String,
) -> Result<Option<UserMemoOutput>, Error> {
    ensure_global_store_tables(db)?;
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT user_id, edited_at, memo FROM memos WHERE user_id = @user_id LIMIT 1",
            &ParamsBuilder::new().set("user_id", user_id).build(),
        )?
        .first()
        .map(|row| UserMemoOutput {
            user_id: row_string(row, 0),
            edited_at: row_string(row, 1),
            memo: row_string(row, 2),
        }))
}

pub fn app__memo_list_users(db: &DatabaseService) -> Result<Vec<UserMemoOutput>, Error> {
    ensure_global_store_tables(db)?;
    Ok(db
        .execute(
            "SELECT user_id, edited_at, memo FROM memos",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| UserMemoOutput {
            user_id: row_string(&row, 0),
            edited_at: row_string(&row, 1),
            memo: row_string(&row, 2),
        })
        .collect())
}

pub fn app__memo_list_user_notes(
    db: &DatabaseService,
    owner_user_id: String,
) -> Result<Vec<UserNoteOutput>, Error> {
    let owner_user_id = normalize_text(owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    Ok(db
        .execute(
            &format!("SELECT user_id, display_name, note, created_at FROM {user_prefix}_notes"),
            &Default::default(),
        )?
        .into_iter()
        .map(|row| UserNoteOutput {
            user_id: row_string(&row, 0),
            display_name: row_string(&row, 1),
            note: row_string(&row, 2),
            created_at: row_string(&row, 3),
        })
        .collect())
}

pub fn app__memo_get_world(
    db: &DatabaseService,
    world_id: String,
) -> Result<Option<WorldMemoOutput>, Error> {
    ensure_global_store_tables(db)?;
    let world_id = normalize_text(world_id);
    if world_id.is_empty() {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT world_id, edited_at, memo FROM world_memos WHERE world_id = @world_id LIMIT 1",
            &ParamsBuilder::new().set("world_id", world_id).build(),
        )?
        .first()
        .map(|row| WorldMemoOutput {
            world_id: row_string(row, 0),
            edited_at: row_string(row, 1),
            memo: row_string(row, 2),
        }))
}

pub fn app__memo_get_avatar(
    db: &DatabaseService,
    avatar_id: String,
) -> Result<Option<AvatarMemoOutput>, Error> {
    ensure_global_store_tables(db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT avatar_id, edited_at, memo FROM avatar_memos WHERE avatar_id = @avatar_id LIMIT 1",
            &ParamsBuilder::new().set("avatar_id", avatar_id).build(),
        )?
        .first()
        .map(|row| AvatarMemoOutput {
            avatar_id: row_string(row, 0),
            edited_at: row_string(row, 1),
            memo: row_string(row, 2),
        }))
}

pub fn app__memo_save_user(
    db: &DatabaseService,
    user_id: String,
    memo: String,
) -> Result<MemoSaveResult, Error> {
    save_memo(db, "memos", "user_id", user_id, memo)
}

pub fn app__memo_save_world(
    db: &DatabaseService,
    world_id: String,
    memo: String,
) -> Result<MemoSaveResult, Error> {
    save_memo(db, "world_memos", "world_id", world_id, memo)
}

pub fn app__memo_save_avatar(
    db: &DatabaseService,
    avatar_id: String,
    memo: String,
) -> Result<MemoSaveResult, Error> {
    save_memo(db, "avatar_memos", "avatar_id", avatar_id, memo)
}
