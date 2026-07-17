#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application::{DatabaseUpgradePreflight, DatabaseUpgradeRunResult};

#[tauri::command]
#[specta::specta]
pub async fn app__database_upgrade_preflight(
    state: State<'_, AppState>,
) -> Result<DatabaseUpgradePreflight, AppError> {
    let runtime = state.database_upgrade.clone();
    tauri::async_runtime::spawn_blocking(move || runtime.preflight())
        .await
        .map_err(|error| {
            AppError::Custom(format!("database upgrade preflight task failed: {error}"))
        })?
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__database_upgrade_run(
    state: State<'_, AppState>,
) -> Result<DatabaseUpgradeRunResult, AppError> {
    let runtime = state.database_upgrade.clone();
    tauri::async_runtime::spawn_blocking(move || runtime.run())
        .await
        .map_err(|error| AppError::Custom(format!("database upgrade task failed: {error}")))
}
