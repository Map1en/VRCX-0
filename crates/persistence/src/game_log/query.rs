use std::collections::{BTreeSet, HashMap};

use chrono::Utc;
use sea_query::{Expr, ExprTrait, Order, Query, SqliteQueryBuilder};

use crate::common::{ident, row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::ownership::{owner_id_for_filter, OwnerId};
use crate::Error;

use super::schema::*;
use super::tables::ensure_game_log_tables;
use super::types::{
    GameLogEventEntry, GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogJoinLeaveSnapshot,
    GameLogLocationEntry, GameLogLocationSnapshot, GameLogPreviousInstanceGroupOutput,
    GameLogPreviousInstanceWorldOutput, GameLogVisitSpan, SessionEventRow,
    SessionLocationSegmentRow, SessionPlayerDurationRow,
};

fn latest_join_leave_lookup_sql() -> String {
    Query::select()
        .column(ident(COL_USER_ID))
        .from(ident(TABLE_JOIN_LEAVE))
        .and_where(Expr::col(ident(COL_DISPLAY_NAME)).eq(Expr::cust("@displayName")))
        .and_where(Expr::col(ident(COL_USER_ID)).ne(""))
        .and_where(owner_scope_expr())
        .order_by(ident(COL_ID), Order::Desc)
        .limit(1)
        .to_string(SqliteQueryBuilder)
}

fn location_before_or_at_sql() -> String {
    Query::select()
        .columns([
            ident(COL_CREATED_AT),
            ident(COL_LOCATION),
            ident(COL_WORLD_ID),
            ident(COL_WORLD_NAME),
            ident(COL_GROUP_NAME),
        ])
        .from(ident(TABLE_LOCATION))
        .and_where(Expr::col(ident(COL_CREATED_AT)).lte(Expr::cust("@createdAt")))
        .and_where(owner_scope_expr())
        .order_by(ident(COL_CREATED_AT), Order::Desc)
        .limit(1)
        .to_string(SqliteQueryBuilder)
}

fn previous_instances_by_group_id_sql() -> &'static str {
    "SELECT created_at, location, time, world_name, group_name
     FROM gamelog_location
     WHERE owner_id IN (0, @ownerId)
       AND location LIKE @groupId
     ORDER BY id DESC"
}

fn previous_instances_by_world_id_sql() -> &'static str {
    "SELECT id, created_at, location, time, world_name, group_name
     FROM gamelog_location
     WHERE owner_id IN (0, @ownerId)
       AND world_id = @worldId
     ORDER BY id DESC"
}

fn last_location_sql() -> String {
    Query::select()
        .columns([
            ident(COL_CREATED_AT),
            ident(COL_LOCATION),
            ident(COL_WORLD_ID),
            ident(COL_WORLD_NAME),
            ident(COL_TIME),
            ident(COL_GROUP_NAME),
        ])
        .from(ident(TABLE_LOCATION))
        .order_by(ident(COL_ID), Order::Desc)
        .limit(1)
        .to_string(SqliteQueryBuilder)
}

fn join_leave_entries_for_location_range_sql(scoped: bool) -> String {
    let mut query = Query::select();
    query
        .columns([
            ident(COL_ID),
            ident(COL_CREATED_AT),
            ident(COL_TYPE),
            ident(COL_DISPLAY_NAME),
            ident(COL_USER_ID),
            ident(COL_TIME),
        ])
        .from(ident(TABLE_JOIN_LEAVE))
        .and_where(Expr::col(ident(COL_LOCATION)).eq(Expr::cust("@location")))
        .and_where(Expr::col(ident(COL_CREATED_AT)).gte(Expr::cust("@afterDate")))
        .and_where(Expr::col(ident(COL_CREATED_AT)).lte(Expr::cust("@beforeDate")));
    if scoped {
        query.and_where(owner_scope_expr());
    }
    query
        .order_by(ident(COL_CREATED_AT), Order::Asc)
        .order_by(ident(COL_ID), Order::Asc)
        .to_string(SqliteQueryBuilder)
}

const SESSION_LOCATION_COLUMNS: [&str; 7] = [
    COL_ID,
    COL_CREATED_AT,
    COL_LOCATION,
    COL_WORLD_ID,
    COL_WORLD_NAME,
    COL_TIME,
    COL_GROUP_NAME,
];

