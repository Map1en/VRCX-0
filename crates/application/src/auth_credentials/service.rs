use serde_json::{json, Map, Value};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::auth::{config_get_input, current_user_get_input, login_basic_input};
use vrcx_0_vrchat_client::http_api::{ApiScope, HttpApiExecuteResponse};

use super::types::{LoginSuccessRecordInput, LogoutRecordInput, SavedCredentialLoginStartInput};
use crate::web_client::WebClient;
use crate::{Error, Result};

const MAX_AUTO_LOGIN_DELAY_SECONDS: i64 = 10;
const SAVED_CREDENTIALS_KEY: &str = "savedCredentials";
const LAST_USER_LOGGED_IN_KEY: &str = "lastUserLoggedIn";
const LEGACY_PRIMARY_PASSWORD_KEY: &str = "enablePrimaryPassword";
const AUTO_LOGIN_DELAY_ENABLED_KEY: &str = "autoLoginDelayEnabled";
const AUTO_LOGIN_DELAY_SECONDS_KEY: &str = "autoLoginDelaySeconds";

pub fn saved_snapshot(config: &ConfigRepository) -> Result<Value> {
    build_saved_auth_snapshot(config)
}

pub fn delete_saved_credential(config: &ConfigRepository, user_id: String) -> Result<Value> {
    let user_id = normalize_text(user_id);
    let mut saved_credentials = read_saved_credentials_map(config)?;
    saved_credentials.remove(&user_id);
    write_saved_credentials_map(config, &saved_credentials)?;

    let last_user_logged_in = get_config_string(config, LAST_USER_LOGGED_IN_KEY, "")?;
    if last_user_logged_in == user_id {
        remove_config_value(config, LAST_USER_LOGGED_IN_KEY)?;
    }

    build_saved_auth_snapshot(config)
}

pub fn record_login_success(
    config: &ConfigRepository,
    web: &WebClient,
    input: LoginSuccessRecordInput,
) -> Result<Value> {
    let user_id = object_field_string(&input.user, "id");
    if user_id.is_empty() {
        return Err(Error::Custom(
            "VrchatAuthLoginSuccessRecord requires a user id.".into(),
        ));
    }

    let mut saved_credentials = read_saved_credentials_map(config)?;
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
        let cookies = web.get_cookies();
        if cookies.is_empty() {
            record.remove("cookies");
        } else {
            record.insert("cookies".into(), Value::String(cookies));
        }
        saved_credentials.insert(user_id.clone(), Value::Object(record));
    }

    write_saved_credentials_map(config, &saved_credentials)?;
    set_config_string(config, LAST_USER_LOGGED_IN_KEY, &user_id)?;
    build_saved_auth_snapshot(config)
}

pub fn record_logout(
    config: &ConfigRepository,
    web: &WebClient,
    input: LogoutRecordInput,
) -> Result<Value> {
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
        let mut saved_credentials = read_saved_credentials_map(config)?;
        if let Some(existing_record) = saved_credentials.get(&user_id).cloned() {
            let mut record = existing_record.as_object().cloned().unwrap_or_default();
            if let Some(user) = user {
                record.insert("user".into(), Value::Object(user));
            }

            let cookies = match input.cookies {
                Some(Value::Null) | None => Value::String(web.get_cookies()),
                Some(cookies) => cookies,
            };
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
            write_saved_credentials_map(config, &saved_credentials)?;
        }
    }

    if clear_last_user_logged_in {
        remove_config_value(config, LAST_USER_LOGGED_IN_KEY)?;
    }
    build_saved_auth_snapshot(config)
}

