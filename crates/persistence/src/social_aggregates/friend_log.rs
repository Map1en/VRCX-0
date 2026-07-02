use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use super::caveats::friend_log_caveats;
use super::helpers::{append_time_window_filter, clamped_optional_limit, table_exists};
use super::types::{FriendLogInput, FriendLogOutput, FriendLogRow};

pub fn get_friend_log(
    db: &DatabaseService,
    input: FriendLogInput,
) -> Result<FriendLogOutput, Error> {
    let user_prefix = normalize_user_table_prefix(&input.owner_user_id)?;
    let table_name = format!("{user_prefix}_friend_log_history");
    if !table_exists(db, &table_name)? {
        return Ok(FriendLogOutput {
            rows: Vec::new(),
            summary: "No relationship events found.".to_string(),
            total_rows: 0,
            returned_rows: 0,
            truncated: false,
            next_cursor: None,
            caveats: friend_log_caveats(),
        });
    }

    let limit = clamped_optional_limit(input.limit, 100, 500);
    let page_limit = limit + 1;
    let (count_where_sql, count_params) = friend_log_filters(&input, None, None)?;
    let total_rows = db
        .execute(
            &format!("SELECT COUNT(*) FROM {table_name} WHERE {count_where_sql}"),
            &count_params.build(),
        )?
        .first()
        .map(|row| row_i64(row, 0).max(0) as usize)
        .unwrap_or(0);
    let cursor = input
        .cursor
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(parse_friend_log_cursor)
        .transpose()?;
    let (page_where_sql, page_params) =
        friend_log_filters(&input, cursor.as_ref(), Some(page_limit))?;
    let sql = format!(
        "SELECT id, created_at, type, user_id, display_name, previous_display_name,
            trust_level, previous_trust_level, friend_number
         FROM {table_name}
         WHERE {page_where_sql}
         ORDER BY created_at DESC, id DESC LIMIT @limit"
    );

    let mut page_rows = db
        .execute(&sql, &page_params.build())?
        .into_iter()
        .map(|row| FriendLogPageRow {
            id: row_i64(&row, 0),
            row: FriendLogRow {
                created_at: row_string(&row, 1),
                kind: row_string(&row, 2),
                user_id: row_string(&row, 3),
                display_name: row_string(&row, 4),
                previous_display_name: row_string(&row, 5),
                trust_level: row_string(&row, 6),
                previous_trust_level: row_string(&row, 7),
                friend_number: row_i64(&row, 8),
            },
        })
        .filter(|page_row| !page_row.row.user_id.trim().is_empty())
        .collect::<Vec<_>>();
    let truncated = page_rows.len() > limit as usize;
    if truncated {
        page_rows.truncate(limit as usize);
    }
    let next_cursor = truncated
        .then(|| page_rows.last().map(friend_log_cursor))
        .flatten();
    let rows = page_rows
        .into_iter()
        .map(|page_row| page_row.row)
        .collect::<Vec<_>>();
    let returned_rows = rows.len();

    let summary = friend_log_summary(&rows, total_rows, truncated);
    Ok(FriendLogOutput {
        rows,
        summary,
        total_rows,
        returned_rows,
        truncated,
        next_cursor,
        caveats: friend_log_caveats(),
    })
}

fn friend_log_summary(rows: &[FriendLogRow], total_rows: usize, truncated: bool) -> String {
    if rows.is_empty() {
        return "No relationship events found.".to_string();
    }
    let entries = rows
        .iter()
        .map(|row| format!("{} {}", row.kind, row.display_name))
        .collect::<Vec<_>>()
        .join(", ");
    if truncated {
        format!(
            "{} of {} relationship event(s): {entries}.",
            rows.len(),
            total_rows
        )
    } else {
        format!("{} relationship event(s): {entries}.", rows.len())
    }
}

struct FriendLogPageRow {
    id: i64,
    row: FriendLogRow,
}

