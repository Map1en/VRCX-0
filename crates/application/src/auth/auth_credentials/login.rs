use serde_json::Value;
use vrcx_0_application_core::WebClient;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_vrchat_client::auth::{config_get_input, current_user_get_input, login_basic_input};
use vrcx_0_vrchat_client::http_api::{ApiScope, HttpApiExecuteResponse};

use super::storage::{
    normalize_text, object_field_raw_string, object_field_string, read_saved_credentials_map,
    value_as_string,
};
use super::types::SavedCredentialLoginStartInput;
use crate::{Error, LoginApi, Result};

pub async fn saved_credential_login_start(
    config: &ConfigRepository,
    web: &WebClient,
    api: &dyn LoginApi,
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
    match probe_cookie_session(api, endpoint.clone(), &user_id, false).await? {
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

    match probe_cookie_session(api, endpoint.clone(), &user_id, true).await? {
        CookieSessionProbe::Use(response) => return Ok(response),
        CookieSessionProbe::Fallback => {}
    }

    let config_response = api
        .execute(config_get_input(endpoint.clone()), ApiScope::Vrchat)
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
    api.execute(request, ApiScope::Vrchat).await
}

enum CookieSessionProbe {
    Use(HttpApiExecuteResponse),
    Fallback,
}

async fn probe_cookie_session(
    api: &dyn LoginApi,
    endpoint: String,
    expected_user_id: &str,
    allow_unmatched_two_factor: bool,
) -> Result<CookieSessionProbe> {
    let config_response = api
        .execute(config_get_input(endpoint.clone()), ApiScope::Vrchat)
        .await?;
    if response_allows_saved_credential_fallback(&config_response) {
        return Ok(CookieSessionProbe::Fallback);
    }
    if !(200..=399).contains(&config_response.status) {
        return Ok(CookieSessionProbe::Use(config_response));
    }

    let current_user_response = api
        .execute(current_user_get_input(endpoint), ApiScope::Vrchat)
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

pub(super) fn response_allows_saved_credential_fallback(response: &HttpApiExecuteResponse) -> bool {
    response.status == 401 && response_error_message(response).contains("Missing Credentials")
}

fn response_error_message(response: &HttpApiExecuteResponse) -> String {
    let Ok(json) = serde_json::from_str::<Value>(&response.data) else {
        return String::new();
    };
    value_message_string(&json).unwrap_or_default()
}

pub(super) fn response_requires_two_factor(response: &HttpApiExecuteResponse) -> bool {
    let Ok(json) = serde_json::from_str::<Value>(&response.data) else {
        return false;
    };
    json.get("requiresTwoFactorAuth")
        .and_then(Value::as_array)
        .is_some_and(|methods| !methods.is_empty())
}

pub(super) fn authenticated_response_user_mismatches(
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
