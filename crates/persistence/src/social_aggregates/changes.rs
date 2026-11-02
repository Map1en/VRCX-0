use std::collections::BTreeMap;

use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use super::caveats::friend_changes_caveats;
use super::helpers::{append_time_window_filter, clamped_optional_limit, table_exists};
use super::types::{
    FriendChangeEvent, FriendChangeKind, FriendChangeRow, FriendChangesInput, FriendChangesOutput,
};

const RECENT_EVENTS_PER_FRIEND: i64 = 3;

pub fn get_friend_changes(
    db: &DatabaseService,
    input: FriendChangesInput,
) -> Result<FriendChangesOutput, Error> {
    let user_prefix = normalize_user_table_prefix(input.owner_user_id.as_str())?;
    let (table_name, select_sql) = match input.kind {
        FriendChangeKind::Status => (
            format!("{user_prefix}_feed_status"),
            "SELECT user_id, display_name, created_at, previous_status || ' ' || previous_status_description AS previous_value, status || ' ' || status_description AS new_value",
        ),
        FriendChangeKind::Avatar => (
            format!("{user_prefix}_feed_avatar"),
            "SELECT user_id, display_name, created_at, '' AS previous_value, avatar_name AS new_value",
        ),
        FriendChangeKind::Bio => (
            format!("{user_prefix}_feed_bio"),
            "SELECT user_id, display_name, created_at, previous_bio AS previous_value, bio AS new_value",
        ),
    };
    if !table_exists(db, &table_name)? {
        return Ok(FriendChangesOutput {
            rows: Vec::new(),
            caveats: friend_changes_caveats(),
        });
    }

    let limit = clamped_optional_limit(input.limit, 25, 100);
    let mut sql = format!(
        "WITH filtered AS (
            {select_sql}, id FROM {table_name} WHERE trim(COALESCE(user_id, '')) <> ''"
    );
    let mut params = ParamsBuilder::new()
        .set("limit", limit)
        .set("recent_events", RECENT_EVENTS_PER_FRIEND);
    if let Some(target_user_id) = input
        .target_user_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" AND user_id = @target_user_id");
        params = params.set("target_user_id", target_user_id);
    }
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "created_at");
    sql.push_str(
        "
        ), counted AS (
            SELECT user_id, COUNT(*) AS change_count, MAX(created_at) AS last_changed_at
            FROM filtered
            GROUP BY user_id
            ORDER BY change_count DESC, last_changed_at DESC, user_id ASC
            LIMIT @limit
        ), ranked AS (
            SELECT
                filtered.*,
                ROW_NUMBER() OVER (
                    PARTITION BY filtered.user_id
                    ORDER BY filtered.created_at DESC, filtered.id DESC
                ) AS rn
            FROM filtered
            JOIN counted ON counted.user_id = filtered.user_id
        )
        SELECT ranked.user_id, ranked.display_name,
            COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', ranked.created_at), ranked.created_at),
            ranked.previous_value, ranked.new_value, counted.change_count,
            COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', counted.last_changed_at), counted.last_changed_at)
        FROM ranked
        JOIN counted ON counted.user_id = ranked.user_id
        WHERE ranked.rn <= @recent_events
        ORDER BY ranked.user_id ASC, ranked.rn ASC",
    );

    let mut grouped: BTreeMap<String, FriendChangeAccumulator> = BTreeMap::new();
    for row in db.execute(&sql, &params.build())? {
        let user_id = row_string(&row, 0);
        let entry = grouped
            .entry(user_id.clone())
            .or_insert_with(|| FriendChangeAccumulator {
                user_id,
                display_name: row_string(&row, 1),
                change_count: row_i64(&row, 5),
                last_changed_at: row_string(&row, 6),
                recent_events: Vec::new(),
            });
        entry.recent_events.push(FriendChangeEvent {
            changed_at: row_string(&row, 2),
            kind: input.kind.clone(),
            previous_value: row_string(&row, 3).trim().to_string(),
            new_value: row_string(&row, 4).trim().to_string(),
        });
    }

    let mut rows = grouped
        .into_values()
        .map(|entry| FriendChangeRow {
            user_id: entry.user_id,
            display_name: entry.display_name,
            change_count: entry.change_count,
            last_changed_at: entry.last_changed_at,
            recent_events: entry.recent_events,
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        right
            .change_count
            .cmp(&left.change_count)
            .then_with(|| right.last_changed_at.cmp(&left.last_changed_at))
            .then_with(|| left.display_name.cmp(&right.display_name))
            .then_with(|| left.user_id.cmp(&right.user_id))
    });

    Ok(FriendChangesOutput {
        rows,
        caveats: friend_changes_caveats(),
    })
}

#[derive(Clone, Debug, Default)]
struct FriendChangeAccumulator {
    user_id: String,
    display_name: String,
    change_count: i64,
    last_changed_at: String,
    recent_events: Vec<FriendChangeEvent>,
}