pub async fn saved_credential_login_start(
    config: &ConfigRepository,
    web: &WebClient,
    db: &DatabaseService,
    input: SavedCredentialLoginStartInput,
) -> Result<HttpApiExecuteResponse> {
    let user_id = normalize_text(input.user_id);
    if user_id.is_empty() {
        return Err(Error::Custom(
            "VrchatAuthSavedCredentialLoginStart requires a user id.".into(),
        ));
    }

    let saved_credentials = read_saved_credentials_map(config)?;
    let Some(saved_credential) = saved_credentials.get(&user_id) else {
        return Err(Error::Custom(
            "Saved credentials were not found for the requested account.".into(),
        ));
    };

    let login_params = saved_credential
        .as_object()
        .and_then(|record| record.get("loginParams"))
        .unwrap_or(&Value::Null);
    let username = object_field_raw_string(login_params, "username");
    let password = object_field_raw_string(login_params, "password");
    if username.trim().is_empty() || password.is_empty() {
        return Err(Error::Custom(
            "The saved account is missing username or password data.".into(),
        ));
    }

    let endpoint = normalize_text(input.endpoint);
    match probe_cookie_session(web, db, endpoint.clone(), &user_id, false).await? {
        CookieSessionProbe::Use(response) => return Ok(response),
        CookieSessionProbe::Fallback => {}
    }

    web.clear_cookies();
    if let Some(cookie) = saved_credential
        .as_object()
        .and_then(|record| record.get("cookies"))
        .and_then(Value::as_str)
        .filter(|cookie| !cookie.is_empty())
    {
        if let Err(error) = web.set_cookies(cookie) {
            tracing::warn!(
                error = %error,
                user_id = %user_id,
                "failed to restore saved cookies before saved credential login; continuing with password login"
            );
        }
    }

    match probe_cookie_session(web, db, endpoint.clone(), &user_id, true).await? {
        CookieSessionProbe::Use(response) => return Ok(response),
        CookieSessionProbe::Fallback => {}
    }

    let config_response = web
        .execute_api(config_get_input(endpoint.clone()), ApiScope::Vrchat, db)
        .await?;
    if config_response.status == 403 {
        return Ok(config_response);
    }
    let (_, request) = login_basic_input(
        endpoint,
        username,
        password,
        "Saved credential login requires username.",
        "Saved credential login requires password.",
    )?;
    web.execute_api(request, ApiScope::Vrchat, db).await
}

enum CookieSessionProbe {
    Use(HttpApiExecuteResponse),
    Fallback,
}

async fn probe_cookie_session(
    web: &WebClient,
    db: &DatabaseService,
    endpoint: String,
    expected_user_id: &str,
    allow_unmatched_two_factor: bool,
) -> Result<CookieSessionProbe> {
    let config_response = web
        .execute_api(config_get_input(endpoint.clone()), ApiScope::Vrchat, db)
        .await?;
    if response_allows_saved_credential_fallback(&config_response) {
        return Ok(CookieSessionProbe::Fallback);
    }
    if !(200..=399).contains(&config_response.status) {
        return Ok(CookieSessionProbe::Use(config_response));
    }

    let current_user_response = web
        .execute_api(current_user_get_input(endpoint), ApiScope::Vrchat, db)
        .await?;
    if response_allows_saved_credential_fallback(&current_user_response) {
        return Ok(CookieSessionProbe::Fallback);
    }
    if !allow_unmatched_two_factor && response_requires_two_factor(&current_user_response) {
        return Ok(CookieSessionProbe::Fallback);
    }
    if authenticated_response_user_mismatches(&current_user_response, expected_user_id) {
        return Ok(CookieSessionProbe::Fallback);
    }
    Ok(CookieSessionProbe::Use(current_user_response))
}

fn response_allows_saved_credential_fallback(response: &HttpApiExecuteResponse) -> bool {
    response.status == 401 && response_error_message(response).contains("Missing Credentials")
}

fn response_error_message(response: &HttpApiExecuteResponse) -> String {
    let Ok(json) = serde_json::from_str::<Value>(&response.data) else {
        return String::new();
    };
    value_message_string(&json).unwrap_or_default()
}

fn response_requires_two_factor(response: &HttpApiExecuteResponse) -> bool {
    let Ok(json) = serde_json::from_str::<Value>(&response.data) else {
        return false;
    };
    json.get("requiresTwoFactorAuth")
        .and_then(Value::as_array)
        .is_some_and(|methods| !methods.is_empty())
}

