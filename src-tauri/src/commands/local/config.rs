#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_runtime_host_desktop::local_data::{ConfigReadEntry, ConfigWriteEntry};

#[tauri::command(async)]
#[specta::specta]
pub fn app__config_list_values(
    state: State<'_, AppState>,
) -> Result<Vec<ConfigReadEntry>, AppError> {
    state
        .runtime_host()
        .local_data()
        .config_list_values()
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__config_remove_value(state: State<'_, AppState>, key: String) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .config_remove_value(key)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__config_set_values(
    state: State<'_, AppState>,
    entries: Vec<ConfigWriteEntry>,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .local_data()
        .config_set_values(entries)
        .map_err(AppError::from)
}
