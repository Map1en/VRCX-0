use crate::common::{normalize_text, now_iso, row_i64, row_string, row_value, ParamsBuilder};
use crate::database::schema::ensure_user_store_tables;
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::realtime::normalize_user_table_prefix;
use crate::Error;
pub use vrcx_0_contracts::mutual_graph::{
    MutualGraphLinkOutput, MutualGraphMetaInput, MutualGraphMetaOutput,
    MutualGraphSnapshotEntryInput, MutualGraphSnapshotOutput,
};

#[cfg(test)]
mod tests;

pub fn mutual_graph_snapshot_get(
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
                "SELECT friend_id, last_fetched_at, opted_out, total_count FROM {user_prefix}_mutual_graph_meta"
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
                    total_count: row_value(&row, 3)
                        .as_i64()
                        .and_then(|count| u32::try_from(count).ok()),
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

fn upsert_mutual_graph_meta_entries(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entries: &[MutualGraphMetaInput],
) -> Result<(), Error> {
    let now = now_iso();
    for entry in entries {
        let friend_id = normalize_text(&entry.friend_id);
        if friend_id.is_empty() {
            continue;
        }
        tx.execute_non_query(
            &format!("INSERT INTO {user_prefix}_mutual_graph_meta (friend_id, last_fetched_at, opted_out, total_count) VALUES (@friend_id, @last_fetched_at, @opted_out, @total_count) ON CONFLICT(friend_id) DO UPDATE SET last_fetched_at = excluded.last_fetched_at, opted_out = excluded.opted_out, total_count = COALESCE(excluded.total_count, {user_prefix}_mutual_graph_meta.total_count)"),
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
                .set(
                    "total_count",
                    match entry.total_count {
                        Some(total_count) => {
                            serde_json::Value::from(i64::try_from(total_count).unwrap_or(i64::MAX))
                        }
                        None => serde_json::Value::Null,
                    },
                )
                .build(),
        )?;
    }
    Ok(())
}

fn replace_mutual_graph_snapshot_entries(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entries: &[MutualGraphSnapshotEntryInput],
) -> Result<(), Error> {
    tx.execute_non_query(
        &format!("DELETE FROM {user_prefix}_mutual_graph_links WHERE friend_id NOT IN (SELECT friend_id FROM {user_prefix}_mutual_graph_meta WHERE opted_out = 1)"),
        &Default::default(),
    )?;
    tx.execute_non_query(
        &format!("DELETE FROM {user_prefix}_mutual_graph_friends WHERE friend_id NOT IN (SELECT friend_id FROM {user_prefix}_mutual_graph_meta WHERE opted_out = 1)"),
        &Default::default(),
    )?;
    for entry in entries {
        let friend_id = normalize_text(&entry.friend_id);
        if friend_id.is_empty() {
            continue;
        }
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_mutual_graph_links WHERE friend_id = @friend_id"),
            &ParamsBuilder::new()
                .set("friend_id", friend_id.clone())
                .build(),
        )?;
        insert_mutual_graph_friend(tx, user_prefix, &friend_id)?;
        for mutual_id in &entry.mutual_ids {
            let mutual_id = normalize_text(mutual_id);
            if !mutual_id.is_empty() {
                insert_mutual_graph_link(tx, user_prefix, &friend_id, &mutual_id)?;
            }
        }
    }
    Ok(())
}

pub fn mutual_graph_snapshot_commit(
    db: &DatabaseService,
    user_id: String,
    entries: Vec<MutualGraphSnapshotEntryInput>,
    meta_entries: Vec<MutualGraphMetaInput>,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    db.write_transaction(|tx| {
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_mutual_graph_meta"),
            &Default::default(),
        )?;
        upsert_mutual_graph_meta_entries(tx, &user_prefix, &meta_entries)?;
        replace_mutual_graph_snapshot_entries(tx, &user_prefix, &entries)?;
        Ok(())
    })?;
    Ok(())
}

pub fn mutual_graph_friend_refresh_commit(
    db: &DatabaseService,
    user_id: String,
    friend_id: String,
    mutual_ids: Option<Vec<String>>,
    total_count: Option<usize>,
    opted_out: bool,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    let friend_id = normalize_text(friend_id);
    if friend_id.is_empty() {
        return Ok(());
    }
    db.write_transaction(|tx| {
        if let Some(mutual_ids) = mutual_ids {
            insert_mutual_graph_friend(tx, &user_prefix, &friend_id)?;
            tx.execute_non_query(
                &format!(
                    "DELETE FROM {user_prefix}_mutual_graph_links WHERE friend_id = @friend_id"
                ),
                &ParamsBuilder::new()
                    .set("friend_id", friend_id.clone())
                    .build(),
            )?;
            for mutual_id in mutual_ids {
                let mutual_id = normalize_text(mutual_id);
                if !mutual_id.is_empty() {
                    insert_mutual_graph_link(tx, &user_prefix, &friend_id, &mutual_id)?;
                }
            }
        }
        upsert_mutual_graph_meta_entries(
            tx,
            &user_prefix,
            &[MutualGraphMetaInput {
                friend_id,
                last_fetched_at: String::new(),
                opted_out,
                total_count,
            }],
        )?;
        Ok(())
    })?;
    Ok(())
}
