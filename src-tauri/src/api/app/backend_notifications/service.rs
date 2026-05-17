#![allow(non_snake_case)]

use std::collections::HashMap;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tauri::State;

use crate::api::app::vrchat_api_types::{HttpApiExecuteResponse, HttpApiRequestInput};
use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    BackendBoopInput, BackendInviteResponseInput, BackendInviteResponsePhotoInput,
    BackendNotificationHideInput, BackendNotificationIdInput, BackendNotificationMarkSeenInput,
    BackendNotificationRespondInput, BackendNotificationSendInput,
};

fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

fn require_text(value: impl AsRef<str>, message: &str) -> Result<String, AppError> {
    let value = normalize_text(value);
    if value.is_empty() {
        return Err(AppError::Custom(message.into()));
    }
    Ok(value)
}

fn encode_path_segment(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

fn json_headers() -> HashMap<String, String> {
    HashMap::from([(
        "Content-Type".to_string(),
        "application/json;charset=utf-8".to_string(),
    )])
}

fn api_input(
    endpoint: String,
    method: &str,
    path: String,
    body: Option<Value>,
) -> HttpApiRequestInput {
    let has_body = body.is_some();
    HttpApiRequestInput {
        endpoint: Some(endpoint),
        method: Some(method.into()),
        path: Some(path),
        headers: body.as_ref().map(|_| json_headers()),
        body,
        json_body: Some(has_body),
        ..Default::default()
    }
}

fn response_has_error(response: &HttpApiExecuteResponse) -> bool {
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
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let diagnostics = state.backend_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::vrchat_api::execute_vrchat_notification_api(state, input).await;
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
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let diagnostics = state.backend_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::vrchat_api::execute_vrchat_media_api(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status));
        }
        Err(error) => diagnostics.record_command(command, "error", error.to_string()),
    }
    result
}

#[tauri::command]
pub async fn app__backend_notification_mark_seen(
    state: State<'_, AppState>,
    input: BackendNotificationMarkSeenInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(
        input.user_id,
        "BackendNotificationMarkSeen requires userId.",
    )?;
    let id = require_text(input.id, "BackendNotificationMarkSeen requires id.")?;
    let path = if input.version >= 2 {
        format!("notifications/{}/see", encode_path_segment(&id))
    } else {
        format!("auth/user/notifications/{}/see", encode_path_segment(&id))
    };
    let method = if input.version >= 2 { "POST" } else { "PUT" };
    let response = execute_notification_api(
        state.clone(),
        "app__backend_notification_mark_seen",
        format!("Marking notification {id} seen."),
        api_input(input.endpoint, method, path, None),
    )
    .await?;

    if input.version == 2 && !response_has_error(&response) {
        super::super::notifications::app__notification_v2_mark_seen(state, user_id, id)?;
    }

    Ok(response)
}

