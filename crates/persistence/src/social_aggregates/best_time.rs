use std::collections::BTreeMap;

use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use super::caveats::best_time_caveats;
use super::helpers::{
    append_time_window_filter, bucket_label, table_exists, tz_offset_modifier, with_tz_caveat,
};
use super::types::{
    ActivityBucket, BestTimeBucketRow, BestTimeFriend, BestTimeToPlayInput, BestTimeToPlayOutput,
};

pub fn get_best_time_to_play(
    db: &DatabaseService,
    input: BestTimeToPlayInput,
) -> Result<BestTimeToPlayOutput, Error> {
    let user_prefix = normalize_user_table_prefix(input.owner_user_id.as_str())?;
    let table_name = format!("{user_prefix}_feed_online_offline");
    if !table_exists(db, &table_name)? {
        return Ok(BestTimeToPlayOutput {
            rows: Vec::new(),
            caveats: best_time_caveats(),
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
            SELECT {bucket_expr} AS bucket, user_id, display_name, created_at
            FROM {table_name}
            WHERE type = 'Online'"
    );
    let mut params = ParamsBuilder::new().set("tz", tz_modifier);
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "created_at");
    sql.push_str(
        ")
        , grouped AS (
            SELECT bucket, user_id, COUNT(*) AS online_count
            FROM filtered
            WHERE bucket IS NOT NULL AND bucket <> '' AND trim(user_id) <> ''
            GROUP BY bucket, user_id
        )
        , latest_names AS (
            SELECT user_id, display_name
            FROM (
                SELECT
                    user_id,
                    display_name,
                    ROW_NUMBER() OVER (
                        PARTITION BY user_id
                        ORDER BY created_at DESC
                    ) AS rn
                FROM filtered
                WHERE trim(user_id) <> ''
            )
            WHERE rn = 1
        )
        SELECT
            grouped.bucket,
            grouped.user_id,
            latest_names.display_name,
            grouped.online_count
        FROM grouped
        JOIN latest_names ON latest_names.user_id = grouped.user_id
        ORDER BY grouped.bucket ASC",
    );

    let mut grouped: BTreeMap<String, BucketAccumulator> = BTreeMap::new();
    for row in db.execute(&sql, &params.build())? {
        let bucket = row_string(&row, 0);
        let user_id = row_string(&row, 1);
        if bucket.is_empty() || user_id.is_empty() {
            continue;
        }
        let display_name = row_string(&row, 2);
        let count = row_i64(&row, 3).max(0);
        let entry = grouped.entry(bucket).or_default();
        let friend = entry
            .friends
            .entry(user_id.clone())
            .or_insert_with(|| BestTimeFriend {
                user_id,
                display_name,
                online_events: 0,
            });
        friend.online_events += count;
        entry.online_events += count;
    }

    let mut rows = grouped
        .into_iter()
        .map(|(bucket, entry)| {
            let mut top_friends = entry.friends.into_values().collect::<Vec<_>>();
            top_friends.sort_by(|left, right| {
                right
                    .online_events
                    .cmp(&left.online_events)
                    .then_with(|| left.display_name.cmp(&right.display_name))
                    .then_with(|| left.user_id.cmp(&right.user_id))
            });
            let distinct_friends = top_friends.len();
            top_friends.truncate(5);
            BestTimeBucketRow {
                label: bucket_label(&input.bucket, &bucket),
                bucket,
                distinct_friends,
                online_events: entry.online_events,
                top_friends,
            }
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        right
            .distinct_friends
            .cmp(&left.distinct_friends)
            .then_with(|| right.online_events.cmp(&left.online_events))
            .then_with(|| left.bucket.cmp(&right.bucket))
    });
    if let Some(limit) = input.limit {
        rows.truncate(limit.clamp(1, 50) as usize);
    }

    Ok(BestTimeToPlayOutput {
        rows,
        caveats: with_tz_caveat(best_time_caveats(), offset_minutes),
    })
}

#[derive(Clone, Debug, Default)]
struct BucketAccumulator {
    friends: BTreeMap<String, BestTimeFriend>,
    online_events: i64,
}