fn session_location_segments_sql(has_cursor: bool, limit: i64) -> String {
    let mut query = Query::select();
    query
        .columns(SESSION_LOCATION_COLUMNS.into_iter().map(ident))
        .from(ident(TABLE_LOCATION))
        .and_where(owner_scope_expr());
    if has_cursor {
        query.and_where(Expr::col(ident(COL_ID)).lt(Expr::cust("@beforeId")));
    }
    query
        .order_by(ident(COL_ID), Order::Desc)
        .limit(u64::try_from(limit).unwrap_or(0))
        .to_string(SqliteQueryBuilder)
}

fn session_location_segments_by_date_range_sql(limit: i64) -> String {
    Query::select()
        .columns(SESSION_LOCATION_COLUMNS.into_iter().map(ident))
        .from(ident(TABLE_LOCATION))
        .and_where(Expr::col(ident(COL_CREATED_AT)).gte(Expr::cust("@afterDate")))
        .and_where(Expr::col(ident(COL_CREATED_AT)).lte(Expr::cust("@beforeDate")))
        .and_where(owner_scope_expr())
        .order_by(ident(COL_ID), Order::Desc)
        .limit(u64::try_from(limit).unwrap_or(0))
        .to_string(SqliteQueryBuilder)
}

fn session_join_leave_events_sql() -> String {
    Query::select()
        .columns([
            ident(COL_ID),
            ident(COL_TYPE),
            ident(COL_CREATED_AT),
            ident(COL_DISPLAY_NAME),
            ident(COL_USER_ID),
            ident(COL_LOCATION),
        ])
        .from(ident(TABLE_JOIN_LEAVE))
        .and_where(Expr::col(ident(COL_CREATED_AT)).gte(Expr::cust("@afterDate")))
        .and_where(Expr::col(ident(COL_CREATED_AT)).lte(Expr::cust("@beforeDate")))
        .and_where(owner_scope_expr())
        .order_by(ident(COL_CREATED_AT), Order::Asc)
        .order_by(ident(COL_ID), Order::Asc)
        .to_string(SqliteQueryBuilder)
}

fn session_video_events_sql() -> String {
    Query::select()
        .columns([
            ident(COL_ID),
            ident(COL_CREATED_AT),
            ident(COL_VIDEO_URL),
            ident(COL_VIDEO_NAME),
            ident(COL_VIDEO_ID),
            ident(COL_DISPLAY_NAME),
            ident(COL_USER_ID),
            ident(COL_LOCATION),
        ])
        .from(ident(TABLE_VIDEO_PLAY))
        .and_where(Expr::col(ident(COL_CREATED_AT)).gte(Expr::cust("@afterDate")))
        .and_where(Expr::col(ident(COL_CREATED_AT)).lte(Expr::cust("@beforeDate")))
        .and_where(owner_scope_expr())
        .order_by(ident(COL_CREATED_AT), Order::Asc)
        .order_by(ident(COL_ID), Order::Asc)
        .to_string(SqliteQueryBuilder)
}

fn latest_created_at_sql(table: &str) -> String {
    Query::select()
        .column(ident(COL_CREATED_AT))
        .from(ident(table))
        .order_by(ident(COL_ID), Order::Desc)
        .limit(1)
        .to_string(SqliteQueryBuilder)
}

fn game_log_events_sql() -> String {
    Query::select()
        .columns([COL_CREATED_AT, COL_DATA].into_iter().map(ident))
        .from(ident(TABLE_EVENT))
        .and_where(owner_scope_expr())
        .order_by(ident(COL_ID), Order::Asc)
        .to_string(SqliteQueryBuilder)
}

fn game_log_locations_sql() -> String {
    Query::select()
        .columns(
            [
                COL_CREATED_AT,
                COL_LOCATION,
                COL_WORLD_ID,
                COL_WORLD_NAME,
                COL_TIME,
                COL_GROUP_NAME,
            ]
            .into_iter()
            .map(ident),
        )
        .from(ident(TABLE_LOCATION))
        .and_where(owner_scope_expr())
        .order_by(ident(COL_ID), Order::Asc)
        .to_string(SqliteQueryBuilder)
}

