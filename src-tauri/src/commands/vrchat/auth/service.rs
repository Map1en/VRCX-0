#![allow(non_snake_case)]

use std::sync::Arc;

use serde_json::Value;
use tauri::State;
use vrcx_0_application_core::vrchat_api::auth::{
    config_get_input, current_user_get_input, file_analysis_get_input, session_get_input,
    visits_get_input,
};

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application::{
    AutoLoginOutcome, AutoLoginStartInput, LoginSessionStartBasicInput,
    LoginSessionStartCookieRestoreInput, LoginSessionStartSavedCredentialInput, LoginSessionState,
    LogoutRecordInput,
};
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse};

use super::types::{
    VrchatAuthAutoLoginStartInput, VrchatAuthEndpointInput, VrchatAuthFileAnalysisInput,
    VrchatAuthLogoutRecordInput, VrchatAuthSavedCredentialDeleteInput,
    VrchatAuthSessionRespondInput, VrchatAuthSessionStartInput,
};

async fn execute_auth_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse, AppError> {
    let diagnostics = state.runtime_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::execute::execute_vrchat_auth_api(state, input).await;
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
pub fn app__vrchat_auth_saved_snapshot_get(state: State<'_, AppState>) -> Result<Value, AppError> {
    vrcx_0_application::saved_snapshot(&state.runtime_context.config).map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_session_start(
    state: State<'_, AppState>,
    input: VrchatAuthSessionStartInput,
) -> Result<LoginSessionState, AppError> {
    let diagnostics = state.runtime_context.diagnostics.clone();
    diagnostics.record_command(
        "app__vrchat_auth_session_start",
        "running",
        "Starting a VRChat login session.",
    );
    state.clear_backend_frontend_session();
    let web = Arc::clone(&state.web);
    let db = Arc::clone(&state.db);
    let config = state.runtime_context.config.clone();
    let login_session = state.runtime_context.login_session.clone();
    let result = match input {
        VrchatAuthSessionStartInput::Basic {
            endpoint,
            username,
            password,
            save_credentials,
        } => {
            login_session
                .start_basic(
                    web,
                    db,
                    &config,
                    LoginSessionStartBasicInput {
                        endpoint,
                        username,
                        password,
                        save_credentials,
                    },
                )
                .await
        }
        VrchatAuthSessionStartInput::SavedCredential { endpoint, user_id } => {
            login_session
                .start_saved_credential(
                    web,
                    db,
                    &config,
                    LoginSessionStartSavedCredentialInput { endpoint, user_id },
                )
                .await
        }
        VrchatAuthSessionStartInput::CookieRestore { endpoint } => {
            login_session
                .start_cookie_restore(
                    web,
                    db,
                    &config,
                    LoginSessionStartCookieRestoreInput { endpoint },
                )
                .await
        }
    };
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
    input: VrchatAuthAutoLoginStartInput,
) -> Result<AutoLoginOutcome, AppError> {
    let diagnostics = state.runtime_context.diagnostics.clone();
    diagnostics.record_command(
        "app__vrchat_auth_auto_login_start",
        "running",
        "Starting an automatic VRChat login attempt.",
    );
    let web = Arc::clone(&state.web);
    let db = Arc::clone(&state.db);
    let config = state.runtime_context.config.clone();
    let login_session = state.runtime_context.login_session.clone();
    let result = login_session
        .auto_login_start(
            web,
            db,
            &config,
            AutoLoginStartInput {
                endpoint: input.endpoint,
                user_id: input.user_id,
            },
        )
        .await
        .map_err(|error| {
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
    input: VrchatAuthSessionRespondInput,
) -> Result<LoginSessionState, AppError> {
    let config = state.runtime_context.config.clone();
    let result = state
        .runtime_context
        .login_session
        .respond(input.method, input.code, state.web.as_ref(), &config)
        .await;
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub fn app__vrchat_auth_session_cancel(state: State<'_, AppState>) -> LoginSessionState {
    state.runtime_context.login_session.cancel()
}

#[tauri::command]
#[specta::specta]
pub fn app__vrchat_auth_saved_credential_delete(
    state: State<'_, AppState>,
    input: VrchatAuthSavedCredentialDeleteInput,
) -> Result<Value, AppError> {
    vrcx_0_application::delete_saved_credential(&state.runtime_context.config, input.user_id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__vrchat_auth_logout_record(
    state: State<'_, AppState>,
    input: VrchatAuthLogoutRecordInput,
) -> Result<Value, AppError> {
    vrcx_0_application::record_logout(
        &state.runtime_context.config,
        state.web.as_ref(),
        LogoutRecordInput {
            user_or_user_id: input.user_or_user_id,
            clear_last_user_logged_in: input.clear_last_user_logged_in,
            cookies: input.cookies,
        },
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__vrchat_auth_auto_login_throttle_reset(state: State<'_, AppState>) {
    state
        .runtime_context
        .login_session
        .reset_auto_login_throttle();
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_config_get(
    state: State<'_, AppState>,
    input: VrchatAuthEndpointInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_auth_api(
        state,
        "app__vrchat_auth_config_get",
        "Getting VRChat config.",
        config_get_input(input.endpoint),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_current_user_get(
    state: State<'_, AppState>,
    input: VrchatAuthEndpointInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_auth_api(
        state,
        "app__vrchat_auth_current_user_get",
        "Getting current VRChat user.",
        current_user_get_input(input.endpoint),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_session_get(
    state: State<'_, AppState>,
    input: VrchatAuthEndpointInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_auth_api(
        state,
        "app__vrchat_auth_session_get",
        "Getting VRChat auth session.",
        session_get_input(input.endpoint),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_visits_get(
    state: State<'_, AppState>,
    input: VrchatAuthEndpointInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_auth_api(
        state,
        "app__vrchat_auth_visits_get",
        "Getting online visits.",
        visits_get_input(input.endpoint),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_auth_file_analysis_get(
    state: State<'_, AppState>,
    input: VrchatAuthFileAnalysisInput,
) -> Result<VrchatApiResponse, AppError> {
    let (file_id, request) =
        file_analysis_get_input(input.endpoint, input.file_id, input.version, input.variant)?;
    execute_auth_api(
        state,
        "app__vrchat_auth_file_analysis_get",
        format!("Getting file analysis for {file_id}."),
        request,
    )
    .await
}
