#![allow(non_snake_case)]

use tauri::{AppHandle, State};

use crate::bootstrap;
use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application_core::{BackendRuntimeMode, BackendRuntimeSnapshot};
use vrcx_0_runtime_host::BackendRuntimeFrontendSessionSnapshot;

#[tauri::command]
#[specta::specta]
pub async fn app__start_background_mode(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<BackendRuntimeSnapshot, AppError> {
    bootstrap::start_background_mode_for_current_session(&app_handle, &state).await
}

#[tauri::command]
#[specta::specta]
pub fn app__stop_background_mode(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    _reason: Option<String>,
) -> Result<BackendRuntimeSnapshot, AppError> {
    let current = state.snapshot_backend_runtime();
    if current.mode != BackendRuntimeMode::Background {
        return Ok(current);
    }

    if let Some(tray) = app_handle.tray_by_id("main") {
        let _ = tray.set_tooltip(Some("VRCX-0"));
    }
    let snapshot = bootstrap::restore_foreground_window_from_background_mode(&app_handle, &state)
        .map_err(|error| AppError::Custom(format!("ensure main window: {error}")))?;
    Ok(snapshot)
}

#[tauri::command]
#[specta::specta]
pub fn app__get_backend_runtime_snapshot(
    state: State<'_, AppState>,
) -> Result<BackendRuntimeSnapshot, AppError> {
    Ok(state.snapshot_backend_runtime())
}

#[tauri::command]
#[specta::specta]
pub fn app__get_backend_runtime_frontend_session_snapshot(
    state: State<'_, AppState>,
) -> Result<Option<BackendRuntimeFrontendSessionSnapshot>, AppError> {
    Ok(state.backend_runtime_frontend_session_snapshot())
}

#[tauri::command]
#[specta::specta]
pub fn app__ensure_main_window(app_handle: AppHandle) -> Result<(), AppError> {
    bootstrap::ensure_main_window(&app_handle)
        .map_err(|error| AppError::Custom(format!("ensure main window: {error}")))
}
