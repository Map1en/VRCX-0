#![allow(non_snake_case)]

use std::collections::HashMap;

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn sqlite__execute(
    sql: String,
    args: Option<HashMap<String, serde_json::Value>>,
    state: State<'_, AppState>,
) -> Result<Vec<Vec<serde_json::Value>>, AppError> {
    let args = args.unwrap_or_default();
    state.db.execute(&sql, &args)
}

#[tauri::command]
pub fn sqlite__execute_non_query(
    sql: String,
    args: Option<HashMap<String, serde_json::Value>>,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    let args = args.unwrap_or_default();
    state.db.execute_non_query(&sql, &args)
}
