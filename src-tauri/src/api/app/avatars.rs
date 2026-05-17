#![allow(non_snake_case)]
#![allow(unused_imports)]

use serde_json::Value;
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_store::avatars::{
    AvatarCacheOutput, AvatarTagInput, AvatarTagOutput, AvatarTagsPatchInput, AvatarTimeSpentOutput,
};
use vrcx_0_store::cache_entities::CacheEntityInput;

#[tauri::command]
pub fn app__avatar_cache_get(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<Option<AvatarCacheOutput>, AppError> {
    vrcx_0_store::avatars::app__avatar_cache_get(state.db.as_ref(), avatar_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_cache_list(
    state: State<'_, AppState>,
) -> Result<Vec<AvatarCacheOutput>, AppError> {
    vrcx_0_store::avatars::app__avatar_cache_list(state.db.as_ref()).map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_cache_remove(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<(), AppError> {
    vrcx_0_store::avatars::app__avatar_cache_remove(state.db.as_ref(), avatar_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_cache_upsert(
    state: State<'_, AppState>,
    entry: CacheEntityInput,
) -> Result<i64, AppError> {
    vrcx_0_store::avatars::app__avatar_cache_upsert(state.db.as_ref(), entry)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_history_add(
    state: State<'_, AppState>,
    user_id: String,
    avatar_id: String,
) -> Result<(), AppError> {
    vrcx_0_store::avatars::app__avatar_history_add(state.db.as_ref(), user_id, avatar_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_history_clear(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<(), AppError> {
    vrcx_0_store::avatars::app__avatar_history_clear(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_history_list(
    state: State<'_, AppState>,
    user_id: String,
    limit: i64,
) -> Result<Vec<AvatarCacheOutput>, AppError> {
    vrcx_0_store::avatars::app__avatar_history_list(state.db.as_ref(), user_id, limit)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tag_add(
    state: State<'_, AppState>,
    avatar_id: String,
    tag: Value,
    color: Value,
) -> Result<i64, AppError> {
    vrcx_0_store::avatars::app__avatar_tag_add(state.db.as_ref(), avatar_id, tag, color)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tag_remove(
    state: State<'_, AppState>,
    avatar_id: String,
    tag: Value,
) -> Result<i64, AppError> {
    vrcx_0_store::avatars::app__avatar_tag_remove(state.db.as_ref(), avatar_id, tag)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tag_update_color(
    state: State<'_, AppState>,
    avatar_id: String,
    tag: Value,
    color: Value,
) -> Result<i64, AppError> {
    vrcx_0_store::avatars::app__avatar_tag_update_color(state.db.as_ref(), avatar_id, tag, color)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tags_distinct(state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
    vrcx_0_store::avatars::app__avatar_tags_distinct(state.db.as_ref()).map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tags_get(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<Vec<AvatarTagOutput>, AppError> {
    vrcx_0_store::avatars::app__avatar_tags_get(state.db.as_ref(), avatar_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tags_list(state: State<'_, AppState>) -> Result<Vec<AvatarTagOutput>, AppError> {
    vrcx_0_store::avatars::app__avatar_tags_list(state.db.as_ref()).map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tags_patch(
    state: State<'_, AppState>,
    avatar_id: String,
    patch: AvatarTagsPatchInput,
) -> Result<(), AppError> {
    vrcx_0_store::avatars::app__avatar_tags_patch(state.db.as_ref(), avatar_id, patch)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tags_remove_all(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<i64, AppError> {
    vrcx_0_store::avatars::app__avatar_tags_remove_all(state.db.as_ref(), avatar_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tags_replace(
    state: State<'_, AppState>,
    avatar_id: String,
    entries: Vec<AvatarTagInput>,
) -> Result<(), AppError> {
    vrcx_0_store::avatars::app__avatar_tags_replace(state.db.as_ref(), avatar_id, entries)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_time_spent_add(
    state: State<'_, AppState>,
    user_id: String,
    avatar_id: String,
    time_spent: i64,
) -> Result<(), AppError> {
    vrcx_0_store::avatars::app__avatar_time_spent_add(
        state.db.as_ref(),
        user_id,
        avatar_id,
        time_spent,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_time_spent_get(
    state: State<'_, AppState>,
    user_id: String,
    avatar_id: String,
) -> Result<AvatarTimeSpentOutput, AppError> {
    vrcx_0_store::avatars::app__avatar_time_spent_get(state.db.as_ref(), user_id, avatar_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_time_spent_list(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Vec<AvatarTimeSpentOutput>, AppError> {
    vrcx_0_store::avatars::app__avatar_time_spent_list(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}
