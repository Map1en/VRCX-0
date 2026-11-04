#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use super::types::{
    VrchatCurrentUserBadgeInput, VrchatCurrentUserProfileUpdateInput, VrchatCurrentUserTagsInput,
    VrchatCurrentUserUpdateInput, VrchatUserInput, VrchatUserProfileInput,
};

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_user_profile_get(
    state: State<'_, AppState>,
    input: VrchatUserProfileInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .user_profile(input.user_id, input.as_self)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_current_user_profile_update(
    state: State<'_, AppState>,
    input: VrchatCurrentUserProfileUpdateInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .current_user_mutations()
        .update_profile(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_user_get(
    state: State<'_, AppState>,
    input: VrchatUserInput,
) -> Result<VrchatResponse, AppError> {
    Ok(state
        .runtime_host()
        .get_user_via_cache(input.user_id, input.force, input.dialog, input.is_friend)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_current_user_account_standing_get(
    state: State<'_, AppState>,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .account_standing()
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_user_represented_group_get(
    state: State<'_, AppState>,
    input: VrchatUserInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .user_represented_group(input.user_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_current_user_update(
    state: State<'_, AppState>,
    input: VrchatCurrentUserUpdateInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .current_user_mutations()
        .update_user(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_current_user_badge_update(
    state: State<'_, AppState>,
    input: VrchatCurrentUserBadgeInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .current_user_mutations()
        .update_badge(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_current_user_tags_add(
    state: State<'_, AppState>,
    input: VrchatCurrentUserTagsInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .current_user_mutations()
        .add_tags(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_current_user_tags_remove(
    state: State<'_, AppState>,
    input: VrchatCurrentUserTagsInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .current_user_mutations()
        .remove_tags(input)
        .await
        .map_err(AppError::from)
}
