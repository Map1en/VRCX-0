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

#[allow(dead_code)]
pub fn insert_location(db: &DatabaseService, entry: &GameLogLocationEntry) -> Result<(), Error> {
    insert_location_on(db, entry)
}

fn insert_location_on(
    target: &impl DbWriteTarget,
    entry: &GameLogLocationEntry,
) -> Result<(), Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, entry.created_at.clone())
        .set(COL_LOCATION, entry.location.clone())
        .set(COL_WORLD_ID, entry.world_id.clone())
        .set(COL_WORLD_NAME, entry.world_name.clone())
        .set(COL_TIME, entry.time)
        .set(COL_GROUP_NAME, entry.group_name.clone())
        .build();
    target.execute_non_query(
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
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn update_location_time(
    db: &DatabaseService,
    created_at: &str,
    time: i64,
) -> Result<(), Error> {
    update_location_time_on(db, created_at, time)
}

fn update_location_time_on(
    target: &impl DbWriteTarget,
    created_at: &str,
    time: i64,
) -> Result<(), Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, created_at)
        .set(COL_TIME, time)
        .build();
    target.execute_non_query(&update_location_time_sql(), &args)?;
    Ok(())
}

#[allow(dead_code)]
pub fn insert_join_leave(db: &DatabaseService, entry: &GameLogJoinLeaveEntry) -> Result<(), Error> {
    insert_join_leave_on(db, entry)
}

fn insert_join_leave_on(
    target: &impl DbWriteTarget,
    entry: &GameLogJoinLeaveEntry,
) -> Result<(), Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, entry.created_at.clone())
        .set(COL_TYPE, entry.event_type.clone())
        .set(COL_DISPLAY_NAME, entry.display_name.clone())
        .set(COL_LOCATION, entry.location.clone())
        .set(COL_USER_ID, entry.user_id.clone())
        .set(COL_TIME, entry.time)
        .build();
    target.execute_non_query(
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
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn insert_portal_spawn(
    db: &DatabaseService,
    entry: &GameLogPortalSpawnEntry,
) -> Result<(), Error> {
    insert_portal_spawn_on(db, entry)
}

fn insert_portal_spawn_on(
    target: &impl DbWriteTarget,
    entry: &GameLogPortalSpawnEntry,
) -> Result<(), Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, entry.created_at.clone())
        .set(COL_DISPLAY_NAME, entry.display_name.clone())
        .set(COL_LOCATION, entry.location.clone())
        .set(COL_USER_ID, entry.user_id.clone())
        .set(COL_INSTANCE_ID, entry.instance_id.clone())
        .set(COL_WORLD_NAME, entry.world_name.clone())
        .build();
    target.execute_non_query(
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
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn insert_video_play(db: &DatabaseService, entry: &GameLogVideoPlayEntry) -> Result<(), Error> {
    insert_video_play_on(db, entry)
}

fn insert_video_play_on(
    target: &impl DbWriteTarget,
    entry: &GameLogVideoPlayEntry,
) -> Result<(), Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, entry.created_at.clone())
        .set(COL_VIDEO_URL, entry.video_url.clone())
        .set(COL_VIDEO_NAME, entry.video_name.clone())
        .set(COL_VIDEO_ID, entry.video_id.clone())
        .set(COL_LOCATION, entry.location.clone())
        .set(COL_DISPLAY_NAME, entry.display_name.clone())
        .set(COL_USER_ID, entry.user_id.clone())
        .build();
    target.execute_non_query(
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
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn insert_resource_load(
    db: &DatabaseService,
    entry: &GameLogResourceLoadEntry,
) -> Result<(), Error> {
    insert_resource_load_on(db, entry)
}

fn insert_resource_load_on(
    target: &impl DbWriteTarget,
    entry: &GameLogResourceLoadEntry,
) -> Result<(), Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, entry.created_at.clone())
        .set(COL_RESOURCE_URL, entry.resource_url.clone())
        .set(COL_RESOURCE_TYPE, entry.resource_type.clone())
        .set(COL_LOCATION, entry.location.clone())
        .build();
    target.execute_non_query(
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
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn insert_event(db: &DatabaseService, entry: &GameLogEventEntry) -> Result<(), Error> {
    insert_event_on(db, entry)
}

fn insert_event_on(target: &impl DbWriteTarget, entry: &GameLogEventEntry) -> Result<(), Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, entry.created_at.clone())
        .set(COL_DATA, entry.data.clone())
        .build();
    target.execute_non_query(
        &insert_or_ignore_sql(TABLE_EVENT, &[COL_CREATED_AT, COL_DATA]),
        &args,
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn insert_external(db: &DatabaseService, entry: &GameLogExternalEntry) -> Result<(), Error> {
    insert_external_on(db, entry)
}

fn insert_external_on(
    target: &impl DbWriteTarget,
    entry: &GameLogExternalEntry,
) -> Result<(), Error> {
    let args = ParamsBuilder::new()
        .set(COL_CREATED_AT, entry.created_at.clone())
        .set(COL_MESSAGE, entry.message.clone())
        .set(COL_DISPLAY_NAME, entry.display_name.clone())
        .set(COL_USER_ID, entry.user_id.clone())
        .set(COL_LOCATION, entry.location.clone())
        .build();
    target.execute_non_query(
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
    )?;
    Ok(())
}

pub fn write_batch(db: &DatabaseService, batch: &GameLogWriteBatch) -> Result<(), Error> {
    if batch.is_empty() {
        return Ok(());
    }

    db.write_transaction(|tx| {
        ensure_game_log_tables_on(tx)?;
        for entry in &batch.locations {
            insert_location_on(tx, entry)?;
        }
        for update in &batch.location_time_updates {
            update_location_time_on(tx, &update.created_at, update.time)?;
        }
        for entry in &batch.join_leave {
            insert_join_leave_on(tx, entry)?;
        }
        for entry in &batch.portal_spawns {
            insert_portal_spawn_on(tx, entry)?;
        }
        for entry in &batch.video_plays {
            insert_video_play_on(tx, entry)?;
        }
        for entry in &batch.resource_loads {
            insert_resource_load_on(tx, entry)?;
        }
        for entry in &batch.events {
            insert_event_on(tx, entry)?;
        }
        for entry in &batch.externals {
            insert_external_on(tx, entry)?;
        }
        Ok(())
    })
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
