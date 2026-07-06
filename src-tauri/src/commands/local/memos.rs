#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_persistence::memos::{
    AvatarMemoOutput, MemoSaveResult, UserMemoOutput, UserNoteOutput, WorldMemoOutput,
};

#[tauri::command]
#[specta::specta]
pub fn app__memo_get_avatar(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<Option<AvatarMemoOutput>, AppError> {
    vrcx_0_persistence::memos::memo_get_avatar(state.db.as_ref(), avatar_id).map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__memo_get_user(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Option<UserMemoOutput>, AppError> {
    vrcx_0_persistence::memos::memo_get_user(state.db.as_ref(), user_id).map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__memo_get_world(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<Option<WorldMemoOutput>, AppError> {
    vrcx_0_persistence::memos::memo_get_world(state.db.as_ref(), world_id).map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__memo_list_user_notes(
    state: State<'_, AppState>,
    owner_user_id: String,
) -> Result<Vec<UserNoteOutput>, AppError> {
    vrcx_0_persistence::memos::memo_list_user_notes(state.db.as_ref(), owner_user_id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__memo_list_users(state: State<'_, AppState>) -> Result<Vec<UserMemoOutput>, AppError> {
    vrcx_0_persistence::memos::memo_list_users(state.db.as_ref()).map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__memo_save_avatar(
    state: State<'_, AppState>,
    avatar_id: String,
    memo: String,
) -> Result<MemoSaveResult, AppError> {
    vrcx_0_persistence::memos::memo_save_avatar(state.db.as_ref(), avatar_id, memo)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__memo_save_user(
    state: State<'_, AppState>,
    user_id: String,
    memo: String,
) -> Result<MemoSaveResult, AppError> {
    let result = vrcx_0_persistence::memos::memo_save_user(state.db.as_ref(), user_id, memo)
        .map_err(AppError::from)?;
    state
        .runtime
        .vr_overlay_runtime
        .invalidate_friends_panel_note_memo_cache();
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub fn app__memo_save_world(
    state: State<'_, AppState>,
    world_id: String,
    memo: String,
) -> Result<MemoSaveResult, AppError> {
    vrcx_0_persistence::memos::memo_save_world(state.db.as_ref(), world_id, memo)
        .map_err(AppError::from)
}