fn game_log_join_leave_sql() -> String {
    Query::select()
        .columns(
            [
                COL_CREATED_AT,
                COL_TYPE,
                COL_DISPLAY_NAME,
                COL_LOCATION,
                COL_USER_ID,
                COL_TIME,
            ]
            .into_iter()
            .map(ident),
        )
        .from(ident(TABLE_JOIN_LEAVE))
        .and_where(owner_scope_expr())
        .order_by(ident(COL_CREATED_AT), Order::Asc)
        .to_string(SqliteQueryBuilder)
}

fn game_log_externals_sql() -> String {
    Query::select()
        .columns(
            [
                COL_CREATED_AT,
                COL_MESSAGE,
                COL_DISPLAY_NAME,
                COL_USER_ID,
                COL_LOCATION,
            ]
            .into_iter()
            .map(ident),
        )
        .from(ident(TABLE_EXTERNAL))
        .and_where(owner_scope_expr())
        .order_by(ident(COL_ID), Order::Asc)
        .to_string(SqliteQueryBuilder)
}

fn owner_scope_expr() -> sea_query::SimpleExpr {
    Expr::cust(format!("{COL_OWNER_ID} IN (0, @ownerId)"))
}

fn owner_params(db: &DatabaseService, owner_user_id: &OwnerId) -> Result<ParamsBuilder, Error> {
    Ok(ParamsBuilder::new().set("ownerId", owner_id_for_filter(db, owner_user_id)?))
}

fn game_log_location_table_exists_sql() -> String {
    Query::select()
        .column(ident("name"))
        .from(ident("sqlite_schema"))
        .and_where(Expr::col(ident("type")).eq("table"))
        .and_where(Expr::col(ident("name")).eq(TABLE_LOCATION))
        .limit(1)
        .to_string(SqliteQueryBuilder)
}

pub fn get_user_id_from_display_name(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    display_name: &str,
) -> Result<String, Error> {
    let args = owner_params(db, owner_user_id)?
        .set("displayName", display_name)
        .build();
    Ok(db
        .execute(&latest_join_leave_lookup_sql(), &args)?
        .first()
        .and_then(|row| row.first())
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string())
}

pub fn get_location_before_or_at(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    created_at: &str,
) -> Result<Option<GameLogLocationSnapshot>, Error> {
    let args = owner_params(db, owner_user_id)?
        .set("createdAt", created_at)
        .build();
    Ok(db
        .execute(&location_before_or_at_sql(), &args)?
        .first()
        .map(|row| GameLogLocationSnapshot {
            created_at: row_string(row, 0),
            location: row_string(row, 1),
            world_id: row_string(row, 2),
            world_name: row_string(row, 3),
            group_name: row_string(row, 4),
        }))
}

pub fn get_visit_span_at(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    at: &str,
) -> Result<Option<GameLogVisitSpan>, Error> {
    if !game_log_location_table_exists(db)? {
        return Ok(None);
    }
    let args = owner_params(db, owner_user_id)?.set("at", at).build();
    Ok(db
        .execute(
            "SELECT g.created_at, COALESCE(g.world_id, ''), COALESCE(g.time, 0),
                    NOT EXISTS (
                        SELECT 1 FROM gamelog_location n
                        WHERE n.owner_id IN (0, @ownerId) AND n.created_at > g.created_at
                    )
             FROM gamelog_location g
             WHERE g.owner_id IN (0, @ownerId) AND g.created_at <= @at
             ORDER BY g.created_at DESC
             LIMIT 1",
            &args,
        )?
        .first()
        .map(|row| GameLogVisitSpan {
            created_at: row_string(row, 0),
            world_id: row_string(row, 1),
            time_ms: std::cmp::Ord::max(row_i64(row, 2), 0),
            latest: row_i64(row, 3) != 0,
        }))
}

pub fn get_previous_instances_by_group_id(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    group_id: &str,
) -> Result<Vec<GameLogPreviousInstanceGroupOutput>, Error> {
    ensure_game_log_tables(db)?;
    let args = owner_params(db, owner_user_id)?
        .set("groupId", format!("%{}%", group_id.trim()))
        .build();
    let mut by_location = HashMap::<String, GameLogPreviousInstanceGroupOutput>::new();
    let mut location_order = Vec::<String>::new();

    for row in db.execute(previous_instances_by_group_id_sql(), &args)? {
        let location = row_string(&row, 1);
        if !by_location.contains_key(&location) {
            location_order.push(location.clone());
        }
        let time = row_i64(&row, 2)
            + by_location
                .get(&location)
                .map(|output| output.time)
                .unwrap_or_default();
        by_location.insert(
            location.clone(),
            GameLogPreviousInstanceGroupOutput {
                created_at: row_string(&row, 0),
                group_name: row_string(&row, 4),
                location,
                time,
                world_name: row_string(&row, 3),
            },
        );
    }

    Ok(location_order
        .into_iter()
        .filter_map(|location| by_location.remove(&location))
        .collect())
}

