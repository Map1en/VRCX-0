use serde::Serialize;
use serde_json::Value;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::auth::{config_get_input, current_user_get_input};
use vrcx_0_vrchat_client::http_api::{
    normalize_vrchat_api_endpoint, ApiScope, HttpApiExecuteResponse,
};
use vrcx_0_vrchat_client::realtime::normalize_websocket_domain;

use crate::WebClient;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedRuntimeSession {
    pub user_id: String,
    pub display_name: String,
    pub endpoint: String,
    pub websocket: String,
    pub current_user: Value,
}

impl AuthenticatedRuntimeSession {
    pub fn from_user(user: Value, endpoint: String, websocket: String) -> Self {
        let user_id = string_field(&user, "id").unwrap_or_default();
        let display_name = string_field(&user, "displayName")
            .or_else(|| string_field(&user, "username"))
            .unwrap_or_else(|| user_id.clone());
        Self {
            user_id,
            display_name,
            endpoint: normalize_vrchat_api_endpoint(Some(&endpoint)),
            websocket: normalize_websocket_domain(&websocket),
            current_user: user,
        }
    }
}

#[derive(Debug)]
pub enum NonInteractiveAuthError {
    InteractionRequired(String),
    SessionInvalidated { user_id: String, reason: String },
    Failed(String),
}

pub enum CookieSessionProbe {
    Authenticated(AuthenticatedRuntimeSession),
    Fallback,
}

pub async fn probe_current_user_from_cookie(
    web: &WebClient,
    db: &DatabaseService,
    user_id: String,
    endpoint: String,
    websocket: String,
    allow_unmatched_two_factor: bool,
) -> std::result::Result<CookieSessionProbe, NonInteractiveAuthError> {
    let config_response = web
        .execute_api(config_get_input(endpoint.clone()), ApiScope::Vrchat, db)
        .await
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
    if response_allows_saved_credential_fallback(&config_response) {
        return Ok(CookieSessionProbe::Fallback);
    }
    if config_response.status == 403 {
        return Err(NonInteractiveAuthError::SessionInvalidated {
            user_id: user_id.clone(),
            reason: auth_response_error_message(
                &config_response,
                format!(
                    "VRChat config request failed with HTTP {}.",
                    config_response.status
                ),
            ),
        });
    }
    if !(200..=399).contains(&config_response.status) {
        return Err(NonInteractiveAuthError::Failed(
            auth_response_error_message(
                &config_response,
                format!(
                    "VRChat config request failed with HTTP {}.",
                    config_response.status
                ),
            ),
        ));
    }

    let response = web
        .execute_api(
            current_user_get_input(endpoint.clone()),
            ApiScope::Vrchat,
            db,
        )
        .await
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
    if response_allows_saved_credential_fallback(&response) {
        return Ok(CookieSessionProbe::Fallback);
    }
    if !allow_unmatched_two_factor && response_requires_two_factor(&response) {
        return Ok(CookieSessionProbe::Fallback);
    }
    if response.status == 403 {
        return Err(NonInteractiveAuthError::SessionInvalidated {
            user_id,
            reason: auth_response_error_message(
                &response,
                format!(
                    "VRChat current-user request failed with HTTP {}.",
                    response.status
                ),
            ),
        });
    }
    let user = parse_current_user_response(response)?;
    let response_user_id = string_field(&user, "id").unwrap_or_default();
    if !user_id.trim().is_empty() && response_user_id != user_id.trim() {
        return Ok(CookieSessionProbe::Fallback);
    }
    Ok(CookieSessionProbe::Authenticated(
        AuthenticatedRuntimeSession::from_user(user, endpoint, websocket),
    ))
}

pub async fn current_user_from_cookie(
    web: &WebClient,
    db: &DatabaseService,
    user_id: String,
    endpoint: String,
    websocket: String,
) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
    let config_response = web
        .execute_api(config_get_input(endpoint.clone()), ApiScope::Vrchat, db)
        .await
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
    if matches!(config_response.status, 401 | 403) {
        return Err(NonInteractiveAuthError::SessionInvalidated {
            user_id: user_id.clone(),
            reason: auth_response_error_message(
                &config_response,
                format!(
                    "VRChat config request failed with HTTP {}.",
                    config_response.status
                ),
            ),
        });
    }

    let response = web
        .execute_api(
            current_user_get_input(endpoint.clone()),
            ApiScope::Vrchat,
            db,
        )
        .await
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
    if matches!(response.status, 401 | 403) {
        return Err(NonInteractiveAuthError::SessionInvalidated {
            user_id,
            reason: auth_response_error_message(
                &response,
                format!(
                    "VRChat current-user request failed with HTTP {}.",
                    response.status
                ),
            ),
        });
    }
    let user = parse_current_user_response(response)?;
    Ok(AuthenticatedRuntimeSession::from_user(
        user, endpoint, websocket,
    ))
}

