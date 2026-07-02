#![allow(non_snake_case)]

use std::collections::HashMap;

use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};
use serde_json::{json, Value};

use crate::common::{
    normalize_text, parse_json_value, row_i64, row_json, row_string, row_value, value_as_i64,
    ParamsBuilder,
};
use crate::database::schema::ensure_user_store_tables;
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::game_log::ensure_game_log_tables;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use super::types::*;

struct ActivitySourceLocationRow {
    created_at: String,
    time: i64,
}

#[derive(Clone, Debug)]
struct ActivitySessionRow {
    start: i64,
    end: i64,
    is_open_tail: bool,
    source_revision: String,
}

fn activity_now_ms(input: Option<i64>) -> i64 {
    input.unwrap_or_else(|| Utc::now().timestamp_millis())
}

pub(super) fn activity_iso_from_ms(ms: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms)
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub(super) fn parse_activity_time_ms(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.timestamp_millis())
        .ok()
        .or_else(|| {
            NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
                .ok()
                .map(|value| value.and_utc().timestamp_millis())
        })
}

fn clamp_activity_range_days(value: &Value, default_value: i64) -> i64 {
    let days = value_as_i64(value);
    let days = if days > 0 { days } else { default_value };
    days.clamp(1, ACTIVITY_MAX_RANGE_DAYS)
}

fn activity_session_output_from_data(session: &ActivitySessionRow) -> ActivitySessionOutput {
    ActivitySessionOutput {
        start: session.start,
        end: session.end,
        is_open_tail: session.is_open_tail,
        source_revision: session.source_revision.clone(),
    }
}

fn activity_session_input_from_data(session: &ActivitySessionRow) -> ActivitySessionInput {
    ActivitySessionInput {
        start: json!(session.start),
        end: json!(session.end),
        is_open_tail: session.is_open_tail,
        source_revision: session.source_revision.clone(),
    }
}

fn read_activity_sessions_data(
    db: &DatabaseService,
    user_prefix: &str,
    user_id: &str,
) -> Result<Vec<ActivitySessionRow>, Error> {
    Ok(db
        .execute(
            &format!("SELECT start_at, end_at, is_open_tail, source_revision FROM {user_prefix}_activity_sessions_v2 WHERE user_id = @user_id ORDER BY start_at"),
            &ParamsBuilder::new().set("user_id", user_id.to_string()).build(),
        )?
        .into_iter()
        .map(|row| ActivitySessionRow {
            start: row_i64(&row, 0),
            end: row_i64(&row, 1),
            is_open_tail: row_i64(&row, 2) != 0,
            source_revision: row_string(&row, 3),
        })
        .collect())
}

fn read_activity_sync_state(
    db: &DatabaseService,
    user_prefix: &str,
    user_id: &str,
) -> Result<Option<ActivitySyncStateOutput>, Error> {
    Ok(db
        .execute(
            &format!("SELECT user_id, updated_at, is_self, source_last_created_at, pending_session_start_at, cached_range_days FROM {user_prefix}_activity_sync_state_v2 WHERE user_id = @user_id LIMIT 1"),
            &ParamsBuilder::new().set("user_id", user_id.to_string()).build(),
        )?
        .first()
        .map(|row| ActivitySyncStateOutput {
            user_id: row_string(row, 0),
            updated_at: row_string(row, 1),
            is_self: row_i64(row, 2) != 0,
            source_last_created_at: row_string(row, 3),
            pending_session_start_at: row_json(row, 4),
            cached_range_days: row_i64(row, 5),
        }))
}

fn default_activity_sync_state(user_id: &str) -> ActivitySyncStateOutput {
    ActivitySyncStateOutput {
        user_id: user_id.to_string(),
        updated_at: String::new(),
        is_self: true,
        source_last_created_at: String::new(),
        pending_session_start_at: Value::Null,
        cached_range_days: 0,
    }
}