pub fn get_previous_instances_by_world_id(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    world_id: &str,
) -> Result<Vec<GameLogPreviousInstanceWorldOutput>, Error> {
    ensure_game_log_tables(db)?;
    let args = owner_params(db, owner_user_id)?
        .set("worldId", world_id.trim())
        .build();
    Ok(db
        .execute(previous_instances_by_world_id_sql(), &args)?
        .into_iter()
        .map(|row| GameLogPreviousInstanceWorldOutput {
            created_at: row_string(&row, 1),
            group_name: row_string(&row, 5),
            id: row_i64(&row, 0),
            location: row_string(&row, 2),
            time: row_i64(&row, 3),
            world_name: row_string(&row, 4),
        })
        .collect())
}

pub fn get_join_leave_entries_for_location_range(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    location: &str,
    after_date: &str,
    before_date: &str,
) -> Result<Vec<GameLogJoinLeaveSnapshot>, Error> {
    get_join_leave_entries_for_location_range_inner(
        db,
        Some(owner_user_id),
        location,
        after_date,
        before_date,
    )
}

pub fn get_join_leave_entries_for_location_range_unscoped(
    db: &DatabaseService,
    location: &str,
    after_date: &str,
    before_date: &str,
) -> Result<Vec<GameLogJoinLeaveSnapshot>, Error> {
    get_join_leave_entries_for_location_range_inner(db, None, location, after_date, before_date)
}

fn get_join_leave_entries_for_location_range_inner(
    db: &DatabaseService,
    owner_user_id: Option<&OwnerId>,
    location: &str,
    after_date: &str,
    before_date: &str,
) -> Result<Vec<GameLogJoinLeaveSnapshot>, Error> {
    let mut args = ParamsBuilder::new();
    if let Some(owner_user_id) = owner_user_id {
        args = args.set("ownerId", owner_id_for_filter(db, owner_user_id)?);
    }
    let args = args
        .set(COL_LOCATION, location)
        .set("afterDate", after_date)
        .set("beforeDate", before_date)
        .build();
    Ok(db
        .execute(
            &join_leave_entries_for_location_range_sql(owner_user_id.is_some()),
            &args,
        )?
        .into_iter()
        .map(|row| GameLogJoinLeaveSnapshot {
            id: row_i64(&row, 0),
            created_at: row_string(&row, 1),
            event_type: row_string(&row, 2),
            display_name: row_string(&row, 3),
            user_id: row_string(&row, 4),
            time: row_i64(&row, 5),
        })
        .collect())
}

fn session_location_segment_from_row(row: &[serde_json::Value]) -> SessionLocationSegmentRow {
    SessionLocationSegmentRow {
        id: row_i64(row, 0),
        created_at: row_string(row, 1),
        location: row_string(row, 2),
        world_id: row_string(row, 3),
        world_name: row_string(row, 4),
        time: row_i64(row, 5),
        group_name: row_string(row, 6),
    }
}

pub fn get_session_location_segments(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    before_id: Option<i64>,
    limit: i64,
) -> Result<Vec<SessionLocationSegmentRow>, Error> {
    ensure_game_log_tables(db)?;
    let mut args = owner_params(db, owner_user_id)?;
    if let Some(before_id) = before_id {
        args = args.set("beforeId", before_id);
    }
    Ok(db
        .execute(
            &session_location_segments_sql(before_id.is_some(), limit),
            &args.build(),
        )?
        .iter()
        .map(|row| session_location_segment_from_row(row))
        .collect())
}

pub fn get_session_location_segments_by_date_range(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    after_date: &str,
    before_date: &str,
    limit: i64,
) -> Result<Vec<SessionLocationSegmentRow>, Error> {
    ensure_game_log_tables(db)?;
    let args = owner_params(db, owner_user_id)?
        .set("afterDate", after_date)
        .set("beforeDate", before_date)
        .build();
    Ok(db
        .execute(&session_location_segments_by_date_range_sql(limit), &args)?
        .iter()
        .map(|row| session_location_segment_from_row(row))
        .collect())
}

