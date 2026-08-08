#![allow(non_snake_case)]

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;

use crate::common::{normalize_text, row_i64, row_string, ParamsBuilder};
use crate::database::schema::ensure_global_store_tables;
use crate::database::DatabaseService;
use crate::game_log::ensure_game_log_tables;
use crate::ownership::owner_id_for_filter;
use crate::Error;

use crate::worlds::{world_summary_from_row, WorldSummaryOutput};

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlayerLocationOutput {
    pub created_at: String,
    pub location: String,
    pub world_id: String,
    pub world_name: String,
    pub time: i64,
    pub group_name: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlayerJoinLeaveOutput {
    pub id: i64,
    pub created_at: String,
    pub r#type: String,
    pub display_name: String,
    pub user_id: String,
    pub time: i64,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstanceActivityRowOutput {
    pub id: i64,
    pub created_at: String,
    pub r#type: String,
    pub display_name: String,
    pub location: String,
    pub user_id: String,
    pub time: i64,
}

pub fn player_list_location_get(
    db: &DatabaseService,
    owner_user_id: &str,
    location: String,
) -> Result<Option<PlayerLocationOutput>, Error> {
    ensure_game_log_tables(db)?;
    let location = normalize_text(location);
    if location.is_empty() {
        return Ok(None);
    }
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    Ok(db
        .execute(
            "SELECT created_at, location, world_id, world_name, time, group_name
             FROM gamelog_location
             WHERE owner_id IN (0, @owner_id)
               AND location = @location
             ORDER BY id DESC
             LIMIT 1",
            &ParamsBuilder::new()
                .set("owner_id", owner_id)
                .set("location", location)
                .build(),
        )?
        .first()
        .map(|row| player_location_from_row(row)))
}

pub fn player_list_latest_location_get(
    db: &DatabaseService,
    owner_user_id: &str,
) -> Result<Option<PlayerLocationOutput>, Error> {
    ensure_game_log_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    Ok(db
        .execute(
            "SELECT created_at, location, world_id, world_name, time, group_name
             FROM gamelog_location
             WHERE owner_id IN (0, @owner_id)
             ORDER BY id DESC
             LIMIT 1",
            &ParamsBuilder::new().set("owner_id", owner_id).build(),
        )?
        .first()
        .map(|row| player_location_from_row(row)))
}

pub fn player_list_join_leave_rows(
    db: &DatabaseService,
    owner_user_id: &str,
    location: String,
    started_at: String,
) -> Result<Vec<PlayerJoinLeaveOutput>, Error> {
    ensure_game_log_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    Ok(db
        .execute(
            "SELECT id, created_at, type, display_name, user_id, time
             FROM gamelog_join_leave
             WHERE owner_id IN (0, @owner_id)
               AND location = @location
               AND (@started_at = '' OR created_at >= @started_at)
             ORDER BY id ASC",
            &ParamsBuilder::new()
                .set("owner_id", owner_id)
                .set("location", normalize_text(location))
                .set("started_at", normalize_text(started_at))
                .build(),
        )?
        .into_iter()
        .map(|row| player_join_leave_from_row(&row))
        .collect())
}

pub fn instance_activity_dates_get(
    db: &DatabaseService,
    owner_user_id: &str,
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
    owner_user_id: &str,
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
        created_at: String::new(),
        description: String::new(),
        image_url: String::new(),
        name,
        release_status: String::new(),
        thumbnail_image_url: String::new(),
        updated_at: String::new(),
        version: 0,
    }
}

pub fn world_summaries_get(
    db: &DatabaseService,
    owner_user_id: &str,
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

pub(crate) fn player_location_from_row(row: &[Value]) -> PlayerLocationOutput {
    PlayerLocationOutput {
        created_at: row_string(row, 0),
        location: row_string(row, 1),
        world_id: row_string(row, 2),
        world_name: row_string(row, 3),
        time: row_i64(row, 4),
        group_name: row_string(row, 5),
    }
}
pub(crate) fn player_join_leave_from_row(row: &[Value]) -> PlayerJoinLeaveOutput {
    PlayerJoinLeaveOutput {
        id: row_i64(row, 0),
        created_at: row_string(row, 1),
        r#type: row_string(row, 2),
        display_name: row_string(row, 3),
        user_id: row_string(row, 4),
        time: row_i64(row, 5),
    }
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
