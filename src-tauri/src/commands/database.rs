#![allow(non_snake_case)]

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application::profile::{
    DatabaseUpgradePreflight, DatabaseUpgradeProgress, DatabaseUpgradeRunResult,
};
use vrcx_0_runtime_host_desktop::DatabaseUpgradeLifecycle;

struct TauriDatabaseUpgradeLifecycle(AppHandle);

impl DatabaseUpgradeLifecycle for TauriDatabaseUpgradeLifecycle {
    fn stop_runtime_services(&self) {
        super::host::window::stop_runtime_services(&self.0);
    }

    fn request_restart(&self) {
        self.0.request_restart();
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app__database_upgrade_preflight(
    state: State<'_, AppState>,
) -> Result<DatabaseUpgradePreflight, AppError> {
    Ok(state.runtime_host().database_upgrade().preflight().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__database_upgrade_run(
    state: State<'_, AppState>,
) -> Result<DatabaseUpgradeRunResult, AppError> {
    Ok(state.runtime_host().database_upgrade().run().await?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__database_upgrade_progress(state: State<'_, AppState>) -> DatabaseUpgradeProgress {
    state.runtime_host().database_upgrade().progress()
}

#[tauri::command]
#[specta::specta]
pub async fn app__database_upgrade_retry(
    state: State<'_, AppState>,
) -> Result<DatabaseUpgradeRunResult, AppError> {
    Ok(state.runtime_host().database_upgrade().retry().await?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__database_upgrade_failure_log_path(state: State<'_, AppState>) -> String {
    state.runtime_host().database_upgrade().failure_log_path()
}

#[tauri::command]
#[specta::specta]
pub async fn app__database_upgrade_start_fresh(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    Ok(state
        .runtime_host()
        .database_upgrade()
        .start_fresh(Arc::new(TauriDatabaseUpgradeLifecycle(app_handle)))
        .await?)
}
