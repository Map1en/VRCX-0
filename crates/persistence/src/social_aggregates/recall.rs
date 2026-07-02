use std::collections::{BTreeMap, HashSet};

use crate::common::{row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::Error;

use super::caveats::recall_encounter_caveats;
use super::helpers::{
    append_time_window_filter, clamped_optional_limit, current_friend_id_set, date_part,
};
use super::types::{RecallEncounterInput, RecallEncounterOutput, RecallEncounterRow};

const SCAN_LIMIT: i64 = 5000;

pub fn recall_encounter(
    db: &DatabaseService,
    input: RecallEncounterInput,
) -> Result<RecallEncounterOutput, Error> {
    let friend_ids = current_friend_id_set(db, &input.owner_user_id)?;

    let mut sql = String::from(
        "SELECT user_id, display_name, location, created_at
         FROM gamelog_join_leave g
         WHERE type = 'OnPlayerJoined' AND display_name <> ''",
    );
    let mut params = ParamsBuilder::new().set("scan_limit", SCAN_LIMIT);

    let owner_user_id = input.owner_user_id.trim();
    if !owner_user_id.is_empty() {
        sql.push_str(" AND COALESCE(g.user_id, '') <> @owner_user_id");
        params = params.set("owner_user_id", owner_user_id.to_string());
    }

    if let Some(name_query) = trimmed(&input.name_query) {
        sql.push_str(" AND display_name LIKE @name_pattern");
        params = params.set("name_pattern", format!("%{name_query}%"));
    }
    if let Some(world_id) = trimmed(&input.world_id) {
        sql.push_str(" AND location LIKE @world_pattern");
        params = params.set("world_pattern", format!("{world_id}%"));
    }
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "created_at");
    if let Some(co_present) = trimmed(&input.co_present_with_user_id) {
        params = params.set("co_present", co_present);
        sql.push_str(
            " AND g.user_id <> @co_present AND g.location <> '' AND g.location IN (SELECT j.location FROM gamelog_join_leave j WHERE j.user_id = @co_present AND j.location <> ''",
        );
        append_time_window_filter(&mut sql, &mut params, &input.time_window, "j.created_at");
        sql.push(')');
    }
    sql.push_str(" ORDER BY created_at DESC, id DESC LIMIT @scan_limit");

    let mut grouped: BTreeMap<String, RecallAccumulator> = BTreeMap::new();
    for row in db.execute(&sql, &params.build())? {
        let user_id = row_string(&row, 0);
        let display_name = row_string(&row, 1);
        let key = if user_id.trim().is_empty() {
            format!("name:{display_name}")
        } else {
            user_id.clone()
        };
        if key == "name:" {
            continue;
        }
        let location = row_string(&row, 2);
        let created_at = row_string(&row, 3);
        let entry = grouped.entry(key).or_insert_with(|| RecallAccumulator {
            user_id: user_id.clone(),
            display_name: display_name.clone(),
            ..RecallAccumulator::default()
        });
        if entry.display_name.is_empty() {
            entry.display_name = display_name;
        }
        entry.encounter_count += 1;
        if !created_at.is_empty() {
            entry.days.insert(date_part(&created_at));
            if entry.first_seen.is_empty() || created_at < entry.first_seen {
                entry.first_seen = created_at.clone();
            }
            if created_at > entry.last_seen {
                entry.last_seen = created_at;
            }
        }
        if !location.is_empty() && entry.sample_locations.len() < 3 {
            entry.sample_locations.insert(location);
        }
    }

    let mut rows = grouped
        .into_values()
        .map(|entry| RecallEncounterRow {
            is_friend: !entry.user_id.is_empty() && friend_ids.contains(&entry.user_id),
            user_id: entry.user_id,
            display_name: entry.display_name,
            encounter_count: entry.encounter_count,
            encounter_days: entry.days.len(),
            first_seen: entry.first_seen,
            last_seen: entry.last_seen,
            sample_locations: entry.sample_locations.into_iter().collect(),
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        right
            .last_seen
            .cmp(&left.last_seen)
            .then_with(|| right.encounter_count.cmp(&left.encounter_count))
            .then_with(|| left.display_name.cmp(&right.display_name))
    });
    rows.truncate(clamped_optional_limit(input.limit, 50, 200) as usize);

    let summary = recall_encounter_summary(&rows);
    Ok(RecallEncounterOutput {
        rows,
        summary,
        caveats: recall_encounter_caveats(),
    })
}

fn recall_encounter_summary(rows: &[RecallEncounterRow]) -> String {
    if rows.is_empty() {
        return "No matching encounters found.".to_string();
    }
    let entries = rows
        .iter()
        .map(|row| format!("{} ({}x)", row.display_name, row.encounter_count))
        .collect::<Vec<_>>()
        .join(", ");
    format!("{} match(es): {entries}.", rows.len())
}

fn trimmed(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[derive(Clone, Debug, Default)]
struct RecallAccumulator {
    user_id: String,
    display_name: String,
    encounter_count: i64,
    days: HashSet<String>,
    first_seen: String,
    last_seen: String,
    sample_locations: HashSet<String>,
}
