use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use crate::common::{row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::ownership::owner_id_for_filter;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use super::types::{ActivityBucket, TimeWindow};

/// Resolve the latest known world name for each world id from the global game
/// log, so aggregations can surface readable world names instead of raw ids.
pub(crate) fn world_names_for_ids(
    db: &DatabaseService,
    owner_user_id: &str,
    world_ids: &BTreeSet<String>,
) -> Result<HashMap<String, String>, Error> {
    if world_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut placeholders = Vec::with_capacity(world_ids.len());
    let mut params = ParamsBuilder::new().set("owner_id", owner_id_for_filter(db, owner_user_id)?);
    for (index, world_id) in world_ids.iter().enumerate() {
        let key = format!("w{index}");
        placeholders.push(format!("@{key}"));
        params = params.set(&key, world_id.clone());
    }
    let sql = format!(
        "SELECT world_id, world_name
         FROM (
             SELECT
                 world_id,
                 world_name,
                 ROW_NUMBER() OVER (PARTITION BY world_id ORDER BY id DESC) AS rn
             FROM gamelog_location
             WHERE owner_id IN (0, @owner_id)
               AND world_id IN ({}) AND trim(world_name) <> ''
         )
         WHERE rn = 1",
        placeholders.join(", ")
    );
    let mut names = HashMap::new();
    for row in db.execute(&sql, &params.build())? {
        let world_id = row_string(&row, 0);
        if !world_id.is_empty() {
            names.insert(world_id, row_string(&row, 1));
        }
    }
    Ok(names)
}

/// Resolve the latest observed display name for each user id from the global
/// game log, so callers that aggregate by user id in SQL can resolve names for
/// just the bounded result set instead of carrying names through the fold.
pub(crate) fn latest_display_names_for_users(
    db: &DatabaseService,
    owner_user_id: &str,
    user_ids: &[String],
) -> Result<HashMap<String, String>, Error> {
    if user_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut placeholders = Vec::with_capacity(user_ids.len());
    let mut params = ParamsBuilder::new().set("owner_id", owner_id_for_filter(db, owner_user_id)?);
    for (index, user_id) in user_ids.iter().enumerate() {
        let key = format!("u{index}");
        placeholders.push(format!("@{key}"));
        params = params.set(&key, user_id.clone());
    }
    let sql = format!(
        "SELECT user_id, display_name
         FROM (
             SELECT
                 user_id,
                 display_name,
                 ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
             FROM gamelog_join_leave
             WHERE owner_id IN (0, @owner_id)
               AND user_id IN ({}) AND trim(display_name) <> ''
         )
         WHERE rn = 1",
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

/// Name of the owner's current-friends table, or `None` when the owner is
/// unknown or the table has not been created yet.
pub(crate) fn friend_current_table_name(
    db: &DatabaseService,
    owner_user_id: &str,
) -> Result<Option<String>, Error> {
    let owner = owner_user_id.trim();
    if owner.is_empty() {
        return Ok(None);
    }
    let user_prefix = normalize_user_table_prefix(owner)?;
    let table_name = format!("{user_prefix}_friend_log_current");
    Ok(table_exists(db, &table_name)?.then_some(table_name))
}

pub(crate) fn current_friend_id_set(
    db: &DatabaseService,
    owner_user_id: &str,
) -> Result<HashSet<String>, Error> {
    let Some(table_name) = friend_current_table_name(db, owner_user_id)? else {
        return Ok(HashSet::new());
    };
    let rows = db.execute(
        &format!("SELECT user_id FROM {table_name}"),
        &ParamsBuilder::new().build(),
    )?;
    Ok(rows
        .into_iter()
        .map(|row| row_string(&row, 0))
        .filter(|value| !value.is_empty())
        .collect())
}

/// Append the timezone that hour/weekday buckets were computed in to a caveat
/// list, so callers that pass a `utcOffsetMinutes` get one consistent note.
pub(crate) fn with_tz_caveat(mut caveats: Vec<String>, utc_offset_minutes: i64) -> Vec<String> {
    caveats.push(format!(
        "Hour/weekday buckets are in {}.",
        tz_offset_label(utc_offset_minutes)
    ));
    caveats
}

/// SQLite `strftime` modifier that shifts a UTC timestamp into a local zone, so
/// hour/weekday buckets are computed in the caller's timezone instead of UTC.
pub(crate) fn tz_offset_modifier(utc_offset_minutes: i64) -> String {
    let sign = if utc_offset_minutes < 0 { '-' } else { '+' };
    format!("{sign}{} minutes", utc_offset_minutes.abs())
}

/// Human-readable timezone label for caveats, e.g. "UTC+09:00" or "UTC".
pub(crate) fn tz_offset_label(utc_offset_minutes: i64) -> String {
    if utc_offset_minutes == 0 {
        return "UTC".to_string();
    }
    let sign = if utc_offset_minutes < 0 { '-' } else { '+' };
    let total = utc_offset_minutes.abs();
    format!("UTC{sign}{:02}:{:02}", total / 60, total % 60)
}

pub(crate) fn append_time_window_filter(
    sql: &mut String,
    params: &mut ParamsBuilder,
    time_window: &TimeWindow,
    column: &str,
) {
    if let Some(from) = time_window
        .from
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sql.push_str(&format!(" AND {column} >= @from"));
        *params = std::mem::take(params).set("from", from);
    }
    if let Some(to) = time_window
        .to
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sql.push_str(&format!(" AND {column} <= @to"));
        *params = std::mem::take(params).set("to", to);
    }
}

pub(crate) fn table_exists(db: &DatabaseService, table_name: &str) -> Result<bool, Error> {
    Ok(!db
        .execute(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = @name LIMIT 1",
            &ParamsBuilder::new().set("name", table_name).build(),
        )?
        .is_empty())
}

pub fn normalize_access_bucket(access_type: &str) -> String {
    match access_type {
        "" => "unknown".into(),
        "invite+" => "invitePlus".into(),
        "friends+" => "friendsPlus".into(),
        other => other.to_string(),
    }
}

pub(crate) fn millis_to_minutes(millis: i64) -> i64 {
    millis / 60_000
}

pub(crate) fn format_minutes(minutes: i64) -> String {
    if minutes < 60 {
        return format!("{minutes}m");
    }
    let hours = minutes / 60;
    let remainder = minutes % 60;
    if remainder == 0 {
        format!("{hours}h")
    } else {
        format!("{hours}h {remainder}m")
    }
}

pub(crate) fn clamped_optional_limit(limit: Option<i64>, default: i64, max: i64) -> i64 {
    limit.unwrap_or(default).clamp(1, max)
}

pub(crate) fn date_part(value: &str) -> String {
    value.chars().take(10).collect()
}

pub(crate) fn typical_online_window(
    buckets: &BTreeMap<String, i64>,
    bucket: &ActivityBucket,
) -> String {
    let Some((key, _)) = buckets
        .iter()
        .max_by(|left, right| left.1.cmp(right.1).then_with(|| right.0.cmp(left.0)))
    else {
        return String::new();
    };
    bucket_label(bucket, key)
}

pub(crate) fn bucket_label(bucket: &ActivityBucket, key: &str) -> String {
    match bucket {
        ActivityBucket::HourOfDay => {
            let hour = key.parse::<u8>().unwrap_or(0).min(23);
            format!("{hour:02}:00-{next:02}:00", next = (hour + 1) % 24)
        }
        ActivityBucket::DayOfWeek => weekday_name(key).to_string(),
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct LatestName {
    name: String,
    at: String,
}

impl LatestName {
    pub(crate) fn observe(&mut self, name: &str, created_at: &str) {
        if self.name.is_empty() || created_at > self.at.as_str() {
            self.name = name.to_string();
            self.at = created_at.to_string();
        }
    }

    pub(crate) fn into_name(self) -> String {
        self.name
    }
}

fn weekday_name(key: &str) -> &'static str {
    match key {
        "0" => "Sunday",
        "1" => "Monday",
        "2" => "Tuesday",
        "3" => "Wednesday",
        "4" => "Thursday",
        "5" => "Friday",
        "6" => "Saturday",
        _ => "",
    }
}
