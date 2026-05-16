#![allow(non_snake_case)]

use std::collections::HashMap;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tauri::State;

use crate::api::app::vrchat_api_types::{HttpApiExecuteResponse, HttpApiRequestInput};
use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    BackendInstanceCloseInput, BackendInstanceCreateInput, BackendInstanceIdentityInput,
    BackendInstanceSelfInviteInput, BackendInstanceShortNameInput,
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

fn api_input(endpoint: String, method: &str, path: String, body: Value) -> HttpApiRequestInput {
    HttpApiRequestInput {
        endpoint: Some(endpoint),
        method: Some(method.into()),
        path: Some(path),
        headers: Some(json_headers()),
        body: Some(body),
        json_body: Some(true),
        skip_empty_query_string: Some(true),
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
        skip_empty_query_string: Some(true),
        ..Default::default()
    }
}

async fn execute_instance_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let diagnostics = state.backend_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::vrchat_api::app__vrchat_instance_execute(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status));
        }
        Err(error) => diagnostics.record_command(command, "error", error.to_string()),
    }
    result
}

#[tauri::command]
pub async fn app__backend_instance_get(
    state: State<'_, AppState>,
    input: BackendInstanceIdentityInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let world_id = require_text(input.world_id, "BackendInstanceGet requires worldId.")?;
    let instance_id = require_text(input.instance_id, "BackendInstanceGet requires instanceId.")?;
    execute_instance_api(
        state,
        "app__backend_instance_get",
        format!("Getting instance {world_id}:{instance_id}."),
        get_input(
            input.endpoint,
            format!(
                "instances/{}:{}",
                encode_path_segment(&world_id),
                encode_path_segment(&instance_id)
            ),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_instance_short_name_get(
    state: State<'_, AppState>,
    input: BackendInstanceShortNameInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let world_id = require_text(
        input.world_id,
        "BackendInstanceShortNameGet requires worldId.",
    )?;
    let instance_id = require_text(
        input.instance_id,
        "BackendInstanceShortNameGet requires instanceId.",
    )?;
    let mut params = HashMap::new();
    if !input.short_name.is_empty() {
        params.insert("shortName".to_string(), Value::String(input.short_name));
    }
    execute_instance_api(
        state,
        "app__backend_instance_short_name_get",
        format!("Getting short name for instance {world_id}:{instance_id}."),
        get_input(
            input.endpoint,
            format!(
                "instances/{}:{}/shortName",
                encode_path_segment(&world_id),
                encode_path_segment(&instance_id)
            ),
            params,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_instance_create(
    state: State<'_, AppState>,
    input: BackendInstanceCreateInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_instance_api(
        state,
        "app__backend_instance_create",
        "Creating instance.",
        api_input(
            input.endpoint,
            "POST",
            "instances".into(),
            object_body(input.params),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_instance_self_invite(
    state: State<'_, AppState>,
    input: BackendInstanceSelfInviteInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let world_id = require_text(
        input.world_id,
        "BackendInstanceSelfInvite requires worldId.",
    )?;
    let instance_id = require_text(
        input.instance_id,
        "BackendInstanceSelfInvite requires instanceId.",
    )?;
    let short_name = input.short_name;
    let body = if short_name.is_empty() {
        json!({})
    } else {
        json!({ "shortName": short_name })
    };
    execute_instance_api(
        state,
        "app__backend_instance_self_invite",
        format!("Sending self invite for {world_id}:{instance_id}."),
        api_input(
            input.endpoint,
            "POST",
            format!(
                "invite/myself/to/{}:{}",
                encode_path_segment(&world_id),
                encode_path_segment(&instance_id)
            ),
            body,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_instance_close(
    state: State<'_, AppState>,
    input: BackendInstanceCloseInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let location = require_text(input.location, "BackendInstanceClose requires location.")?;
    execute_instance_api(
        state,
        "app__backend_instance_close",
        format!("Closing instance {location}."),
        api_input(
            input.endpoint,
            "DELETE",
            format!("instances/{location}"),
            json!({ "hardClose": input.hard_close }),
        ),
    )
    .await
}