#[tauri::command]
pub async fn app__backend_notification_accept_friend_request(
    state: State<'_, AppState>,
    input: BackendNotificationIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let id = require_text(
        input.id,
        "BackendNotificationAcceptFriendRequest requires id.",
    )?;
    execute_notification_api(
        state,
        "app__backend_notification_accept_friend_request",
        format!("Accepting friend request notification {id}."),
        api_input(
            input.endpoint,
            "PUT",
            format!(
                "auth/user/notifications/{}/accept",
                encode_path_segment(&id)
            ),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_notification_hide_remote(
    state: State<'_, AppState>,
    input: BackendNotificationHideInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let id = require_text(input.id, "BackendNotificationHideRemote requires id.")?;
    let sender_user_id = normalize_text(input.sender_user_id);
    let (method, path, body) =
        if input.type_name == "ignoredFriendRequest" && !sender_user_id.is_empty() {
            (
                "DELETE",
                format!(
                    "user/{}/friendRequest",
                    encode_path_segment(&sender_user_id)
                ),
                Some(json!({ "notificationId": id })),
            )
        } else if input.version >= 2 {
            (
                "DELETE",
                format!("notifications/{}", encode_path_segment(&id)),
                None,
            )
        } else {
            (
                "PUT",
                format!("auth/user/notifications/{}/hide", encode_path_segment(&id)),
                None,
            )
        };
    execute_notification_api(
        state,
        "app__backend_notification_hide_remote",
        format!("Hiding notification {id}."),
        api_input(input.endpoint, method, path, body),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_notification_respond(
    state: State<'_, AppState>,
    input: BackendNotificationRespondInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let id = require_text(input.id, "BackendNotificationRespond requires id.")?;
    let response_type = require_text(
        input.response_type,
        "BackendNotificationRespond requires responseType.",
    )?;
    execute_notification_api(
        state,
        "app__backend_notification_respond",
        format!("Responding to notification {id}."),
        api_input(
            input.endpoint,
            "POST",
            format!("notifications/{}/respond", encode_path_segment(&id)),
            Some(json!({
                "notificationId": id,
                "responseType": response_type,
                "responseData": input.response_data,
            })),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_invite_response_send(
    state: State<'_, AppState>,
    input: BackendInviteResponseInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let id = require_text(input.id, "BackendInviteResponseSend requires id.")?;
    execute_notification_api(
        state,
        "app__backend_invite_response_send",
        format!("Sending invite response for {id}."),
        api_input(
            input.endpoint,
            "POST",
            format!("invite/{}/response", encode_path_segment(&id)),
            Some(json!({
                "responseSlot": input.response_slot,
                "rsvp": true,
            })),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_invite_response_photo_send(
    state: State<'_, AppState>,
    input: BackendInviteResponsePhotoInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let id = require_text(input.id, "BackendInviteResponsePhotoSend requires id.")?;
    let image_data = require_text(
        input.image_data,
        "BackendInviteResponsePhotoSend requires imageData.",
    )?;
    execute_media_api(
        state,
        "app__backend_invite_response_photo_send",
        format!("Sending invite response photo for {id}."),
        HttpApiRequestInput {
            endpoint: Some(input.endpoint),
            method: Some("POST".into()),
            path: Some(format!(
                "invite/{}/response/photo",
                encode_path_segment(&id)
            )),
            upload_image_legacy: Some(true),
            post_data: Some(
                json!({
                    "responseSlot": input.response_slot,
                    "rsvp": true,
                })
                .to_string(),
            ),
            image_data: Some(image_data),
            ..Default::default()
        },
    )
    .await
}

#[tauri::command]
pub async fn app__backend_invite_send(
    state: State<'_, AppState>,
    input: BackendNotificationSendInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let receiver_user_id = require_text(
        input.receiver_user_id,
        "BackendInviteSend requires receiverUserId.",
    )?;
    execute_notification_api(
        state,
        "app__backend_invite_send",
        format!("Sending invite to {receiver_user_id}."),
        api_input(
            input.endpoint,
            "POST",
            format!("invite/{}", encode_path_segment(&receiver_user_id)),
            Some(input.params),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_request_invite_send(
    state: State<'_, AppState>,
    input: BackendNotificationSendInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let receiver_user_id = require_text(
        input.receiver_user_id,
        "BackendRequestInviteSend requires receiverUserId.",
    )?;
    execute_notification_api(
        state,
        "app__backend_request_invite_send",
        format!("Sending invite request to {receiver_user_id}."),
        api_input(
            input.endpoint,
            "POST",
            format!("requestInvite/{}", encode_path_segment(&receiver_user_id)),
            Some(input.params),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_boop_send(
    state: State<'_, AppState>,
    input: BackendBoopInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(input.user_id, "BackendBoopSend requires userId.")?;
    let emoji_id = normalize_text(input.emoji_id);
    let body = if emoji_id.is_empty() {
        json!({})
    } else {
        json!({ "emojiId": emoji_id })
    };
    execute_notification_api(
        state,
        "app__backend_boop_send",
        format!("Sending boop to {user_id}."),
        api_input(
            input.endpoint,
            "POST",
            format!("users/{}/boop", encode_path_segment(&user_id)),
            Some(body),
        ),
    )
    .await
}
