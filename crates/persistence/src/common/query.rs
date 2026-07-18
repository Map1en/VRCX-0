use sea_query::{Alias, Expr, ExprTrait, OnConflict, Query, SimpleExpr, SqliteQueryBuilder};

pub fn ident(name: impl Into<String>) -> Alias {
    Alias::new(name)
}

pub fn named_param(name: &str) -> SimpleExpr {
    let name = name.trim_start_matches('@');
    Expr::cust(format!("@{name}"))
}

pub fn insert_or_ignore_sql(table: &str, columns: &[&str]) -> String {
    let mut query = Query::insert();
    query.into_table(ident(table));
    query.columns(columns.iter().map(|column| ident(*column)));
    query.values_panic(columns.iter().map(|column| named_param(column)));
    query.on_conflict(OnConflict::new().do_nothing().to_owned());
    query.to_string(SqliteQueryBuilder)
}

pub fn insert_or_replace_sql(table: &str, columns: &[&str]) -> String {
    let mut query = Query::insert();
    query.replace();
    query.into_table(ident(table));
    query.columns(columns.iter().map(|column| ident(*column)));
    query.values_panic(columns.iter().map(|column| named_param(column)));
    query.to_string(SqliteQueryBuilder)
}

pub fn update_by_key_sql(table: &str, updates: &[&str], key_column: &str) -> String {
    let mut query = Query::update();
    query.table(ident(table));
    for column in updates {
        query.value(ident(*column), named_param(column));
    }
    query.and_where(Expr::col(ident(key_column)).eq(named_param(key_column)));
    query.to_string(SqliteQueryBuilder)
}

pub fn delete_by_key_sql(table: &str, key_column: &str) -> String {
    let mut query = Query::delete();
    query.from_table(ident(table));
    query.and_where(Expr::col(ident(key_column)).eq(named_param(key_column)));
    query.to_string(SqliteQueryBuilder)
}

pub fn delete_all_sql(table: &str) -> String {
    let mut query = Query::delete();
    query.from_table(ident(table));
    query.to_string(SqliteQueryBuilder)
}

pub fn delete_where_lt_sql(table: &str, column: &str, param: &str) -> String {
    let mut query = Query::delete();
    query.from_table(ident(table));
    query.and_where(Expr::col(ident(column)).lt(named_param(param)));
    query.to_string(SqliteQueryBuilder)
}