fn read_self_activity_source_slice(
    db: &DatabaseService,
    from_date: &str,
    to_date: &str,
) -> Result<Vec<ActivitySourceLocationRow>, Error> {
    ensure_game_log_tables(db)?;
    let to_filter = if to_date.is_empty() {
        ""
    } else {
        "AND created_at < @to_date_iso"
    };
    let to_tail = if to_date.is_empty() {
        String::new()
    } else {
        "UNION ALL
         SELECT created_at, time, 2 AS sort_group
         FROM (
             SELECT created_at, time
             FROM gamelog_location
             WHERE created_at >= @to_date_iso
             ORDER BY created_at
             LIMIT 1
         )"
        .to_string()
    };
    let mut db_params = HashMap::new();
    db_params.insert(
        "@from_date_iso".into(),
        Value::String(from_date.to_string()),
    );
    db_params.insert("@to_date_iso".into(), Value::String(to_date.to_string()));
    Ok(db
        .execute(
            &format!(
                "SELECT created_at, time
                 FROM (
                     SELECT created_at, time, 0 AS sort_group
                     FROM (
                         SELECT created_at, time
                         FROM gamelog_location
                         WHERE created_at < @from_date_iso
                         ORDER BY created_at DESC
                         LIMIT 1
                     )
                     UNION ALL
                     SELECT created_at, time, 1 AS sort_group
                     FROM gamelog_location
                     WHERE created_at >= @from_date_iso
                       {to_filter}
                     {to_tail}
                 )
                 ORDER BY created_at ASC, sort_group ASC"
            ),
            &db_params,
        )?
        .into_iter()
        .map(|row| ActivitySourceLocationRow {
            created_at: row_string(&row, 0),
            time: row_i64(&row, 1),
        })
        .collect())
}

fn read_self_activity_source_after(
    db: &DatabaseService,
    after_created_at: &str,
    inclusive: bool,
) -> Result<Vec<ActivitySourceLocationRow>, Error> {
    ensure_game_log_tables(db)?;
    let op = if inclusive { ">=" } else { ">" };
    Ok(db
        .execute(
            &format!(
                "SELECT created_at, time
                 FROM gamelog_location
                 WHERE created_at {op} @after_created_at
                 ORDER BY created_at"
            ),
            &ParamsBuilder::new()
                .set("after_created_at", normalize_text(after_created_at))
                .build(),
        )?
        .into_iter()
        .map(|row| ActivitySourceLocationRow {
            created_at: row_string(&row, 0),
            time: row_i64(&row, 1),
        })
        .collect())
}

fn merge_activity_sessions(
    older_sessions: &[ActivitySessionRow],
    newer_sessions: &[ActivitySessionRow],
) -> Vec<ActivitySessionRow> {
    let mut sessions = Vec::with_capacity(older_sessions.len() + newer_sessions.len());
    sessions.extend_from_slice(older_sessions);
    sessions.extend_from_slice(newer_sessions);
    if sessions.is_empty() {
        return sessions;
    }
    sessions.sort_by_key(|session| session.start);

    let mut merged: Vec<ActivitySessionRow> = Vec::new();
    for session in sessions {
        if let Some(last) = merged.last_mut() {
            if session.start <= last.end + ACTIVITY_ONLINE_SESSION_MERGE_GAP_MS {
                last.end = last.end.max(session.end);
                last.is_open_tail = last.is_open_tail || session.is_open_tail;
                if !session.source_revision.is_empty() {
                    last.source_revision = session.source_revision;
                }
                continue;
            }
        }
        merged.push(session);
    }
    merged
}

fn build_sessions_from_gamelog(
    rows: &[ActivitySourceLocationRow],
    now_ms: i64,
    may_have_open_tail: bool,
    source_revision: &str,
) -> Vec<ActivitySessionRow> {
    let mut raw_sessions = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let Some(start) = parse_activity_time_ms(&row.created_at) else {
            continue;
        };
        let mut duration = row.time;
        if duration == 0 {
            duration = if let Some(next) = rows.get(index + 1) {
                parse_activity_time_ms(&next.created_at)
                    .map(|next_start| next_start - start)
                    .unwrap_or(0)
            } else {
                now_ms - start
            };
            duration = duration.min(ACTIVITY_MAX_INFERRED_SESSION_MS);
        }
        if duration > 0 {
            raw_sessions.push(ActivitySessionRow {
                start,
                end: start + duration,
                is_open_tail: false,
                source_revision: source_revision.to_string(),
            });
        }
    }

    let mut sessions = merge_activity_sessions(&[], &raw_sessions);
    if may_have_open_tail {
        if let Some(last) = sessions.last_mut() {
            last.is_open_tail = true;
        }
    }
    sessions
}

