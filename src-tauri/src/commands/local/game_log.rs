#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use serde_json::Value;
use vrcx_0_application_game::{GameLogSessionDto, GameLogSessionsQueryInput};
use vrcx_0_persistence::game_log::GameLogQueryInput;

#[tauri::command]
#[specta::specta]
pub fn app__game_log_entries_add(
    state: State<'_, AppState>,
    kind: String,
    entries: Vec<Value>,
) -> Result<(), AppError> {
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    let affected_count = vrcx_0_persistence::game_log::game_log_entries_add(
        state.db.as_ref(),
        &owner_user_id,
        kind,
        entries,
    )
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
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    vrcx_0_persistence::game_log::game_log_entry_delete(
        state.db.as_ref(),
        &owner_user_id,
        kind,
        entry,
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__game_log_instance_delete(
    state: State<'_, AppState>,
    location: String,
    event_ids: Vec<i64>,
) -> Result<i64, AppError> {
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    vrcx_0_persistence::game_log::game_log_instance_delete(
        state.db.as_ref(),
        &owner_user_id,
        location,
        event_ids,
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__game_log_instance_delete_by_location(
    state: State<'_, AppState>,
    location: String,
) -> Result<i64, AppError> {
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    vrcx_0_persistence::game_log::game_log_instance_delete_by_location(
        state.db.as_ref(),
        &owner_user_id,
        location,
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__game_log_query(
    state: State<'_, AppState>,
    query: GameLogQueryInput,
) -> Result<Value, AppError> {
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    vrcx_0_persistence::game_log::game_log_query(state.db.as_ref(), &owner_user_id, query)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__game_log_sessions_query(
    state: State<'_, AppState>,
    input: GameLogSessionsQueryInput,
) -> Result<Vec<GameLogSessionDto>, AppError> {
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    vrcx_0_application_game::game_log_sessions_query(state.db.as_ref(), &owner_user_id, input)
        .map_err(AppError::from)
}
