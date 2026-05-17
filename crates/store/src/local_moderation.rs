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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModerationInput {
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub block: bool,
    #[serde(default)]
    pub mute: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModerationInput {
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub target_user_id: String,
    #[serde(default)]
    pub target_display_name: String,
    #[serde(default)]
    pub created: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModerationOutput {
    pub user_id: String,
    pub updated_at: String,
    pub display_name: String,
    pub block: bool,
    pub mute: bool,
}

pub fn app__local_moderation_list(
    db: &DatabaseService,
    owner_user_id: String,
) -> Result<Vec<LocalModerationOutput>, Error> {
    let owner_user_id = normalize_text(&owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_moderation_table(db, &user_prefix)?;
    Ok(db
        .execute(
            &format!(
                "SELECT user_id, updated_at, display_name, block, mute FROM {user_prefix}_moderation"
            ),
            &Default::default(),
        )?
        .into_iter()
        .map(|row| LocalModerationOutput {
            user_id: row_string(&row, 0),
            updated_at: row_string(&row, 1),
            display_name: row_string(&row, 2),
            block: row_i64(&row, 3) == 1,
            mute: row_i64(&row, 4) == 1,
        })
        .collect())
}

pub fn app__local_moderation_get(
    db: &DatabaseService,
    owner_user_id: String,
    user_id: String,
) -> Result<Option<LocalModerationOutput>, Error> {
    let owner_user_id = normalize_text(&owner_user_id);
    let user_id = normalize_text(user_id);
    if owner_user_id.is_empty() || user_id.is_empty() {
        return Ok(None);
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_moderation_table(db, &user_prefix)?;
    Ok(db
        .execute(
            &format!("SELECT user_id, updated_at, display_name, block, mute FROM {user_prefix}_moderation WHERE user_id = @user_id LIMIT 1"),
            &ParamsBuilder::new().set("user_id", user_id).build(),
        )?
        .first()
        .map(|row| LocalModerationOutput {
            user_id: row_string(row, 0),
            updated_at: row_string(row, 1),
            display_name: row_string(row, 2),
            block: row_i64(row, 3) == 1,
            mute: row_i64(row, 4) == 1,
        }))
}

pub fn app__local_moderation_set(
    db: &DatabaseService,
    owner_user_id: String,
    entry: LocalModerationInput,
) -> Result<(), Error> {
    set_local_moderation_row(db, &owner_user_id, &entry)
}

pub fn app__local_moderation_delete(
    db: &DatabaseService,
    owner_user_id: String,
    user_id: String,
) -> Result<(), Error> {
    delete_local_moderation_row(db, &owner_user_id, &user_id)
}

pub fn app__local_moderation_sync_snapshot(
    db: &DatabaseService,
    owner_user_id: String,
    rows: Vec<RemoteModerationInput>,
) -> Result<Vec<LocalModerationOutput>, Error> {
    use std::collections::{HashMap, HashSet};

    let owner_user_id = normalize_text(&owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_moderation_table(db, &user_prefix)?;

    let mut moderation_by_user_id: HashMap<String, LocalModerationOutput> = HashMap::new();
    for row in rows {
        if row.r#type != "block" && row.r#type != "mute" {
            continue;
        }
        let target_user_id = normalize_text(row.target_user_id);
        if target_user_id.is_empty() {
            continue;
        }
        let entry = moderation_by_user_id
            .entry(target_user_id.clone())
            .or_insert_with(|| LocalModerationOutput {
                user_id: target_user_id.clone(),
                updated_at: if row.created.trim().is_empty() {
                    now_iso()
                } else {
                    row.created.clone()
                },
                display_name: row.target_display_name.clone(),
                block: false,
                mute: false,
            });
        if !row.created.trim().is_empty() {
            entry.updated_at = row.created.clone();
        }
        if !row.target_display_name.trim().is_empty() {
            entry.display_name = row.target_display_name.clone();
        }
        if row.r#type == "block" {
            entry.block = true;
        }
        if row.r#type == "mute" {
            entry.mute = true;
        }
    }

    let target_ids: HashSet<String> = moderation_by_user_id.keys().cloned().collect();
    let existing = db.execute(
        &format!("SELECT user_id FROM {user_prefix}_moderation"),
        &Default::default(),
    )?;

    db.write_transaction(|tx| {
        for row in existing {
            let user_id = row
                .first()
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if !target_ids.contains(&user_id) {
                tx.execute_non_query(
                    &format!("DELETE FROM {user_prefix}_moderation WHERE user_id = @user_id"),
                    &ParamsBuilder::new().set("user_id", user_id).build(),
                )?;
            }
        }
        for entry in moderation_by_user_id.values() {
            tx.execute_non_query(
                &format!("INSERT OR REPLACE INTO {user_prefix}_moderation (user_id, updated_at, display_name, block, mute) VALUES (@user_id, @updated_at, @display_name, @block, @mute)"),
                &ParamsBuilder::new()
                    .set("user_id", entry.user_id.clone())
                    .set("updated_at", entry.updated_at.clone())
                    .set("display_name", entry.display_name.clone())
                    .set("block", if entry.block { 1 } else { 0 })
                    .set("mute", if entry.mute { 1 } else { 0 })
                    .build(),
            )?;
        }
        Ok(())
    })?;

    Ok(moderation_by_user_id.into_values().collect())
}