fn friend_log_filters(
    input: &FriendLogInput,
    cursor: Option<&(String, i64)>,
    limit: Option<i64>,
) -> Result<(String, ParamsBuilder), Error> {
    let target_user_id = input
        .target_user_id
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_string();
    let types = normalize_friend_log_types(input.types.clone())?;
    let mut sql = String::from("1 = 1");
    let mut params = ParamsBuilder::new();

    if let Some(limit) = limit {
        params = params.set("limit", limit);
    }
    if !target_user_id.is_empty() {
        sql.push_str(" AND user_id = @target_user_id");
        params = params.set("target_user_id", target_user_id);
    }
    if !types.is_empty() {
        let mut placeholders = Vec::with_capacity(types.len());
        for (index, kind) in types.into_iter().enumerate() {
            let key = format!("type_{index}");
            placeholders.push(format!("@{key}"));
            params = params.set(&key, kind);
        }
        sql.push_str(&format!(" AND type IN ({})", placeholders.join(", ")));
    }
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "created_at");
    if let Some((created_at, id)) = cursor {
        sql.push_str(
            " AND (created_at < @cursor_created_at OR (created_at = @cursor_created_at AND id < @cursor_id))",
        );
        params = params
            .set("cursor_created_at", created_at.clone())
            .set("cursor_id", *id);
    }
    Ok((sql, params))
}

fn friend_log_cursor(row: &FriendLogPageRow) -> String {
    format!("{}|{}", row.row.created_at, row.id)
}

fn parse_friend_log_cursor(value: &str) -> Result<(String, i64), Error> {
    let Some((created_at, id)) = value.rsplit_once('|') else {
        return Err(Error::InvalidData("invalid friend log cursor".into()));
    };
    let id = id
        .parse::<i64>()
        .map_err(|_| Error::InvalidData("invalid friend log cursor".into()))?;
    if created_at.trim().is_empty() {
        return Err(Error::InvalidData("invalid friend log cursor".into()));
    }
    Ok((created_at.to_string(), id))
}

pub fn get_friend_log_first_created_at(
    db: &DatabaseService,
    owner_user_id: &str,
    target_user_id: &str,
    kind: &str,
) -> Result<Option<String>, Error> {
    let target_user_id = target_user_id.trim();
    if target_user_id.is_empty() {
        return Ok(None);
    }
    let kind = kind.trim();
    if !is_friend_log_type(kind) {
        return Err(Error::InvalidData(format!(
            "unsupported friend log type: {kind}"
        )));
    }

    let user_prefix = normalize_user_table_prefix(owner_user_id)?;
    let table_name = format!("{user_prefix}_friend_log_history");
    if !table_exists(db, &table_name)? {
        return Ok(None);
    }

    Ok(db
        .execute(
            &format!(
                "SELECT created_at
                 FROM {table_name}
                 WHERE user_id = @target_user_id AND type = @kind
                 ORDER BY created_at ASC, id ASC
                 LIMIT 1"
            ),
            &ParamsBuilder::new()
                .set("target_user_id", target_user_id)
                .set("kind", kind)
                .build(),
        )?
        .first()
        .map(|row| row_string(row, 0))
        .filter(|value| !value.trim().is_empty()))
}

fn normalize_friend_log_types(types: Vec<String>) -> Result<Vec<String>, Error> {
    let mut normalized = Vec::new();
    let mut invalid = Vec::new();
    for value in types {
        let value = value.trim().to_string();
        if value.is_empty() {
            continue;
        }
        if is_friend_log_type(&value) {
            normalized.push(value);
        } else {
            invalid.push(value);
        }
    }
    if invalid.is_empty() {
        Ok(normalized)
    } else {
        Err(Error::InvalidData(format!(
            "unsupported friend log type(s): {}",
            invalid.join(", ")
        )))
    }
}

fn is_friend_log_type(value: &str) -> bool {
    matches!(
        value,
        "Friend"
            | "Unfriend"
            | "FriendRequest"
            | "CancelFriendRequest"
            | "DisplayName"
            | "TrustLevel"
    )
}
