#![allow(non_snake_case)]

use std::collections::HashMap;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tauri::State;

use crate::api::app::vrchat_api_types::{HttpApiExecuteResponse, HttpApiRequestInput};
use crate::error::AppError;
use crate::state::AppState;

use super::types::{BackendFriendCancelRequestInput, BackendFriendUserInput};

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

async fn execute_friend_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let diagnostics = state.backend_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::vrchat_api::app__vrchat_friend_execute(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status));
        }
        Err(error) => diagnostics.record_command(command, "error", error.to_string()),
    }
    result
}

#[tauri::command]
pub async fn app__backend_friend_delete(
    state: State<'_, AppState>,
    input: BackendFriendUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(input.user_id, "BackendFriendDelete requires userId.")?;
    execute_friend_api(
        state,
        "app__backend_friend_delete",
        format!("Deleting friend {user_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            format!("auth/user/friends/{}", encode_path_segment(&user_id)),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_friend_request_send(
    state: State<'_, AppState>,
    input: BackendFriendUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(input.user_id, "BackendFriendRequestSend requires userId.")?;
    execute_friend_api(
        state,
        "app__backend_friend_request_send",
        format!("Sending friend request to {user_id}."),
        api_input(
            input.endpoint,
            "POST",
            format!("user/{}/friendRequest", encode_path_segment(&user_id)),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_friend_request_cancel(
    state: State<'_, AppState>,
    input: BackendFriendCancelRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(input.user_id, "BackendFriendRequestCancel requires userId.")?;
    let notification_id = normalize_text(input.notification_id);
    let body = if notification_id.is_empty() {
        None
    } else {
        Some(json!({ "notificationId": notification_id }))
    };
    execute_friend_api(
        state,
        "app__backend_friend_request_cancel",
        format!("Cancelling friend request for {user_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            format!("user/{}/friendRequest", encode_path_segment(&user_id)),
            body,
        ),
    )
    .await
}
