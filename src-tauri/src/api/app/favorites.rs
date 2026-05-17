#![allow(non_snake_case)]
#![allow(unused_imports)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use serde_json::Value;

#[tauri::command]
pub fn app__favorite_add(
    state: State<'_, AppState>,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64, AppError> {
    vrcx_0_store::favorites::app__favorite_add(state.db.as_ref(), kind, entity_id, group_name)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__favorite_group_delete(
    state: State<'_, AppState>,
    kind: String,
    group_name: String,
) -> Result<i64, AppError> {
    vrcx_0_store::favorites::app__favorite_group_delete(state.db.as_ref(), kind, group_name)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__favorite_group_rename(
    state: State<'_, AppState>,
    kind: String,
    group_name: String,
    new_group_name: String,
) -> Result<i64, AppError> {
    vrcx_0_store::favorites::app__favorite_group_rename(
        state.db.as_ref(),
        kind,
        group_name,
        new_group_name,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__favorite_list(
    state: State<'_, AppState>,
    kind: String,
) -> Result<Vec<Value>, AppError> {
    vrcx_0_store::favorites::app__favorite_list(state.db.as_ref(), kind).map_err(AppError::from)
}

#[tauri::command]
pub fn app__favorite_remove(
    state: State<'_, AppState>,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64, AppError> {
    vrcx_0_store::favorites::app__favorite_remove(state.db.as_ref(), kind, entity_id, group_name)
        .map_err(AppError::from)
}
