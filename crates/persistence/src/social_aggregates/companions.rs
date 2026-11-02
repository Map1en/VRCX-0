use std::collections::{BTreeMap, BTreeSet};

use vrcx_0_core::location::parse_location;

use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::ownership::{owner_id_for_filter, OwnerId};
use crate::Error;

use super::caveats::companions_caveats;
use super::helpers::{
    append_time_window_filter, clamped_optional_limit, current_friend_id_set, format_minutes,
    latest_display_names_for_users, millis_to_minutes, world_names_for_ids,
};
use super::types::{CompanionOfRow, CompanionsOfInput, CompanionsOfOutput};

const TOP_WORLDS_PER_COMPANION: usize = 3;

pub fn get_companions_of(
    db: &DatabaseService,
    input: CompanionsOfInput,
) -> Result<CompanionsOfOutput, Error> {
    let target_user_id = input.user_id.trim().to_string();
    if target_user_id.is_empty() {
        return Ok(CompanionsOfOutput {
            rows: Vec::new(),
            summary: companions_summary("", &[]),
            caveats: companions_caveats(),
        });
    }
    let limit = clamped_optional_limit(input.limit, 25, 100);
    let owner_user_id = OwnerId::new(input.owner_user_id.as_str().trim());
    let owner_id = owner_id_for_filter(db, &owner_user_id)?;

    // Players the signed-in user observed leaving the same instances the target
    // was in, intersecting each pair's presence windows. Aggregating per
    // companion in SQL (with the `location` index driving the self-join) keeps
    // the ranked result bounded to `limit` rows instead of materializing every
    // overlapping pair. `location LIKE 'wrld_%'` already restricts to real
    // visible instances, so no per-row Rust visibility filter is needed.
    let mut sql = String::from(
        "SELECT
            other.user_id,
            SUM(
                MAX(0,
                    MIN(
                        CAST(strftime('%s', other.created_at) AS INTEGER),
                        CAST(strftime('%s', target.created_at) AS INTEGER)
                    ) - MAX(
                        CAST(strftime('%s', other.created_at) AS INTEGER) - (MAX(other.time, 0) / 1000),
                        CAST(strftime('%s', target.created_at) AS INTEGER) - (MAX(target.time, 0) / 1000)
                    )
                )
            ) AS overlap_seconds,
            COUNT(*) AS overlap_events,
            COUNT(DISTINCT other.location) AS shared_instances,
            MAX(other.created_at) AS last_seen_together,
            group_concat(DISTINCT other.location) AS locations
         FROM gamelog_join_leave target
         JOIN gamelog_join_leave other ON other.location = target.location
         WHERE target.owner_id IN (0, @owner_id)
           AND other.owner_id IN (0, @owner_id)
           AND target.user_id = @target_user_id
           AND target.type = 'OnPlayerLeft'
           AND target.time > 0
           AND target.location LIKE 'wrld_%'
           AND other.type = 'OnPlayerLeft'
           AND other.time > 0
           AND other.user_id <> @target_user_id
           AND other.user_id <> @owner_user_id
           AND trim(other.user_id) <> ''
           AND CAST(strftime('%s', other.created_at) AS INTEGER)
               > CAST(strftime('%s', target.created_at) AS INTEGER) - (MAX(target.time, 0) / 1000)
           AND CAST(strftime('%s', target.created_at) AS INTEGER)
               > CAST(strftime('%s', other.created_at) AS INTEGER) - (MAX(other.time, 0) / 1000)",
    );
    let mut params = ParamsBuilder::new()
        .set("target_user_id", target_user_id.clone())
        .set("owner_user_id", &owner_user_id)
        .set("owner_id", owner_id);
    append_time_window_filter(
        &mut sql,
        &mut params,
        &input.time_window,
        "target.created_at",
    );
    sql.push_str(
        " GROUP BY other.user_id
          ORDER BY shared_instances DESC, overlap_seconds DESC, overlap_events DESC, other.user_id ASC
          LIMIT @limit",
    );
    params = params.set("limit", limit);

    let mut rows = Vec::new();
    let mut top_world_ids = Vec::new();
    let mut world_ids = BTreeSet::new();
    for row in db.execute(&sql, &params.build())? {
        let user_id = row_string(&row, 0);
        if user_id.is_empty() {
            continue;
        }
        let mut instances_per_world = BTreeMap::<String, usize>::new();
        for location in row_string(&row, 5).split(',') {
            let world_id = parse_location(location).world_id;
            if !world_id.is_empty() {
                *instances_per_world.entry(world_id).or_default() += 1;
            }
        }
        let mut ranked_worlds = instances_per_world.into_iter().collect::<Vec<_>>();
        ranked_worlds
            .sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
        let top = ranked_worlds
            .into_iter()
            .take(TOP_WORLDS_PER_COMPANION)
            .map(|(world_id, _)| world_id)
            .collect::<Vec<_>>();
        world_ids.extend(top.iter().cloned());
        top_world_ids.push(top);
        rows.push(CompanionOfRow {
            user_id,
            display_name: String::new(),
            is_friend: false,
            overlap_minutes: millis_to_minutes(row_i64(&row, 1).max(0) * 1000),
            shared_instances: usize::try_from(row_i64(&row, 3).max(0)).unwrap_or(0),
            last_seen_together: row_string(&row, 4),
            top_worlds: Vec::new(),
        });
    }

    let mut user_ids = rows
        .iter()
        .map(|row| row.user_id.clone())
        .collect::<Vec<_>>();
    user_ids.push(target_user_id.clone());
    let display_names = latest_display_names_for_users(db, &owner_user_id, &user_ids)?;
    let world_names = world_names_for_ids(db, &owner_user_id, &world_ids)?;
    let friend_ids = current_friend_id_set(db, &owner_user_id)?;
    for (row, top) in rows.iter_mut().zip(top_world_ids) {
        if let Some(name) = display_names.get(&row.user_id) {
            row.display_name = name.clone();
        }
        row.is_friend = friend_ids.contains(&row.user_id);
        row.top_worlds = top
            .iter()
            .filter_map(|world_id| world_names.get(world_id).cloned())
            .collect();
    }
    let target_display_name = display_names
        .get(&target_user_id)
        .cloned()
        .unwrap_or(target_user_id);

    Ok(CompanionsOfOutput {
        summary: companions_summary(&target_display_name, &rows),
        rows,
        caveats: companions_caveats(),
    })
}

fn companions_summary(target: &str, rows: &[CompanionOfRow]) -> String {
    let target = if target.trim().is_empty() {
        "This user"
    } else {
        target
    };
    let Some(top) = rows.first() else {
        return format!("{target} has no observed companions in the selected local history.");
    };
    let mut parts = Vec::new();
    parts.push(format!(
        "{} is most often with {} ({} instance(s), {})",
        target,
        top.display_name,
        top.shared_instances,
        format_minutes(top.overlap_minutes)
    ));
    for row in rows.iter().skip(1).take(2) {
        parts.push(format!(
            "{} ({} instance(s), {})",
            row.display_name,
            row.shared_instances,
            format_minutes(row.overlap_minutes)
        ));
    }
    format!("{}.", parts.join(", then "))
}