fn write_activity_sync_state_data(
    db: &DatabaseService,
    user_prefix: &str,
    user_id: &str,
    sync: &ActivitySyncStateOutput,
) -> Result<(), Error> {
    db.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_activity_sync_state_v2 (user_id, updated_at, is_self, source_last_created_at, pending_session_start_at, cached_range_days) VALUES (@user_id, @updated_at, @is_self, @source_last_created_at, @pending_session_start_at, @cached_range_days)"),
        &ParamsBuilder::new()
            .set("user_id", user_id.to_string())
            .set("updated_at", sync.updated_at.clone())
            .set("is_self", if sync.is_self { 1 } else { 0 })
            .set("source_last_created_at", sync.source_last_created_at.clone())
            .set("pending_session_start_at", sync.pending_session_start_at.clone())
            .set("cached_range_days", sync.cached_range_days)
            .build(),
    )?;
    Ok(())
}

fn write_activity_snapshot(
    db: &DatabaseService,
    user_prefix: &str,
    user_id: &str,
    sync: &ActivitySyncStateOutput,
    sessions: &[ActivitySessionRow],
    replace_from_start_at: Option<i64>,
) -> Result<(), Error> {
    let session_inputs: Vec<ActivitySessionInput> = sessions
        .iter()
        .map(activity_session_input_from_data)
        .collect();
    db.write_transaction(|tx| {
        tx.execute_non_query(
            &format!("INSERT OR REPLACE INTO {user_prefix}_activity_sync_state_v2 (user_id, updated_at, is_self, source_last_created_at, pending_session_start_at, cached_range_days) VALUES (@user_id, @updated_at, @is_self, @source_last_created_at, @pending_session_start_at, @cached_range_days)"),
            &ParamsBuilder::new()
                .set("user_id", user_id.to_string())
                .set("updated_at", sync.updated_at.clone())
                .set("is_self", if sync.is_self { 1 } else { 0 })
                .set("source_last_created_at", sync.source_last_created_at.clone())
                .set("pending_session_start_at", sync.pending_session_start_at.clone())
                .set("cached_range_days", sync.cached_range_days)
                .build(),
        )?;
        match replace_from_start_at {
            Some(replace_from_start_at) => tx.execute_non_query(
                &format!("DELETE FROM {user_prefix}_activity_sessions_v2 WHERE user_id = @user_id AND start_at >= @replace_from_start_at"),
                &ParamsBuilder::new()
                    .set("user_id", user_id.to_string())
                    .set("replace_from_start_at", replace_from_start_at)
                    .build(),
            )?,
            None => tx.execute_non_query(
                &format!("DELETE FROM {user_prefix}_activity_sessions_v2 WHERE user_id = @user_id"),
                &ParamsBuilder::new().set("user_id", user_id.to_string()).build(),
            )?,
        };
        insert_activity_sessions(tx, user_prefix, user_id, &session_inputs)?;
        Ok(())
    })?;
    Ok(())
}

fn activity_refresh_output(
    sync: ActivitySyncStateOutput,
    sessions: Vec<ActivitySessionRow>,
    source_count: usize,
) -> ActivitySelfSessionsRefreshOutput {
    ActivitySelfSessionsRefreshOutput {
        sync,
        sessions: sessions
            .iter()
            .map(activity_session_output_from_data)
            .collect(),
        source_count,
    }
}

