#![allow(non_snake_case)]

use tauri::{AppHandle, Emitter, State};

use crate::domain::game_launch;
use crate::error::AppError;
use crate::state::AppState;

use super::host_capabilities::{
    require_host_capability, require_host_capability_supported, HostCapability,
};

#[tauri::command]
pub fn app__check_game_running(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    require_host_capability(HostCapability::GameProcessMonitor)?;
    let _ = app_handle.emit(
        "updateIsGameRunning",
        serde_json::json!({
            "isGameRunning": state.process_monitor.is_game_running(),
            "isSteamVRRunning": state.process_monitor.is_steamvr_running(),
        }),
    );
    Ok(())
}

#[tauri::command]
pub fn app__is_game_running(state: State<'_, AppState>) -> Result<bool, AppError> {
    require_host_capability(HostCapability::GameProcessMonitor)?;
    Ok(state.process_monitor.is_game_running())
}

#[tauri::command]
pub fn app__is_steamvr_running(state: State<'_, AppState>) -> Result<bool, AppError> {
    require_host_capability(HostCapability::GameProcessMonitor)?;
    Ok(state.process_monitor.is_steamvr_running())
}

#[tauri::command]
pub fn app__set_game_client_runtime_state(
    state: State<'_, AppState>,
    session_active: bool,
    current_location: String,
) {
    state
        .game_client_backend
        .set_runtime_state(session_active, &current_location);
}

#[tauri::command]
pub fn app__quit_game() -> Result<i32, AppError> {
    require_host_capability_supported(HostCapability::GameLaunch)?;
    Ok(game_launch::quit_game())
}

#[tauri::command]
pub fn app__start_game(arguments: String) -> Result<bool, AppError> {
    require_host_capability(HostCapability::GameLaunch)?;
    game_launch::start_game(&arguments)
}

#[tauri::command]
pub fn app__start_game_from_path(path: String, arguments: String) -> Result<bool, AppError> {
    require_host_capability_supported(HostCapability::GameLaunch)?;
    game_launch::start_game_from_path(&path, &arguments)
}
