#![allow(non_snake_case)]

use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tauri::State;

use crate::api::app::vrchat_api_types::{HttpApiExecuteResponse, HttpApiRequestInput};
use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    BackendAuthCodeInput, BackendAuthEndpointInput, BackendAuthFileAnalysisInput,
    BackendAuthLoginBasicInput,
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

fn encode_uri_component(value: &str) -> String {
    let mut output = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => output.push(char::from(*byte)),
            _ => output.push_str(&format!("%{byte:02X}")),
        }
    }
    output
}

fn json_headers() -> HashMap<String, String> {
    HashMap::from([(
        "Content-Type".to_string(),
        "application/json;charset=utf-8".to_string(),
    )])
}

fn get_input(
    endpoint: String,
    path: impl Into<String>,
    headers: HashMap<String, String>,
    query_params: HashMap<String, Value>,
) -> HttpApiRequestInput {
    HttpApiRequestInput {
        endpoint: Some(endpoint),
        method: Some("GET".into()),
        path: Some(path.into()),
        headers: (!headers.is_empty()).then_some(headers),
        params: Some(query_params.clone()),
        query_params: Some(query_params),
        ..Default::default()
    }
}

fn api_input(
    endpoint: String,
    method: &str,
    path: impl Into<String>,
    body: Value,
) -> HttpApiRequestInput {
    HttpApiRequestInput {
        endpoint: Some(endpoint),
        method: Some(method.into()),
        path: Some(path.into()),
        headers: Some(json_headers()),
        body: Some(body),
        json_body: Some(true),
        ..Default::default()
    }
}

async fn execute_auth_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let diagnostics = state.backend_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::vrchat_api::execute_vrchat_auth_api(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status));
        }
        Err(error) => diagnostics.record_command(command, "error", error.to_string()),
    }
    result
}

#[tauri::command]
pub async fn app__backend_auth_config_get(
    state: State<'_, AppState>,
    input: BackendAuthEndpointInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_auth_api(
        state,
        "app__backend_auth_config_get",
        "Getting VRChat config.",
        get_input(input.endpoint, "config", HashMap::new(), HashMap::new()),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_auth_current_user_get(
    state: State<'_, AppState>,
    input: BackendAuthEndpointInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_auth_api(
        state,
        "app__backend_auth_current_user_get",
        "Getting current VRChat user.",
        get_input(input.endpoint, "auth/user", HashMap::new(), HashMap::new()),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_auth_session_get(
    state: State<'_, AppState>,
    input: BackendAuthEndpointInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_auth_api(
        state,
        "app__backend_auth_session_get",
        "Getting VRChat auth session.",
        get_input(input.endpoint, "auth", HashMap::new(), HashMap::new()),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_auth_login_basic(
    state: State<'_, AppState>,
    input: BackendAuthLoginBasicInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let username = require_text(input.username, "BackendAuthLoginBasic requires username.")?;
    let password = require_text(input.password, "BackendAuthLoginBasic requires password.")?;
    let credentials = format!(
        "{}:{}",
        encode_uri_component(&username),
        encode_uri_component(&password)
    );
    let authorization = format!("Basic {}", B64.encode(credentials.as_bytes()));
    execute_auth_api(
        state,
        "app__backend_auth_login_basic",
        format!("Logging in {username}."),
        get_input(
            input.endpoint,
            "auth/user",
            HashMap::from([("Authorization".to_string(), authorization)]),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_auth_totp_verify(
    state: State<'_, AppState>,
    input: BackendAuthCodeInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_auth_api(
        state,
        "app__backend_auth_totp_verify",
        "Verifying VRChat TOTP.",
        api_input(
            input.endpoint,
            "POST",
            "auth/twofactorauth/totp/verify",
            json!({ "code": normalize_text(input.code) }),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_auth_otp_verify(
    state: State<'_, AppState>,
    input: BackendAuthCodeInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let normalized_code = normalize_text(input.code).replace(char::is_whitespace, "");
    let formatted_code = if normalized_code.len() > 4 && !normalized_code.contains('-') {
        format!("{}-{}", &normalized_code[..4], &normalized_code[4..])
    } else {
        normalized_code
    };
    execute_auth_api(
        state,
        "app__backend_auth_otp_verify",
        "Verifying VRChat OTP.",
        api_input(
            input.endpoint,
            "POST",
            "auth/twofactorauth/otp/verify",
            json!({ "code": formatted_code }),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_auth_email_otp_verify(
    state: State<'_, AppState>,
    input: BackendAuthCodeInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_auth_api(
        state,
        "app__backend_auth_email_otp_verify",
        "Verifying VRChat email OTP.",
        api_input(
            input.endpoint,
            "POST",
            "auth/twofactorauth/emailotp/verify",
            json!({ "code": normalize_text(input.code) }),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_auth_visits_get(
    state: State<'_, AppState>,
    input: BackendAuthEndpointInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_auth_api(
        state,
        "app__backend_auth_visits_get",
        "Getting online visits.",
        get_input(input.endpoint, "visits", HashMap::new(), HashMap::new()),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_auth_file_analysis_get(
    state: State<'_, AppState>,
    input: BackendAuthFileAnalysisInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let file_id = require_text(input.file_id, "BackendAuthFileAnalysisGet requires fileId.")?;
    let variant = require_text(
        input.variant,
        "BackendAuthFileAnalysisGet requires variant.",
    )?;
    execute_auth_api(
        state,
        "app__backend_auth_file_analysis_get",
        format!("Getting file analysis for {file_id}."),
        get_input(
            input.endpoint,
            format!(
                "analysis/{}/{}/{}",
                encode_path_segment(&file_id),
                input.version,
                encode_path_segment(&variant)
            ),
            HashMap::new(),
            HashMap::new(),
        ),
    )
    .await
}