pub fn activity_friend_presence_slice(
    db: &DatabaseService,
    query: ActivityFriendPresenceSliceInput,
) -> Result<Vec<ActivityPresenceOutput>, Error> {
    let owner_user_id = normalize_text(query.owner_user_id);
    let user_id = normalize_text(query.user_id);
    if owner_user_id.is_empty() || user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    let table_name = format!("{user_prefix}_feed_online_offline");
    let to_date = normalize_text(query.to_date_iso);
    let to_filter = if to_date.is_empty() {
        ""
    } else {
        "AND created_at < @to_date_iso"
    };
    let mut db_params = HashMap::new();
    db_params.insert("@user_id".into(), Value::String(user_id.clone()));
    db_params.insert(
        "@from_date_iso".into(),
        Value::String(normalize_text(query.from_date_iso)),
    );
    db_params.insert("@to_date_iso".into(), Value::String(to_date.clone()));
    let mut rows: Vec<ActivityPresenceOutput> = db
        .execute(
            &format!(
                "SELECT created_at, type
                 FROM (
                     SELECT created_at, type, 0 AS sort_group
                     FROM (
                         SELECT created_at, type
                         FROM {table_name}
                         WHERE user_id = @user_id
                           AND (type = 'Online' OR type = 'Offline')
                           AND created_at < @from_date_iso
                         ORDER BY created_at DESC
                         LIMIT 1
                     )
                     UNION ALL
                     SELECT created_at, type, 1 AS sort_group
                     FROM {table_name}
                     WHERE user_id = @user_id
                       AND (type = 'Online' OR type = 'Offline')
                       AND created_at >= @from_date_iso
                       {to_filter}
                 )
                 ORDER BY created_at ASC, sort_group ASC"
            ),
            &db_params,
        )?
        .into_iter()
        .map(|row| activity_presence_from_row(&row))
        .collect();
    if !to_date.is_empty() {
        rows.extend(
            db.execute(
                &format!(
                    "SELECT created_at, type
                         FROM {table_name}
                         WHERE user_id = @user_id
                           AND (type = 'Online' OR type = 'Offline')
                           AND created_at >= @to_date_iso
                         ORDER BY created_at ASC
                         LIMIT 1"
                ),
                &db_params,
            )?
            .into_iter()
            .map(|row| activity_presence_from_row(&row)),
        );
        rows.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    }
    Ok(rows)
}

pub fn activity_self_source_bounds(
    db: &DatabaseService,
) -> Result<ActivitySelfSourceBoundsOutput, Error> {
    ensure_game_log_tables(db)?;
    let row = db
        .execute(
            "SELECT MIN(created_at), MAX(created_at), COUNT(*) FROM gamelog_location",
            &Default::default(),
        )?
        .into_iter()
        .next();
    Ok(match row {
        Some(row) => ActivitySelfSourceBoundsOutput {
            first_created_at: row_string(&row, 0),
            last_created_at: row_string(&row, 1),
            count: row_i64(&row, 2),
        },
        None => ActivitySelfSourceBoundsOutput {
            first_created_at: String::new(),
            last_created_at: String::new(),
            count: 0,
        },
    })
}

