#![allow(non_snake_case)]

use tauri::{AppHandle, State};

use crate::bootstrap;
use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application::{BackendRuntimeMode, BackendRuntimePhase, BackendRuntimeSnapshot};
use vrcx_0_runtime_host::BackendRuntimeFrontendSessionSnapshot;

#[tauri::command]
pub async fn app__start_background_mode(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<BackendRuntimeSnapshot, AppError> {
    bootstrap::capture_background_resume_route(&app_handle, &state);
    let snapshot = state
        .start_backend_runtime(BackendRuntimeMode::Background)
        .await?;
    let current = state.snapshot_backend_runtime();
    if snapshot.mode == BackendRuntimeMode::Background
        && current.mode == BackendRuntimeMode::Background
        && current.phase == BackendRuntimePhase::Running
    {
        bootstrap::show_background_mode_started_notification(&app_handle, &state);
        destroy_main_window(&app_handle);
    }
    refresh_tray_menu(&app_handle, &state);
    Ok(snapshot)
}

#[tauri::command]
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
pub fn app__get_backend_runtime_snapshot(
    state: State<'_, AppState>,
) -> Result<BackendRuntimeSnapshot, AppError> {
    Ok(state.snapshot_backend_runtime())
}

#[tauri::command]
pub fn app__get_backend_runtime_frontend_session_snapshot(
    state: State<'_, AppState>,
) -> Result<Option<BackendRuntimeFrontendSessionSnapshot>, AppError> {
    Ok(state.backend_runtime_frontend_session_snapshot())
}

#[tauri::command]
pub fn app__ensure_main_window(app_handle: AppHandle) -> Result<(), AppError> {
    bootstrap::ensure_main_window(&app_handle)
        .map_err(|error| AppError::Custom(format!("ensure main window: {error}")))
}

fn destroy_main_window(app_handle: &AppHandle) {
    bootstrap::destroy_main_window_for_background_mode(app_handle);
}

fn refresh_tray_menu(app_handle: &AppHandle, state: &AppState) {
    if let Err(error) = bootstrap::refresh_tray_menu(app_handle, state) {
        tracing::warn!(error = %error, "failed to refresh tray background mode item");
    }
}
