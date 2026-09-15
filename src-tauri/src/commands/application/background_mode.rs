#![allow(non_snake_case)]

use tauri::{AppHandle, State};

use crate::bootstrap;
use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application_core::BackendRuntimeSnapshot;
use vrcx_0_composition::BackendRuntimeCombinedSnapshot;

#[tauri::command]
#[specta::specta]
pub async fn app__start_background_mode(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<BackendRuntimeSnapshot, AppError> {
    bootstrap::start_background_mode_for_current_session(&app_handle, &state).await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__backend_runtime_combined_snapshot_get(
    state: State<'_, AppState>,
) -> Result<BackendRuntimeCombinedSnapshot, AppError> {
    Ok(state.runtime_host().backend_runtime_combined_snapshot())
}

#[tauri::command]
#[specta::specta]
pub fn app__ensure_main_window(app_handle: AppHandle) -> Result<(), AppError> {
    bootstrap::ensure_main_window(&app_handle)
        .map_err(|error| AppError::Custom(format!("ensure main window: {error}")))
}