pub fn activity_self_sessions_refresh(
    db: &DatabaseService,
    input: ActivitySelfSessionsRefreshInput,
) -> Result<ActivitySelfSessionsRefreshOutput, Error> {
    let user_id = normalize_text(input.user_id);
    if user_id.is_empty() {
        return Err(Error::Custom(
            "ActivitySelfSessionsRefresh requires userId.".into(),
        ));
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_game_log_tables(db)?;
    ensure_user_store_tables(db, &user_prefix)?;

    let now_ms = activity_now_ms(input.now_ms);
    let now_iso = activity_iso_from_ms(now_ms);
    let mode = normalize_text(input.mode).to_ascii_lowercase();
    let mut sync = read_activity_sync_state(db, &user_prefix, &user_id)?
        .unwrap_or_else(|| default_activity_sync_state(&user_id));
    let mut sessions = read_activity_sessions_data(db, &user_prefix, &user_id)?;

    match mode.as_str() {
        "full" => {
            let range_days =
                clamp_activity_range_days(&input.range_days, ACTIVITY_INITIAL_RANGE_DAYS);
            let from_date = activity_iso_from_ms(now_ms - range_days * ACTIVITY_DAY_MS);
            let rows = read_self_activity_source_slice(db, &from_date, "")?;
            let source_last_created_at = rows
                .last()
                .map(|row| row.created_at.clone())
                .unwrap_or_default();
            sessions = build_sessions_from_gamelog(&rows, now_ms, true, &source_last_created_at);
            sync = ActivitySyncStateOutput {
                user_id: user_id.clone(),
                updated_at: now_iso,
                is_self: true,
                source_last_created_at,
                pending_session_start_at: Value::Null,
                cached_range_days: range_days,
            };
            write_activity_snapshot(db, &user_prefix, &user_id, &sync, &sessions, None)?;
            Ok(activity_refresh_output(sync, sessions, rows.len()))
        }
        "incremental" => {
            if sync.source_last_created_at.is_empty() {
                return Ok(activity_refresh_output(sync, sessions, 0));
            }
            let rows = read_self_activity_source_after(db, &sync.source_last_created_at, true)?;
            if rows.is_empty() {
                sync.updated_at = now_iso;
                write_activity_sync_state_data(db, &user_prefix, &user_id, &sync)?;
                return Ok(activity_refresh_output(sync, sessions, 0));
            }
            let source_last_created_at = rows
                .last()
                .map(|row| row.created_at.clone())
                .unwrap_or_default();
            let computed =
                build_sessions_from_gamelog(&rows, now_ms, true, &source_last_created_at);
            let replace_from_start_at = sessions.last().map(|session| session.start);
            sessions = merge_activity_sessions(&sessions, &computed);
            sync.updated_at = now_iso;
            sync.source_last_created_at = source_last_created_at;
            sync.pending_session_start_at = Value::Null;
            let tail_sessions = match replace_from_start_at {
                Some(replace_from_start_at) => sessions
                    .iter()
                    .filter(|session| session.start >= replace_from_start_at)
                    .cloned()
                    .collect::<Vec<_>>(),
                None => sessions.clone(),
            };
            write_activity_snapshot(
                db,
                &user_prefix,
                &user_id,
                &sync,
                &tail_sessions,
                replace_from_start_at,
            )?;
            Ok(activity_refresh_output(sync, sessions, rows.len()))
        }
        "expand" => {
            let range_days = clamp_activity_range_days(
                &input.range_days,
                (sync.cached_range_days + ACTIVITY_FULL_CACHE_BATCH_DAYS)
                    .max(ACTIVITY_INITIAL_RANGE_DAYS),
            );
            let current_days = sync.cached_range_days.max(0);
            if range_days <= current_days {
                return Ok(activity_refresh_output(sync, sessions, 0));
            }
            let from_date = activity_iso_from_ms(now_ms - range_days * ACTIVITY_DAY_MS);
            let to_date = if current_days > 0 {
                activity_iso_from_ms(now_ms - current_days * ACTIVITY_DAY_MS)
            } else {
                String::new()
            };
            let rows = read_self_activity_source_slice(db, &from_date, &to_date)?;
            let computed =
                build_sessions_from_gamelog(&rows, now_ms, false, &sync.source_last_created_at);
            if !computed.is_empty() {
                sessions = merge_activity_sessions(&computed, &sessions);
            }
            sync.cached_range_days = range_days;
            sync.updated_at = now_iso;
            write_activity_snapshot(db, &user_prefix, &user_id, &sync, &sessions, None)?;
            Ok(activity_refresh_output(sync, sessions, rows.len()))
        }
        _ => Err(Error::Custom(format!(
            "Unsupported ActivitySelfSessionsRefresh mode: {mode}"
        ))),
    }
}

pub fn activity_sync_state_get(
    db: &DatabaseService,
    user_id: String,
) -> Result<Option<ActivitySyncStateOutput>, Error> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(None);
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    Ok(db
        .execute(
            &format!("SELECT user_id, updated_at, is_self, source_last_created_at, pending_session_start_at, cached_range_days FROM {user_prefix}_activity_sync_state_v2 WHERE user_id = @user_id LIMIT 1"),
            &ParamsBuilder::new().set("user_id", user_id.clone()).build(),
        )?
        .first()
        .map(|row| ActivitySyncStateOutput {
            user_id: row_string(row, 0),
            updated_at: row_string(row, 1),
            is_self: row_i64(row, 2) != 0,
            source_last_created_at: row_string(row, 3),
            pending_session_start_at: row_json(row, 4),
            cached_range_days: row_i64(row, 5),
        }))
}

