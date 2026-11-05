#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::remote::AvatarListByUserQuery;
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    VrchatAvatarIdInput, VrchatAvatarListByUserInput, VrchatAvatarModerationInput,
    VrchatAvatarSaveInput,
};

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_avatar_gallery_get(
    state: State<'_, AppState>,
    input: VrchatAvatarIdInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .avatar_gallery(input.avatar_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_avatar_list_by_user_get(
    state: State<'_, AppState>,
    input: VrchatAvatarListByUserInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .avatars_by_user(
            input.user_id,
            input.user,
            AvatarListByUserQuery {
                n: input.n,
                offset: input.offset,
                sort: input.sort,
                order: input.order,
                release_status: input.release_status,
            },
        )
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_avatar_styles_get(
    state: State<'_, AppState>,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .avatar_styles()
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_avatar_moderations_get(
    state: State<'_, AppState>,
) -> Result<VrchatResponse, AppError> {
    Ok(state.runtime_host().avatars().moderations().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_avatar_select(
    state: State<'_, AppState>,
    input: VrchatAvatarIdInput,
) -> Result<vrcx_0_application::avatars::AvatarSelectionMutationOutcome, AppError> {
    Ok(state
        .runtime_host()
        .avatars()
        .select(input.avatar_id)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_avatar_select_fallback(
    state: State<'_, AppState>,
    input: VrchatAvatarIdInput,
) -> Result<vrcx_0_application::avatars::AvatarSelectionMutationOutcome, AppError> {
    Ok(state
        .runtime_host()
        .avatars()
        .select_fallback(input.avatar_id)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_avatar_save(
    state: State<'_, AppState>,
    input: VrchatAvatarSaveInput,
) -> Result<VrchatResponse, AppError> {
    Ok(state
        .runtime_host()
        .avatars()
        .save(input.avatar_id, input.params)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_avatar_delete(
    state: State<'_, AppState>,
    input: VrchatAvatarIdInput,
) -> Result<VrchatResponse, AppError> {
    Ok(state
        .runtime_host()
        .avatars()
        .delete(input.avatar_id)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_avatar_impostor_create(
    state: State<'_, AppState>,
    input: VrchatAvatarIdInput,
) -> Result<VrchatResponse, AppError> {
    Ok(state
        .runtime_host()
        .avatars()
        .create_impostor(input.avatar_id)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_avatar_impostor_delete(
    state: State<'_, AppState>,
    input: VrchatAvatarIdInput,
) -> Result<VrchatResponse, AppError> {
    Ok(state
        .runtime_host()
        .avatars()
        .delete_impostor(input.avatar_id)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_avatar_moderation_send(
    state: State<'_, AppState>,
    input: VrchatAvatarModerationInput,
) -> Result<VrchatResponse, AppError> {
    Ok(state
        .runtime_host()
        .avatars()
        .send_moderation(input.avatar_id)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_avatar_moderation_delete(
    state: State<'_, AppState>,
    input: VrchatAvatarModerationInput,
) -> Result<VrchatResponse, AppError> {
    Ok(state
        .runtime_host()
        .avatars()
        .delete_moderation(input.avatar_id)
        .await?)
}