fn response_allows_saved_credential_fallback(response: &HttpApiExecuteResponse) -> bool {
    response.status == 401
        && auth_response_error_message(response, String::new()).contains("Missing Credentials")
}

fn response_requires_two_factor(response: &HttpApiExecuteResponse) -> bool {
    let Ok(json) = serde_json::from_str::<Value>(&response.data) else {
        return false;
    };
    json.get("requiresTwoFactorAuth")
        .and_then(Value::as_array)
        .is_some_and(|methods| !methods.is_empty())
}

pub fn auth_response_error_message(response: &HttpApiExecuteResponse, fallback: String) -> String {
    let Ok(json) = serde_json::from_str::<Value>(&response.data) else {
        return fallback;
    };
    json.as_str()
        .map(ToOwned::to_owned)
        .or_else(|| string_field(&json, "message"))
        .or_else(|| {
            json.get("error").and_then(|error| {
                if let Some(message) = string_field(error, "message") {
                    Some(message)
                } else {
                    error.as_str().map(ToOwned::to_owned)
                }
            })
        })
        .unwrap_or(fallback)
}

pub fn parse_current_user_response(
    response: HttpApiExecuteResponse,
) -> std::result::Result<Value, NonInteractiveAuthError> {
    let json = serde_json::from_str::<Value>(&response.data)
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
    if json
        .get("requiresTwoFactorAuth")
        .and_then(Value::as_array)
        .is_some_and(|methods| !methods.is_empty())
    {
        return Err(NonInteractiveAuthError::InteractionRequired(
            "Re-authentication in the GUI is required because this account requires 2FA/OTP."
                .into(),
        ));
    }
    if !(200..=399).contains(&response.status) {
        let message = string_field(&json, "message")
            .or_else(|| {
                json.get("error")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .unwrap_or_else(|| {
                format!("VRChat auth request failed with HTTP {}.", response.status)
            });
        return Err(NonInteractiveAuthError::Failed(message));
    }
    if string_field(&json, "id").unwrap_or_default().is_empty() {
        return Err(NonInteractiveAuthError::Failed(
            "The auth request did not return a current user payload.".into(),
        ));
    }
    Ok(json)
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(|value| match value {
            Value::String(value) => Some(value.trim().to_string()),
            Value::Number(value) => Some(value.to_string()),
            Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(status: i32, data: serde_json::Value) -> HttpApiExecuteResponse {
        HttpApiExecuteResponse {
            status,
            data: data.to_string(),
            raw: data,
        }
    }

    #[test]
    fn parse_current_user_response_accepts_valid_user() {
        let json = parse_current_user_response(response(
            200,
            serde_json::json!({
                "id": "usr_123",
                "displayName": "Example"
            }),
        ))
        .unwrap();

        assert_eq!(string_field(&json, "id").as_deref(), Some("usr_123"));
    }

    #[test]
    fn parse_current_user_response_rejects_two_factor_payload() {
        let result = parse_current_user_response(response(
            200,
            serde_json::json!({
                "requiresTwoFactorAuth": ["totp"]
            }),
        ));

        assert!(matches!(
            result,
            Err(NonInteractiveAuthError::InteractionRequired(_))
        ));
    }

    #[test]
    fn parse_current_user_response_uses_error_message() {
        let result = parse_current_user_response(response(
            403,
            serde_json::json!({
                "message": "Forbidden"
            }),
        ));

        assert!(matches!(
            result,
            Err(NonInteractiveAuthError::Failed(message)) if message == "Forbidden"
        ));
    }

    #[test]
    fn parse_current_user_response_fails_a_401_with_a_top_level_message() {
        let result = parse_current_user_response(response(
            401,
            serde_json::json!({ "message": "Missing Credentials" }),
        ));

        assert!(matches!(
            result,
            Err(NonInteractiveAuthError::Failed(message)) if message == "Missing Credentials"
        ));
    }

    #[test]
    fn parse_current_user_response_ignores_nested_error_message_objects() {
        let result = parse_current_user_response(response(
            401,
            serde_json::json!({
                "error": { "message": "Missing Credentials" }
            }),
        ));

        assert!(matches!(
            result,
            Err(NonInteractiveAuthError::Failed(message))
                if message == "VRChat auth request failed with HTTP 401."
        ));
    }

    #[test]
    fn parse_current_user_response_falls_back_to_a_generic_message_when_none_is_provided() {
        let result = parse_current_user_response(response(500, serde_json::json!({})));

        assert!(matches!(
            result,
            Err(NonInteractiveAuthError::Failed(message))
                if message == "VRChat auth request failed with HTTP 500."
        ));
    }

    #[test]
    fn auth_response_error_message_reads_nested_error() {
        let message = auth_response_error_message(
            &response(
                401,
                serde_json::json!({
                    "error": {
                        "message": "Missing Credentials"
                    }
                }),
            ),
            "fallback".into(),
        );

        assert_eq!(message, "Missing Credentials");
    }
}