pub fn activity_sessions_get(
    db: &DatabaseService,
    user_id: String,
) -> Result<Vec<ActivitySessionOutput>, Error> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    Ok(db
        .execute(
            &format!("SELECT start_at, end_at, is_open_tail, source_revision FROM {user_prefix}_activity_sessions_v2 WHERE user_id = @user_id ORDER BY start_at"),
            &ParamsBuilder::new().set("user_id", user_id).build(),
        )?
        .into_iter()
        .map(|row| activity_session_from_row(&row))
        .collect())
}

pub fn activity_bucket_cache_get(
    db: &DatabaseService,
    query: ActivityBucketCacheQueryInput,
) -> Result<Option<ActivityBucketCacheOutput>, Error> {
    let owner_user_id = normalize_text(query.owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(None);
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    let target_user_id = normalize_text(query.target_user_id);
    let range_days = value_as_i64(&query.range_days);
    let view_kind = normalize_text(query.view_kind);
    let exclude_key = normalize_text(query.exclude_key);
    Ok(db
        .execute(
            &format!("SELECT user_id, target_user_id, range_days, view_kind, exclude_key, bucket_version, built_from_cursor, raw_buckets_json, normalized_buckets_json, summary_json, built_at FROM {user_prefix}_activity_bucket_cache_v2 WHERE user_id = @owner_user_id AND target_user_id = @target_user_id AND range_days = @range_days AND view_kind = @view_kind AND exclude_key = @exclude_key LIMIT 1"),
            &ParamsBuilder::new()
                .set("owner_user_id", owner_user_id)
                .set("target_user_id", target_user_id)
                .set("range_days", range_days)
                .set("view_kind", view_kind)
                .set("exclude_key", exclude_key)
                .build(),
        )?
        .first()
        .map(|row| ActivityBucketCacheOutput {
            owner_user_id: row_string(row, 0),
            target_user_id: row_string(row, 1),
            range_days: row_i64(row, 2),
            view_kind: row_string(row, 3),
            exclude_key: row_string(row, 4),
            bucket_version: row_i64(row, 5),
            built_from_cursor: row_string(row, 6),
            raw_buckets: parse_json_value(row_value(row, 7), Value::Array(Vec::new())),
            normalized_buckets: parse_json_value(row_value(row, 8), Value::Array(Vec::new())),
            summary: parse_json_value(row_value(row, 9), json!({})),
            built_at: row_string(row, 10),
        }))
}

pub fn activity_sync_state_upsert(
    db: &DatabaseService,
    entry: ActivitySyncStateInput,
) -> Result<(), Error> {
    let user_id = normalize_text(&entry.user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    db.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_activity_sync_state_v2 (user_id, updated_at, is_self, source_last_created_at, pending_session_start_at, cached_range_days) VALUES (@user_id, @updated_at, @is_self, @source_last_created_at, @pending_session_start_at, @cached_range_days)"),
        &ParamsBuilder::new()
            .set("user_id", user_id)
            .set("updated_at", entry.updated_at)
            .set("is_self", if entry.is_self { 1 } else { 0 })
            .set("source_last_created_at", entry.source_last_created_at)
            .set("pending_session_start_at", entry.pending_session_start_at.unwrap_or(Value::Null))
            .set("cached_range_days", value_as_i64(&entry.cached_range_days))
            .build(),
    )?;
    Ok(())
}

fn insert_activity_sessions(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    user_id: &str,
    sessions: &[ActivitySessionInput],
) -> Result<(), crate::Error> {
    for session in sessions {
        tx.execute_non_query(
            &format!("INSERT OR REPLACE INTO {user_prefix}_activity_sessions_v2 (user_id, start_at, end_at, is_open_tail, source_revision) VALUES (@user_id, @start_at, @end_at, @is_open_tail, @source_revision)"),
            &ParamsBuilder::new()
                .set("user_id", user_id.to_string())
                .set("start_at", value_as_i64(&session.start))
                .set("end_at", value_as_i64(&session.end))
                .set("is_open_tail", if session.is_open_tail { 1 } else { 0 })
                .set("source_revision", session.source_revision.clone())
                .build(),
        )?;
    }
    Ok(())
}

pub fn activity_sessions_replace(
    db: &DatabaseService,
    user_id: String,
    sessions: Vec<ActivitySessionInput>,
) -> Result<(), Error> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    db.write_transaction(|tx| {
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_activity_sessions_v2 WHERE user_id = @user_id"),
            &ParamsBuilder::new().set("user_id", user_id.clone()).build(),
        )?;
        insert_activity_sessions(tx, &user_prefix, &user_id, &sessions)?;
        Ok(())
    })?;
    Ok(())
}

