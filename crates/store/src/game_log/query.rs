use chrono::Utc;
use sea_query::{Expr, Order, Query, SqliteQueryBuilder};

use crate::common::{ident, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::Error;

use super::schema::*;
use super::tables::ensure_game_log_tables;
use super::types::{GameLogJoinLeaveSnapshot, GameLogLocationSnapshot};

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

fn join_leave_entries_for_location_range_sql() -> String {
    Query::select()
        .columns([
            ident(COL_CREATED_AT),
            ident(COL_TYPE),
            ident(COL_DISPLAY_NAME),
            ident(COL_USER_ID),
        ])
        .from(ident(TABLE_JOIN_LEAVE))
        .and_where(Expr::col(ident(COL_LOCATION)).eq(Expr::cust("@location")))
        .and_where(Expr::col(ident(COL_CREATED_AT)).gte(Expr::cust("@afterDate")))
        .and_where(Expr::col(ident(COL_CREATED_AT)).lte(Expr::cust("@beforeDate")))
        .order_by(ident(COL_CREATED_AT), Order::Asc)
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
            created_at: row_string(&row, 0),
            event_type: row_string(&row, 1),
            display_name: row_string(&row, 2),
            user_id: row_string(&row, 3),
        })
        .collect())
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
