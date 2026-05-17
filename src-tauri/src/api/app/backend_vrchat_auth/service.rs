#![allow(non_snake_case)]

use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Map, Value};
use tauri::State;

use crate::api::app::vrchat_api_types::{HttpApiExecuteResponse, HttpApiRequestInput};
use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    BackendAuthCodeInput, BackendAuthEndpointInput, BackendAuthFileAnalysisInput,
    BackendAuthLoginBasicInput, BackendAuthLoginSuccessRecordInput, BackendAuthLogoutRecordInput,
    BackendAuthSavedCredentialDeleteInput,
};

const MAX_AUTO_LOGIN_DELAY_SECONDS: i64 = 10;
const SAVED_CREDENTIALS_KEY: &str = "savedCredentials";
const LAST_USER_LOGGED_IN_KEY: &str = "lastUserLoggedIn";
const LEGACY_PRIMARY_PASSWORD_KEY: &str = "enablePrimaryPassword";
const AUTO_LOGIN_DELAY_ENABLED_KEY: &str = "autoLoginDelayEnabled";
const AUTO_LOGIN_DELAY_SECONDS_KEY: &str = "autoLoginDelaySeconds";

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

fn config_error(error: impl ToString) -> AppError {
    AppError::Custom(error.to_string())
}

fn value_as_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.trim().to_string(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn value_as_raw_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.to_string(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn object_field_string(value: &Value, key: &str) -> String {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .map(|value| value_as_string(Some(value)))
        .unwrap_or_default()
}

fn object_field_raw_string(value: &Value, key: &str) -> String {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .map(|value| value_as_raw_string(Some(value)))
        .unwrap_or_default()
}

fn normalize_login_params_value(raw_login_params: &Value) -> Value {
    json!({
        "username": object_field_raw_string(raw_login_params, "username"),
        "password": object_field_raw_string(raw_login_params, "password"),
        "endpoint": "",
        "websocket": "",
    })
}

fn normalize_login_params_record(record: &Value) -> Value {
    let raw_login_params = record
        .as_object()
        .and_then(|object| {
            object
                .get("loginParams")
                .or_else(|| object.get("loginParmas"))
        })
        .unwrap_or(&Value::Null);
    normalize_login_params_value(raw_login_params)
}

fn normalize_saved_credential_record(key: &str, entry: &Value) -> (bool, Option<(String, Value)>) {
    let Some(record) = entry.as_object() else {
        return (false, None);
    };
    let Some(user) = record.get("user").filter(|value| value.is_object()) else {
        return (false, None);
    };

    let user_id = object_field_string(user, "id");
    let user_id = if user_id.is_empty() {
        key.trim().to_string()
    } else {
        user_id
    };
    if user_id.is_empty() {
        return (false, None);
    }

    let mut normalized = Map::new();
    normalized.insert("user".into(), user.clone());
    normalized.insert("loginParams".into(), normalize_login_params_record(entry));
    if let Some(cookies) = record.get("cookies") {
        let has_cookies = match cookies {
            Value::Null => false,
            Value::String(value) => !value.is_empty(),
            _ => true,
        };
        if has_cookies {
            normalized.insert("cookies".into(), cookies.clone());
        }
    }

    let raw_login_params = record
        .get("loginParams")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let edited = user_id != key
        || record.contains_key("loginParmas")
        || !raw_login_params.contains_key("endpoint")
        || !raw_login_params.contains_key("websocket")
        || !value_as_string(raw_login_params.get("endpoint")).is_empty()
        || !value_as_string(raw_login_params.get("websocket")).is_empty();

    (edited, Some((user_id, Value::Object(normalized))))
}

fn read_saved_credentials_map(state: &State<'_, AppState>) -> Result<Map<String, Value>, AppError> {
    let source = state
        .backend_context
        .config
        .get_json(SAVED_CREDENTIALS_KEY, json!({}))
        .map_err(config_error)?;
    let source_object = source.as_object().cloned().unwrap_or_default();

    let mut normalized = Map::new();
    let mut edited = false;
    for (key, value) in &source_object {
        let (entry_edited, normalized_entry) = normalize_saved_credential_record(key, value);
        match normalized_entry {
            Some((normalized_key, normalized_value)) => {
                normalized.insert(normalized_key, normalized_value);
                edited = edited || entry_edited;
            }
            None => edited = true,
        }
    }

    if edited {
        write_saved_credentials_map(state, &normalized)?;
    }
    Ok(normalized)
}

fn write_saved_credentials_map(
    state: &State<'_, AppState>,
    saved_credentials: &Map<String, Value>,
) -> Result<(), AppError> {
    let value = Value::Object(saved_credentials.clone());
    state
        .backend_context
        .config
        .set_string(SAVED_CREDENTIALS_KEY, &value.to_string())
        .map_err(config_error)
}

fn get_config_string(
    state: &State<'_, AppState>,
    key: &str,
    default_value: &str,
) -> Result<String, AppError> {
    state
        .backend_context
        .config
        .get_string(key, default_value)
        .map_err(config_error)
}

fn get_config_bool(
    state: &State<'_, AppState>,
    key: &str,
    default_value: bool,
) -> Result<bool, AppError> {
    state
        .backend_context
        .config
        .get_bool(key, default_value)
        .map_err(config_error)
}

fn remove_config_value(state: &State<'_, AppState>, key: &str) -> Result<(), AppError> {
    state
        .backend_context
        .config
        .remove(key)
        .map_err(config_error)
}

fn set_config_string(state: &State<'_, AppState>, key: &str, value: &str) -> Result<(), AppError> {
    state
        .backend_context
        .config
        .set_string(key, value)
        .map_err(config_error)
}

fn normalize_auto_login_delay_seconds(value: &str) -> i64 {
    value
        .trim()
        .parse::<i64>()
        .ok()
        .map(|value| value.clamp(0, MAX_AUTO_LOGIN_DELAY_SECONDS))
        .unwrap_or(0)
}

fn login_params_has_credentials(saved_credential: Option<&Value>) -> bool {
    let Some(login_params) = saved_credential
        .and_then(Value::as_object)
        .and_then(|record| record.get("loginParams"))
    else {
        return false;
    };
    !object_field_string(login_params, "username").is_empty()
        && !object_field_string(login_params, "password").is_empty()
}

fn resolve_auto_login_status(
    last_user_logged_in: &str,
    saved_credentials: &Map<String, Value>,
    auto_login_delay_enabled: bool,
    auto_login_delay_seconds: i64,
) -> (&'static str, String) {
    if last_user_logged_in.is_empty() {
        return ("not-configured", "No previous login was recorded.".into());
    }

    let saved_credential = saved_credentials.get(last_user_logged_in);
    if saved_credential.is_none() {
        return (
            "missing-last-user",
            "The last logged-in account is no longer present in saved credentials.".into(),
        );
    }

    if !login_params_has_credentials(saved_credential) {
        return (
            "missing-credentials",
            "The saved account is missing username or password data.".into(),
        );
    }

    if auto_login_delay_enabled && auto_login_delay_seconds > 0 {
        return (
            "available",
            format!(
                "Saved credentials are available. Auto-login delay is {auto_login_delay_seconds} second(s)."
            ),
        );
    }

    (
        "available",
        "Saved credentials are available and auto-login can run immediately.".into(),
    )
}

fn saved_credential_user_id(value: &Value) -> String {
    value
        .as_object()
        .and_then(|record| record.get("user"))
        .map(|user| object_field_string(user, "id"))
        .unwrap_or_default()
}

fn saved_credential_sort_name(value: &Value) -> String {
    value
        .as_object()
        .and_then(|record| record.get("user"))
        .map(|user| {
            let display_name = object_field_string(user, "displayName");
            if display_name.is_empty() {
                object_field_string(user, "username")
            } else {
                display_name
            }
        })
        .unwrap_or_default()
        .to_lowercase()
}

fn saved_credential_display_name(value: Option<&Value>, fallback: &str) -> String {
    value
        .and_then(|record| record.as_object())
        .and_then(|record| record.get("user"))
        .map(|user| {
            [
                object_field_string(user, "displayName"),
                object_field_string(user, "username"),
                object_field_string(user, "id"),
            ]
            .into_iter()
            .find(|value| !value.is_empty())
            .unwrap_or_default()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn sorted_saved_credentials_list(
    saved_credentials: &Map<String, Value>,
    last_user_logged_in: &str,
) -> Vec<Value> {
    let mut values = saved_credentials.values().cloned().collect::<Vec<_>>();
    values.sort_by(|left, right| {
        let left_is_last = !last_user_logged_in.is_empty()
            && saved_credential_user_id(left) == last_user_logged_in;
        let right_is_last = !last_user_logged_in.is_empty()
            && saved_credential_user_id(right) == last_user_logged_in;
        if left_is_last != right_is_last {
            return right_is_last.cmp(&left_is_last);
        }
        saved_credential_sort_name(left).cmp(&saved_credential_sort_name(right))
    });
    values
}

fn build_saved_auth_snapshot(state: &State<'_, AppState>) -> Result<Value, AppError> {
    let mut saved_credentials = read_saved_credentials_map(state)?;
    let mut last_user_logged_in = get_config_string(state, LAST_USER_LOGGED_IN_KEY, "")?;
    let legacy_primary_password_enabled =
        get_config_bool(state, LEGACY_PRIMARY_PASSWORD_KEY, false)?;
    if legacy_primary_password_enabled {
        saved_credentials.clear();
        last_user_logged_in.clear();
        write_saved_credentials_map(state, &saved_credentials)?;
        remove_config_value(state, LEGACY_PRIMARY_PASSWORD_KEY)?;
        remove_config_value(state, LAST_USER_LOGGED_IN_KEY)?;
    }

    let auto_login_delay_enabled = get_config_bool(state, AUTO_LOGIN_DELAY_ENABLED_KEY, false)?;
    let auto_login_delay_seconds = normalize_auto_login_delay_seconds(&get_config_string(
        state,
        AUTO_LOGIN_DELAY_SECONDS_KEY,
        "0",
    )?);
    let (auto_login_status, auto_login_reason) = resolve_auto_login_status(
        &last_user_logged_in,
        &saved_credentials,
        auto_login_delay_enabled,
        auto_login_delay_seconds,
    );
    let auto_login_target = if last_user_logged_in.is_empty() {
        Value::Null
    } else {
        saved_credentials
            .get(&last_user_logged_in)
            .cloned()
            .unwrap_or(Value::Null)
    };
    let cookie_restore_eligible = !last_user_logged_in.is_empty();
    let saved_credential_fallback_available =
        auto_login_status == "available" && !auto_login_target.is_null();
    let auto_login_display_name = saved_credential_display_name(
        saved_credentials.get(&last_user_logged_in),
        if last_user_logged_in.is_empty() {
            "saved account"
        } else {
            &last_user_logged_in
        },
    );
    let auto_login_throttle_key = if let Value::Object(record) = &auto_login_target {
        record
            .get("user")
            .map(|user| object_field_string(user, "id"))
            .unwrap_or_default()
    } else {
        String::new()
    };
    let saved_credentials_list =
        sorted_saved_credentials_list(&saved_credentials, &last_user_logged_in);

    Ok(json!({
        "lastUserLoggedIn": if last_user_logged_in.is_empty() { Value::Null } else { Value::String(last_user_logged_in) },
        "savedCredentialCount": saved_credentials.len(),
        "savedCredentials": saved_credentials,
        "savedCredentialsList": saved_credentials_list,
        "autoLoginTarget": auto_login_target,
        "autoLoginDisplayName": auto_login_display_name,
        "autoLoginThrottleKey": auto_login_throttle_key,
        "cookieRestoreEligible": cookie_restore_eligible,
        "savedCredentialFallbackAvailable": saved_credential_fallback_available,
        "autoLoginDelayEnabled": auto_login_delay_enabled,
        "autoLoginDelaySeconds": auto_login_delay_seconds,
        "autoLoginStatus": auto_login_status,
        "autoLoginReason": auto_login_reason,
    }))
}

#[tauri::command]
pub fn app__backend_auth_saved_snapshot_get(state: State<'_, AppState>) -> Result<Value, AppError> {
    build_saved_auth_snapshot(&state)
}

#[tauri::command]
pub fn app__backend_auth_saved_credential_delete(
    state: State<'_, AppState>,
    input: BackendAuthSavedCredentialDeleteInput,
) -> Result<Value, AppError> {
    let user_id = normalize_text(input.user_id);
    let mut saved_credentials = read_saved_credentials_map(&state)?;
    saved_credentials.remove(&user_id);
    write_saved_credentials_map(&state, &saved_credentials)?;

    let last_user_logged_in = get_config_string(&state, LAST_USER_LOGGED_IN_KEY, "")?;
    if last_user_logged_in == user_id {
        remove_config_value(&state, LAST_USER_LOGGED_IN_KEY)?;
    }

    build_saved_auth_snapshot(&state)
}

#[tauri::command]
pub fn app__backend_auth_login_success_record(
    state: State<'_, AppState>,
    input: BackendAuthLoginSuccessRecordInput,
) -> Result<Value, AppError> {
    let user_id = object_field_string(&input.user, "id");
    if user_id.is_empty() {
        return Err(AppError::Custom(
            "BackendAuthLoginSuccessRecord requires a user id.".into(),
        ));
    }

    let mut saved_credentials = read_saved_credentials_map(&state)?;
    let existing_record = saved_credentials.get(&user_id).cloned();

    if input.save_credentials {
        let login_params = input
            .stored_login_params
            .as_ref()
            .unwrap_or(&input.login_params);
        saved_credentials.insert(
            user_id.clone(),
            json!({
                "user": input.user,
                "loginParams": normalize_login_params_value(login_params),
            }),
        );
    } else if let Some(existing_record) = existing_record {
        let mut record = existing_record.as_object().cloned().unwrap_or_default();
        record.insert("user".into(), input.user);
        let cookies = state.backend_context.web.get_cookies();
        if cookies.is_empty() {
            record.remove("cookies");
        } else {
            record.insert("cookies".into(), Value::String(cookies));
        }
        saved_credentials.insert(user_id.clone(), Value::Object(record));
    }

    write_saved_credentials_map(&state, &saved_credentials)?;
    set_config_string(&state, LAST_USER_LOGGED_IN_KEY, &user_id)?;
    build_saved_auth_snapshot(&state)
}

#[tauri::command]
pub fn app__backend_auth_logout_record(
    state: State<'_, AppState>,
    input: BackendAuthLogoutRecordInput,
) -> Result<Value, AppError> {
    let user = input.user_or_user_id.as_object().cloned();
    let user_id = if let Some(user) = user.as_ref() {
        object_field_string(&Value::Object(user.clone()), "id")
    } else {
        value_as_string(Some(&input.user_or_user_id))
    };
    let clear_last_user_logged_in = input
        .clear_last_user_logged_in
        .unwrap_or(!user_id.is_empty());

    if !user_id.is_empty() {
        let mut saved_credentials = read_saved_credentials_map(&state)?;
        if let Some(existing_record) = saved_credentials.get(&user_id).cloned() {
            let mut record = existing_record.as_object().cloned().unwrap_or_default();
            if let Some(user) = user {
                record.insert("user".into(), Value::Object(user));
            }

            let cookies = input
                .cookies
                .unwrap_or_else(|| Value::String(state.backend_context.web.get_cookies()));
            let has_cookies = match &cookies {
                Value::Null => false,
                Value::String(value) => !value.is_empty(),
                _ => true,
            };
            if has_cookies {
                record.insert("cookies".into(), cookies);
            } else {
                record.remove("cookies");
            }

            saved_credentials.insert(user_id.clone(), Value::Object(record));
            write_saved_credentials_map(&state, &saved_credentials)?;
        }
    }

    if clear_last_user_logged_in {
        remove_config_value(&state, LAST_USER_LOGGED_IN_KEY)?;
    }
    build_saved_auth_snapshot(&state)
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
pub async fn app__backend_auth_cookie_session_restore(
    state: State<'_, AppState>,
    input: BackendAuthEndpointInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let endpoint = input.endpoint;
    execute_auth_api(
        state.clone(),
        "app__backend_auth_cookie_session_restore_config",
        "Preparing VRChat config before cookie session restore.",
        get_input(endpoint.clone(), "config", HashMap::new(), HashMap::new()),
    )
    .await?;
    execute_auth_api(
        state,
        "app__backend_auth_cookie_session_restore",
        "Restoring current VRChat user from cookies.",
        get_input(endpoint, "auth/user", HashMap::new(), HashMap::new()),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_auth_login_basic_start(
    state: State<'_, AppState>,
    input: BackendAuthLoginBasicInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let endpoint = input.endpoint;
    let username = require_text(
        input.username,
        "BackendAuthLoginBasicStart requires username.",
    )?;
    let password = require_text(
        input.password,
        "BackendAuthLoginBasicStart requires password.",
    )?;
    execute_auth_api(
        state.clone(),
        "app__backend_auth_login_basic_start_config",
        "Preparing VRChat config before basic login.",
        get_input(endpoint.clone(), "config", HashMap::new(), HashMap::new()),
    )
    .await?;
    let credentials = format!(
        "{}:{}",
        encode_uri_component(&username),
        encode_uri_component(&password)
    );
    let authorization = format!("Basic {}", B64.encode(credentials.as_bytes()));
    execute_auth_api(
        state,
        "app__backend_auth_login_basic_start",
        format!("Logging in {username}."),
        get_input(
            endpoint,
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
