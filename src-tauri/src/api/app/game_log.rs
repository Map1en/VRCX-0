#![allow(non_snake_case)]
#![allow(unused_imports)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use serde_json::Value;
use vrcx_0_store::game_log::GameLogQueryInput;

#[tauri::command]
pub fn app__game_log_entries_add(
    state: State<'_, AppState>,
    kind: String,
    entries: Vec<Value>,
) -> Result<(), AppError> {
    vrcx_0_store::game_log::app__game_log_entries_add(state.db.as_ref(), kind, entries)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__game_log_entry_delete(
    state: State<'_, AppState>,
    kind: String,
    entry: Value,
) -> Result<i64, AppError> {
    vrcx_0_store::game_log::app__game_log_entry_delete(state.db.as_ref(), kind, entry)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__game_log_instance_delete(
    state: State<'_, AppState>,
    location: String,
    event_ids: Vec<i64>,
) -> Result<i64, AppError> {
    vrcx_0_store::game_log::app__game_log_instance_delete(state.db.as_ref(), location, event_ids)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__game_log_instance_delete_by_location(
    state: State<'_, AppState>,
    location: String,
) -> Result<i64, AppError> {
    vrcx_0_store::game_log::app__game_log_instance_delete_by_location(state.db.as_ref(), location)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__game_log_query(
    state: State<'_, AppState>,
    query: GameLogQueryInput,
) -> Result<Value, AppError> {
    vrcx_0_store::game_log::app__game_log_query(state.db.as_ref(), query).map_err(AppError::from)
}
