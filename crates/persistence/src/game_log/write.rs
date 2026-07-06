use crate::common::{insert_or_ignore_sql, update_by_key_sql, DbWriteTarget, ParamsBuilder};
use crate::database::DatabaseService;
use crate::Error;

use super::schema::*;
use super::tables::ensure_game_log_tables_on;
use super::types::{
    GameLogEventEntry, GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogLocationEntry,
    GameLogPortalSpawnEntry, GameLogResourceLoadEntry, GameLogVideoPlayEntry, GameLogWriteBatch,
};

fn update_location_time_sql() -> String {
    update_by_key_sql(TABLE_LOCATION, &[COL_TIME], COL_CREATED_AT)
}

#[cfg(test)]
fn insert_location(db: &DatabaseService, entry: &GameLogLocationEntry) -> Result<u64, Error> {
    insert_location_on(db, entry)
}

fn insert_location_on(
    target: &impl DbWriteTarget,
    entry: &GameLogLocationEntry,
) -> Result<u64, Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, entry.created_at.clone())
        .set(COL_LOCATION, entry.location.clone())
        .set(COL_WORLD_ID, entry.world_id.clone())
        .set(COL_WORLD_NAME, entry.world_name.clone())
        .set(COL_TIME, entry.time)
        .set(COL_GROUP_NAME, entry.group_name.clone())
        .build();
    target
        .execute_non_query(
            &insert_or_ignore_sql(
                TABLE_LOCATION,
                &[
                    COL_CREATED_AT,
                    COL_LOCATION,
                    COL_WORLD_ID,
                    COL_WORLD_NAME,
                    COL_TIME,
                    COL_GROUP_NAME,
                ],
            ),
            &args,
        )
        .map(affected_count)
}

#[cfg(test)]
fn update_location_time(db: &DatabaseService, created_at: &str, time: i64) -> Result<u64, Error> {
    update_location_time_on(db, created_at, time)
}

fn update_location_time_on(
    target: &impl DbWriteTarget,
    created_at: &str,
    time: i64,
) -> Result<u64, Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, created_at)
        .set(COL_TIME, time)
        .build();
    target
        .execute_non_query(&update_location_time_sql(), &args)
        .map(affected_count)
}

#[cfg(test)]
fn insert_join_leave(db: &DatabaseService, entry: &GameLogJoinLeaveEntry) -> Result<u64, Error> {
    insert_join_leave_on(db, entry)
}

fn insert_join_leave_on(
    target: &impl DbWriteTarget,
    entry: &GameLogJoinLeaveEntry,
) -> Result<u64, Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, entry.created_at.clone())
        .set(COL_TYPE, entry.event_type.clone())
        .set(COL_DISPLAY_NAME, entry.display_name.clone())
        .set(COL_LOCATION, entry.location.clone())
        .set(COL_USER_ID, entry.user_id.clone())
        .set(COL_TIME, entry.time)
        .build();
    target
        .execute_non_query(
            &insert_or_ignore_sql(
                TABLE_JOIN_LEAVE,
                &[
                    COL_CREATED_AT,
                    COL_TYPE,
                    COL_DISPLAY_NAME,
                    COL_LOCATION,
                    COL_USER_ID,
                    COL_TIME,
                ],
            ),
            &args,
        )
        .map(affected_count)
}

#[cfg(test)]
fn insert_portal_spawn(
    db: &DatabaseService,
    entry: &GameLogPortalSpawnEntry,
) -> Result<u64, Error> {
    insert_portal_spawn_on(db, entry)
}

fn insert_portal_spawn_on(
    target: &impl DbWriteTarget,
    entry: &GameLogPortalSpawnEntry,
) -> Result<u64, Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, entry.created_at.clone())
        .set(COL_DISPLAY_NAME, entry.display_name.clone())
        .set(COL_LOCATION, entry.location.clone())
        .set(COL_USER_ID, entry.user_id.clone())
        .set(COL_INSTANCE_ID, entry.instance_id.clone())
        .set(COL_WORLD_NAME, entry.world_name.clone())
        .build();
    target
        .execute_non_query(
            &insert_or_ignore_sql(
                TABLE_PORTAL_SPAWN,
                &[
                    COL_CREATED_AT,
                    COL_DISPLAY_NAME,
                    COL_LOCATION,
                    COL_USER_ID,
                    COL_INSTANCE_ID,
                    COL_WORLD_NAME,
                ],
            ),
            &args,
        )
        .map(affected_count)
}