fn authenticated_response_user_mismatches(
    response: &HttpApiExecuteResponse,
    expected_user_id: &str,
) -> bool {
    let expected_user_id = expected_user_id.trim();
    if expected_user_id.is_empty() || !(200..=399).contains(&response.status) {
        return false;
    }
    let Ok(json) = serde_json::from_str::<Value>(&response.data) else {
        return false;
    };
    if json
        .get("requiresTwoFactorAuth")
        .and_then(Value::as_array)
        .is_some_and(|methods| !methods.is_empty())
    {
        return false;
    }
    let response_user_id = object_field_string(&json, "id");
    !response_user_id.is_empty() && response_user_id != expected_user_id
}

fn value_message_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.trim().to_string()),
        Value::Object(_) => object_field_optional_string(value, "message").or_else(|| {
            value.get("error").and_then(|error| {
                value_message_string(error)
                    .or_else(|| object_field_optional_string(error, "message"))
            })
        }),
        _ => None,
    }
}

fn object_field_optional_string(value: &Value, key: &str) -> Option<String> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .map(|value| value_as_string(Some(value)))
        .filter(|value| !value.is_empty())
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

fn read_saved_credentials_map(config: &ConfigRepository) -> Result<Map<String, Value>> {
    let source = config.get_json(SAVED_CREDENTIALS_KEY, json!({}))?;
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
        write_saved_credentials_map(config, &normalized)?;
    }
    Ok(normalized)
}

fn write_saved_credentials_map(
    config: &ConfigRepository,
    saved_credentials: &Map<String, Value>,
) -> Result<()> {
    let value = Value::Object(saved_credentials.clone());
    config.set_string(SAVED_CREDENTIALS_KEY, &value.to_string())?;
    Ok(())
}

fn get_config_string(config: &ConfigRepository, key: &str, default_value: &str) -> Result<String> {
    Ok(config.get_string(key, default_value)?)
}

fn get_config_bool(config: &ConfigRepository, key: &str, default_value: bool) -> Result<bool> {
    Ok(config.get_bool(key, default_value)?)
}

fn remove_config_value(config: &ConfigRepository, key: &str) -> Result<()> {
    Ok(config.remove(key)?)
}

fn set_config_string(config: &ConfigRepository, key: &str, value: &str) -> Result<()> {
    Ok(config.set_string(key, value)?)
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

fn login_params_username(saved_credential: &Value) -> String {
    saved_credential
        .as_object()
        .and_then(|record| record.get("loginParams"))
        .map(|login_params| object_field_raw_string(login_params, "username"))
        .unwrap_or_default()
}

fn saved_credential_has_cookies(saved_credential: &Value) -> bool {
    saved_credential
        .as_object()
        .and_then(|record| record.get("cookies"))
        .map(|cookies| match cookies {
            Value::Null => false,
            Value::String(value) => !value.is_empty(),
            _ => true,
        })
        .unwrap_or(false)
}

fn redacted_saved_credential(value: &Value) -> Value {
    let has_login_credentials = login_params_has_credentials(Some(value));
    let has_cookies = saved_credential_has_cookies(value);
    let mut redacted = Map::new();
    if let Some(user) = value
        .as_object()
        .and_then(|record| record.get("user"))
        .filter(|user| user.is_object())
    {
        redacted.insert("user".into(), redact_snapshot_secrets(user));
    }
    redacted.insert(
        "loginParams".into(),
        json!({
            "username": login_params_username(value),
            "endpoint": "",
            "websocket": "",
        }),
    );
    redacted.insert(
        "hasLoginCredentials".into(),
        Value::Bool(has_login_credentials),
    );
    redacted.insert("hasCookies".into(), Value::Bool(has_cookies));
    Value::Object(redacted)
}

fn redact_snapshot_secrets(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .filter_map(|(key, value)| {
                    if is_snapshot_secret_key(key) {
                        None
                    } else {
                        Some((key.clone(), redact_snapshot_secrets(value)))
                    }
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(redact_snapshot_secrets).collect()),
        _ => value.clone(),
    }
}

fn is_snapshot_secret_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|ch| *ch != '_' && *ch != '-')
        .flat_map(char::to_lowercase)
        .collect();
    matches!(
        normalized.as_str(),
        "password" | "cookies" | "cookie" | "cookieb64"
    )
}

