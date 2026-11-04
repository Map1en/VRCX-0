#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use super::types::{
    VrchatBoopInput, VrchatRequestInvitePhotoSendInput, VrchatRequestInviteSendInput,
};
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_request_invite_send(
    state: State<'_, AppState>,
    input: VrchatRequestInviteSendInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .request_invite(input.receiver_user_id, input.params)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_request_invite_photo_send(
    state: State<'_, AppState>,
    input: VrchatRequestInvitePhotoSendInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .request_invite_photo(input.receiver_user_id, input.params, input.image_data)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_boop_send(
    state: State<'_, AppState>,
    input: VrchatBoopInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .boop(input.user_id, input.emoji_id, input.inventory_item_id)
        .await
        .map_err(AppError::from)
}
