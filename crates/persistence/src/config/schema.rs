use sea_query::{ColumnDef, Expr, ExprTrait, OnConflict, Query, SqliteQueryBuilder, Table};

use crate::common::{ident, named_param};

pub(super) const TABLE_CONFIGS: &str = "configs";
pub(super) const COL_KEY: &str = "key";
pub(super) const COL_VALUE: &str = "value";

pub(super) fn create_configs_sql() -> String {
    let mut key = ColumnDef::new(ident(COL_KEY));
    key.text().primary_key();
    let mut value = ColumnDef::new(ident(COL_VALUE));
    value.text();

    Table::create()
        .table(ident(TABLE_CONFIGS))
        .if_not_exists()
        .col(key)
        .col(value)
        .to_string(SqliteQueryBuilder)
}

pub(super) fn select_value_sql() -> String {
    Query::select()
        .column(ident(COL_VALUE))
        .from(ident(TABLE_CONFIGS))
        .and_where(Expr::col(ident(COL_KEY)).eq(named_param(COL_KEY)))
        .limit(1)
        .to_string(SqliteQueryBuilder)
}

pub(super) fn upsert_value_sql() -> String {
    Query::insert()
        .into_table(ident(TABLE_CONFIGS))
        .columns([ident(COL_KEY), ident(COL_VALUE)])
        .values_panic([named_param(COL_KEY), named_param(COL_VALUE)])
        .on_conflict(
            OnConflict::column(ident(COL_KEY))
                .update_column(ident(COL_VALUE))
                .to_owned(),
        )
        .to_string(SqliteQueryBuilder)
}

pub(super) fn delete_value_sql() -> String {
    Query::delete()
        .from_table(ident(TABLE_CONFIGS))
        .and_where(Expr::col(ident(COL_KEY)).eq(named_param(COL_KEY)))
        .to_string(SqliteQueryBuilder)
}
