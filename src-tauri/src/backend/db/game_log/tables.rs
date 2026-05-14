use sea_query::{ColumnDef, Index, SqliteQueryBuilder, Table};

use crate::backend::db::common::{ident, DbWriteTarget};
use crate::domain::database::DatabaseService;
use crate::error::AppError;

use super::schema::*;

#[allow(dead_code)]
pub fn ensure_game_log_tables(db: &DatabaseService) -> Result<(), AppError> {
    ensure_game_log_tables_on(db)
}

pub(super) fn ensure_game_log_tables_on(target: &impl DbWriteTarget) -> Result<(), AppError> {
    for sql in create_table_sqls() {
        target.execute_non_query(&sql, &Default::default())?;
    }
    Ok(())
}

fn create_table_sqls() -> [String; 7] {
    [
        create_location_table_sql(),
        create_join_leave_table_sql(),
        create_portal_spawn_table_sql(),
        create_video_play_table_sql(),
        create_resource_load_table_sql(),
        create_event_table_sql(),
        create_external_table_sql(),
    ]
}

fn id_column() -> ColumnDef {
    let mut column = ColumnDef::new(ident(COL_ID));
    column.integer().primary_key();
    column
}

fn text_column(name: &'static str) -> ColumnDef {
    let mut column = ColumnDef::new(ident(name));
    column.text();
    column
}

fn integer_column(name: &'static str) -> ColumnDef {
    let mut column = ColumnDef::new(ident(name));
    column.integer();
    column
}

fn unique_index(columns: &[&'static str]) -> sea_query::IndexCreateStatement {
    let mut index = Index::create();
    index.unique();
    for column in columns {
        index.col(ident(*column));
    }
    index.take()
}

fn create_location_table_sql() -> String {
    Table::create()
        .table(ident(TABLE_LOCATION))
        .if_not_exists()
        .col(id_column())
        .col(text_column(COL_CREATED_AT))
        .col(text_column(COL_LOCATION))
        .col(text_column(COL_WORLD_ID))
        .col(text_column(COL_WORLD_NAME))
        .col(integer_column(COL_TIME))
        .col(text_column(COL_GROUP_NAME))
        .index(&mut unique_index(&[COL_CREATED_AT, COL_LOCATION]))
        .to_string(SqliteQueryBuilder)
}

fn create_join_leave_table_sql() -> String {
    Table::create()
        .table(ident(TABLE_JOIN_LEAVE))
        .if_not_exists()
        .col(id_column())
        .col(text_column(COL_CREATED_AT))
        .col(text_column(COL_TYPE))
        .col(text_column(COL_DISPLAY_NAME))
        .col(text_column(COL_LOCATION))
        .col(text_column(COL_USER_ID))
        .col(integer_column(COL_TIME))
        .index(&mut unique_index(&[
            COL_CREATED_AT,
            COL_TYPE,
            COL_DISPLAY_NAME,
        ]))
        .to_string(SqliteQueryBuilder)
}

fn create_portal_spawn_table_sql() -> String {
    Table::create()
        .table(ident(TABLE_PORTAL_SPAWN))
        .if_not_exists()
        .col(id_column())
        .col(text_column(COL_CREATED_AT))
        .col(text_column(COL_DISPLAY_NAME))
        .col(text_column(COL_LOCATION))
        .col(text_column(COL_USER_ID))
        .col(text_column(COL_INSTANCE_ID))
        .col(text_column(COL_WORLD_NAME))
        .index(&mut unique_index(&[COL_CREATED_AT, COL_DISPLAY_NAME]))
        .to_string(SqliteQueryBuilder)
}

fn create_video_play_table_sql() -> String {
    Table::create()
        .table(ident(TABLE_VIDEO_PLAY))
        .if_not_exists()
        .col(id_column())
        .col(text_column(COL_CREATED_AT))
        .col(text_column(COL_VIDEO_URL))
        .col(text_column(COL_VIDEO_NAME))
        .col(text_column(COL_VIDEO_ID))
        .col(text_column(COL_LOCATION))
        .col(text_column(COL_DISPLAY_NAME))
        .col(text_column(COL_USER_ID))
        .index(&mut unique_index(&[COL_CREATED_AT, COL_VIDEO_URL]))
        .to_string(SqliteQueryBuilder)
}

fn create_resource_load_table_sql() -> String {
    Table::create()
        .table(ident(TABLE_RESOURCE_LOAD))
        .if_not_exists()
        .col(id_column())
        .col(text_column(COL_CREATED_AT))
        .col(text_column(COL_RESOURCE_URL))
        .col(text_column(COL_RESOURCE_TYPE))
        .col(text_column(COL_LOCATION))
        .index(&mut unique_index(&[COL_CREATED_AT, COL_RESOURCE_URL]))
        .to_string(SqliteQueryBuilder)
}

fn create_event_table_sql() -> String {
    Table::create()
        .table(ident(TABLE_EVENT))
        .if_not_exists()
        .col(id_column())
        .col(text_column(COL_CREATED_AT))
        .col(text_column(COL_DATA))
        .index(&mut unique_index(&[COL_CREATED_AT, COL_DATA]))
        .to_string(SqliteQueryBuilder)
}

fn create_external_table_sql() -> String {
    Table::create()
        .table(ident(TABLE_EXTERNAL))
        .if_not_exists()
        .col(id_column())
        .col(text_column(COL_CREATED_AT))
        .col(text_column(COL_MESSAGE))
        .col(text_column(COL_DISPLAY_NAME))
        .col(text_column(COL_USER_ID))
        .col(text_column(COL_LOCATION))
        .index(&mut unique_index(&[COL_CREATED_AT, COL_MESSAGE]))
        .to_string(SqliteQueryBuilder)
}
