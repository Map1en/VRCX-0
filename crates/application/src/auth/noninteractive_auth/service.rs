use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use vrcx_0_application_core::WebClient;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::{normalize_vrchat_api_endpoint, HttpApiExecuteResponse};
use vrcx_0_vrchat_client::realtime::normalize_websocket_domain;

use crate::auth::cookie_session::{probe_cookie_session, CookieProbeResult, CookieProbeStage};
use crate::auth::{LoginApi, WebClientLoginApi};

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
    web: Arc<WebClient>,
    db: Arc<DatabaseService>,
    user_id: String,
    endpoint: String,
    websocket: String,
) -> std::result::Result<CookieSessionProbe, NonInteractiveAuthError> {
    let api = WebClientLoginApi::new(web, db);
    probe_current_user_from_cookie_with_api(&api, user_id, endpoint, websocket).await
}

pub(crate) async fn probe_current_user_from_cookie_with_api(
    api: &dyn LoginApi,
    user_id: String,
    endpoint: String,
    websocket: String,
) -> std::result::Result<CookieSessionProbe, NonInteractiveAuthError> {
    let result = probe_cookie_session(api, &endpoint, &user_id)
        .await
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
    if matches!(result, CookieProbeResult::RequiresTwoFactor(_)) {
        return Ok(CookieSessionProbe::Fallback);
    }
    map_fallback_probe(result, user_id, endpoint, websocket)
}

pub async fn probe_saved_current_user_from_cookie(
    web: Arc<WebClient>,
    db: Arc<DatabaseService>,
    user_id: String,
    endpoint: String,
    websocket: String,
) -> std::result::Result<CookieSessionProbe, NonInteractiveAuthError> {
    let api = WebClientLoginApi::new(web, db);
    probe_saved_current_user_from_cookie_with_api(&api, user_id, endpoint, websocket).await
}

pub(crate) async fn probe_saved_current_user_from_cookie_with_api(
    api: &dyn LoginApi,
    user_id: String,
    endpoint: String,
    websocket: String,
) -> std::result::Result<CookieSessionProbe, NonInteractiveAuthError> {
    let result = probe_cookie_session(api, &endpoint, &user_id)
        .await
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
    if matches!(result, CookieProbeResult::RequiresTwoFactor(_)) {
        return Err(NonInteractiveAuthError::InteractionRequired(
            "Re-authentication in the GUI is required because this account requires 2FA/OTP."
                .into(),
        ));
    }
    map_fallback_probe(result, user_id, endpoint, websocket)
}

fn map_fallback_probe(
    result: CookieProbeResult,
    user_id: String,
    endpoint: String,
    websocket: String,
) -> std::result::Result<CookieSessionProbe, NonInteractiveAuthError> {
    match result {
        CookieProbeResult::Authenticated { user, .. } => Ok(CookieSessionProbe::Authenticated(
            AuthenticatedRuntimeSession::from_user(user, endpoint, websocket),
        )),
        CookieProbeResult::MissingCredentials(_) | CookieProbeResult::UserMismatch => {
            Ok(CookieSessionProbe::Fallback)
        }
        CookieProbeResult::RequiresTwoFactor(_) => unreachable!(),
        CookieProbeResult::Rejected { response, .. } if response.status == 401 => {
            Ok(CookieSessionProbe::Fallback)
        }
        CookieProbeResult::Rejected { stage, response } => {
            rejected_probe_error(user_id, stage, response)
        }
    }
}

pub async fn current_user_from_cookie(
    web: Arc<WebClient>,
    db: Arc<DatabaseService>,
    user_id: String,
    endpoint: String,
    websocket: String,
) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
    let api = WebClientLoginApi::new(web, db);
    current_user_from_cookie_with_api(&api, user_id, endpoint, websocket).await
}

pub(crate) async fn current_user_from_cookie_with_api(
    api: &dyn LoginApi,
    user_id: String,
    endpoint: String,
    websocket: String,
) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
    match probe_cookie_session(api, &endpoint, &user_id)
        .await
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?
    {
        CookieProbeResult::Authenticated { user, .. } => Ok(
            AuthenticatedRuntimeSession::from_user(user, endpoint, websocket),
        ),
        CookieProbeResult::RequiresTwoFactor(_) => {
            Err(NonInteractiveAuthError::InteractionRequired(
                "Re-authentication in the GUI is required because this account requires 2FA/OTP."
                    .into(),
            ))
        }
        CookieProbeResult::MissingCredentials(response) => {
            Err(NonInteractiveAuthError::SessionInvalidated {
                user_id,
                reason: auth_response_error_message(
                    &response,
                    format!("VRChat auth request failed with HTTP {}.", response.status),
                ),
            })
        }
        CookieProbeResult::UserMismatch => Err(NonInteractiveAuthError::SessionInvalidated {
            user_id,
            reason: "The stored browser session belongs to a different account.".into(),
        }),
        CookieProbeResult::Rejected { stage, response } => {
            rejected_probe_error(user_id, stage, response)
        }
    }
}

fn rejected_probe_error<T>(
    user_id: String,
    stage: CookieProbeStage,
    response: HttpApiExecuteResponse,
) -> std::result::Result<T, NonInteractiveAuthError> {
    let request_name = match stage {
        CookieProbeStage::Config => "config",
        CookieProbeStage::CurrentUser => "current-user",
    };
    let reason = auth_response_error_message(
        &response,
        format!(
            "VRChat {request_name} request failed with HTTP {}.",
            response.status
        ),
    );
    if matches!(response.status, 401 | 403) {
        Err(NonInteractiveAuthError::SessionInvalidated { user_id, reason })
    } else {
        Err(NonInteractiveAuthError::Failed(reason))
    }
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
    if response.status != 200 {
        return Err(NonInteractiveAuthError::Failed(
            auth_response_error_message(
                &response,
                format!("VRChat auth request failed with HTTP {}.", response.status),
            ),
        ));
    }
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
        vrcx_0_vrchat_client::http_api::execute_response(status, data.to_string())
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
    fn parse_current_user_response_reads_nested_error_message_objects() {
        let result = parse_current_user_response(response(
            401,
            serde_json::json!({
                "error": { "message": "Missing Credentials" }
            }),
        ));

        assert!(matches!(
            result,
            Err(NonInteractiveAuthError::Failed(message))
                if message == "Missing Credentials"
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

    #[test]
    fn generic_401_cookie_probe_allows_saved_credential_fallback() {
        let result = map_fallback_probe(
            CookieProbeResult::Rejected {
                stage: CookieProbeStage::CurrentUser,
                response: response(401, serde_json::json!({ "error": "Unauthorized" })),
            },
            "usr_1".into(),
            String::new(),
            String::new(),
        );

        assert!(matches!(result, Ok(CookieSessionProbe::Fallback)));
    }
}
