#![allow(non_snake_case)]

use tauri::State;

use vrcx_0_persistence::browse_history::{
    BrowseHistoryEntityKind, BrowseHistoryPageOutput, BrowseHistoryQueryInput,
    BrowseHistoryRecordInput,
};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn app__browse_history_record(
    state: State<'_, AppState>,
    input: BrowseHistoryRecordInput,
) -> Result<(), AppError> {
    vrcx_0_persistence::browse_history::browse_history_record(state.db.as_ref(), input)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__browse_history_query(
    state: State<'_, AppState>,
    input: BrowseHistoryQueryInput,
) -> Result<BrowseHistoryPageOutput, AppError> {
    vrcx_0_persistence::browse_history::browse_history_query(state.db.as_ref(), input)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__browse_history_delete(
    state: State<'_, AppState>,
    owner_user_id: String,
    entity_kind: BrowseHistoryEntityKind,
    entity_id: String,
) -> Result<i64, AppError> {
    vrcx_0_persistence::browse_history::browse_history_delete(
        state.db.as_ref(),
        owner_user_id,
        entity_kind,
        entity_id,
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__browse_history_clear(
    state: State<'_, AppState>,
    owner_user_id: String,
    entity_kind: Option<BrowseHistoryEntityKind>,
) -> Result<i64, AppError> {
    vrcx_0_persistence::browse_history::browse_history_clear(
        state.db.as_ref(),
        owner_user_id,
        entity_kind,
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__browse_history_retention_days_get(state: State<'_, AppState>) -> Result<i64, AppError> {
    vrcx_0_persistence::browse_history::browse_history_retention_days_get(state.db.as_ref())
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__browse_history_retention_days_set(
    state: State<'_, AppState>,
    retention_days: i64,
) -> Result<i64, AppError> {
    vrcx_0_persistence::browse_history::browse_history_retention_days_set(
        state.db.as_ref(),
        retention_days,
    )
    .map_err(AppError::from)
}
