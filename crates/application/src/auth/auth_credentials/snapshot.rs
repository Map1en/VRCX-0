use serde_json::{json, Map, Value};
use vrcx_0_persistence::config::ConfigRepository;

use super::storage::{
    get_config_bool, get_config_string, object_field_raw_string, object_field_string,
    read_saved_credentials_map, remove_config_value, write_saved_credentials_map,
    LAST_USER_LOGGED_IN_KEY,
};
use crate::Result;

const MAX_AUTO_LOGIN_DELAY_SECONDS: i64 = 10;
const LEGACY_PRIMARY_PASSWORD_KEY: &str = "enablePrimaryPassword";
const AUTO_LOGIN_DELAY_ENABLED_KEY: &str = "autoLoginDelayEnabled";
const AUTO_LOGIN_DELAY_SECONDS_KEY: &str = "autoLoginDelaySeconds";

pub fn saved_snapshot(config: &ConfigRepository) -> Result<Value> {
    build_saved_auth_snapshot(config)
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

pub(super) fn build_saved_auth_snapshot(config: &ConfigRepository) -> Result<Value> {
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
