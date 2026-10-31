use serde::Serialize;
use serde_json::Value;
use vrcx_0_application_core::vrchat_api::VrchatApiResponse as HttpApiExecuteResponse;
use vrcx_0_contracts::vrchat_login::{
    auth_response_error_message, cookie_probe_rejection_reason, CookieProbeResult, CookieProbeStage,
};
use vrcx_0_core::json::{JsonExt, RawJson};
use vrcx_0_core::vrchat_endpoints::{
    normalize_vrchat_api_endpoint, normalize_vrchat_websocket_endpoint,
};

use crate::auth::cookie_session::probe_cookie_session;
use crate::auth::LoginApi;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedRuntimeSession {
    pub user_id: String,
    pub display_name: String,
    pub endpoint: String,
    pub websocket: String,
    pub current_user: RawJson,
}

impl AuthenticatedRuntimeSession {
    pub fn from_user(user: Value, endpoint: String, websocket: String) -> Self {
        let user_id = user.scalar_field("id").unwrap_or_default();
        let display_name = user
            .scalar_field("displayName")
            .or_else(|| user.scalar_field("username"))
            .unwrap_or_else(|| user_id.clone());
        Self {
            user_id,
            display_name,
            endpoint: normalize_vrchat_api_endpoint(Some(&endpoint)),
            websocket: normalize_vrchat_websocket_endpoint(&websocket),
            current_user: RawJson::from(user),
        }
    }
}

#[derive(Debug)]
pub enum NonInteractiveAuthError {
    InteractionRequired(String),
    SessionInvalidated {
        user_id: String,
        reason: String,
        status_code: Option<i32>,
    },
    Failed(String),
}

pub enum CookieSessionProbe {
    Authenticated(AuthenticatedRuntimeSession),
    Fallback,
}

pub async fn probe_current_user_from_cookie(
    api: &dyn LoginApi,
    user_id: String,
    endpoint: String,
    websocket: String,
) -> std::result::Result<CookieSessionProbe, NonInteractiveAuthError> {
    probe_current_user_from_cookie_with_api(api, user_id, endpoint, websocket).await
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
    map_fallback_probe(result, user_id, endpoint, websocket)
}

pub async fn probe_saved_current_user_from_cookie(
    api: &dyn LoginApi,
    user_id: String,
    endpoint: String,
    websocket: String,
) -> std::result::Result<CookieSessionProbe, NonInteractiveAuthError> {
    probe_saved_current_user_from_cookie_with_api(api, user_id, endpoint, websocket).await
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
        CookieProbeResult::MissingCredentials(_)
        | CookieProbeResult::UserMismatch { .. }
        | CookieProbeResult::RequiresTwoFactor(_) => Ok(CookieSessionProbe::Fallback),
        CookieProbeResult::Rejected { response, .. } if response.status == 401 => {
            Ok(CookieSessionProbe::Fallback)
        }
        CookieProbeResult::Rejected { stage, response } => {
            rejected_probe_error(user_id, stage, response)
        }
    }
}

pub async fn current_user_from_cookie(
    api: &dyn LoginApi,
    user_id: String,
    endpoint: String,
    websocket: String,
) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
    current_user_from_cookie_with_api(api, user_id, endpoint, websocket).await
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
                status_code: Some(response.status),
                reason: auth_response_error_message(
                    &response,
                    format!("VRChat auth request failed with HTTP {}.", response.status),
                ),
            })
        }
        CookieProbeResult::UserMismatch { .. } => {
            Err(NonInteractiveAuthError::SessionInvalidated {
                user_id,
                reason: "The stored browser session belongs to a different account.".into(),
                status_code: None,
            })
        }
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
    let reason = cookie_probe_rejection_reason(stage, &response);
    if matches!(response.status, 401 | 403) {
        Err(NonInteractiveAuthError::SessionInvalidated {
            user_id,
            reason,
            status_code: Some(response.status),
        })
    } else {
        Err(NonInteractiveAuthError::Failed(reason))
    }
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
    if json.scalar_field("id").unwrap_or_default().is_empty() {
        return Err(NonInteractiveAuthError::Failed(
            "The auth request did not return a current user payload.".into(),
        ));
    }
    Ok(json)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(status: i32, data: serde_json::Value) -> HttpApiExecuteResponse {
        vrcx_0_contracts::vrchat_api::vrchat_response(status, data.to_string())
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

        assert_eq!(json.scalar_field("id").as_deref(), Some("usr_123"));
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
    fn parse_current_user_response_uses_top_level_error_message() {
        for (status, message) in [(403, "Forbidden"), (401, "Missing Credentials")] {
            let result = parse_current_user_response(response(
                status,
                serde_json::json!({ "message": message }),
            ));

            assert!(matches!(
                result,
                Err(NonInteractiveAuthError::Failed(actual)) if actual == message
            ));
        }
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
