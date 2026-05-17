#![allow(non_snake_case)]
#![allow(unused_imports)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use std::collections::HashMap;
use vrcx_0_store::local_moderation::{
    LocalModerationInput, LocalModerationOutput, RemoteModerationInput,
};

#[tauri::command]
pub fn app__local_moderation_delete(
    state: State<'_, AppState>,
    owner_user_id: String,
    user_id: String,
) -> Result<(), AppError> {
    vrcx_0_store::local_moderation::app__local_moderation_delete(
        state.db.as_ref(),
        owner_user_id,
        user_id,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__local_moderation_get(
    state: State<'_, AppState>,
    owner_user_id: String,
    user_id: String,
) -> Result<Option<LocalModerationOutput>, AppError> {
    vrcx_0_store::local_moderation::app__local_moderation_get(
        state.db.as_ref(),
        owner_user_id,
        user_id,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__local_moderation_list(
    state: State<'_, AppState>,
    owner_user_id: String,
) -> Result<Vec<LocalModerationOutput>, AppError> {
    vrcx_0_store::local_moderation::app__local_moderation_list(state.db.as_ref(), owner_user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__local_moderation_set(
    state: State<'_, AppState>,
    owner_user_id: String,
    entry: LocalModerationInput,
) -> Result<(), AppError> {
    vrcx_0_store::local_moderation::app__local_moderation_set(
        state.db.as_ref(),
        owner_user_id,
        entry,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__local_moderation_sync_snapshot(
    state: State<'_, AppState>,
    owner_user_id: String,
    rows: Vec<RemoteModerationInput>,
) -> Result<Vec<LocalModerationOutput>, AppError> {
    vrcx_0_store::local_moderation::app__local_moderation_sync_snapshot(
        state.db.as_ref(),
        owner_user_id,
        rows,
    )
    .map_err(AppError::from)
}
