#![allow(non_snake_case)]

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::common::{
    add_list_params, normalize_text, row_i64, row_string, value_as_i64, ParamsBuilder,
};
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::realtime::{ensure_realtime_tables, normalize_user_table_prefix};
use crate::Error;

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogHistoryEntryInput {
    #[serde(default)]
    pub row_id: Value,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub previous_display_name: String,
    #[serde(default)]
    pub trust_level: String,
    #[serde(default)]
    pub previous_trust_level: String,
    #[serde(default)]
    pub friend_number: Value,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogCurrentEntryInput {
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub trust_level: Option<String>,
    #[serde(default)]
    pub friend_number: Value,
}

#[derive(Debug, Deserialize, Default, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogReplaceOptionsInput {
    #[serde(default)]
    pub history_entries: Vec<FriendLogHistoryEntryInput>,
    #[serde(default)]
    pub added_history_entries: Vec<FriendLogHistoryEntryInput>,
}

#[derive(Debug, Deserialize, Default, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogDeleteOptionsInput {
    #[serde(default)]
    pub history_entries: Vec<FriendLogHistoryEntryInput>,
}

#[derive(Debug, Deserialize, Default, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogUpsertOptionsInput {
    #[serde(default)]
    pub history_entry: Option<FriendLogHistoryEntryInput>,
    #[serde(default)]
    pub force_history: bool,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogMutationResult {
    pub user_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub target_user_id: String,
    pub count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inserted: Option<bool>,
    pub history_count: i64,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogCurrentOutput {
    pub user_id: String,
    pub display_name: String,
    pub trust_level: String,
    pub friend_number: i64,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogHistoryQueryInput {
    pub user_id: String,
    #[serde(default)]
    pub target_user_id: String,
    #[serde(default)]
    pub types: Vec<String>,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogHistoryOutput {
    pub row_id: i64,
    pub created_at: String,
    pub r#type: String,
    pub user_id: String,
    pub display_name: String,
    pub previous_display_name: String,
    pub trust_level: String,
    pub previous_trust_level: String,
    pub friend_number: i64,
}

pub fn friend_log_current_list(
    db: &DatabaseService,
    user_id: String,
) -> Result<Vec<FriendLogCurrentOutput>, Error> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    Ok(db
        .execute(
            &format!("SELECT user_id, display_name, trust_level, friend_number FROM {user_prefix}_friend_log_current ORDER BY friend_number ASC, display_name COLLATE NOCASE ASC, user_id ASC"),
            &Default::default(),
        )?
        .into_iter()
        .map(|row| FriendLogCurrentOutput {
            user_id: row_string(&row, 0),
            display_name: row_string(&row, 1),
            trust_level: row_string(&row, 2),
            friend_number: row_i64(&row, 3),
        })
        .filter(|row| !row.user_id.trim().is_empty())
        .collect())
}

/// Current display names for a specific set of friend user ids. Scoped to the
/// requested ids so callers that only need to relabel a handful of rows do not
/// load and materialize the entire friend roster.
pub fn friend_display_names(
    db: &DatabaseService,
    owner_user_id: String,
    user_ids: &[String],
) -> Result<HashMap<String, String>, Error> {
    let owner_user_id = normalize_text(owner_user_id);
    if owner_user_id.is_empty() || user_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let mut placeholders = Vec::with_capacity(user_ids.len());
    let mut params = ParamsBuilder::new();
    for (index, user_id) in user_ids.iter().enumerate() {
        let key = format!("u{index}");
        placeholders.push(format!("@{key}"));
        params = params.set(&key, user_id.clone());
    }
    let sql = format!(
        "SELECT user_id, display_name FROM {user_prefix}_friend_log_current WHERE user_id IN ({})",
        placeholders.join(", ")
    );
    let mut names = HashMap::new();
    for row in db.execute(&sql, &params.build())? {
        let user_id = row_string(&row, 0);
        if !user_id.is_empty() {
            names.insert(user_id, row_string(&row, 1));
        }
    }
    Ok(names)
}

pub fn friend_log_history_query(
    db: &DatabaseService,
    query: FriendLogHistoryQueryInput,
) -> Result<Vec<FriendLogHistoryOutput>, Error> {
    let user_id = normalize_text(query.user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let mut clauses = Vec::new();
    let mut db_params = HashMap::new();
    let target_user_id = normalize_text(query.target_user_id);
    if !target_user_id.is_empty() {
        clauses.push("user_id = @user_id".to_string());
        db_params.insert("@user_id".into(), Value::String(target_user_id));
    }
    let types = query
        .types
        .into_iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let type_placeholders = add_list_params(&mut db_params, &types, "friend_log_type");
    if !type_placeholders.is_empty() {
        clauses.push(format!("type IN ({})", type_placeholders.join(", ")));
    }
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };
    Ok(db
        .execute(
            &format!("SELECT id, created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number FROM {user_prefix}_friend_log_history{where_sql} ORDER BY created_at DESC, id DESC"),
            &db_params,
        )?
        .into_iter()
        .map(|row| FriendLogHistoryOutput {
            row_id: row_i64(&row, 0),
            created_at: row_string(&row, 1),
            r#type: row_string(&row, 2),
            user_id: row_string(&row, 3),
            display_name: row_string(&row, 4),
            previous_display_name: row_string(&row, 5),
            trust_level: row_string(&row, 6),
            previous_trust_level: row_string(&row, 7),
            friend_number: row_i64(&row, 8),
        })
        .filter(|row| !row.user_id.trim().is_empty())
        .collect())
}

pub fn friend_log_replace_current(
    db: &DatabaseService,
    user_id: String,
    entries: Vec<FriendLogCurrentEntryInput>,
    options: FriendLogReplaceOptionsInput,
) -> Result<FriendLogMutationResult, Error> {
    let owner_user_id = normalize_text(&user_id);
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let history_count = db.write_transaction(|tx| {
        let mut written_history_count = 0;
        for entry in &options.history_entries {
            let target_user_id = normalize_text(&entry.user_id);
            if target_user_id.is_empty() {
                continue;
            }
            let affected = tx.execute_non_query(
                &format!("DELETE FROM {user_prefix}_friend_log_current WHERE user_id = @user_id"),
                &ParamsBuilder::new().set("user_id", target_user_id).build(),
            )?;
            if affected > 0 {
                add_friend_log_history_entry(tx, &user_prefix, entry)?;
                written_history_count += 1;
            }
        }
        for entry in &options.added_history_entries {
            let target_user_id = normalize_text(&entry.user_id);
            if target_user_id.is_empty() {
                continue;
            }
            let existing_rows = tx.execute(
                &format!("SELECT user_id FROM {user_prefix}_friend_log_current WHERE user_id = @user_id LIMIT 1"),
                &ParamsBuilder::new().set("user_id", target_user_id).build(),
            )?;
            if existing_rows.is_empty() {
                add_friend_log_history_entry(tx, &user_prefix, entry)?;
                written_history_count += 1;
            }
        }
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_friend_log_current"),
            &Default::default(),
        )?;
        for entry in &entries {
            let target_user_id = normalize_text(&entry.user_id);
            if target_user_id.is_empty() {
                continue;
            }
            tx.execute_non_query(
                &format!("INSERT OR REPLACE INTO {user_prefix}_friend_log_current (user_id, display_name, trust_level, friend_number) VALUES (@user_id, @display_name, @trust_level, @friend_number)"),
                &ParamsBuilder::new()
                    .set("user_id", target_user_id)
                    .set("display_name", entry.display_name.clone())
                    .set("trust_level", current_friend_trust_level(entry))
                    .set("friend_number", value_as_i64(&entry.friend_number))
                    .build(),
            )?;
        }
        Ok::<i64, crate::Error>(written_history_count)
    })?;
    Ok(FriendLogMutationResult {
        user_id: owner_user_id,
        target_user_id: String::new(),
        count: entries.len() as i64,
        inserted: None,
        history_count,
    })
}

pub fn friend_log_delete_current_array(
    db: &DatabaseService,
    user_id: String,
    target_user_ids: Vec<String>,
    options: FriendLogDeleteOptionsInput,
) -> Result<FriendLogMutationResult, Error> {
    let owner_user_id = normalize_text(&user_id);
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let normalized_ids: Vec<String> = target_user_ids
        .into_iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect();
    if normalized_ids.is_empty() {
        return Ok(FriendLogMutationResult {
            user_id: owner_user_id,
            target_user_id: String::new(),
            count: 0,
            inserted: None,
            history_count: 0,
        });
    }
    let result = db.write_transaction(|tx| {
        let mut deleted_count = 0;
        let mut written_history_count = 0;
        for target_user_id in &normalized_ids {
            let affected = tx.execute_non_query(
                &format!("DELETE FROM {user_prefix}_friend_log_current WHERE user_id = @user_id"),
                &ParamsBuilder::new()
                    .set("user_id", target_user_id.clone())
                    .build(),
            )?;
            if affected > 0 {
                deleted_count += affected;
                if let Some(entry) = options
                    .history_entries
                    .iter()
                    .find(|entry| normalize_text(&entry.user_id) == *target_user_id)
                {
                    add_friend_log_history_entry(tx, &user_prefix, entry)?;
                    written_history_count += 1;
                }
            }
        }
        Ok::<(i64, i64), crate::Error>((deleted_count, written_history_count))
    })?;
    Ok(FriendLogMutationResult {
        user_id: owner_user_id,
        target_user_id: String::new(),
        count: result.0,
        inserted: None,
        history_count: result.1,
    })
}

pub fn friend_log_upsert_current(
    db: &DatabaseService,
    user_id: String,
    entry: FriendLogCurrentEntryInput,
    options: FriendLogUpsertOptionsInput,
) -> Result<FriendLogMutationResult, Error> {
    let owner_user_id = normalize_text(&user_id);
    let target_user_id = normalize_text(&entry.user_id);
    if target_user_id.is_empty() {
        return Ok(FriendLogMutationResult {
            user_id: owner_user_id,
            target_user_id: String::new(),
            count: 0,
            inserted: Some(false),
            history_count: 0,
        });
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let result = db.write_transaction(|tx| {
        let insert_count = tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_friend_log_current (user_id, display_name, trust_level, friend_number) VALUES (@user_id, @display_name, @trust_level, @friend_number)"),
            &ParamsBuilder::new()
                .set("user_id", target_user_id.clone())
                .set("display_name", entry.display_name.clone())
                .set("trust_level", current_friend_trust_level(&entry))
                .set("friend_number", value_as_i64(&entry.friend_number))
                .build(),
        )?;
        let inserted = insert_count > 0;
        if !inserted {
            tx.execute_non_query(
                &format!("UPDATE {user_prefix}_friend_log_current SET display_name = @display_name, trust_level = @trust_level, friend_number = CASE WHEN @friend_number > 0 THEN @friend_number ELSE friend_number END WHERE user_id = @user_id"),
                &ParamsBuilder::new()
                    .set("user_id", target_user_id.clone())
                    .set("display_name", entry.display_name.clone())
                    .set("trust_level", current_friend_trust_level(&entry))
                    .set("friend_number", value_as_i64(&entry.friend_number))
                    .build(),
            )?;
        }
        let mut history_count = 0;
        if let Some(history_entry) = options
            .history_entry
            .as_ref()
            .filter(|_| inserted || options.force_history)
        {
            let mut history_entry = history_entry.clone();
            history_entry.user_id = target_user_id.clone();
            add_friend_log_history_entry(tx, &user_prefix, &history_entry)?;
            history_count = 1;
        }
        Ok::<(bool, i64), crate::Error>((inserted, history_count))
    })?;
    Ok(FriendLogMutationResult {
        user_id: owner_user_id,
        target_user_id,
        count: 1,
        inserted: Some(result.0),
        history_count: result.1,
    })
}

pub fn friend_log_delete_current(
    db: &DatabaseService,
    user_id: String,
    target_user_id: String,
) -> Result<i64, Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    db.execute_non_query(
        &format!("DELETE FROM {user_prefix}_friend_log_current WHERE user_id = @user_id"),
        &ParamsBuilder::new()
            .set("user_id", normalize_text(target_user_id))
            .build(),
    )
}

