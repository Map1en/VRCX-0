use std::collections::BTreeMap;

use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use super::caveats::friend_activity_caveats;
use super::helpers::{
    append_time_window_filter, table_exists, typical_online_window, tz_offset_modifier,
    with_tz_caveat, LatestName,
};
use super::types::{
    ActivityBucket, FriendActivityPatternInput, FriendActivityPatternOutput,
    FriendActivityPatternRow,
};

pub fn get_friend_activity_pattern(
    db: &DatabaseService,
    input: FriendActivityPatternInput,
) -> Result<FriendActivityPatternOutput, Error> {
    let user_prefix = normalize_user_table_prefix(input.owner_user_id.as_str())?;
    let table_name = format!("{user_prefix}_feed_online_offline");
    if !table_exists(db, &table_name)? {
        return Ok(FriendActivityPatternOutput {
            rows: Vec::new(),
            caveats: friend_activity_caveats(),
        });
    }

    let offset_minutes = input.utc_offset_minutes.unwrap_or(0);
    let tz_modifier = tz_offset_modifier(offset_minutes);
    let bucket_expr = match input.bucket {
        ActivityBucket::HourOfDay => "strftime('%H', created_at, @tz)",
        ActivityBucket::DayOfWeek => {
            "CAST((CAST(strftime('%w', created_at, @tz) AS INTEGER) + 6) % 7 AS TEXT)"
        }
    };
    let mut sql = format!(
        "WITH filtered AS (
            SELECT user_id, display_name, {bucket_expr} AS bucket, created_at
            FROM {table_name}
            WHERE type = 'Online'"
    );
    let mut params = ParamsBuilder::new().set("tz", tz_modifier);
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "created_at");
    if let Some(user_id) = input
        .user_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" AND user_id = @user_id");
        params = std::mem::take(&mut params).set("user_id", user_id);
    }
    sql.push_str(
        ")
        , latest_name AS (
            SELECT user_id, bucket, display_name
            FROM (
                SELECT
                    user_id,
                    bucket,
                    display_name,
                    ROW_NUMBER() OVER (
                        PARTITION BY user_id, bucket
                        ORDER BY created_at DESC
                    ) AS rn
                FROM filtered
                WHERE trim(user_id) <> '' AND bucket IS NOT NULL AND bucket <> ''
            )
            WHERE rn = 1
        )
        , grouped AS (
            SELECT user_id, bucket, COUNT(*) AS online_count, MAX(created_at) AS latest_at
            FROM filtered
            WHERE trim(user_id) <> '' AND bucket IS NOT NULL AND bucket <> ''
            GROUP BY user_id, bucket
        )
        SELECT
            grouped.user_id,
            latest_name.display_name AS display_name,
            grouped.bucket,
            grouped.online_count,
            grouped.latest_at
        FROM grouped
        JOIN latest_name
            ON latest_name.user_id = grouped.user_id
            AND latest_name.bucket = grouped.bucket
        ORDER BY grouped.user_id ASC, grouped.bucket ASC",
    );

    let mut grouped: BTreeMap<String, FriendActivityAccumulator> = BTreeMap::new();
    for row in db.execute(&sql, &params.build())? {
        let user_id = row_string(&row, 0);
        if user_id.is_empty() {
            continue;
        }
        let display_name = row_string(&row, 1);
        let bucket = row_string(&row, 2);
        let count = row_i64(&row, 3);
        let latest_at = row_string(&row, 4);
        let entry = grouped
            .entry(user_id.clone())
            .or_insert_with(|| FriendActivityAccumulator {
                user_id,
                latest_name: LatestName::default(),
                buckets: BTreeMap::new(),
            });
        entry.latest_name.observe(&display_name, &latest_at);
        *entry.buckets.entry(bucket).or_insert(0) += count;
    }

    Ok(FriendActivityPatternOutput {
        rows: grouped
            .into_values()
            .map(|entry| FriendActivityPatternRow {
                typical_online_window: typical_online_window(&entry.buckets, &input.bucket),
                user_id: entry.user_id,
                display_name: entry.latest_name.into_name(),
                buckets: entry.buckets,
            })
            .collect(),
        caveats: with_tz_caveat(friend_activity_caveats(), offset_minutes),
    })
}

#[derive(Clone, Debug)]
struct FriendActivityAccumulator {
    user_id: String,
    latest_name: LatestName,
    buckets: BTreeMap<String, i64>,
}