fn insert_video_play_on(
    target: &impl DbWriteTarget,
    entry: &GameLogVideoPlayEntry,
) -> Result<u64, Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, entry.created_at.clone())
        .set(COL_VIDEO_URL, entry.video_url.clone())
        .set(COL_VIDEO_NAME, entry.video_name.clone())
        .set(COL_VIDEO_ID, entry.video_id.clone())
        .set(COL_LOCATION, entry.location.clone())
        .set(COL_DISPLAY_NAME, entry.display_name.clone())
        .set(COL_USER_ID, entry.user_id.clone())
        .build();
    target
        .execute_non_query(
            &insert_or_ignore_sql(
                TABLE_VIDEO_PLAY,
                &[
                    COL_CREATED_AT,
                    COL_VIDEO_URL,
                    COL_VIDEO_NAME,
                    COL_VIDEO_ID,
                    COL_LOCATION,
                    COL_DISPLAY_NAME,
                    COL_USER_ID,
                ],
            ),
            &args,
        )
        .map(affected_count)
}

#[cfg(test)]
fn insert_resource_load(
    db: &DatabaseService,
    entry: &GameLogResourceLoadEntry,
) -> Result<u64, Error> {
    insert_resource_load_on(db, entry)
}

fn insert_resource_load_on(
    target: &impl DbWriteTarget,
    entry: &GameLogResourceLoadEntry,
) -> Result<u64, Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, entry.created_at.clone())
        .set(COL_RESOURCE_URL, entry.resource_url.clone())
        .set(COL_RESOURCE_TYPE, entry.resource_type.clone())
        .set(COL_LOCATION, entry.location.clone())
        .build();
    target
        .execute_non_query(
            &insert_or_ignore_sql(
                TABLE_RESOURCE_LOAD,
                &[
                    COL_CREATED_AT,
                    COL_RESOURCE_URL,
                    COL_RESOURCE_TYPE,
                    COL_LOCATION,
                ],
            ),
            &args,
        )
        .map(affected_count)
}

#[cfg(test)]
fn insert_event(db: &DatabaseService, entry: &GameLogEventEntry) -> Result<u64, Error> {
    insert_event_on(db, entry)
}

fn insert_event_on(target: &impl DbWriteTarget, entry: &GameLogEventEntry) -> Result<u64, Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, entry.created_at.clone())
        .set(COL_DATA, entry.data.clone())
        .build();
    target
        .execute_non_query(
            &insert_or_ignore_sql(TABLE_EVENT, &[COL_CREATED_AT, COL_DATA]),
            &args,
        )
        .map(affected_count)
}

fn insert_external_on(
    target: &impl DbWriteTarget,
    entry: &GameLogExternalEntry,
) -> Result<u64, Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, entry.created_at.clone())
        .set(COL_MESSAGE, entry.message.clone())
        .set(COL_DISPLAY_NAME, entry.display_name.clone())
        .set(COL_USER_ID, entry.user_id.clone())
        .set(COL_LOCATION, entry.location.clone())
        .build();
    target
        .execute_non_query(
            &insert_or_ignore_sql(
                TABLE_EXTERNAL,
                &[
                    COL_CREATED_AT,
                    COL_MESSAGE,
                    COL_DISPLAY_NAME,
                    COL_USER_ID,
                    COL_LOCATION,
                ],
            ),
            &args,
        )
        .map(affected_count)
}

pub fn write_batch(db: &DatabaseService, batch: &GameLogWriteBatch) -> Result<u64, Error> {
    if batch.is_empty() {
        return Ok(0);
    }

    db.write_transaction(|tx| {
        ensure_game_log_tables_on(tx)?;
        let mut affected = 0_u64;
        for entry in &batch.locations {
            affected = affected.saturating_add(insert_location_on(tx, entry)?);
        }
        for update in &batch.location_time_updates {
            affected = affected.saturating_add(update_location_time_on(
                tx,
                &update.created_at,
                update.time,
            )?);
        }
        for entry in &batch.join_leave {
            affected = affected.saturating_add(insert_join_leave_on(tx, entry)?);
        }
        for entry in &batch.portal_spawns {
            affected = affected.saturating_add(insert_portal_spawn_on(tx, entry)?);
        }
        for entry in &batch.video_plays {
            affected = affected.saturating_add(insert_video_play_on(tx, entry)?);
        }
        for entry in &batch.resource_loads {
            affected = affected.saturating_add(insert_resource_load_on(tx, entry)?);
        }
        for entry in &batch.events {
            affected = affected.saturating_add(insert_event_on(tx, entry)?);
        }
        for entry in &batch.externals {
            affected = affected.saturating_add(insert_external_on(tx, entry)?);
        }
        Ok(affected)
    })
}

fn affected_count(count: i64) -> u64 {
    count.max(0) as u64
}

#[cfg(test)]
#[path = "../../tests/game_log/tests.rs"]
mod tests;
