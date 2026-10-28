use serde_json::Value;
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::TwoFactorMethod;

use crate::vrchat_api::{
    classify_vrchat_auth_failure, vrchat_auth_error_message, VrchatAuthFailureKind, VrchatResponse,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VrchatLoginFailureKind {
    InvalidCredentials,
    MissingCredentials,
    SessionInvalidated,
    TwoFactorUnavailable,
    Other,
}

#[derive(Clone, Debug, PartialEq)]
pub enum VrchatLoginStep {
    Authenticated {
        user: Value,
    },
    TwoFactorRequired {
        methods: Vec<TwoFactorMethod>,
        mode: TwoFactorMethod,
    },
    Failed {
        reason: String,
        kind: VrchatLoginFailureKind,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VrchatTwoFactorVerifyOutcome {
    Verified,
    Rejected {
        reason: String,
        kind: VrchatLoginFailureKind,
    },
    Retry {
        error: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CookieProbeStage {
    Config,
    CurrentUser,
}

#[derive(Debug)]
pub enum CookieProbeResult {
    Authenticated {
        response: VrchatResponse,
        user: Value,
    },
    MissingCredentials(VrchatResponse),
    RequiresTwoFactor(VrchatResponse),
    UserMismatch {
        actual_user_id: String,
    },
    Rejected {
        stage: CookieProbeStage,
        response: VrchatResponse,
    },
}

pub fn classify_vrchat_login_failure(response: &VrchatResponse) -> VrchatLoginFailureKind {
    match classify_vrchat_auth_failure(response) {
        VrchatAuthFailureKind::InvalidCredentials => VrchatLoginFailureKind::InvalidCredentials,
        VrchatAuthFailureKind::MissingCredentials => VrchatLoginFailureKind::MissingCredentials,
        VrchatAuthFailureKind::SessionInvalidated => VrchatLoginFailureKind::SessionInvalidated,
        VrchatAuthFailureKind::Other => VrchatLoginFailureKind::Other,
    }
}

pub fn interpret_login_config_response(response: &VrchatResponse) -> Option<VrchatLoginStep> {
    if response.status == 200 {
        return None;
    }
    Some(failed(
        auth_response_error_message(
            response,
            format!(
                "VRChat config request failed with HTTP {}.",
                response.status
            ),
        ),
        classify_vrchat_login_failure(response),
    ))
}

pub fn interpret_login_response(response: &VrchatResponse) -> VrchatLoginStep {
    if response.status != 200 {
        return failed(
            auth_response_error_message(
                response,
                format!("Login failed with HTTP {}", response.status),
            ),
            classify_vrchat_login_failure(response),
        );
    }

    let json = match parse_json(response) {
        Ok(json) => json,
        Err(step) => return step,
    };

    if json.get("requiresTwoFactorAuth").is_some() {
        return two_factor_step(extract_two_factor_methods(&json));
    }

    authenticated_step(json)
}

pub fn unsupported_two_factor_method(method: &TwoFactorMethod) -> VrchatLoginStep {
    failed(
        format!("Unsupported 2FA method: {}", method.as_str()),
        VrchatLoginFailureKind::TwoFactorUnavailable,
    )
}

pub fn interpret_two_factor_verify_response(
    response: &VrchatResponse,
) -> VrchatTwoFactorVerifyOutcome {
    if response.status == 200 {
        return VrchatTwoFactorVerifyOutcome::Verified;
    }
    if matches!(response.status, 401 | 403) {
        return VrchatTwoFactorVerifyOutcome::Rejected {
            reason: auth_response_error_message(
                response,
                format!("2FA verification failed with HTTP {}", response.status),
            ),
            kind: classify_vrchat_login_failure(response),
        };
    }
    VrchatTwoFactorVerifyOutcome::Retry {
        error: format!("2FA verification failed with HTTP {}", response.status),
    }
}

pub fn interpret_two_factor_current_user_response(response: &VrchatResponse) -> VrchatLoginStep {
    if response.status != 200 {
        return failed(
            format!(
                "Failed to fetch user profile after 2FA: HTTP {}",
                response.status
            ),
            classify_vrchat_login_failure(response),
        );
    }

    let json = match parse_json(response) {
        Ok(json) => json,
        Err(step) => return step,
    };

    if json.get("requiresTwoFactorAuth").is_some() {
        let methods = extract_two_factor_methods(&json);
        if !methods.is_empty() {
            return two_factor_step(methods);
        }
    }

    authenticated_step(json)
}

pub fn interpret_cookie_probe_config_response(
    response: VrchatResponse,
) -> Option<CookieProbeResult> {
    if is_missing_credentials(&response) {
        return Some(CookieProbeResult::MissingCredentials(response));
    }
    if response.status != 200 {
        return Some(CookieProbeResult::Rejected {
            stage: CookieProbeStage::Config,
            response,
        });
    }
    None
}

pub fn interpret_cookie_probe_current_user_response(
    response: VrchatResponse,
    expected_user_id: &str,
) -> Result<CookieProbeResult, String> {
    if is_missing_credentials(&response) {
        return Ok(CookieProbeResult::MissingCredentials(response));
    }
    if response.status != 200 {
        return Ok(CookieProbeResult::Rejected {
            stage: CookieProbeStage::CurrentUser,
            response,
        });
    }

    let user = serde_json::from_str::<Value>(&response.data)
        .map_err(|error| format!("parse current user response: {error}"))?;
    if user
        .get("requiresTwoFactorAuth")
        .and_then(Value::as_array)
        .is_some_and(|methods| !methods.is_empty())
    {
        return Ok(CookieProbeResult::RequiresTwoFactor(response));
    }

    let actual_user_id = user.scalar_field("id").unwrap_or_default();
    if actual_user_id.is_empty() {
        return Err("The auth request did not return a current user payload.".into());
    }
    let expected_user_id = expected_user_id.trim();
    if !expected_user_id.is_empty() && actual_user_id != expected_user_id {
        return Ok(CookieProbeResult::UserMismatch { actual_user_id });
    }

    Ok(CookieProbeResult::Authenticated { response, user })
}

fn is_missing_credentials(response: &VrchatResponse) -> bool {
    classify_vrchat_auth_failure(response) == VrchatAuthFailureKind::MissingCredentials
}

pub fn auth_response_error_message(response: &VrchatResponse, fallback: String) -> String {
    vrchat_auth_error_message(response).unwrap_or(fallback)
}

pub fn cookie_probe_rejection_reason(stage: CookieProbeStage, response: &VrchatResponse) -> String {
    let request_name = match stage {
        CookieProbeStage::Config => "config",
        CookieProbeStage::CurrentUser => "current-user",
    };
    auth_response_error_message(
        response,
        format!(
            "VRChat {request_name} request failed with HTTP {}.",
            response.status
        ),
    )
}

fn failed(reason: impl Into<String>, kind: VrchatLoginFailureKind) -> VrchatLoginStep {
    VrchatLoginStep::Failed {
        reason: reason.into(),
        kind,
    }
}

fn parse_json(response: &VrchatResponse) -> Result<Value, VrchatLoginStep> {
    serde_json::from_str(&response.data)
        .map_err(|error| failed(error.to_string(), VrchatLoginFailureKind::Other))
}

fn extract_two_factor_methods(json: &Value) -> Vec<TwoFactorMethod> {
    json.get("requiresTwoFactorAuth")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(TwoFactorMethod::from))
                .collect()
        })
        .unwrap_or_default()
}

fn two_factor_step(mut methods: Vec<TwoFactorMethod>) -> VrchatLoginStep {
    methods.sort_by_key(|method| match method {
        TwoFactorMethod::Totp => 0,
        TwoFactorMethod::EmailOtp => 1,
        TwoFactorMethod::Otp => 2,
        TwoFactorMethod::Unknown(_) => 3,
    });
    let Some(mode) = methods
        .iter()
        .find(|method| !matches!(method, TwoFactorMethod::Unknown(_)))
        .cloned()
    else {
        return failed(
            "2FA is required but no supported method was returned.",
            VrchatLoginFailureKind::TwoFactorUnavailable,
        );
    };
    VrchatLoginStep::TwoFactorRequired { methods, mode }
}

fn authenticated_step(user: Value) -> VrchatLoginStep {
    if user.scalar_field("id").unwrap_or_default().is_empty() {
        return failed(
            "The auth request did not return a valid user payload.",
            VrchatLoginFailureKind::Other,
        );
    }
    VrchatLoginStep::Authenticated { user }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::vrchat_api::vrchat_response;

    fn response(status: i32, data: Value) -> VrchatResponse {
        vrchat_response(status, data.to_string())
    }

    #[test]
    fn login_response_prefers_totp_and_keeps_every_offered_method() {
        let step = interpret_login_response(&response(
            200,
            json!({ "requiresTwoFactorAuth": ["otp", "emailOtp", "totp"] }),
        ));

        assert_eq!(
            step,
            VrchatLoginStep::TwoFactorRequired {
                methods: vec![
                    TwoFactorMethod::Totp,
                    TwoFactorMethod::EmailOtp,
                    TwoFactorMethod::Otp,
                ],
                mode: TwoFactorMethod::Totp,
            }
        );
    }

    #[test]
    fn login_response_without_supported_two_factor_method_is_unavailable() {
        let step = interpret_login_response(&response(
            200,
            json!({ "requiresTwoFactorAuth": ["passkey"] }),
        ));

        assert!(matches!(
            step,
            VrchatLoginStep::Failed {
                kind: VrchatLoginFailureKind::TwoFactorUnavailable,
                ..
            }
        ));
    }

    #[test]
    fn login_response_classifies_invalid_password() {
        let step = interpret_login_response(&response(
            401,
            json!({ "error": { "message": "Invalid Username/Email or Password" } }),
        ));

        assert_eq!(
            step,
            VrchatLoginStep::Failed {
                reason: "Invalid Username/Email or Password".into(),
                kind: VrchatLoginFailureKind::InvalidCredentials,
            }
        );
    }

    #[test]
    fn login_response_rejects_user_payload_without_id() {
        let step = interpret_login_response(&response(200, json!({ "displayName": "x" })));

        assert!(matches!(
            step,
            VrchatLoginStep::Failed {
                kind: VrchatLoginFailureKind::Other,
                ..
            }
        ));
    }

    #[test]
    fn two_factor_verify_only_rejects_on_auth_statuses() {
        assert_eq!(
            interpret_two_factor_verify_response(&response(200, json!({}))),
            VrchatTwoFactorVerifyOutcome::Verified
        );
        assert!(matches!(
            interpret_two_factor_verify_response(&response(401, json!({}))),
            VrchatTwoFactorVerifyOutcome::Rejected { .. }
        ));
        assert_eq!(
            interpret_two_factor_verify_response(&response(400, json!({}))),
            VrchatTwoFactorVerifyOutcome::Retry {
                error: "2FA verification failed with HTTP 400".into()
            }
        );
    }

    #[test]
    fn cookie_probe_reports_a_different_account() {
        let result = interpret_cookie_probe_current_user_response(
            response(200, json!({ "id": "usr_other" })),
            " usr_expected ",
        )
        .unwrap();

        assert!(matches!(
            result,
            CookieProbeResult::UserMismatch { actual_user_id } if actual_user_id == "usr_other"
        ));
    }

    #[test]
    fn cookie_probe_stops_at_config_when_credentials_are_missing() {
        let result = interpret_cookie_probe_config_response(response(
            401,
            json!({ "error": { "message": "Missing Credentials" } }),
        ));

        assert!(matches!(
            result,
            Some(CookieProbeResult::MissingCredentials(_))
        ));
        assert!(interpret_cookie_probe_config_response(response(200, json!({}))).is_none());
    }
}

#[cfg(test)]
mod rejection_reason_tests {
    use serde_json::json;

    use super::*;
    use crate::vrchat_api::vrchat_response;

    #[test]
    fn a_rejected_cookie_probe_names_its_request_unless_vrchat_explains_why() {
        assert_eq!(
            cookie_probe_rejection_reason(
                CookieProbeStage::Config,
                &vrchat_response(500, json!({}).to_string()),
            ),
            "VRChat config request failed with HTTP 500."
        );
        assert_eq!(
            cookie_probe_rejection_reason(
                CookieProbeStage::CurrentUser,
                &vrchat_response(403, json!({ "error": { "message": "Banned" } }).to_string()),
            ),
            "Banned"
        );
    }
}
