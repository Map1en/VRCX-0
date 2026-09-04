use std::collections::HashMap;
use std::fs;

use serde_json::Value;

use crate::Error;

use super::schema::select_table_names;
use super::DatabaseService;

const FEED_TABLE_SUFFIXES: [&str; 4] = [
    "feed_gps",
    "feed_avatar",
    "feed_online_offline",
    "feed_status",
];
const FRIEND_LOG_TABLE_SUFFIX: &str = "friend_log_history";
const GAMELOG_TABLE: &str = "gamelog_join_leave";
const PREFIX_PROBE_SUFFIX: &str = "feed_gps";

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct DatabaseScaleEstimate {
    pub db_bytes: u64,
    pub feed_rows: Option<i64>,
    pub gamelog_rows: Option<i64>,
    pub friend_log_rows: Option<i64>,
}

pub fn database_scale_estimate(db: &DatabaseService) -> Result<DatabaseScaleEstimate, Error> {
    let db_bytes = fs::metadata(db.db_path())
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let analyzed_rows = analyzed_row_counts(db)?;
    if analyzed_rows.is_empty() {
        return Ok(DatabaseScaleEstimate {
            db_bytes,
            ..DatabaseScaleEstimate::default()
        });
    }

    let mut feed_rows = None;
    let mut friend_log_rows = None;
    for prefix in user_table_prefixes(db)? {
        let mut prefix_feed_rows = None;
        for suffix in FEED_TABLE_SUFFIXES {
            if let Some(rows) = analyzed_rows.get(&format!("{prefix}_{suffix}")) {
                prefix_feed_rows = Some(prefix_feed_rows.unwrap_or(0) + rows);
            }
        }
        feed_rows = larger(feed_rows, prefix_feed_rows);
        friend_log_rows = larger(
            friend_log_rows,
            analyzed_rows
                .get(&format!("{prefix}_{FRIEND_LOG_TABLE_SUFFIX}"))
                .copied(),
        );
    }

    Ok(DatabaseScaleEstimate {
        db_bytes,
        feed_rows,
        gamelog_rows: analyzed_rows.get(GAMELOG_TABLE).copied(),
        friend_log_rows,
    })
}

fn larger(current: Option<i64>, candidate: Option<i64>) -> Option<i64> {
    match (current, candidate) {
        (Some(current), Some(candidate)) => Some(current.max(candidate)),
        (Some(current), None) => Some(current),
        (None, candidate) => candidate,
    }
}

fn analyzed_row_counts(db: &DatabaseService) -> Result<HashMap<String, i64>, Error> {
    let stat_tables = select_table_names(db, "name = 'sqlite_stat1'")?;
    if stat_tables.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = db.execute("SELECT tbl, stat FROM sqlite_stat1", &Default::default())?;
    let mut counts: HashMap<String, i64> = HashMap::new();
    for row in rows {
        let Some(table) = row.first().and_then(Value::as_str) else {
            continue;
        };
        let Some(rows) = row.get(1).and_then(Value::as_str).and_then(parse_stat_rows) else {
            continue;
        };
        counts
            .entry(table.to_string())
            .and_modify(|current| *current = (*current).max(rows))
            .or_insert(rows);
    }
    Ok(counts)
}

fn parse_stat_rows(stat: &str) -> Option<i64> {
    stat.split_whitespace().next()?.parse::<i64>().ok()
}

fn user_table_prefixes(db: &DatabaseService) -> Result<Vec<String>, Error> {
    let probe_suffix = format!("_{PREFIX_PROBE_SUFFIX}");
    Ok(
        select_table_names(db, &format!("name GLOB 'usr*{probe_suffix}'"))?
            .into_iter()
            .filter_map(|table| {
                table
                    .strip_suffix(&probe_suffix)
                    .map(|prefix| prefix.to_string())
            })
            .collect(),
    )
}

#[cfg(test)]
#[path = "scale/tests.rs"]
mod tests;
