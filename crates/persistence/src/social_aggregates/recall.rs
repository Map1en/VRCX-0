use std::collections::{BTreeMap, BTreeSet, HashSet};

use vrcx_0_core::location::parse_location;

use crate::common::{row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::ownership::owner_id_for_filter;
use crate::Error;

use super::caveats::recall_encounter_caveats;
use super::helpers::{
    append_time_window_filter, clamped_optional_limit, current_friend_id_set, date_part,
    world_names_for_ids,
};
use super::types::{RecallEncounterInput, RecallEncounterOutput, RecallEncounterRow};

const SCAN_LIMIT: i64 = 5000;
const SAMPLE_WORLDS: usize = 2;
const SUMMARY_NAMES: usize = 10;

pub fn recall_encounter(
    db: &DatabaseService,
    input: RecallEncounterInput,
) -> Result<RecallEncounterOutput, Error> {
    let friend_ids = current_friend_id_set(db, &input.owner_user_id)?;
    let owner_id = owner_id_for_filter(db, &input.owner_user_id)?;

    let mut sql = String::from(
        "SELECT user_id, display_name, location, created_at
         FROM gamelog_join_leave g
         WHERE g.owner_id IN (0, @owner_id)
           AND type = 'OnPlayerJoined' AND display_name <> ''",
    );
    let mut params = ParamsBuilder::new()
        .set("scan_limit", SCAN_LIMIT)
        .set("owner_id", owner_id);

    let owner_user_id = input.owner_user_id.as_str().trim();
    if !owner_user_id.is_empty() {
        sql.push_str(" AND COALESCE(g.user_id, '') <> @owner_user_id");
        params = params.set("owner_user_id", owner_user_id.to_string());
    }

    if let Some(name_query) = trimmed(&input.name_query) {
        sql.push_str(" AND display_name LIKE @name_pattern");
        params = params.set("name_pattern", format!("%{name_query}%"));
    }
    if let Some(target_user_id) = trimmed(&input.target_user_id) {
        sql.push_str(" AND g.user_id = @target_user_id");
        params = params.set("target_user_id", target_user_id);
    }
    if let Some(world_id) = trimmed(&input.world_id) {
        sql.push_str(" AND location LIKE @world_pattern");
        params = params.set("world_pattern", format!("{world_id}%"));
    }
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "created_at");
    if let Some(co_present) = trimmed(&input.co_present_with_user_id) {
        params = params.set("co_present", co_present);
        sql.push_str(
            " AND g.user_id <> @co_present AND g.location <> '' AND g.location IN (SELECT j.location FROM gamelog_join_leave j WHERE j.owner_id IN (0, @owner_id) AND j.user_id = @co_present AND j.location <> ''",
        );
        append_time_window_filter(&mut sql, &mut params, &input.time_window, "j.created_at");
        sql.push(')');
    }
    sql.push_str(" ORDER BY created_at DESC, id DESC LIMIT @scan_limit");

    let mut grouped: BTreeMap<String, RecallAccumulator> = BTreeMap::new();
    let scanned = db.execute(&sql, &params.build())?;
    let scan_was_capped = scanned.len() as i64 >= SCAN_LIMIT;
    for row in scanned {
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
        let world_id = parse_location(&location).world_id;
        if !world_id.is_empty()
            && entry.sample_world_ids.len() < SAMPLE_WORLDS
            && !entry.sample_world_ids.contains(&world_id)
        {
            entry.sample_world_ids.push(world_id);
        }
    }
    let world_ids = grouped
        .values()
        .flat_map(|entry| entry.sample_world_ids.iter().cloned())
        .collect::<BTreeSet<_>>();
    let world_names = world_names_for_ids(db, &input.owner_user_id, &world_ids)?;

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
            sample_worlds: entry
                .sample_world_ids
                .iter()
                .filter_map(|world_id| world_names.get(world_id).cloned())
                .collect(),
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
    let mut caveats = recall_encounter_caveats();
    if scan_was_capped {
        caveats.push(format!(
            "Only the newest {SCAN_LIMIT} matching join events were scanned; narrow timeWindow or nameQuery to reach older encounters."
        ));
    }
    Ok(RecallEncounterOutput {
        rows,
        summary,
        caveats,
    })
}

fn recall_encounter_summary(rows: &[RecallEncounterRow]) -> String {
    if rows.is_empty() {
        return "No matching encounters found.".to_string();
    }
    let entries = rows
        .iter()
        .take(SUMMARY_NAMES)
        .map(|row| format!("{} ({}x)", row.display_name, row.encounter_count))
        .collect::<Vec<_>>()
        .join(", ");
    let more = rows.len().saturating_sub(SUMMARY_NAMES);
    if more == 0 {
        format!("{} match(es): {entries}.", rows.len())
    } else {
        format!("{} match(es): {entries}, and {more} more.", rows.len())
    }
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
    sample_world_ids: Vec<String>,
}
