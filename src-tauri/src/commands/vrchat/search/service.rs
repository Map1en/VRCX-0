#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_core::vrchat_api::search::{
    search_config_get_input, search_groups_get_input, search_groups_strict_get_input,
    search_instance_short_name_get_input, search_users_get_input, search_worlds_get_input,
};

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse};

use super::types::{VrchatSearchParamsInput, VrchatSearchShortNameInput, VrchatSearchWorldsInput};

async fn execute_search_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse, AppError> {
    let diagnostics = state.runtime_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::execute::execute_vrchat_search_api(state, input).await;
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
pub async fn app__vrchat_search_config_get(
    state: State<'_, AppState>,
    input: VrchatSearchParamsInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_search_api(
        state,
        "app__vrchat_search_config_get",
        "Searching config.",
        search_config_get_input(input.endpoint, input.params),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_search_worlds_get(
    state: State<'_, AppState>,
    input: VrchatSearchWorldsInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_search_api(
        state,
        "app__vrchat_search_worlds_get",
        "Searching worlds.",
        search_worlds_get_input(input.endpoint, input.params, input.option),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_search_users_get(
    state: State<'_, AppState>,
    input: VrchatSearchParamsInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_search_api(
        state,
        "app__vrchat_search_users_get",
        "Searching users.",
        search_users_get_input(input.endpoint, input.params),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_search_groups_get(
    state: State<'_, AppState>,
    input: VrchatSearchParamsInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_search_api(
        state,
        "app__vrchat_search_groups_get",
        "Searching groups.",
        search_groups_get_input(input.endpoint, input.params),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_search_groups_strict_get(
    state: State<'_, AppState>,
    input: VrchatSearchParamsInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_search_api(
        state,
        "app__vrchat_search_groups_strict_get",
        "Strict searching groups.",
        search_groups_strict_get_input(input.endpoint, input.params),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_search_instance_short_name_get(
    state: State<'_, AppState>,
    input: VrchatSearchShortNameInput,
) -> Result<VrchatApiResponse, AppError> {
    let (short_name, request) =
        search_instance_short_name_get_input(input.endpoint, input.short_name)?;
    execute_search_api(
        state,
        "app__vrchat_search_instance_short_name_get",
        format!("Resolving instance short name {short_name}."),
        request,
    )
    .await
}
