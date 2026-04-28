#![allow(non_snake_case)]

use std::collections::HashMap;

use tauri::State;

use crate::domain::database::DatabaseUpgradeStatus;
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
pub fn sqlite__execute_on_writer(
    sql: String,
    args: Option<HashMap<String, serde_json::Value>>,
    state: State<'_, AppState>,
) -> Result<Vec<Vec<serde_json::Value>>, AppError> {
    let args = args.unwrap_or_default();
    state.db.execute_on_writer(&sql, &args)
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

#[tauri::command]
pub fn sqlite__begin_upgrade(
    from_version: i64,
    to_version: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.db.begin_upgrade(from_version, to_version)
}

#[tauri::command]
pub fn sqlite__commit_upgrade(state: State<'_, AppState>) -> Result<(), AppError> {
    state.db.commit_upgrade()
}

#[tauri::command]
pub fn sqlite__fail_upgrade(reason: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.db.fail_upgrade(reason)
}

#[tauri::command]
pub fn sqlite__get_failed_upgrade(
    state: State<'_, AppState>,
) -> Result<Option<DatabaseUpgradeStatus>, AppError> {
    state.db.get_failed_upgrade()
}
