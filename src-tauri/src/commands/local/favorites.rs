#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_application::FavoriteRow;

#[tauri::command]
#[specta::specta]
pub fn app__favorite_add(
    state: State<'_, AppState>,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64, AppError> {
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    let affected = vrcx_0_application::add_local_favorite(
        state.db.as_ref(),
        &owner_user_id,
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
    let affected = vrcx_0_application::delete_local_favorite_entries(
        state.db.as_ref(),
        &owner_user_id,
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
    let affected = vrcx_0_application::rename_local_favorite_entries(
        state.db.as_ref(),
        &owner_user_id,
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
) -> Result<Vec<FavoriteRow>, AppError> {
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    vrcx_0_application::list_local_favorites(state.db.as_ref(), &owner_user_id, kind)
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
    let affected = vrcx_0_application::remove_local_favorite(
        state.db.as_ref(),
        &owner_user_id,
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
