#![allow(non_snake_case)]

use serde_json::Value;
use tauri::State;

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_runtime_host_desktop::local_data::{
    AvatarCacheOutput, AvatarGetInput, AvatarTagInput, AvatarTagOutput, AvatarTagsPatchInput,
    AvatarTimeSpentOutput, AvatarUsageRow,
};

#[tauri::command]
#[specta::specta]
pub async fn app__avatar_get(
    state: State<'_, AppState>,
    input: AvatarGetInput,
) -> Result<Option<vrcx_0_core::json::RawJson>, AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_get(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__avatar_find_by_image_url(
    state: State<'_, AppState>,
    image_url: String,
) -> Result<Option<vrcx_0_core::json::RawJson>, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("avatar image url lookup", move || {
        local_data.avatar_find_by_image_url(image_url)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__avatar_history_clear(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<(), AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("avatar history clear", move || {
        local_data.avatar_history_clear(user_id)
    })
    .await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_history_list(
    state: State<'_, AppState>,
    user_id: String,
    limit: i64,
) -> Result<Vec<AvatarCacheOutput>, AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_history_list(user_id, limit)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_usage_ranking(
    state: State<'_, AppState>,
    user_id: String,
    limit: i64,
) -> Result<Vec<AvatarUsageRow>, AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_usage_ranking(user_id, limit)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_tag_add(
    state: State<'_, AppState>,
    avatar_id: String,
    tag: Value,
    color: Value,
) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_tag_add(avatar_id, tag, color)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_tag_remove(
    state: State<'_, AppState>,
    avatar_id: String,
    tag: Value,
) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_tag_remove(avatar_id, tag)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_tag_update_color(
    state: State<'_, AppState>,
    avatar_id: String,
    tag: Value,
    color: Value,
) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_tag_update_color(avatar_id, tag, color)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_tags_distinct(state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_tags_distinct()
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_tags_get(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<Vec<AvatarTagOutput>, AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_tags_get(avatar_id)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_tags_list(state: State<'_, AppState>) -> Result<Vec<AvatarTagOutput>, AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_tags_list()
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_tags_patch(
    state: State<'_, AppState>,
    avatar_id: String,
    patch: AvatarTagsPatchInput,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_tags_patch(avatar_id, patch)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_tags_remove_all(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_tags_remove_all(avatar_id)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_tags_replace(
    state: State<'_, AppState>,
    avatar_id: String,
    entries: Vec<AvatarTagInput>,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_tags_replace(avatar_id, entries)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_time_spent_add(
    state: State<'_, AppState>,
    user_id: String,
    avatar_id: String,
    time_spent: i64,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_time_spent_add(user_id, avatar_id, time_spent)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_time_spent_get(
    state: State<'_, AppState>,
    user_id: String,
    avatar_id: String,
) -> Result<AvatarTimeSpentOutput, AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_time_spent_get(user_id, avatar_id)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_time_spent_list(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Vec<AvatarTimeSpentOutput>, AppError> {
    state
        .runtime_host()
        .local_data()
        .avatar_time_spent_list(user_id)
        .map_err(AppError::from)
}
