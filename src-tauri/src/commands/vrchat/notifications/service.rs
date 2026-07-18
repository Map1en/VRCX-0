#![allow(non_snake_case)]

use serde_json::Value;
use tauri::State;
use vrcx_0_application_core::vrchat_api::notifications::{
    boop_send_input, invite_photo_input, invite_response_photo_input, invite_response_send_input,
    invite_send_input, notification_accept_friend_request_input, notification_hide_remote_input,
    notification_mark_seen_input, notification_respond_input, request_invite_photo_input,
    request_invite_send_input,
};

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application as media_upload;
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse};

use super::types::{
    VrchatBoopInput, VrchatInviteResponseInput, VrchatInviteResponsePhotoInput,
    VrchatNotificationHideInput, VrchatNotificationIdInput, VrchatNotificationMarkSeenInput,
    VrchatNotificationPhotoSendInput, VrchatNotificationRespondInput, VrchatNotificationSendInput,
};

fn response_has_error(response: &VrchatApiResponse) -> bool {
    response.status >= 400
        || serde_json::from_str::<Value>(&response.data)
            .ok()
            .and_then(|value| value.as_object().map(|object| object.contains_key("error")))
            .unwrap_or(false)
}

async fn execute_notification_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse, AppError> {
    let diagnostics = state.runtime_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::execute::execute_vrchat_notification_api(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status));
        }
        Err(error) => diagnostics.record_command(command, "error", error.to_string()),
    }
    result
}

async fn execute_media_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse, AppError> {
    let diagnostics = state.runtime_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::execute::execute_vrchat_media_api(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status));
        }
        Err(error) => diagnostics.record_command(command, "error", error.to_string()),
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_notification_mark_seen(
    state: State<'_, AppState>,
    input: VrchatNotificationMarkSeenInput,
) -> Result<VrchatApiResponse, AppError> {
    let version = input.version;
    let (user_id, id, request) =
        notification_mark_seen_input(input.endpoint, input.user_id, input.id, version)?;
    let response = execute_notification_api(
        state.clone(),
        "app__vrchat_notification_mark_seen",
        format!("Marking notification {id} seen."),
        request,
    )
    .await?;

    if version == 2 && !response_has_error(&response) {
        crate::commands::local::notifications::app__notification_v2_mark_seen(state, user_id, id)?;
    }

    Ok(response)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_notification_accept_friend_request(
    state: State<'_, AppState>,
    input: VrchatNotificationIdInput,
) -> Result<VrchatApiResponse, AppError> {
    let (id, request) = notification_accept_friend_request_input(input.endpoint, input.id)?;
    execute_notification_api(
        state,
        "app__vrchat_notification_accept_friend_request",
        format!("Accepting friend request notification {id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_notification_hide_remote(
    state: State<'_, AppState>,
    input: VrchatNotificationHideInput,
) -> Result<VrchatApiResponse, AppError> {
    let (id, request) = notification_hide_remote_input(
        input.endpoint,
        input.id,
        input.version,
        input.type_name,
        input.sender_user_id,
    )?;
    execute_notification_api(
        state,
        "app__vrchat_notification_hide_remote",
        format!("Hiding notification {id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_notification_respond(
    state: State<'_, AppState>,
    input: VrchatNotificationRespondInput,
) -> Result<VrchatApiResponse, AppError> {
    let (id, request) = notification_respond_input(
        input.endpoint,
        input.id,
        input.response_type,
        input.response_data,
    )?;
    execute_notification_api(
        state,
        "app__vrchat_notification_respond",
        format!("Responding to notification {id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_invite_response_send(
    state: State<'_, AppState>,
    input: VrchatInviteResponseInput,
) -> Result<VrchatApiResponse, AppError> {
    let (id, request) = invite_response_send_input(input.endpoint, input.id, input.response_slot)?;
    execute_notification_api(
        state,
        "app__vrchat_invite_response_send",
        format!("Sending invite response for {id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_invite_response_photo_send(
    state: State<'_, AppState>,
    input: VrchatInviteResponsePhotoInput,
) -> Result<VrchatApiResponse, AppError> {
    let (id, request) = invite_response_photo_input(
        input.endpoint,
        input.id,
        input.response_slot,
        input.image_data,
    )?;
    execute_media_api(
        state,
        "app__vrchat_invite_response_photo_send",
        format!("Sending invite response photo for {id}."),
        media_upload::prepare_media_upload_request(request)?,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_invite_send(
    state: State<'_, AppState>,
    input: VrchatNotificationSendInput,
) -> Result<VrchatApiResponse, AppError> {
    let (receiver_user_id, request) =
        invite_send_input(input.endpoint, input.receiver_user_id, input.params)?;
    execute_notification_api(
        state,
        "app__vrchat_invite_send",
        format!("Sending invite to {receiver_user_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_invite_photo_send(
    state: State<'_, AppState>,
    input: VrchatNotificationPhotoSendInput,
) -> Result<VrchatApiResponse, AppError> {
    let (receiver_user_id, request) = invite_photo_input(
        input.endpoint,
        input.receiver_user_id,
        input.params,
        input.image_data,
    )?;
    execute_media_api(
        state,
        "app__vrchat_invite_photo_send",
        format!("Sending invite photo to {receiver_user_id}."),
        media_upload::prepare_media_upload_request(request)?,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_request_invite_send(
    state: State<'_, AppState>,
    input: VrchatNotificationSendInput,
) -> Result<VrchatApiResponse, AppError> {
    let (receiver_user_id, request) =
        request_invite_send_input(input.endpoint, input.receiver_user_id, input.params)?;
    execute_notification_api(
        state,
        "app__vrchat_request_invite_send",
        format!("Sending invite request to {receiver_user_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_request_invite_photo_send(
    state: State<'_, AppState>,
    input: VrchatNotificationPhotoSendInput,
) -> Result<VrchatApiResponse, AppError> {
    let (receiver_user_id, request) = request_invite_photo_input(
        input.endpoint,
        input.receiver_user_id,
        input.params,
        input.image_data,
    )?;
    execute_media_api(
        state,
        "app__vrchat_request_invite_photo_send",
        format!("Sending invite request photo to {receiver_user_id}."),
        media_upload::prepare_media_upload_request(request)?,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_boop_send(
    state: State<'_, AppState>,
    input: VrchatBoopInput,
) -> Result<VrchatApiResponse, AppError> {
    let (user_id, request) = boop_send_input(input.endpoint, input.user_id, input.emoji_id)?;
    execute_notification_api(
        state,
        "app__vrchat_boop_send",
        format!("Sending boop to {user_id}."),
        request,
    )
    .await
}
