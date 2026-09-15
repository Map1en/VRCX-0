#![allow(non_snake_case)]

use crate::error::AppError;
use crate::state::AppState;
use tauri::State;
use vrcx_0_application::profile::{
    DataDirMigrationActionOutcome, DataDirMigrationMode, DataDirMigrationPlan,
    DataDirMigrationStatus,
};
use vrcx_0_host_desktop::vrchat_paths;
use vrcx_0_runtime_host_desktop::data_dir::{
    AppDataDirState, DataDirCleanupReport, DataDirMigrationResult,
};

use vrcx_0_host_desktop::host_capabilities::{require_host_capability, HostCapability};

#[tauri::command(async)]
#[specta::specta]
pub fn app__system_culture() -> String {
    vrcx_0_runtime_host_desktop::system_culture()
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__system_language() -> String {
    vrcx_0_runtime_host_desktop::system_language()
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__get_vrchat_photos_location() -> Result<String, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(vrchat_paths::vrchat_photos_location())
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__get_ugc_photo_location(path: Option<String>) -> Result<String, AppError> {
    if path.as_deref().is_none_or(|p| p.is_empty()) {
        require_host_capability(HostCapability::VrchatPathDiscovery)?;
    }
    Ok(vrchat_paths::ugc_photo_location(path))
}

#[tauri::command]
#[specta::specta]
pub async fn app__get_app_data_dir_state(
    state: State<'_, AppState>,
) -> Result<AppDataDirState, AppError> {
    let runtime = state.runtime_host().data_dir().clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || runtime.state())
            .await
            .map_err(|error| AppError::Custom(format!("data directory state task: {error}")))??,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn app__plan_data_dir_migration(
    state: State<'_, AppState>,
    path: String,
) -> Result<DataDirMigrationPlan, AppError> {
    let runtime = state.runtime_host().data_dir().clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || runtime.plan(path))
            .await
            .map_err(|error| AppError::Custom(format!("data directory plan task: {error}")))??,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn app__request_data_dir_migration(
    state: State<'_, AppState>,
    path: String,
    mode: DataDirMigrationMode,
) -> Result<DataDirMigrationActionOutcome, AppError> {
    let runtime = state.runtime_host().data_dir().clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || runtime.request_migration(path, mode))
            .await
            .map_err(|error| {
                AppError::Custom(format!("data directory migration task: {error}"))
            })??,
    )
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__cancel_data_dir_migration(
    state: State<'_, AppState>,
) -> Result<DataDirMigrationActionOutcome, AppError> {
    Ok(state.runtime_host().data_dir().request_cancel())
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__data_dir_migration_current_status(
    state: State<'_, AppState>,
) -> Result<DataDirMigrationStatus, AppError> {
    Ok(state.runtime_host().data_dir().current_status())
}

#[tauri::command]
#[specta::specta]
pub async fn app__take_data_dir_migration_result(
    state: State<'_, AppState>,
) -> Result<Option<DataDirMigrationResult>, AppError> {
    let runtime = state.runtime_host().data_dir().clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || runtime.take_last_result())
            .await
            .map_err(|error| AppError::Custom(format!("data directory result task: {error}")))??,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn app__cleanup_migrated_data_dir(
    state: State<'_, AppState>,
) -> Result<Option<DataDirCleanupReport>, AppError> {
    let runtime = state.runtime_host().data_dir().clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || runtime.cleanup_migrated_data())
            .await
            .map_err(|error| AppError::Custom(format!("data directory cleanup task: {error}")))??,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn app__dismiss_data_dir_cleanup(state: State<'_, AppState>) -> Result<(), AppError> {
    let runtime = state.runtime_host().data_dir().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.dismiss_cleanup())
        .await
        .map_err(|error| {
            AppError::Custom(format!("data directory cleanup dismiss task: {error}"))
        })??;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__mark_data_dir_cleanup_prompted(
    state: State<'_, AppState>,
    prompted_at: String,
) -> Result<(), AppError> {
    let runtime = state.runtime_host().data_dir().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.mark_cleanup_prompted(prompted_at))
        .await
        .map_err(|error| {
            AppError::Custom(format!("data directory cleanup prompt task: {error}"))
        })??;
    Ok(())
}
