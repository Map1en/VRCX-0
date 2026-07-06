use chrono::Utc;
use sea_query::{Expr, ExprTrait, Order, Query, SqliteQueryBuilder};

use crate::common::{ident, row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::Error;

use super::schema::*;
use super::tables::ensure_game_log_tables;
use super::types::{
    GameLogEventEntry, GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogJoinLeaveSnapshot,
    GameLogLocationEntry, GameLogLocationSnapshot, SessionEventRow, SessionLocationSegmentRow,
};

fn latest_join_leave_lookup_sql() -> String {
    Query::select()
        .column(ident(COL_USER_ID))
        .from(ident(TABLE_JOIN_LEAVE))
        .and_where(Expr::col(ident(COL_DISPLAY_NAME)).eq(Expr::cust("@displayName")))
        .and_where(Expr::col(ident(COL_USER_ID)).ne(""))
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
        .order_by(ident(COL_CREATED_AT), Order::Desc)
        .limit(1)
        .to_string(SqliteQueryBuilder)
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

fn join_leave_entries_for_location_range_sql() -> String {
    Query::select()
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
        .and_where(Expr::col(ident(COL_CREATED_AT)).lte(Expr::cust("@beforeDate")))
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
        .from(ident(TABLE_LOCATION));
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
        .order_by(ident(COL_ID), Order::Asc)
        .to_string(SqliteQueryBuilder)
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
    display_name: &str,
) -> Result<String, Error> {
    let args = ParamsBuilder::new()
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
    created_at: &str,
) -> Result<Option<GameLogLocationSnapshot>, Error> {
    let args = ParamsBuilder::new().set("createdAt", created_at).build();
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

pub fn get_join_leave_entries_for_location_range(
    db: &DatabaseService,
    location: &str,
    after_date: &str,
    before_date: &str,
) -> Result<Vec<GameLogJoinLeaveSnapshot>, Error> {
    let args = ParamsBuilder::new()
        .set(COL_LOCATION, location)
        .set("afterDate", after_date)
        .set("beforeDate", before_date)
        .build();
    Ok(db
        .execute(&join_leave_entries_for_location_range_sql(), &args)?
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
    before_id: Option<i64>,
    limit: i64,
) -> Result<Vec<SessionLocationSegmentRow>, Error> {
    ensure_game_log_tables(db)?;
    let mut args = ParamsBuilder::new();
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
    after_date: &str,
    before_date: &str,
    limit: i64,
) -> Result<Vec<SessionLocationSegmentRow>, Error> {
    ensure_game_log_tables(db)?;
    let args = ParamsBuilder::new()
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
    after_date: &str,
    before_date: &str,
) -> Result<Vec<SessionEventRow>, Error> {
    ensure_game_log_tables(db)?;
    let args = ParamsBuilder::new()
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

pub fn get_game_log_events(db: &DatabaseService) -> Result<Vec<GameLogEventEntry>, Error> {
    ensure_game_log_tables(db)?;
    Ok(db
        .execute(&game_log_events_sql(), &Default::default())?
        .into_iter()
        .map(|row| GameLogEventEntry {
            created_at: row_string(&row, 0),
            data: row_string(&row, 1),
        })
        .collect())
}

pub fn get_game_log_locations(db: &DatabaseService) -> Result<Vec<GameLogLocationEntry>, Error> {
    ensure_game_log_tables(db)?;
    Ok(db
        .execute(&game_log_locations_sql(), &Default::default())?
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

pub fn get_game_log_join_leave(db: &DatabaseService) -> Result<Vec<GameLogJoinLeaveEntry>, Error> {
    ensure_game_log_tables(db)?;
    Ok(db
        .execute(&game_log_join_leave_sql(), &Default::default())?
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

pub fn get_game_log_externals(db: &DatabaseService) -> Result<Vec<GameLogExternalEntry>, Error> {
    ensure_game_log_tables(db)?;
    Ok(db
        .execute(&game_log_externals_sql(), &Default::default())?
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_leave_range_sql_orders_same_timestamp_rows_by_id() {
        let sql = join_leave_entries_for_location_range_sql();

        assert!(sql.contains("ORDER BY \"created_at\" ASC, \"id\" ASC"));
    }
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