fn redacted_saved_credentials_map(saved_credentials: &Map<String, Value>) -> Map<String, Value> {
    saved_credentials
        .iter()
        .map(|(key, value)| (key.clone(), redacted_saved_credential(value)))
        .collect()
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

fn sorted_redacted_saved_credentials_list(
    saved_credentials: &Map<String, Value>,
    last_user_logged_in: &str,
) -> Vec<Value> {
    sorted_saved_credentials_list(saved_credentials, last_user_logged_in)
        .into_iter()
        .map(|value| redacted_saved_credential(&value))
        .collect()
}

fn build_saved_auth_snapshot(config: &ConfigRepository) -> Result<Value> {
    let mut saved_credentials = read_saved_credentials_map(config)?;
    let mut last_user_logged_in = get_config_string(config, LAST_USER_LOGGED_IN_KEY, "")?;
    let legacy_primary_password_enabled =
        get_config_bool(config, LEGACY_PRIMARY_PASSWORD_KEY, false)?;
    if legacy_primary_password_enabled {
        saved_credentials.clear();
        last_user_logged_in.clear();
        write_saved_credentials_map(config, &saved_credentials)?;
        remove_config_value(config, LEGACY_PRIMARY_PASSWORD_KEY)?;
        remove_config_value(config, LAST_USER_LOGGED_IN_KEY)?;
    }

    let auto_login_delay_enabled = get_config_bool(config, AUTO_LOGIN_DELAY_ENABLED_KEY, false)?;
    let auto_login_delay_seconds = normalize_auto_login_delay_seconds(&get_config_string(
        config,
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
        sorted_redacted_saved_credentials_list(&saved_credentials, &last_user_logged_in);
    let redacted_saved_credentials = redacted_saved_credentials_map(&saved_credentials);
    let redacted_auto_login_target = if auto_login_target.is_null() {
        Value::Null
    } else {
        redacted_saved_credential(&auto_login_target)
    };

    Ok(json!({
        "lastUserLoggedIn": if last_user_logged_in.is_empty() { Value::Null } else { Value::String(last_user_logged_in) },
        "savedCredentialCount": saved_credentials.len(),
        "savedCredentials": redacted_saved_credentials,
        "savedCredentialsList": saved_credentials_list,
        "autoLoginTarget": redacted_auto_login_target,
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

fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use serde_json::json;
    use vrcx_0_persistence::config::ConfigRepository;
    use vrcx_0_persistence::DatabaseService;

    use super::{saved_snapshot, LAST_USER_LOGGED_IN_KEY, SAVED_CREDENTIALS_KEY};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn contains_secret_key(value: &serde_json::Value) -> bool {
        match value {
            serde_json::Value::Object(object) => object.iter().any(|(key, value)| {
                matches!(key.as_str(), "password" | "cookies") || contains_secret_key(value)
            }),
            serde_json::Value::Array(values) => values.iter().any(contains_secret_key),
            _ => false,
        }
    }

    #[test]
    fn saved_snapshot_redacts_passwords_and_cookies() -> crate::Result<()> {
        let dir = TestDir::new("auth-snapshot-redacted");
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        let config = ConfigRepository::new(db);
        config.set_string(
            SAVED_CREDENTIALS_KEY,
            &json!({
                "usr_1": {
                    "user": {
                        "id": "usr_1",
                        "displayName": "Example",
                        "username": "example",
                        "password": "nested-secret",
                        "profile": {
                            "cookies": "nested-cookie"
                        }
                    },
                    "loginParams": {
                        "username": "login@example.com",
                        "password": "secret"
                    },
                    "cookies": "raw-cookie-b64"
                }
            })
            .to_string(),
        )?;
        config.set_string(LAST_USER_LOGGED_IN_KEY, "usr_1")?;

        let snapshot = saved_snapshot(&config)?;
        assert!(!contains_secret_key(&snapshot));
        assert_eq!(
            snapshot["savedCredentials"]["usr_1"]["loginParams"]["username"],
            "login@example.com"
        );
        assert_eq!(
            snapshot["savedCredentials"]["usr_1"]["hasLoginCredentials"],
            true
        );
        assert_eq!(snapshot["savedCredentials"]["usr_1"]["hasCookies"], true);
        assert_eq!(snapshot["savedCredentialFallbackAvailable"], true);
        Ok(())
    }
}
