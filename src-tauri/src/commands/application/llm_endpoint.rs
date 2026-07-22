#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_harness::{
    LlmEndpointDetectModelsInput, LlmEndpointDetectModelsResult, LlmEndpointDto,
    LlmEndpointUpsertInput, LlmTranslateInput,
};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__llm_endpoint_follow_custom_proxy(
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    state
        .assistant()
        .await?
        .follow_custom_proxy()
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__llm_endpoint_set_follow_custom_proxy(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<bool, AppError> {
    state
        .assistant()
        .await?
        .set_follow_custom_proxy(enabled)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__llm_endpoint_list(
    state: State<'_, AppState>,
) -> Result<Vec<LlmEndpointDto>, AppError> {
    state
        .assistant()
        .await?
        .endpoint_list()
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__llm_endpoint_upsert(
    state: State<'_, AppState>,
    input: LlmEndpointUpsertInput,
) -> Result<LlmEndpointDto, AppError> {
    state
        .assistant()
        .await?
        .endpoint_upsert(input)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__llm_endpoint_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    state
        .assistant()
        .await?
        .endpoint_delete(&id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__llm_endpoint_detect_models(
    state: State<'_, AppState>,
    input: LlmEndpointDetectModelsInput,
) -> Result<LlmEndpointDetectModelsResult, AppError> {
    state
        .assistant()
        .await?
        .endpoint_detect_models(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__llm_translate(
    state: State<'_, AppState>,
    input: LlmTranslateInput,
) -> Result<String, AppError> {
    state
        .assistant()
        .await?
        .translate(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_reasoning_effort(
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    state
        .assistant()
        .await?
        .assistant_reasoning_effort()
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_set_reasoning_effort(
    state: State<'_, AppState>,
    effort: String,
) -> Result<String, AppError> {
    state
        .assistant()
        .await?
        .set_assistant_reasoning_effort(&effort)
        .map_err(AppError::from)
}