pub fn get_session_events_for_range(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    after_date: &str,
    before_date: &str,
) -> Result<Vec<SessionEventRow>, Error> {
    ensure_game_log_tables(db)?;
    let args = owner_params(db, owner_user_id)?
        .set("afterDate", after_date)
        .set("beforeDate", before_date)
        .build();

    let mut rows = Vec::new();
    for row in db.execute(&session_join_leave_events_sql(), &args)? {
        rows.push(SessionEventRow {
            row_id: row_i64(&row, 0),
            event_type: row_string(&row, 1),
            created_at: row_string(&row, 2),
            display_name: row_string(&row, 3),
            user_id: row_string(&row, 4),
            location: row_string(&row, 5),
            video_url: None,
            video_name: None,
            video_id: None,
        });
    }
    for row in db.execute(&session_video_events_sql(), &args)? {
        rows.push(SessionEventRow {
            row_id: row_i64(&row, 0),
            event_type: "VideoPlay".to_string(),
            created_at: row_string(&row, 1),
            video_url: Some(row_string(&row, 2)),
            video_name: Some(row_string(&row, 3)),
            video_id: Some(row_string(&row, 4)),
            display_name: row_string(&row, 5),
            user_id: row_string(&row, 6),
            location: row_string(&row, 7),
        });
    }
    Ok(rows)
}

pub fn get_session_player_duration_rows(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    locations: &[String],
) -> Result<Vec<SessionPlayerDurationRow>, Error> {
    ensure_game_log_tables(db)?;
    let locations = locations
        .iter()
        .map(|location| location.trim())
        .filter(|location| !location.is_empty())
        .collect::<BTreeSet<_>>();
    if locations.is_empty() {
        return Ok(Vec::new());
    }

    let mut params = owner_params(db, owner_user_id)?;
    let mut placeholders = Vec::with_capacity(locations.len());
    for (index, location) in locations.into_iter().enumerate() {
        let key = format!("location{index}");
        placeholders.push(format!("@{key}"));
        params = params.set(&key, location.to_string());
    }
    let rows = db.execute(
        &format!(
            "SELECT location, display_name, user_id, time, created_at
             FROM gamelog_join_leave
             WHERE owner_id IN (0, @ownerId)
               AND type = 'OnPlayerLeft'
               AND location IN ({})
             ORDER BY created_at ASC, id ASC",
            placeholders.join(", ")
        ),
        &params.build(),
    )?;

    Ok(rows
        .iter()
        .map(|row| SessionPlayerDurationRow {
            created_at: row_string(row, 4),
            location: row_string(row, 0),
            display_name: row_string(row, 1),
            user_id: row_string(row, 2),
            time: row_i64(row, 3),
        })
        .collect())
}

pub fn get_game_log_events(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
) -> Result<Vec<GameLogEventEntry>, Error> {
    ensure_game_log_tables(db)?;
    let args = owner_params(db, owner_user_id)?.build();
    Ok(db
        .execute(&game_log_events_sql(), &args)?
        .into_iter()
        .map(|row| GameLogEventEntry {
            created_at: row_string(&row, 0),
            data: row_string(&row, 1),
        })
        .collect())
}

pub fn get_game_log_locations(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
) -> Result<Vec<GameLogLocationEntry>, Error> {
    ensure_game_log_tables(db)?;
    let args = owner_params(db, owner_user_id)?.build();
    Ok(db
        .execute(&game_log_locations_sql(), &args)?
        .into_iter()
        .map(|row| GameLogLocationEntry {
            created_at: row_string(&row, 0),
            location: row_string(&row, 1),
            world_id: row_string(&row, 2),
            world_name: row_string(&row, 3),
            time: row
                .get(4)
                .and_then(serde_json::Value::as_i64)
                .unwrap_or_default(),
            group_name: row_string(&row, 5),
        })
        .collect())
}

