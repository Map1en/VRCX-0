use std::collections::{BTreeMap, HashSet};

use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::ownership::owner_id_for_filter;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use super::caveats::fading_friends_caveats;
use super::helpers::{
    clamped_optional_limit, date_part, millis_to_minutes, table_exists, LatestName,
};
use super::types::{FadingFriendRow, FadingFriendsInput, FadingFriendsOutput};

pub fn get_fading_friends(
    db: &DatabaseService,
    input: FadingFriendsInput,
) -> Result<FadingFriendsOutput, Error> {
    let user_prefix = normalize_user_table_prefix(&input.owner_user_id)?;
    let owner_id = owner_id_for_filter(db, &input.owner_user_id)?;
    let friends_table = format!("{user_prefix}_friend_log_current");
    if !table_exists(db, &friends_table)? {
        return Ok(FadingFriendsOutput {
            rows: Vec::new(),
            caveats: fading_friends_caveats(),
        });
    }

    let sql = format!(
        "SELECT user_id, display_name, time, created_at
         FROM gamelog_join_leave g
         WHERE g.owner_id IN (0, @owner_id)
           AND type = 'OnPlayerLeft' AND time > 0
           AND created_at >= @prior_from AND created_at <= @now
           AND EXISTS (SELECT 1 FROM {friends_table} f WHERE f.user_id = g.user_id)
         ORDER BY created_at ASC, id ASC"
    );
    let params = ParamsBuilder::new()
        .set("owner_id", owner_id)
        .set("prior_from", input.prior_from.as_str())
        .set("now", input.now.as_str());

    let mut grouped: BTreeMap<String, FadingAccumulator> = BTreeMap::new();
    for row in db.execute(&sql, &params.build())? {
        let user_id = row_string(&row, 0);
        if user_id.trim().is_empty() {
            continue;
        }
        let display_name = row_string(&row, 1);
        let millis = row_i64(&row, 2).max(0);
        let created_at = row_string(&row, 3);
        let entry = grouped
            .entry(user_id.clone())
            .or_insert_with(|| FadingAccumulator {
                user_id,
                ..FadingAccumulator::default()
            });
        entry.latest_name.observe(&display_name, &created_at);
        let is_recent = created_at >= input.pivot;
        if is_recent {
            entry.recent_millis += millis;
            if !created_at.is_empty() {
                entry.recent_days.insert(date_part(&created_at));
            }
        } else {
            entry.prior_millis += millis;
            if !created_at.is_empty() {
                entry.prior_days.insert(date_part(&created_at));
            }
        }
        if created_at > entry.last_seen_together {
            entry.last_seen_together = created_at;
        }
    }

    let min_prior_minutes = input.min_prior_minutes.unwrap_or(30).max(0);
    let mut rows = grouped
        .into_values()
        .filter_map(|entry| {
            let prior_minutes = millis_to_minutes(entry.prior_millis);
            let recent_minutes = millis_to_minutes(entry.recent_millis);
            if prior_minutes < min_prior_minutes || recent_minutes >= prior_minutes {
                return None;
            }
            let drop_percent =
                ((prior_minutes - recent_minutes) * 100 / prior_minutes).clamp(0, 100);
            Some(FadingFriendRow {
                user_id: entry.user_id,
                display_name: entry.latest_name.into_name(),
                prior_minutes,
                recent_minutes,
                prior_co_days: entry.prior_days.len(),
                recent_co_days: entry.recent_days.len(),
                drop_percent,
                last_seen_together: entry.last_seen_together,
            })
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        right
            .drop_percent
            .cmp(&left.drop_percent)
            .then_with(|| right.prior_minutes.cmp(&left.prior_minutes))
            .then_with(|| left.display_name.cmp(&right.display_name))
            .then_with(|| left.user_id.cmp(&right.user_id))
    });
    rows.truncate(clamped_optional_limit(input.limit, 25, 200) as usize);

    Ok(FadingFriendsOutput {
        rows,
        caveats: fading_friends_caveats(),
    })
}

#[derive(Clone, Debug, Default)]
struct FadingAccumulator {
    user_id: String,
    latest_name: LatestName,
    prior_millis: i64,
    recent_millis: i64,
    prior_days: HashSet<String>,
    recent_days: HashSet<String>,
    last_seen_together: String,
}
