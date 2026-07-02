#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_harness::{
    LlmEndpointDetectModelsInput, LlmEndpointDto, LlmEndpointUpsertInput, LlmTranslateInput,
};

use crate::error::AppError;
use crate::state::AppState;

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
) -> Result<Vec<String>, AppError> {
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
