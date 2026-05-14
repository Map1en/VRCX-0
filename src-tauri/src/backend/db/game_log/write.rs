use std::collections::HashMap;

use sea_query::{Expr, OnConflict, Query, SqliteQueryBuilder};

use crate::domain::database::DatabaseService;
use crate::error::AppError;

use super::schema::*;
use super::tables::{ensure_game_log_tables_on, GameLogWriteTarget};
use super::types::{
    GameLogEventEntry, GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogLocationEntry,
    GameLogPortalSpawnEntry, GameLogResourceLoadEntry, GameLogVideoPlayEntry, GameLogWriteBatch,
};

fn insert_or_ignore_sql(table: &str, columns: &[&str]) -> String {
    let mut query = Query::insert();
    query.into_table(ident(table));
    query.columns(columns.iter().map(|column| ident(*column)));
    query.values_panic(
        columns
            .iter()
            .map(|column| Expr::cust(format!("@{column}"))),
    );
    query.on_conflict(OnConflict::new().do_nothing().to_owned());
    query.to_string(SqliteQueryBuilder)
}

fn update_location_time_sql() -> String {
    Query::update()
        .table(ident(TABLE_LOCATION))
        .value(ident(COL_TIME), Expr::cust("@time"))
        .and_where(Expr::col(ident(COL_CREATED_AT)).eq(Expr::cust("@created_at")))
        .to_string(SqliteQueryBuilder)
}

#[allow(dead_code)]
pub fn insert_location(db: &DatabaseService, entry: &GameLogLocationEntry) -> Result<(), AppError> {
    insert_location_on(db, entry)
}

fn insert_location_on(
    target: &impl GameLogWriteTarget,
    entry: &GameLogLocationEntry,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert(
        "@created_at".to_string(),
        serde_json::json!(entry.created_at),
    );
    args.insert("@location".to_string(), serde_json::json!(entry.location));
    args.insert("@world_id".to_string(), serde_json::json!(entry.world_id));
    args.insert(
        "@world_name".to_string(),
        serde_json::json!(entry.world_name),
    );
    args.insert("@time".to_string(), serde_json::json!(entry.time));
    args.insert(
        "@group_name".to_string(),
        serde_json::json!(entry.group_name),
    );
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
) -> Result<(), AppError> {
    update_location_time_on(db, created_at, time)
}

fn update_location_time_on(
    target: &impl GameLogWriteTarget,
    created_at: &str,
    time: i64,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert("@created_at".to_string(), serde_json::json!(created_at));
    args.insert("@time".to_string(), serde_json::json!(time));
    target.execute_non_query(&update_location_time_sql(), &args)?;
    Ok(())
}

#[allow(dead_code)]
pub fn insert_join_leave(
    db: &DatabaseService,
    entry: &GameLogJoinLeaveEntry,
) -> Result<(), AppError> {
    insert_join_leave_on(db, entry)
}

fn insert_join_leave_on(
    target: &impl GameLogWriteTarget,
    entry: &GameLogJoinLeaveEntry,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert(
        "@created_at".to_string(),
        serde_json::json!(entry.created_at),
    );
    args.insert("@type".to_string(), serde_json::json!(entry.event_type));
    args.insert(
        "@display_name".to_string(),
        serde_json::json!(entry.display_name),
    );
    args.insert("@location".to_string(), serde_json::json!(entry.location));
    args.insert("@user_id".to_string(), serde_json::json!(entry.user_id));
    args.insert("@time".to_string(), serde_json::json!(entry.time));
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
) -> Result<(), AppError> {
    insert_portal_spawn_on(db, entry)
}

fn insert_portal_spawn_on(
    target: &impl GameLogWriteTarget,
    entry: &GameLogPortalSpawnEntry,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert(
        "@created_at".to_string(),
        serde_json::json!(entry.created_at),
    );
    args.insert(
        "@display_name".to_string(),
        serde_json::json!(entry.display_name),
    );
    args.insert("@location".to_string(), serde_json::json!(entry.location));
    args.insert("@user_id".to_string(), serde_json::json!(entry.user_id));
    args.insert(
        "@instance_id".to_string(),
        serde_json::json!(entry.instance_id),
    );
    args.insert(
        "@world_name".to_string(),
        serde_json::json!(entry.world_name),
    );
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
pub fn insert_video_play(
    db: &DatabaseService,
    entry: &GameLogVideoPlayEntry,
) -> Result<(), AppError> {
    insert_video_play_on(db, entry)
}

fn insert_video_play_on(
    target: &impl GameLogWriteTarget,
    entry: &GameLogVideoPlayEntry,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert(
        "@created_at".to_string(),
        serde_json::json!(entry.created_at),
    );
    args.insert("@video_url".to_string(), serde_json::json!(entry.video_url));
    args.insert(
        "@video_name".to_string(),
        serde_json::json!(entry.video_name),
    );
    args.insert("@video_id".to_string(), serde_json::json!(entry.video_id));
    args.insert("@location".to_string(), serde_json::json!(entry.location));
    args.insert(
        "@display_name".to_string(),
        serde_json::json!(entry.display_name),
    );
    args.insert("@user_id".to_string(), serde_json::json!(entry.user_id));
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
) -> Result<(), AppError> {
    insert_resource_load_on(db, entry)
}

fn insert_resource_load_on(
    target: &impl GameLogWriteTarget,
    entry: &GameLogResourceLoadEntry,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert(
        "@created_at".to_string(),
        serde_json::json!(entry.created_at),
    );
    args.insert(
        "@resource_url".to_string(),
        serde_json::json!(entry.resource_url),
    );
    args.insert(
        "@resource_type".to_string(),
        serde_json::json!(entry.resource_type),
    );
    args.insert("@location".to_string(), serde_json::json!(entry.location));
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
pub fn insert_event(db: &DatabaseService, entry: &GameLogEventEntry) -> Result<(), AppError> {
    insert_event_on(db, entry)
}

fn insert_event_on(
    target: &impl GameLogWriteTarget,
    entry: &GameLogEventEntry,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert(
        "@created_at".to_string(),
        serde_json::json!(entry.created_at),
    );
    args.insert("@data".to_string(), serde_json::json!(entry.data));
    target.execute_non_query(
        &insert_or_ignore_sql(TABLE_EVENT, &[COL_CREATED_AT, COL_DATA]),
        &args,
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn insert_external(db: &DatabaseService, entry: &GameLogExternalEntry) -> Result<(), AppError> {
    insert_external_on(db, entry)
}

fn insert_external_on(
    target: &impl GameLogWriteTarget,
    entry: &GameLogExternalEntry,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert(
        "@created_at".to_string(),
        serde_json::json!(entry.created_at),
    );
    args.insert("@message".to_string(), serde_json::json!(entry.message));
    args.insert(
        "@display_name".to_string(),
        serde_json::json!(entry.display_name),
    );
    args.insert("@user_id".to_string(), serde_json::json!(entry.user_id));
    args.insert("@location".to_string(), serde_json::json!(entry.location));
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

pub fn write_batch(db: &DatabaseService, batch: &GameLogWriteBatch) -> Result<(), AppError> {
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
