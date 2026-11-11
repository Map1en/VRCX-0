use std::collections::{BTreeMap, BTreeSet};

use vrcx_0_contracts::feed::{
    WorldFriendVisitRow, WorldFriendVisitsOutput, WorldRecentFriendCountRow,
};

use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::ownership::OwnerId;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use super::helpers::table_exists;

const WORLD_FRIEND_VISIT_ROW_LIMIT: i64 = 100;
const WORLD_RECENT_FRIEND_COUNT_WORLD_LIMIT: usize = 100;

pub fn get_world_friend_visits(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    world_id: &str,
) -> Result<WorldFriendVisitsOutput, Error> {
    let world_id = world_id.trim();
    let owner = owner_user_id.as_str().trim();
    if !world_id.starts_with("wrld_") || owner.is_empty() {
        return Ok(WorldFriendVisitsOutput::default());
    }

    let user_prefix = normalize_user_table_prefix(owner)?;
    let gps_table = format!("{user_prefix}_feed_gps");
    if !table_exists(db, &gps_table)? {
        return Ok(WorldFriendVisitsOutput::default());
    }
    let online_offline_table = format!("{user_prefix}_feed_online_offline");
    let friends_table = format!("{user_prefix}_friend_log_current");

    let sql = format!(
        "SELECT
             visits.user_id,
             COALESCE(NULLIF(trim(friends.display_name), ''), visits.display_name),
             COUNT(*),
             MAX(visits.created_at),
             COUNT(*) OVER ()
         FROM (
             SELECT user_id, display_name, created_at
             FROM {gps_table}
             WHERE location = @world_id
                OR (location >= @location_start AND location < @location_end)
             UNION ALL
             SELECT user_id, display_name, created_at
             FROM {online_offline_table}
             WHERE type = 'Online'
               AND (location = @world_id
                    OR (location >= @location_start AND location < @location_end))
         ) AS visits
         JOIN {friends_table} AS friends ON friends.user_id = visits.user_id
         GROUP BY visits.user_id
         ORDER BY MAX(visits.created_at) DESC, visits.user_id ASC
         LIMIT @limit"
    );

    let params = ParamsBuilder::new()
        .set("world_id", world_id)
        .set("location_start", format!("{world_id}:"))
        .set("location_end", format!("{world_id};"))
        .set("limit", WORLD_FRIEND_VISIT_ROW_LIMIT)
        .build();

    let rows = db.execute(&sql, &params)?;
    let friend_count = rows.first().map(|row| row_i64(row, 4)).unwrap_or_default();
    let friends = rows
        .into_iter()
        .map(|row| WorldFriendVisitRow {
            user_id: row_string(&row, 0),
            display_name: row_string(&row, 1),
            visit_count: row_i64(&row, 2),
            last_visited_at: row_string(&row, 3),
        })
        .collect::<Vec<_>>();
    let last_visited_at = friends
        .first()
        .map(|row| row.last_visited_at.clone())
        .unwrap_or_default();

    Ok(WorldFriendVisitsOutput {
        friend_count,
        last_visited_at,
        friends,
    })
}

pub fn get_world_recent_friend_counts(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    world_ids: &[String],
    since: &str,
) -> Result<Vec<WorldRecentFriendCountRow>, Error> {
    let owner = owner_user_id.as_str().trim();
    let wanted = world_ids
        .iter()
        .map(|world_id| world_id.trim())
        .filter(|world_id| world_id.starts_with("wrld_"))
        .take(WORLD_RECENT_FRIEND_COUNT_WORLD_LIMIT)
        .collect::<BTreeSet<_>>();
    if wanted.is_empty() || owner.is_empty() {
        return Ok(Vec::new());
    }

    let user_prefix = normalize_user_table_prefix(owner)?;
    let gps_table = format!("{user_prefix}_feed_gps");
    if !table_exists(db, &gps_table)? {
        return Ok(Vec::new());
    }
    let online_offline_table = format!("{user_prefix}_feed_online_offline");
    let friends_table = format!("{user_prefix}_friend_log_current");

    let sql = format!(
        "SELECT DISTINCT visits.user_id, visits.location
         FROM (
             SELECT user_id, location
             FROM {gps_table}
             WHERE location LIKE 'wrld_%' AND created_at >= @since
             UNION ALL
             SELECT user_id, location
             FROM {online_offline_table}
             WHERE type = 'Online' AND location LIKE 'wrld_%' AND created_at >= @since
         ) AS visits
         JOIN {friends_table} AS friends ON friends.user_id = visits.user_id"
    );
    let params = ParamsBuilder::new().set("since", since).build();
    let rows = db.execute(&sql, &params)?;

    let mut friends_by_world = BTreeMap::<&str, BTreeSet<String>>::new();
    for row in &rows {
        let location = row_string(row, 1);
        let world_id = location.split(':').next().unwrap_or_default();
        if let Some(world_id) = wanted.get(world_id) {
            friends_by_world
                .entry(world_id)
                .or_default()
                .insert(row_string(row, 0));
        }
    }

    Ok(friends_by_world
        .into_iter()
        .map(|(world_id, friends)| WorldRecentFriendCountRow {
            world_id: world_id.to_string(),
            friend_count: friends.len() as i64,
        })
        .collect())
}
