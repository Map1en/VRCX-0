#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_core::vrchat_api::auth::{
    config_get_input, current_user_get_input, file_analysis_get_input, visits_get_input,
};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application::{
    AutoLoginOutcome, AutoLoginStartInput, LoginSessionCancelInput, LoginSessionEnd,
    LoginSessionRespondInput, LoginSessionStartInput, LoginSessionState, SavedAuthSnapshot,
};
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse, VrchatScope};

use super::types::{VrchatAuthFileAnalysisInput, VrchatAuthSavedCredentialDeleteInput};

async fn execute_auth_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse, AppError> {
    super::super::execute::execute_vrchat_api(state, command, detail, input, VrchatScope::Vrchat)
        .await
}

#[tauri::command]
#[specta::specta]
pub fn app__vrchat_auth_saved_snapshot_get(
    state: State<'_, AppState>,
) -> Result<SavedAuthSnapshot, AppError> {
    vrcx_0_application::saved_snapshot(&state.runtime_context.config).map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_session_start(
    state: State<'_, AppState>,
    input: LoginSessionStartInput,
) -> Result<LoginSessionState, AppError> {
    let diagnostics = state.runtime_context.diagnostics.clone();
    diagnostics.record_command(
        "app__vrchat_auth_session_start",
        "running",
        "Starting a VRChat login session.",
    );
    let result = state.start_login_session(input).await;
    diagnostics.record_command(
        "app__vrchat_auth_session_start",
        "ok",
        format!("status={result:?}"),
    );
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_auto_login_start(
    state: State<'_, AppState>,
    input: AutoLoginStartInput,
) -> Result<AutoLoginOutcome, AppError> {
    let diagnostics = state.runtime_context.diagnostics.clone();
    diagnostics.record_command(
        "app__vrchat_auth_auto_login_start",
        "running",
        "Starting an automatic VRChat login attempt.",
    );
    let result = state.start_auto_login(input).await.map_err(|error| {
        diagnostics.record_command(
            "app__vrchat_auth_auto_login_start",
            "error",
            error.to_string(),
        );
        AppError::from(error)
    })?;
    diagnostics.record_command(
        "app__vrchat_auth_auto_login_start",
        "ok",
        format!("status={result:?}"),
    );
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_session_respond(
    state: State<'_, AppState>,
    input: LoginSessionRespondInput,
) -> Result<LoginSessionState, AppError> {
    let result = state.respond_login_session(input).await;
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_session_cancel(
    state: State<'_, AppState>,
    input: LoginSessionCancelInput,
) -> Result<LoginSessionState, AppError> {
    Ok(state.cancel_login_session(input).await)
}

#[tauri::command]
#[specta::specta]
pub fn app__vrchat_auth_saved_credential_delete(
    state: State<'_, AppState>,
    input: VrchatAuthSavedCredentialDeleteInput,
) -> Result<SavedAuthSnapshot, AppError> {
    vrcx_0_application::delete_saved_credential(&state.runtime_context.config, input.user_id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_session_end(
    state: State<'_, AppState>,
    input: LoginSessionEnd,
) -> Result<Option<SavedAuthSnapshot>, AppError> {
    state.end_login_session(input).await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_config_get(
    state: State<'_, AppState>,
) -> Result<VrchatApiResponse, AppError> {
    execute_auth_api(
        state,
        "app__vrchat_auth_config_get",
        "Getting VRChat config.",
        config_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_current_user_get(
    state: State<'_, AppState>,
) -> Result<VrchatApiResponse, AppError> {
    execute_auth_api(
        state,
        "app__vrchat_auth_current_user_get",
        "Getting current VRChat user.",
        current_user_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_visits_get(
    state: State<'_, AppState>,
) -> Result<VrchatApiResponse, AppError> {
    execute_auth_api(
        state,
        "app__vrchat_auth_visits_get",
        "Getting online visits.",
        visits_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_file_analysis_get(
    state: State<'_, AppState>,
    input: VrchatAuthFileAnalysisInput,
) -> Result<VrchatApiResponse, AppError> {
    let (file_id, request) = file_analysis_get_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.file_id,
        input.version,
        input.variant,
    )?;
    execute_auth_api(
        state,
        "app__vrchat_auth_file_analysis_get",
        format!("Getting file analysis for {file_id}."),
        request,
    )
    .await
}
