#![allow(non_snake_case)]

use tauri::State;

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;

use serde_json::Value;
use vrcx_0_application_game::{
    GameLogSessionDto, GameLogSessionsQueryInput, InstanceHistoryEntryOutput,
    InstanceHistoryQueryInput,
};
use vrcx_0_host_desktop::host_capabilities::{require_host_capability_supported, HostCapability};
use vrcx_0_runtime_host_desktop::local_data::{
    GameLogEntryDeleteKind, GameLogPreviousInstanceGroupOutput, GameLogPreviousInstanceWorldOutput,
    GameLogQuery, GameLogQueryOutput, GameLogWriteKind,
};

#[tauri::command(async)]
#[specta::specta]
pub fn app__game_log_persistence_set_disabled(
    state: State<'_, AppState>,
    disabled: bool,
) -> Result<(), AppError> {
    require_host_capability_supported(HostCapability::GameLogWatcher)?;
    state
        .runtime_host()
        .set_game_log_persistence_disabled(disabled)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__game_log_entries_add(
    state: State<'_, AppState>,
    kind: GameLogWriteKind,
    entries: Vec<Value>,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .add_game_log_entries(kind, entries)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__game_log_entry_delete(
    state: State<'_, AppState>,
    kind: GameLogEntryDeleteKind,
    entry: Value,
) -> Result<i64, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("game log entry delete", move || {
        local_data.game_log_entry_delete(kind, entry)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__game_log_instance_delete(
    state: State<'_, AppState>,
    location: String,
    event_ids: Vec<i64>,
) -> Result<i64, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("game log instance delete", move || {
        local_data.game_log_instance_delete(location, event_ids)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__game_log_instance_delete_by_location(
    state: State<'_, AppState>,
    location: String,
) -> Result<i64, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("game log instance delete", move || {
        local_data.game_log_instance_delete_by_location(location)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__game_log_query(
    state: State<'_, AppState>,
    query: GameLogQuery,
) -> Result<GameLogQueryOutput, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("game log query", move || local_data.game_log_query(query)).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__game_log_previous_instances_by_group_id(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<Vec<GameLogPreviousInstanceGroupOutput>, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("game log previous instances query", move || {
        local_data.previous_instances_by_group_id(group_id)
    })
    .await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__game_log_previous_instances_by_world_id(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<Vec<GameLogPreviousInstanceWorldOutput>, AppError> {
    state
        .runtime_host()
        .local_data()
        .previous_instances_by_world_id(world_id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__game_log_sessions_query(
    state: State<'_, AppState>,
    input: GameLogSessionsQueryInput,
) -> Result<Vec<GameLogSessionDto>, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("game log sessions query", move || {
        local_data.game_log_sessions_query(input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__instance_history_query(
    state: State<'_, AppState>,
    input: InstanceHistoryQueryInput,
) -> Result<Vec<InstanceHistoryEntryOutput>, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("instance history query", move || {
        local_data.instance_history_query(input)
    })
    .await
}
