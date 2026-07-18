#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{AppUpdateDownloadStatusSnapshot, AppUpdateStatusSnapshot};
use vrcx_0_application_core::UpdaterMetadata;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn app__app_update_status_get(state: State<'_, AppState>) -> AppUpdateStatusSnapshot {
    state.desktop.app_update.hydration_snapshot()
}

#[tauri::command]
#[specta::specta]
pub async fn app__app_update_check_run(
    state: State<'_, AppState>,
) -> Result<AppUpdateStatusSnapshot, AppError> {
    Ok(state.desktop.app_update.check_now().await)
}

#[tauri::command]
#[specta::specta]
pub fn app__app_update_download_status_get(
    state: State<'_, AppState>,
) -> AppUpdateDownloadStatusSnapshot {
    state.desktop.app_update.download_status()
}

#[tauri::command]
#[specta::specta]
pub async fn app__app_update_install_confirm(
    state: State<'_, AppState>,
    version: String,
) -> Result<UpdaterMetadata, AppError> {
    state
        .desktop
        .app_update
        .install(&version)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__app_update_background_download_preference_changed(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), AppError> {
    state
        .desktop
        .app_update
        .set_auto_background_download_preference(enabled)
        .await;
    Ok(())
}