pub fn get_last_game_log_location(
    db: &DatabaseService,
) -> Result<Option<GameLogLocationEntry>, Error> {
    ensure_game_log_tables(db)?;
    Ok(db
        .execute(&last_location_sql(), &Default::default())?
        .into_iter()
        .next()
        .map(|row| GameLogLocationEntry {
            created_at: row_string(&row, 0),
            location: row_string(&row, 1),
            world_id: row_string(&row, 2),
            world_name: row_string(&row, 3),
            time: row
                .get(4)
                .and_then(serde_json::Value::as_i64)
                .unwrap_or_default(),
            group_name: row_string(&row, 5),
        }))
}

pub fn get_game_log_join_leave(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
) -> Result<Vec<GameLogJoinLeaveEntry>, Error> {
    ensure_game_log_tables(db)?;
    let args = owner_params(db, owner_user_id)?.build();
    Ok(db
        .execute(&game_log_join_leave_sql(), &args)?
        .into_iter()
        .map(|row| GameLogJoinLeaveEntry {
            created_at: row_string(&row, 0),
            event_type: row_string(&row, 1),
            display_name: row_string(&row, 2),
            location: row_string(&row, 3),
            user_id: row_string(&row, 4),
            world_name: String::new(),
            time: row
                .get(5)
                .and_then(serde_json::Value::as_i64)
                .unwrap_or_default(),
        })
        .collect())
}

pub fn get_game_log_externals(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
) -> Result<Vec<GameLogExternalEntry>, Error> {
    ensure_game_log_tables(db)?;
    let args = owner_params(db, owner_user_id)?.build();
    Ok(db
        .execute(&game_log_externals_sql(), &args)?
        .into_iter()
        .map(|row| GameLogExternalEntry {
            created_at: row_string(&row, 0),
            message: row_string(&row, 1),
            display_name: row_string(&row, 2),
            user_id: row_string(&row, 3),
            location: row_string(&row, 4),
        })
        .collect())
}

pub fn game_log_location_table_exists(db: &DatabaseService) -> Result<bool, Error> {
    Ok(!db
        .execute(&game_log_location_table_exists_sql(), &Default::default())?
        .is_empty())
}

pub fn get_last_game_log_date(db: &DatabaseService) -> Result<String, Error> {
    ensure_game_log_tables(db)?;

    let now = Utc::now();
    let now_string = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let date_offset = (now - chrono::Duration::days(1))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let mut dates = Vec::new();
    for table in [
        TABLE_LOCATION,
        TABLE_JOIN_LEAVE,
        TABLE_PORTAL_SPAWN,
        TABLE_EVENT,
        TABLE_VIDEO_PLAY,
        TABLE_RESOURCE_LOAD,
    ] {
        if let Some(value) = db
            .execute(&latest_created_at_sql(table), &Default::default())?
            .first()
            .and_then(|row| row.first())
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
        {
            dates.push(value.to_string());
        }
    }

    dates.sort();
    let Some(latest) = dates.last() else {
        return Ok(now_string);
    };
    if latest > &date_offset && latest < &now_string {
        Ok(latest.clone())
    } else {
        Ok(now_string)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir {
        path: std::path::PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn join_leave_range_orders_rows_by_created_at_then_id() -> Result<(), Error> {
        let dir = TestDir::new("gamelog-join-leave-range-order");
        let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
        ensure_game_log_tables(&db)?;
        for (id, created_at, display_name) in [
            (7, "2026-05-14T01:00:02.000Z", "d"),
            (3, "2026-05-14T01:00:01.000Z", "b"),
            (9, "2026-05-14T01:00:01.000Z", "c"),
            (1, "2026-05-14T01:00:02.000Z", "a"),
            (5, "2026-05-14T01:00:01.000Z", "e"),
        ] {
            db.execute_non_query(
                "INSERT INTO gamelog_join_leave (id, created_at, type, display_name, location, user_id, time) VALUES (@id, @createdAt, 'OnPlayerJoined', @displayName, 'wrld_test:1', '', 0)",
                &ParamsBuilder::new()
                    .set("id", id)
                    .set("createdAt", created_at)
                    .set("displayName", display_name)
                    .build(),
            )?;
        }

        let rows = get_join_leave_entries_for_location_range(
            &db,
            &OwnerId::new("usr_test"),
            "wrld_test:1",
            "2026-05-14T00:00:00.000Z",
            "2026-05-14T02:00:00.000Z",
        )?;

        assert_eq!(
            rows.iter().map(|row| row.id).collect::<Vec<_>>(),
            vec![3, 5, 9, 1, 7]
        );
        Ok(())
    }
}