pub fn friend_log_history_add(
    db: &DatabaseService,
    user_id: String,
    entries: Vec<FriendLogHistoryEntryInput>,
) -> Result<i64, Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let count = db.write_transaction(|tx| {
        let mut written_count = 0;
        for entry in &entries {
            if entry.r#type.trim().is_empty() || entry.user_id.trim().is_empty() {
                continue;
            }
            let affected = tx.execute_non_query(
                &format!("INSERT OR IGNORE INTO {user_prefix}_friend_log_history (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number) VALUES (@created_at, @type, @user_id, @display_name, @previous_display_name, @trust_level, @previous_trust_level, @friend_number)"),
                &ParamsBuilder::new()
                    .set("created_at", entry.created_at.clone())
                    .set("type", entry.r#type.clone())
                    .set("user_id", normalize_text(&entry.user_id))
                    .set("display_name", entry.display_name.clone())
                    .set("previous_display_name", entry.previous_display_name.clone())
                    .set("trust_level", entry.trust_level.clone())
                    .set("previous_trust_level", entry.previous_trust_level.clone())
                    .set("friend_number", value_as_i64(&entry.friend_number))
                    .build(),
            )?;
            written_count += affected;
        }
        Ok::<i64, crate::Error>(written_count)
    })?;
    Ok(count)
}

