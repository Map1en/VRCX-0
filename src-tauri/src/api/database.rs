#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_persistence::database::DatabaseUpgradeStatus;

#[tauri::command]
pub fn sqlite__begin_upgrade(
    from_version: i64,
    to_version: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    Ok(state.db.begin_upgrade(from_version, to_version)?)
}

#[tauri::command]
pub fn sqlite__commit_upgrade(state: State<'_, AppState>) -> Result<(), AppError> {
    Ok(state.db.commit_upgrade()?)
}

#[tauri::command]
pub fn sqlite__fail_upgrade(reason: String, state: State<'_, AppState>) -> Result<(), AppError> {
    Ok(state.db.fail_upgrade(reason)?)
}

#[tauri::command]
pub fn sqlite__get_failed_upgrade(
    state: State<'_, AppState>,
) -> Result<Option<DatabaseUpgradeStatus>, AppError> {
    Ok(state.db.get_failed_upgrade()?)
}
