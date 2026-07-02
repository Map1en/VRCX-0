use std::collections::{BTreeMap, BTreeSet};

use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use super::caveats::copresence_caveats;
use super::helpers::{
    append_time_window_filter, clamped_optional_limit, current_friend_id_set, format_minutes,
    millis_to_minutes, normalize_access_bucket, table_exists, world_names_for_ids,
};
use super::types::{
    CopresenceGroupBy, CopresenceSummaryInput, CopresenceSummaryOutput, CopresenceSummaryRow,
};

pub fn get_copresence_summary(
    db: &DatabaseService,
    input: CopresenceSummaryInput,
) -> Result<CopresenceSummaryOutput, Error> {
    let limit = clamped_optional_limit(input.limit, 25, 100);
    let min_millis = input.min_minutes.unwrap_or(0).max(0).saturating_mul(60_000);
    let world_id_expr = match input.group_by {
        CopresenceGroupBy::Friend => "''",
        CopresenceGroupBy::FriendWorld => {
            "CASE
                WHEN substr(g.location, 1, 5) = 'wrld_' AND instr(g.location, ':') > 0
                    THEN substr(g.location, 1, instr(g.location, ':') - 1)
                WHEN substr(g.location, 1, 5) = 'wrld_' AND instr(g.location, ':') = 0
                    THEN g.location
                ELSE ''
             END"
        }
    };
    let mut sql = String::from(
        "WITH base AS (
            SELECT
                COALESCE(g.user_id, '') AS user_id,
                COALESCE(g.display_name, '') AS display_name,
                CASE
                    WHEN trim(COALESCE(g.user_id, '')) <> '' THEN COALESCE(g.user_id, '')
                    ELSE 'name:' || COALESCE(g.display_name, '')
                END AS group_key,
                ",
    );
    sql.push_str(world_id_expr);
    sql.push_str(
        " AS world_id,
                COALESCE(g.location, '') AS location,
                g.time,
                COALESCE(g.created_at, '') AS created_at,
                CASE
                    WHEN g.location LIKE '%~private(%' AND g.location LIKE '%~canRequestInvite%' THEN 'invitePlus'
                    WHEN g.location LIKE '%~private(%' THEN 'invite'
                    WHEN g.location LIKE '%~friends(%' THEN 'friends'
                    WHEN g.location LIKE '%~hidden(%' THEN 'friendsPlus'
                    WHEN g.location LIKE '%~group(%' THEN 'group'
                    WHEN substr(g.location, 1, 5) = 'wrld_' AND instr(g.location, ':') > 0 THEN 'public'
                    ELSE 'unknown'
                END AS access_bucket
            FROM gamelog_join_leave g
            WHERE g.type = 'OnPlayerLeft'",
    );
    let mut params = ParamsBuilder::new();
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "g.created_at");

    let owner_user_id = input
        .owner_user_id
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    sql.push_str(" AND (@owner_user_id = '' OR COALESCE(g.user_id, '') <> @owner_user_id)");

    if input.friends_only {
        if let Some(owner_user_id) = input
            .owner_user_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let user_prefix = normalize_user_table_prefix(owner_user_id)?;
            let table_name = format!("{user_prefix}_friend_log_current");
            if table_exists(db, &table_name)? {
                sql.push_str(&format!(
                    " AND EXISTS (SELECT 1 FROM {table_name} f WHERE f.user_id = g.user_id)"
                ));
            } else {
                return Ok(CopresenceSummaryOutput {
                    rows: Vec::new(),
                    total_rows: 0,
                    returned_rows: 0,
                    truncated: false,
                    summary: copresence_summary(&[]),
                    caveats: copresence_caveats(),
                });
            }
        }
    }
    sql.push_str(
        ")
        , latest_name AS (
            SELECT group_key, world_id, display_name
            FROM (
                SELECT
                    group_key,
                    world_id,
                    display_name,
                    ROW_NUMBER() OVER (
                        PARTITION BY group_key, world_id
                        ORDER BY created_at DESC
                    ) AS rn
                FROM base
                WHERE NOT (trim(user_id) = '' AND trim(display_name) = '')
            )
            WHERE rn = 1
        )
        , grouped AS (
            SELECT
                group_key,
                MAX(user_id) AS user_id,
                world_id,
                SUM(time) AS total_millis,
                COUNT(DISTINCT CASE WHEN created_at <> '' THEN substr(created_at, 1, 10) END) AS co_days,
                COUNT(DISTINCT CASE WHEN location <> '' THEN location END) AS instances,
                MAX(created_at) AS last_seen_together
            FROM base
            WHERE NOT (trim(user_id) = '' AND trim(display_name) = '')
            GROUP BY group_key, world_id
            HAVING SUM(time) >= @min_millis
        )
        , ranked AS (
            SELECT
                grouped.group_key,
                grouped.user_id,
                latest_name.display_name AS display_name,
                grouped.world_id,
                grouped.total_millis,
                grouped.co_days,
                grouped.instances,
                grouped.last_seen_together,
                COUNT(*) OVER () AS total_rows
            FROM grouped
            JOIN latest_name
                ON latest_name.group_key = grouped.group_key
                AND latest_name.world_id = grouped.world_id
            ORDER BY grouped.total_millis DESC, latest_name.display_name ASC, grouped.user_id ASC, grouped.group_key ASC, grouped.world_id ASC
            LIMIT @limit
        )
        , access AS (
            SELECT
                group_key,
                world_id,
                access_bucket,
                SUM(time) AS access_millis
            FROM base
            WHERE NOT (trim(user_id) = '' AND trim(display_name) = '')
            GROUP BY group_key, world_id, access_bucket
        )
        SELECT
            ranked.user_id,
            ranked.display_name,
            ranked.world_id,
            ranked.total_millis,
            ranked.co_days,
            ranked.instances,
            ranked.last_seen_together,
            ranked.total_rows,
            access.access_bucket,
            access.access_millis,
            ranked.group_key
        FROM ranked
        LEFT JOIN access
            ON access.group_key = ranked.group_key
            AND access.world_id = ranked.world_id
        ORDER BY ranked.total_millis DESC, ranked.display_name ASC, ranked.user_id ASC, ranked.group_key ASC, ranked.world_id ASC, access.access_bucket ASC",
    );
    params = params
        .set("min_millis", min_millis)
        .set("limit", limit)
        .set("owner_user_id", owner_user_id.clone());

    let mut rows = Vec::new();
    let mut current_key: Option<CopresenceKey> = None;
    let mut current_row: Option<CopresenceSummaryRow> = None;
    let mut total_rows = 0usize;
    for row in db.execute(&sql, &params.build())? {
        let user_id = row_string(&row, 0);
        let display_name = row_string(&row, 1);
        let world_id = row_string(&row, 2);
        let key = CopresenceKey {
            group_key: row_string(&row, 10),
            world_id: (!world_id.is_empty()).then_some(world_id.clone()),
        };

        if current_key.as_ref() != Some(&key) {
            if let Some(row) = current_row.take() {
                rows.push(row);
            }
            current_key = Some(key.clone());
            current_row = Some(CopresenceSummaryRow {
                user_id,
                display_name,
                is_friend: false,
                world_id: key.world_id,
                world_name: None,
                total_minutes: millis_to_minutes(row_i64(&row, 3)),
                co_days: usize::try_from(row_i64(&row, 4).max(0)).unwrap_or(0),
                instances: usize::try_from(row_i64(&row, 5).max(0)).unwrap_or(0),
                last_seen_together: row_string(&row, 6),
                minutes_by_access: BTreeMap::new(),
            });
        }
        if total_rows == 0 {
            total_rows = usize::try_from(row_i64(&row, 7).max(0)).unwrap_or(0);
        }
        let access = normalize_access_bucket(&row_string(&row, 8));
        let access_minutes = millis_to_minutes(row_i64(&row, 9).max(0));
        if access_minutes > 0 {
            if let Some(current_row) = current_row.as_mut() {
                current_row.minutes_by_access.insert(access, access_minutes);
            }
        }
    }
    if let Some(row) = current_row {
        rows.push(row);
    }

    // When friends_only is set the query already restricted rows to current
    // friends, so skip the extra friend-set read and mark them directly.
    let friend_ids = if input.friends_only {
        None
    } else {
        Some(current_friend_id_set(db, &owner_user_id)?)
    };
    for row in &mut rows {
        row.is_friend = match &friend_ids {
            None => true,
            Some(friend_ids) => !row.user_id.is_empty() && friend_ids.contains(&row.user_id),
        };
    }

    let world_ids = rows
        .iter()
        .filter_map(|row| row.world_id.clone())
        .filter(|world_id| !world_id.is_empty())
        .collect::<BTreeSet<_>>();
    if !world_ids.is_empty() {
        let world_names = world_names_for_ids(db, &world_ids)?;
        for row in &mut rows {
            if let Some(world_id) = row.world_id.as_ref() {
                if let Some(name) = world_names.get(world_id) {
                    row.world_name = Some(name.clone());
                }
            }
        }
    }
    let returned_rows = rows.len();

    Ok(CopresenceSummaryOutput {
        summary: copresence_summary(&rows),
        rows,
        total_rows,
        returned_rows,
        truncated: returned_rows < total_rows,
        caveats: copresence_caveats(),
    })
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct CopresenceKey {
    group_key: String,
    world_id: Option<String>,
}

fn copresence_summary(rows: &[CopresenceSummaryRow]) -> String {
    let Some(top) = rows.first() else {
        return "No co-presence rows match this query.".into();
    };
    let mut parts = Vec::new();
    parts.push(format!(
        "You spend the most time with {} ({}, {} instance(s))",
        top.display_name,
        format_minutes(top.total_minutes),
        top.instances
    ));
    for row in rows.iter().skip(1).take(2) {
        parts.push(format!(
            "{} ({}, {} instance(s))",
            row.display_name,
            format_minutes(row.total_minutes),
            row.instances
        ));
    }
    format!("{}.", parts.join(", then "))
}
