#![allow(non_snake_case)]
#![allow(unused_imports)]

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::common::{DbParams, ParamsBuilder};
use crate::database::{
    maintenance::UserTableContextOutput, DatabaseService, DatabaseWriteTransaction,
};
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
pub struct MutualGraphSnapshotEntryInput {
    pub friend_id: String,
    #[serde(default)]
    pub mutual_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphMetaInput {
    pub friend_id: String,
    #[serde(default)]
    pub last_fetched_at: String,
    #[serde(default)]
    pub opted_out: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphLinkOutput {
    pub friend_id: String,
    pub mutual_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphMetaOutput {
    pub friend_id: String,
    pub last_fetched_at: String,
    pub opted_out: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphSnapshotOutput {
    pub friend_ids: Vec<String>,
    pub links: Vec<MutualGraphLinkOutput>,
    pub meta: Vec<MutualGraphMetaOutput>,
}

pub fn app__mutual_graph_tables_ensure(
    db: &DatabaseService,
    user_id: String,
) -> Result<UserTableContextOutput, Error> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    Ok(UserTableContextOutput {
        user_id,
        user_prefix,
    })
}

pub fn app__mutual_graph_snapshot_get(
    db: &DatabaseService,
    user_id: String,
) -> Result<MutualGraphSnapshotOutput, Error> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;

    let friend_ids = db
        .execute(
            &format!("SELECT friend_id FROM {user_prefix}_mutual_graph_friends"),
            &Default::default(),
        )?
        .into_iter()
        .map(|row| row_string(&row, 0))
        .filter(|friend_id| !friend_id.is_empty())
        .collect();
    let links = db
        .execute(
            &format!("SELECT friend_id, mutual_id FROM {user_prefix}_mutual_graph_links"),
            &Default::default(),
        )?
        .into_iter()
        .filter_map(|row| {
            let friend_id = row_string(&row, 0);
            let mutual_id = row_string(&row, 1);
            if friend_id.is_empty() || mutual_id.is_empty() {
                None
            } else {
                Some(MutualGraphLinkOutput {
                    friend_id,
                    mutual_id,
                })
            }
        })
        .collect();
    let meta = db
        .execute(
            &format!(
                "SELECT friend_id, last_fetched_at, opted_out FROM {user_prefix}_mutual_graph_meta"
            ),
            &Default::default(),
        )?
        .into_iter()
        .filter_map(|row| {
            let friend_id = row_string(&row, 0);
            if friend_id.is_empty() {
                None
            } else {
                Some(MutualGraphMetaOutput {
                    friend_id,
                    last_fetched_at: row_string(&row, 1),
                    opted_out: row_i64(&row, 2) == 1,
                })
            }
        })
        .collect();

    Ok(MutualGraphSnapshotOutput {
        friend_ids,
        links,
        meta,
    })
}

fn insert_mutual_graph_friend(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    friend_id: &str,
) -> Result<(), crate::Error> {
    tx.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_mutual_graph_friends (friend_id) VALUES (@friend_id)"),
        &ParamsBuilder::new().set("friend_id", friend_id.to_string()).build(),
    )?;
    Ok(())
}

fn insert_mutual_graph_link(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    friend_id: &str,
    mutual_id: &str,
) -> Result<(), crate::Error> {
    tx.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_mutual_graph_links (friend_id, mutual_id) VALUES (@friend_id, @mutual_id)"),
        &ParamsBuilder::new()
            .set("friend_id", friend_id.to_string())
            .set("mutual_id", mutual_id.to_string())
            .build(),
    )?;
    Ok(())
}

pub fn app__mutual_graph_snapshot_save(
    db: &DatabaseService,
    user_id: String,
    entries: Vec<MutualGraphSnapshotEntryInput>,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    db.write_transaction(|tx| {
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_mutual_graph_links WHERE friend_id NOT IN (SELECT friend_id FROM {user_prefix}_mutual_graph_meta WHERE opted_out = 1)"),
            &Default::default(),
        )?;
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_mutual_graph_friends WHERE friend_id NOT IN (SELECT friend_id FROM {user_prefix}_mutual_graph_meta WHERE opted_out = 1)"),
            &Default::default(),
        )?;
        for entry in &entries {
            let friend_id = normalize_text(&entry.friend_id);
            if friend_id.is_empty() {
                continue;
            }
            tx.execute_non_query(
                &format!("DELETE FROM {user_prefix}_mutual_graph_links WHERE friend_id = @friend_id"),
                &ParamsBuilder::new().set("friend_id", friend_id.clone()).build(),
            )?;
            insert_mutual_graph_friend(tx, &user_prefix, &friend_id)?;
            for mutual_id in &entry.mutual_ids {
                let mutual_id = normalize_text(mutual_id);
                if !mutual_id.is_empty() {
                    insert_mutual_graph_link(tx, &user_prefix, &friend_id, &mutual_id)?;
                }
            }
        }
        Ok(())
    })?;
    Ok(())
}

pub fn app__mutual_graph_friend_update(
    db: &DatabaseService,
    user_id: String,
    friend_id: String,
    mutual_ids: Vec<String>,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    let friend_id = normalize_text(friend_id);
    if friend_id.is_empty() {
        return Ok(());
    }
    db.write_transaction(|tx| {
        insert_mutual_graph_friend(tx, &user_prefix, &friend_id)?;
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_mutual_graph_links WHERE friend_id = @friend_id"),
            &ParamsBuilder::new()
                .set("friend_id", friend_id.clone())
                .build(),
        )?;
        for mutual_id in &mutual_ids {
            let mutual_id = normalize_text(mutual_id);
            if !mutual_id.is_empty() {
                insert_mutual_graph_link(tx, &user_prefix, &friend_id, &mutual_id)?;
            }
        }
        Ok(())
    })?;
    Ok(())
}

pub fn app__mutual_graph_meta_upsert(
    db: &DatabaseService,
    user_id: String,
    entry: MutualGraphMetaInput,
) -> Result<(), Error> {
    app__mutual_graph_meta_bulk_upsert(db, user_id, vec![entry])
}

pub fn app__mutual_graph_meta_bulk_upsert(
    db: &DatabaseService,
    user_id: String,
    entries: Vec<MutualGraphMetaInput>,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    let now = now_iso();
    db.write_transaction(|tx| {
        for entry in &entries {
            let friend_id = normalize_text(&entry.friend_id);
            if friend_id.is_empty() {
                continue;
            }
            tx.execute_non_query(
                &format!("INSERT OR REPLACE INTO {user_prefix}_mutual_graph_meta (friend_id, last_fetched_at, opted_out) VALUES (@friend_id, @last_fetched_at, @opted_out)"),
                &ParamsBuilder::new()
                    .set("friend_id", friend_id)
                    .set(
                        "last_fetched_at",
                        if entry.last_fetched_at.trim().is_empty() {
                            now.clone()
                        } else {
                            entry.last_fetched_at.clone()
                        },
                    )
                    .set("opted_out", if entry.opted_out { 1 } else { 0 })
                    .build(),
            )?;
        }
        Ok(())
    })?;
    Ok(())
}
