use std::collections::BTreeMap;

use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::ownership::owner_id_for_filter;
use crate::Error;

use super::helpers::{clamped_optional_limit, current_friend_id_set, friend_current_table_name};
use super::types::{ResolveUserInput, ResolveUserOutput, ResolvedUserRow};

pub fn resolve_user_by_name(
    db: &DatabaseService,
    input: ResolveUserInput,
) -> Result<ResolveUserOutput, Error> {
    let query = input.name_query.trim().to_string();
    if query.is_empty() {
        return Ok(ResolveUserOutput {
            rows: Vec::new(),
            caveats: resolve_caveats(),
        });
    }
    let limit = clamped_optional_limit(input.limit, 8, 25);
    let friend_ids = current_friend_id_set(db, &input.owner_user_id)?;
    let owner_id = owner_id_for_filter(db, &input.owner_user_id)?;
    let pattern = format!("%{query}%");

    let mut acc: BTreeMap<String, Candidate> = BTreeMap::new();

    // Source A: names observed in the local game log (friends and non-friends).
    let rows = db.execute(
        "SELECT user_id, display_name, COUNT(*) AS hits, MAX(created_at) AS last_seen
         FROM gamelog_join_leave
         WHERE owner_id IN (0, @owner_id)
           AND trim(user_id) <> '' AND display_name LIKE @pattern
         GROUP BY user_id, display_name",
        &ParamsBuilder::new()
            .set("pattern", pattern.clone())
            .set("owner_id", owner_id)
            .build(),
    )?;
    for row in rows {
        let user_id = row_string(&row, 0);
        if user_id.is_empty() {
            continue;
        }
        let name = row_string(&row, 1);
        let hits = row_i64(&row, 2).max(0);
        let last_seen = row_string(&row, 3);
        let entry = acc.entry(user_id.clone()).or_insert_with(|| Candidate {
            user_id,
            display_name: name.clone(),
            matched_name: name.clone(),
            encounter_count: 0,
            last_seen: String::new(),
        });
        entry.encounter_count += hits;
        if last_seen > entry.last_seen {
            entry.last_seen = last_seen;
            entry.matched_name = name.clone();
            entry.display_name = name;
        }
    }

    // Source B: current friends whose current name matches (covers rarely-seen friends).
    if let Some(table_name) = friend_current_table_name(db, &input.owner_user_id)? {
        let rows = db.execute(
            &format!(
                "SELECT user_id, display_name FROM {table_name} WHERE display_name LIKE @pattern"
            ),
            &ParamsBuilder::new().set("pattern", pattern).build(),
        )?;
        for row in rows {
            let user_id = row_string(&row, 0);
            if user_id.is_empty() {
                continue;
            }
            let name = row_string(&row, 1);
            let entry = acc.entry(user_id.clone()).or_insert_with(|| Candidate {
                user_id,
                display_name: name.clone(),
                matched_name: name.clone(),
                encounter_count: 0,
                last_seen: String::new(),
            });
            // A current friend's name is authoritative for display.
            entry.display_name = name;
        }
    }

    let query_lower = query.to_lowercase();
    let mut ranked = acc
        .into_values()
        .map(|candidate| {
            let is_friend = friend_ids.contains(&candidate.user_id);
            let exact = candidate.display_name.to_lowercase() == query_lower
                || candidate.matched_name.to_lowercase() == query_lower;
            (exact, is_friend, candidate)
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| right.1.cmp(&left.1))
            .then_with(|| right.2.encounter_count.cmp(&left.2.encounter_count))
            .then_with(|| right.2.last_seen.cmp(&left.2.last_seen))
            .then_with(|| left.2.display_name.cmp(&right.2.display_name))
    });
    ranked.truncate(limit as usize);

    let rows = ranked
        .into_iter()
        .map(|(_, is_friend, candidate)| ResolvedUserRow {
            user_id: candidate.user_id,
            display_name: candidate.display_name,
            matched_name: candidate.matched_name,
            is_friend,
            encounter_count: candidate.encounter_count,
            last_seen: candidate.last_seen,
        })
        .collect();

    Ok(ResolveUserOutput {
        rows,
        caveats: resolve_caveats(),
    })
}

fn resolve_caveats() -> Vec<String> {
    vec![
        "Names are matched against the signed-in user's observed local history; multiple people can share a name."
            .into(),
        "Disambiguate with isFriend, lastSeen and encounterCount; pass the chosen userId to other tools.".into(),
    ]
}

struct Candidate {
    user_id: String,
    display_name: String,
    matched_name: String,
    encounter_count: i64,
    last_seen: String,
}
