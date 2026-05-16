#![allow(non_snake_case)]

use std::collections::HashMap;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tauri::State;

use crate::api::app::vrchat_api_types::{HttpApiExecuteResponse, HttpApiRequestInput};
use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    BackendWorldIdInput, BackendWorldListByUserInput, BackendWorldPersistentDataDeleteInput,
    BackendWorldSaveInput,
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

async fn execute_world_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let diagnostics = state.backend_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::vrchat_api::execute_vrchat_world_api(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status));
        }
        Err(error) => diagnostics.record_command(command, "error", error.to_string()),
    }
    result
}

#[tauri::command]
pub async fn app__backend_world_get(
    state: State<'_, AppState>,
    input: BackendWorldIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let world_id = require_text(input.world_id, "BackendWorldGet requires worldId.")?;
    execute_world_api(
        state,
        "app__backend_world_get",
        format!("Getting world {world_id}."),
        get_input(
            input.endpoint,
            format!("worlds/{}", encode_path_segment(&world_id)),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_world_list_by_user_get(
    state: State<'_, AppState>,
    input: BackendWorldListByUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(input.user_id, "BackendWorldListByUserGet requires userId.")?;
    execute_world_api(
        state,
        "app__backend_world_list_by_user_get",
        format!("Getting worlds for {user_id}."),
        get_input(
            input.endpoint,
            "worlds".into(),
            HashMap::from([
                ("n".to_string(), json!(input.n)),
                ("offset".to_string(), json!(input.offset)),
                ("sort".to_string(), Value::String(input.sort)),
                ("order".to_string(), Value::String(input.order)),
                ("userId".to_string(), Value::String(user_id)),
                (
                    "releaseStatus".to_string(),
                    Value::String(input.release_status),
                ),
            ]),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_world_persistent_data_exists(
    state: State<'_, AppState>,
    input: BackendWorldPersistentDataDeleteInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(
        input.user_id,
        "BackendWorldPersistentDataExists requires userId.",
    )?;
    let world_id = require_text(
        input.world_id,
        "BackendWorldPersistentDataExists requires worldId.",
    )?;
    execute_world_api(
        state,
        "app__backend_world_persistent_data_exists",
        format!("Checking persistent data for user {user_id} in world {world_id}."),
        get_input(
            input.endpoint,
            format!(
                "users/{}/{}/persist/exists",
                encode_path_segment(&user_id),
                encode_path_segment(&world_id)
            ),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_world_save(
    state: State<'_, AppState>,
    input: BackendWorldSaveInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let world_id = require_text(input.world_id, "BackendWorldSave requires worldId.")?;
    execute_world_api(
        state,
        "app__backend_world_save",
        format!("Saving world {world_id}."),
        api_input(
            input.endpoint,
            "PUT",
            format!("worlds/{}", encode_path_segment(&world_id)),
            Some(object_body(input.params)),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_world_delete(
    state: State<'_, AppState>,
    input: BackendWorldIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let world_id = require_text(input.world_id, "BackendWorldDelete requires worldId.")?;
    execute_world_api(
        state,
        "app__backend_world_delete",
        format!("Deleting world {world_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            format!("worlds/{}", encode_path_segment(&world_id)),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_world_publish(
    state: State<'_, AppState>,
    input: BackendWorldIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let world_id = require_text(input.world_id, "BackendWorldPublish requires worldId.")?;
    execute_world_api(
        state,
        "app__backend_world_publish",
        format!("Publishing world {world_id}."),
        api_input(
            input.endpoint,
            "PUT",
            format!("worlds/{}/publish", encode_path_segment(&world_id)),
            Some(json!({ "worldId": world_id })),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_world_unpublish(
    state: State<'_, AppState>,
    input: BackendWorldIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let world_id = require_text(input.world_id, "BackendWorldUnpublish requires worldId.")?;
    execute_world_api(
        state,
        "app__backend_world_unpublish",
        format!("Unpublishing world {world_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            format!("worlds/{}/publish", encode_path_segment(&world_id)),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_world_persistent_data_delete(
    state: State<'_, AppState>,
    input: BackendWorldPersistentDataDeleteInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(
        input.user_id,
        "BackendWorldPersistentDataDelete requires userId.",
    )?;
    let world_id = require_text(
        input.world_id,
        "BackendWorldPersistentDataDelete requires worldId.",
    )?;
    execute_world_api(
        state,
        "app__backend_world_persistent_data_delete",
        format!("Deleting persistent data for user {user_id} in world {world_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            format!(
                "users/{}/{}/persist",
                encode_path_segment(&user_id),
                encode_path_segment(&world_id)
            ),
            None,
        ),
    )
    .await
}
