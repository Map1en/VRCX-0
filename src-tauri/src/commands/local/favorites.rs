#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use serde_json::Value;

#[tauri::command]
#[specta::specta]
pub fn app__favorite_add(
    state: State<'_, AppState>,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64, AppError> {
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    let affected = vrcx_0_persistence::favorites::favorite_add(
        state.db.as_ref(),
        Some(&owner_user_id),
        kind.clone(),
        entity_id,
        group_name,
    )
    .map_err(AppError::from)?;
    state
        .realtime_runtime
        .notify_favorites_changed(&kind, true, false);
    Ok(affected)
}

#[tauri::command]
#[specta::specta]
pub fn app__favorite_group_delete(
    state: State<'_, AppState>,
    kind: String,
    group_name: String,
) -> Result<i64, AppError> {
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    let affected = vrcx_0_persistence::favorites::favorite_group_delete(
        state.db.as_ref(),
        Some(&owner_user_id),
        kind.clone(),
        group_name,
    )
    .map_err(AppError::from)?;
    state
        .realtime_runtime
        .notify_favorites_changed(&kind, true, false);
    Ok(affected)
}

#[tauri::command]
#[specta::specta]
pub fn app__favorite_group_rename(
    state: State<'_, AppState>,
    kind: String,
    group_name: String,
    new_group_name: String,
) -> Result<i64, AppError> {
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    let affected = vrcx_0_persistence::favorites::favorite_group_rename(
        state.db.as_ref(),
        Some(&owner_user_id),
        kind.clone(),
        group_name,
        new_group_name,
    )
    .map_err(AppError::from)?;
    state
        .realtime_runtime
        .notify_favorites_changed(&kind, true, false);
    Ok(affected)
}

#[tauri::command]
#[specta::specta]
pub fn app__favorite_list(
    state: State<'_, AppState>,
    kind: String,
) -> Result<Vec<Value>, AppError> {
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    vrcx_0_persistence::favorites::favorite_list(state.db.as_ref(), Some(&owner_user_id), kind)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__favorite_remove(
    state: State<'_, AppState>,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64, AppError> {
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    let affected = vrcx_0_persistence::favorites::favorite_remove(
        state.db.as_ref(),
        Some(&owner_user_id),
        kind.clone(),
        entity_id,
        group_name,
    )
    .map_err(AppError::from)?;
    state
        .realtime_runtime
        .notify_favorites_changed(&kind, true, false);
    Ok(affected)
}
