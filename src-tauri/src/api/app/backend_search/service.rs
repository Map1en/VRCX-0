#![allow(non_snake_case)]

use std::collections::HashMap;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::Value;
use tauri::State;

use crate::api::app::vrchat_api_types::{HttpApiExecuteResponse, HttpApiRequestInput};
use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    BackendSearchParamsInput, BackendSearchShortNameInput, BackendSearchWorldsInput,
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

fn get_input(
    endpoint: String,
    path: impl Into<String>,
    query_params: HashMap<String, Value>,
) -> HttpApiRequestInput {
    HttpApiRequestInput {
        endpoint: Some(endpoint),
        method: Some("GET".into()),
        path: Some(path.into()),
        params: Some(query_params.clone()),
        query_params: Some(query_params),
        ..Default::default()
    }
}

async fn execute_search_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let diagnostics = state.backend_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::vrchat_api::app__vrchat_search_execute(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status));
        }
        Err(error) => diagnostics.record_command(command, "error", error.to_string()),
    }
    result
}

#[tauri::command]
pub async fn app__backend_search_config_get(
    state: State<'_, AppState>,
    input: BackendSearchParamsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_search_api(
        state,
        "app__backend_search_config_get",
        "Searching config.",
        get_input(input.endpoint, "config", input.params),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_search_worlds_get(
    state: State<'_, AppState>,
    input: BackendSearchWorldsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let option = input
        .option
        .map(normalize_text)
        .filter(|value| !value.is_empty());
    let path = match option {
        Some(value) => format!("worlds/{}", encode_path_segment(&value)),
        None => "worlds".into(),
    };
    execute_search_api(
        state,
        "app__backend_search_worlds_get",
        "Searching worlds.",
        get_input(input.endpoint, path, input.params),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_search_users_get(
    state: State<'_, AppState>,
    input: BackendSearchParamsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_search_api(
        state,
        "app__backend_search_users_get",
        "Searching users.",
        get_input(input.endpoint, "users", input.params),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_search_groups_get(
    state: State<'_, AppState>,
    input: BackendSearchParamsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_search_api(
        state,
        "app__backend_search_groups_get",
        "Searching groups.",
        get_input(input.endpoint, "groups", input.params),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_search_groups_strict_get(
    state: State<'_, AppState>,
    input: BackendSearchParamsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_search_api(
        state,
        "app__backend_search_groups_strict_get",
        "Strict searching groups.",
        get_input(input.endpoint, "groups/strictsearch", input.params),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_search_instance_short_name_get(
    state: State<'_, AppState>,
    input: BackendSearchShortNameInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let short_name = require_text(
        input.short_name,
        "BackendSearchInstanceShortNameGet requires shortName.",
    )?;
    execute_search_api(
        state,
        "app__backend_search_instance_short_name_get",
        format!("Resolving instance short name {short_name}."),
        get_input(
            input.endpoint,
            format!("instances/s/{}", encode_path_segment(&short_name)),
            HashMap::new(),
        ),
    )
    .await
}
