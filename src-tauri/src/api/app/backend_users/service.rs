#![allow(non_snake_case)]

use std::collections::HashMap;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tauri::State;

use crate::api::app::vrchat_api_types::{HttpApiExecuteResponse, HttpApiRequestInput};
use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    BackendCurrentUserBadgeInput, BackendCurrentUserTagsInput, BackendCurrentUserUpdateInput,
    BackendUserInput, BackendUserMutualFriendsInput,
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

fn object_body(value: Option<Value>) -> Value {
    match value {
        Some(value @ Value::Object(_)) => value,
        _ => json!({}),
    }
}

fn get_input(
    endpoint: String,
    path: String,
    query_params: HashMap<String, Value>,
) -> HttpApiRequestInput {
    HttpApiRequestInput {
        endpoint: Some(endpoint),
        method: Some("GET".into()),
        path: Some(path),
        params: Some(query_params.clone()),
        query_params: Some(query_params),
        ..Default::default()
    }
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

async fn execute_user_read_api(
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

async fn execute_current_user_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let diagnostics = state.backend_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::vrchat_api::app__vrchat_auth_execute(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status));
        }
        Err(error) => diagnostics.record_command(command, "error", error.to_string()),
    }
    result
}

#[tauri::command]
pub async fn app__backend_user_get(
    state: State<'_, AppState>,
    input: BackendUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(input.user_id, "BackendUserGet requires userId.")?;
    execute_user_read_api(
        state,
        "app__backend_user_get",
        format!("Getting user {user_id}."),
        get_input(
            input.endpoint,
            format!("users/{}", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_user_mutual_counts_get(
    state: State<'_, AppState>,
    input: BackendUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(input.user_id, "BackendUserMutualCountsGet requires userId.")?;
    execute_user_read_api(
        state,
        "app__backend_user_mutual_counts_get",
        format!("Getting mutual counts for {user_id}."),
        get_input(
            input.endpoint,
            format!("users/{}/mutuals", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_user_groups_get(
    state: State<'_, AppState>,
    input: BackendUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(input.user_id, "BackendUserGroupsGet requires userId.")?;
    execute_user_read_api(
        state,
        "app__backend_user_groups_get",
        format!("Getting groups for user {user_id}."),
        get_input(
            input.endpoint,
            format!("users/{}/groups", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_user_represented_group_get(
    state: State<'_, AppState>,
    input: BackendUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(
        input.user_id,
        "BackendUserRepresentedGroupGet requires userId.",
    )?;
    execute_user_read_api(
        state,
        "app__backend_user_represented_group_get",
        format!("Getting represented group for user {user_id}."),
        get_input(
            input.endpoint,
            format!("users/{}/groups/represented", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_user_mutual_friends_get(
    state: State<'_, AppState>,
    input: BackendUserMutualFriendsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(
        input.user_id,
        "BackendUserMutualFriendsGet requires userId.",
    )?;
    execute_user_read_api(
        state,
        "app__backend_user_mutual_friends_get",
        format!(
            "Getting mutual friends for {user_id} offset {}.",
            input.offset
        ),
        {
            let mut params = HashMap::from([
                ("n".to_string(), json!(input.n)),
                ("offset".to_string(), json!(input.offset)),
            ]);
            if input.include_user_id_param {
                params.insert("userId".to_string(), Value::String(user_id.clone()));
            }
            get_input(
                input.endpoint,
                format!("users/{}/mutuals/friends", encode_path_segment(&user_id)),
                params,
            )
        },
    )
    .await
}

#[tauri::command]
pub async fn app__backend_current_user_update(
    state: State<'_, AppState>,
    input: BackendCurrentUserUpdateInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(input.user_id, "BackendCurrentUserUpdate requires userId.")?;
    execute_current_user_api(
        state,
        "app__backend_current_user_update",
        format!("Updating current user {user_id}."),
        api_input(
            input.endpoint,
            "PUT",
            format!("users/{}", encode_path_segment(&user_id)),
            Some(object_body(input.params)),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_current_user_badge_update(
    state: State<'_, AppState>,
    input: BackendCurrentUserBadgeInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(
        input.user_id,
        "BackendCurrentUserBadgeUpdate requires userId.",
    )?;
    let badge_id = require_text(
        input.badge_id,
        "BackendCurrentUserBadgeUpdate requires badgeId.",
    )?;
    execute_current_user_api(
        state,
        "app__backend_current_user_badge_update",
        format!("Updating badge {badge_id} for current user {user_id}."),
        api_input(
            input.endpoint,
            "PUT",
            format!(
                "users/{}/badges/{}",
                encode_path_segment(&user_id),
                encode_path_segment(&badge_id)
            ),
            Some(json!({
                "userId": user_id,
                "badgeId": badge_id,
                "hidden": input.hidden,
                "showcased": input.showcased,
            })),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_current_user_tags_add(
    state: State<'_, AppState>,
    input: BackendCurrentUserTagsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(input.user_id, "BackendCurrentUserTagsAdd requires userId.")?;
    execute_current_user_api(
        state,
        "app__backend_current_user_tags_add",
        format!("Adding tags to current user {user_id}."),
        api_input(
            input.endpoint,
            "POST",
            format!("users/{}/addTags", encode_path_segment(&user_id)),
            Some(json!({ "tags": input.tags })),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_current_user_tags_remove(
    state: State<'_, AppState>,
    input: BackendCurrentUserTagsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(
        input.user_id,
        "BackendCurrentUserTagsRemove requires userId.",
    )?;
    execute_current_user_api(
        state,
        "app__backend_current_user_tags_remove",
        format!("Removing tags from current user {user_id}."),
        api_input(
            input.endpoint,
            "POST",
            format!("users/{}/removeTags", encode_path_segment(&user_id)),
            Some(json!({ "tags": input.tags })),
        ),
    )
    .await
}
