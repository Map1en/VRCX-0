#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use serde_json::Value;
use vrcx_0_application::{GameLogSessionDto, GameLogSessionsQueryInput};
use vrcx_0_persistence::game_log::GameLogQueryInput;

#[tauri::command]
#[specta::specta]
pub fn app__game_log_entries_add(
    state: State<'_, AppState>,
    kind: String,
    entries: Vec<Value>,
) -> Result<(), AppError> {
    let affected_count =
        vrcx_0_persistence::game_log::game_log_entries_add(state.db.as_ref(), kind, entries)
            .map_err(AppError::from)?;
    state
        .runtime_context
        .event_bus
        .emit_game_log_persisted(affected_count);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__game_log_entry_delete(
    state: State<'_, AppState>,
    kind: String,
    entry: Value,
) -> Result<i64, AppError> {
    vrcx_0_persistence::game_log::game_log_entry_delete(state.db.as_ref(), kind, entry)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__game_log_instance_delete(
    state: State<'_, AppState>,
    location: String,
    event_ids: Vec<i64>,
) -> Result<i64, AppError> {
    vrcx_0_persistence::game_log::game_log_instance_delete(state.db.as_ref(), location, event_ids)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__game_log_instance_delete_by_location(
    state: State<'_, AppState>,
    location: String,
) -> Result<i64, AppError> {
    vrcx_0_persistence::game_log::game_log_instance_delete_by_location(state.db.as_ref(), location)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__game_log_query(
    state: State<'_, AppState>,
    query: GameLogQueryInput,
) -> Result<Value, AppError> {
    vrcx_0_persistence::game_log::game_log_query(state.db.as_ref(), query).map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__game_log_sessions_query(
    state: State<'_, AppState>,
    input: GameLogSessionsQueryInput,
) -> Result<Vec<GameLogSessionDto>, AppError> {
    vrcx_0_application::game_log_sessions_query(state.db.as_ref(), input).map_err(AppError::from)
}
