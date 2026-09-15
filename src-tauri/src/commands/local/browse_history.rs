#![allow(non_snake_case)]

use tauri::State;

use vrcx_0_runtime_host_desktop::local_data::{
    BrowseHistoryEntityKind, BrowseHistoryPageOutput, BrowseHistoryQueryInput,
    BrowseHistoryRecordInput,
};

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_runtime_host_desktop::local_data::OwnerId;

#[tauri::command(async)]
#[specta::specta]
pub fn app__browse_history_record(
    state: State<'_, AppState>,
    input: BrowseHistoryRecordInput,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .local_data()
        .browse_history_record(input)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__browse_history_query(
    state: State<'_, AppState>,
    input: BrowseHistoryQueryInput,
) -> Result<BrowseHistoryPageOutput, AppError> {
    state
        .runtime_host()
        .local_data()
        .browse_history_query(input)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__browse_history_delete(
    state: State<'_, AppState>,
    owner_user_id: OwnerId,
    entity_kind: BrowseHistoryEntityKind,
    entity_id: String,
) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .browse_history_delete(owner_user_id, entity_kind, entity_id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__browse_history_clear(
    state: State<'_, AppState>,
    owner_user_id: OwnerId,
    entity_kind: Option<BrowseHistoryEntityKind>,
) -> Result<i64, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("browse history clear", move || {
        local_data.browse_history_clear(owner_user_id, entity_kind)
    })
    .await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__browse_history_retention_days_get(state: State<'_, AppState>) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .browse_history_retention_days_get()
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__browse_history_retention_days_set(
    state: State<'_, AppState>,
    retention_days: i64,
) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .browse_history_retention_days_set(retention_days)
        .map_err(AppError::from)
}