pub fn friend_log_history_delete(
    db: &DatabaseService,
    user_id: String,
    entry: FriendLogHistoryEntryInput,
) -> Result<i64, Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let row_id = value_as_i64(&entry.row_id);
    if row_id > 0 {
        return db.execute_non_query(
            &format!("DELETE FROM {user_prefix}_friend_log_history WHERE id = @row_id"),
            &ParamsBuilder::new().set("row_id", row_id).build(),
        );
    }
    db.execute_non_query(
        &format!("DELETE FROM {user_prefix}_friend_log_history WHERE created_at = @created_at AND type = @type AND user_id = @user_id"),
        &ParamsBuilder::new()
            .set("created_at", entry.created_at)
            .set("type", entry.r#type)
            .set("user_id", normalize_text(entry.user_id))
        .build(),
    )
}

pub(crate) fn add_friend_log_history_entry(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &FriendLogHistoryEntryInput,
) -> Result<(), crate::Error> {
    if entry.r#type.trim().is_empty() || entry.user_id.trim().is_empty() {
        return Ok(());
    }
    tx.execute_non_query(
        &format!("INSERT INTO {user_prefix}_friend_log_history (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number) VALUES (@created_at, @type, @user_id, @display_name, @previous_display_name, @trust_level, @previous_trust_level, @friend_number)"),
        &ParamsBuilder::new()
            .set("created_at", entry.created_at.clone())
            .set("type", entry.r#type.clone())
            .set("user_id", normalize_text(&entry.user_id))
            .set("display_name", entry.display_name.clone())
            .set("previous_display_name", entry.previous_display_name.clone())
            .set("trust_level", entry.trust_level.clone())
            .set("previous_trust_level", entry.previous_trust_level.clone())
            .set("friend_number", value_as_i64(&entry.friend_number))
            .build(),
    )?;
    Ok(())
}

pub(crate) fn current_friend_trust_level(entry: &FriendLogCurrentEntryInput) -> String {
    entry
        .trust_level
        .clone()
        .unwrap_or_else(|| "Visitor".to_string())
}
