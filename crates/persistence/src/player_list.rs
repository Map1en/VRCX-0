use std::collections::HashMap;

use serde_json::Value;
use vrcx_0_contracts::player_list::InstanceActivityRowOutput;

use crate::common::{normalize_text, row_i64, row_string, ParamsBuilder};
use crate::database::schema::ensure_global_store_tables;
use crate::database::DatabaseService;
use crate::game_log::ensure_game_log_tables;
use crate::ownership::{owner_id_for_filter, OwnerId};
use crate::Error;

use crate::worlds::{world_summary_from_row, WorldSummaryOutput};

pub fn instance_activity_dates_get(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    user_id: String,
) -> Result<Vec<String>, Error> {
    ensure_game_log_tables(db)?;
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    Ok(db
        .execute(
            "SELECT created_at
             FROM gamelog_join_leave
             WHERE owner_id IN (0, @owner_id)
               AND user_id = @user_id
             ORDER BY created_at DESC",
            &ParamsBuilder::new()
                .set("owner_id", owner_id)
                .set("user_id", user_id)
                .build(),
        )?
        .into_iter()
        .map(|row| row_string(&row, 0))
        .filter(|created_at| !created_at.is_empty())
        .collect())
}

pub fn instance_activity_rows_get(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    start_date: String,
    end_date: String,
) -> Result<Vec<InstanceActivityRowOutput>, Error> {
    ensure_game_log_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    Ok(db
        .execute(
            "SELECT id, created_at, type, display_name, location, user_id, time
             FROM gamelog_join_leave
             WHERE owner_id IN (0, @owner_id)
               AND type = 'OnPlayerLeft'
               AND julianday(created_at, '-' || (time * 1.0 / 1000) || ' seconds') <= julianday(@utc_end_date)
               AND julianday(created_at) >= julianday(@utc_start_date)
             ORDER BY created_at ASC, id ASC",
            &ParamsBuilder::new()
                .set("owner_id", owner_id)
                .set("utc_start_date", start_date)
                .set("utc_end_date", end_date)
                .build(),
        )?
        .into_iter()
        .map(|row| instance_activity_from_row(&row))
        .filter(|row| !is_traveling_location(&row.location))
        .collect())
}

fn empty_world_summary(id: String, name: String) -> WorldSummaryOutput {
    WorldSummaryOutput {
        id,
        author_id: String::new(),
        author_name: String::new(),
        created_at: Default::default(),
        description: String::new(),
        image_url: String::new(),
        name,
        release_status: Default::default(),
        thumbnail_image_url: String::new(),
        updated_at: Default::default(),
        version: 0,
    }
}

pub fn world_summaries_get(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    world_ids: Vec<String>,
) -> Result<HashMap<String, WorldSummaryOutput>, Error> {
    ensure_global_store_tables(db)?;
    ensure_game_log_tables(db)?;
    let world_ids = world_ids
        .into_iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if world_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    let mut params = ParamsBuilder::new().set("owner_id", owner_id);
    let mut placeholders = Vec::with_capacity(world_ids.len());
    for (index, world_id) in world_ids.iter().enumerate() {
        let key = format!("world_id_{index}");
        params = params.set(&key, world_id.clone());
        placeholders.push(format!("@{key}"));
    }
    let params = params.build();
    let in_clause = placeholders.join(", ");

    let mut summaries = HashMap::new();
    for row in db.execute(
        &format!(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version
             FROM cache_world
             WHERE id IN ({in_clause})"
        ),
        &params,
    )? {
        let world = world_summary_from_row(&row);
        if !world.id.is_empty() {
            summaries.insert(world.id.clone(), world);
        }
    }

    for row in db.execute(
        &format!(
            "SELECT gl.world_id, gl.world_name
             FROM gamelog_location gl
             INNER JOIN (
                 SELECT world_id, MAX(id) AS max_id
                 FROM gamelog_location
                 WHERE world_id IN ({in_clause})
                   AND owner_id IN (0, @owner_id)
                   AND world_name IS NOT NULL
                   AND world_name != ''
                 GROUP BY world_id
             ) latest
                 ON latest.world_id = gl.world_id
                AND latest.max_id = gl.id
             WHERE gl.owner_id IN (0, @owner_id)"
        ),
        &params,
    )? {
        let world_id = row_string(&row, 0);
        let world_name = row_string(&row, 1);
        if world_id.is_empty() || world_name.is_empty() {
            continue;
        }
        if summaries
            .get(&world_id)
            .is_some_and(|world| !world.name.is_empty())
        {
            continue;
        }
        summaries.insert(world_id.clone(), empty_world_summary(world_id, world_name));
    }

    Ok(summaries)
}

pub(crate) fn instance_activity_from_row(row: &[Value]) -> InstanceActivityRowOutput {
    InstanceActivityRowOutput {
        id: row_i64(row, 0),
        created_at: row_string(row, 1),
        r#type: row_string(row, 2),
        display_name: row_string(row, 3),
        location: row_string(row, 4),
        user_id: row_string(row, 5),
        time: row_i64(row, 6),
    }
}
pub(crate) fn is_traveling_location(location: &str) -> bool {
    matches!(location.trim(), "traveling" | "traveling:traveling")
}

#[cfg(test)]
mod tests;
