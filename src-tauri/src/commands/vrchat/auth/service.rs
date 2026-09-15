#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application::auth::{
    AutoLoginOutcome, AutoLoginStartInput, LoginSessionCancelInput, LoginSessionEnd,
    LoginSessionRespondInput, LoginSessionStartInput, LoginSessionState, SavedAuthSnapshot,
};
use vrcx_0_application_core::vrchat_api::VrchatApiResponse;

use super::types::{VrchatAuthFileAnalysisInput, VrchatAuthSavedCredentialDeleteInput};

#[tauri::command(async)]
#[specta::specta]
pub fn app__vrchat_auth_saved_snapshot_get(
    state: State<'_, AppState>,
) -> Result<SavedAuthSnapshot, AppError> {
    state
        .runtime_host()
        .saved_auth_snapshot()
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_session_start(
    state: State<'_, AppState>,
    input: LoginSessionStartInput,
) -> Result<LoginSessionState, AppError> {
    Ok(state.runtime_host().start_login_session(input).await)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_auto_login_start(
    state: State<'_, AppState>,
    input: AutoLoginStartInput,
) -> Result<AutoLoginOutcome, AppError> {
    state
        .runtime_host()
        .start_auto_login(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_session_respond(
    state: State<'_, AppState>,
    input: LoginSessionRespondInput,
) -> Result<LoginSessionState, AppError> {
    let result = state.runtime_host().respond_login_session(input).await;
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_session_cancel(
    state: State<'_, AppState>,
    input: LoginSessionCancelInput,
) -> Result<LoginSessionState, AppError> {
    Ok(state.runtime_host().cancel_login_session(input).await)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__vrchat_auth_saved_credential_delete(
    state: State<'_, AppState>,
    input: VrchatAuthSavedCredentialDeleteInput,
) -> Result<SavedAuthSnapshot, AppError> {
    state
        .runtime_host()
        .delete_saved_credential(input.user_id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_session_end(
    state: State<'_, AppState>,
    input: LoginSessionEnd,
) -> Result<Option<SavedAuthSnapshot>, AppError> {
    state
        .runtime_host()
        .end_login_session(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_config_get(
    state: State<'_, AppState>,
) -> Result<VrchatApiResponse, AppError> {
    Ok(state.runtime_host().vrchat_config().get().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_config_refresh(
    state: State<'_, AppState>,
) -> Result<VrchatApiResponse, AppError> {
    Ok(state.runtime_host().vrchat_config().refresh().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_current_user_get(
    state: State<'_, AppState>,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .current_user()
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_visits_get(
    state: State<'_, AppState>,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .visits()
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_file_analysis_get(
    state: State<'_, AppState>,
    input: VrchatAuthFileAnalysisInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .file_analysis(input.file_id, input.version, input.variant)
        .await
        .map_err(AppError::from)
}
