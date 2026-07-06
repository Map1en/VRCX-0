#![allow(non_snake_case)]

use tauri::State;

use crate::adapters::log_watcher::LogLocationSnapshot;
use crate::error::AppError;
use crate::state::AppState;

use crate::commands::host::host_capabilities::{require_host_capability, HostCapability};

#[tauri::command]
#[specta::specta]
pub fn log_watcher__vrc_closed_gracefully(state: State<'_, AppState>) -> Result<bool, AppError> {
    require_host_capability(HostCapability::GameLogWatcher)?;
    Ok(state.log_watcher.vrc_closed_gracefully())
}

#[tauri::command]
#[specta::specta]
pub fn log_watcher__get_current_location(
    state: State<'_, AppState>,
) -> Result<Option<LogLocationSnapshot>, AppError> {
    require_host_capability(HostCapability::GameLogWatcher)?;
    Ok(state.log_watcher.current_location_snapshot())
}
