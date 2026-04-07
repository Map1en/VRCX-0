#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn log_watcher__get(state: State<'_, AppState>) -> Vec<Vec<String>> {
    state.log_watcher.get()
}

#[tauri::command]
pub fn log_watcher__set_date_till(
    date: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.log_watcher.set_date_till(&date);
    Ok(())
}

#[tauri::command]
pub fn log_watcher__reset(state: State<'_, AppState>) -> Result<(), AppError> {
    state.log_watcher.reset();
    Ok(())
}

#[tauri::command]
pub fn log_watcher__vrc_closed_gracefully(state: State<'_, AppState>) -> bool {
    state.log_watcher.vrc_closed_gracefully()
}