pub fn activity_sessions_append(
    db: &DatabaseService,
    user_id: String,
    sessions: Vec<ActivitySessionInput>,
    replace_from_start_at: Option<i64>,
) -> Result<(), Error> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    db.write_transaction(|tx| {
        if let Some(replace_from_start_at) = replace_from_start_at {
            tx.execute_non_query(
                &format!("DELETE FROM {user_prefix}_activity_sessions_v2 WHERE user_id = @user_id AND start_at >= @replace_from_start_at"),
                &ParamsBuilder::new()
                    .set("user_id", user_id.clone())
                    .set("replace_from_start_at", replace_from_start_at)
                    .build(),
            )?;
        }
        insert_activity_sessions(tx, &user_prefix, &user_id, &sessions)?;
        Ok(())
    })?;
    Ok(())
}

pub fn activity_bucket_cache_upsert(
    db: &DatabaseService,
    entry: ActivityBucketCacheInput,
) -> Result<(), Error> {
    let owner_user_id = normalize_text(&entry.owner_user_id);
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    db.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_activity_bucket_cache_v2 (user_id, target_user_id, range_days, view_kind, exclude_key, bucket_version, built_from_cursor, raw_buckets_json, normalized_buckets_json, summary_json, built_at) VALUES (@owner_user_id, @target_user_id, @range_days, @view_kind, @exclude_key, @bucket_version, @built_from_cursor, @raw_buckets_json, @normalized_buckets_json, @summary_json, @built_at)"),
        &ParamsBuilder::new()
            .set("owner_user_id", owner_user_id)
            .set("target_user_id", normalize_text(entry.target_user_id))
            .set("range_days", value_as_i64(&entry.range_days))
            .set("view_kind", normalize_text(entry.view_kind))
            .set("exclude_key", normalize_text(entry.exclude_key))
            .set("bucket_version", value_as_i64(&entry.bucket_version))
            .set("built_from_cursor", entry.built_from_cursor)
            .set("raw_buckets_json", entry.raw_buckets.to_string())
            .set("normalized_buckets_json", entry.normalized_buckets.to_string())
            .set("summary_json", entry.summary.to_string())
            .set("built_at", entry.built_at)
            .build(),
    )?;
    Ok(())
}

pub(crate) const ACTIVITY_FULL_CACHE_BATCH_DAYS: i64 = 30;
pub(crate) const ACTIVITY_INITIAL_RANGE_DAYS: i64 = 90;
pub(crate) const ACTIVITY_MAX_RANGE_DAYS: i64 = 3650;
pub(crate) const ACTIVITY_ONLINE_SESSION_MERGE_GAP_MS: i64 = 5 * 60 * 1000;
pub(crate) const ACTIVITY_DAY_MS: i64 = 86_400_000;
pub(crate) const ACTIVITY_MAX_INFERRED_SESSION_MS: i64 = 24 * 60 * 60 * 1000;

fn activity_presence_from_row(row: &[Value]) -> ActivityPresenceOutput {
    ActivityPresenceOutput {
        created_at: row_string(row, 0),
        r#type: row_string(row, 1),
    }
}
fn activity_session_from_row(row: &[Value]) -> ActivitySessionOutput {
    ActivitySessionOutput {
        start: row_i64(row, 0),
        end: row_i64(row, 1),
        is_open_tail: row_i64(row, 2) != 0,
        source_revision: row_string(row, 3),
    }
}
