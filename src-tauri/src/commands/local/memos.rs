#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_runtime_host_desktop::local_data::OwnerId;
use vrcx_0_runtime_host_desktop::local_data::{
    AvatarMemoOutput, MemoSaveResult, UserMemoOutput, UserNoteOutput, WorldMemoOutput,
};

#[tauri::command(async)]
#[specta::specta]
pub fn app__memo_get_avatar(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<Option<AvatarMemoOutput>, AppError> {
    state
        .runtime_host()
        .local_data()
        .memo_get_avatar(avatar_id)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__memo_get_user(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Option<UserMemoOutput>, AppError> {
    state
        .runtime_host()
        .local_data()
        .memo_get_user(user_id)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__memo_get_world(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<Option<WorldMemoOutput>, AppError> {
    state
        .runtime_host()
        .local_data()
        .memo_get_world(world_id)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__memo_list_user_notes(
    state: State<'_, AppState>,
    owner_user_id: OwnerId,
) -> Result<Vec<UserNoteOutput>, AppError> {
    state
        .runtime_host()
        .local_data()
        .memo_list_user_notes(owner_user_id)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__memo_list_users(state: State<'_, AppState>) -> Result<Vec<UserMemoOutput>, AppError> {
    state
        .runtime_host()
        .local_data()
        .memo_list_users()
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__memo_save_avatar(
    state: State<'_, AppState>,
    avatar_id: String,
    memo: String,
) -> Result<MemoSaveResult, AppError> {
    state
        .runtime_host()
        .local_data()
        .memo_save_avatar(avatar_id, memo)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__memo_save_user(
    state: State<'_, AppState>,
    user_id: String,
    memo: String,
) -> Result<MemoSaveResult, AppError> {
    state
        .runtime_host()
        .local_data()
        .memo_save_user(user_id, memo)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__memo_save_world(
    state: State<'_, AppState>,
    world_id: String,
    memo: String,
) -> Result<MemoSaveResult, AppError> {
    state
        .runtime_host()
        .local_data()
        .memo_save_world(world_id, memo)
        .map_err(AppError::from)
}
