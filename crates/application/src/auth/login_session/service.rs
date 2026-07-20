use serde_json::Value;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_vrchat_client::auth::{
    config_get_input, current_user_get_input, email_otp_verify_input, login_basic_input,
    otp_verify_input, totp_verify_input,
};
use vrcx_0_vrchat_client::http_api::{ApiScope, HttpApiExecuteResponse, HttpApiRequestInput};

use crate::auth::auth_credentials::saved_credential_login_start_with_api;
use crate::{
    auth::cookie_session::{probe_cookie_session, CookieProbeResult, CookieProbeStage},
    auth_response_error_message, AuthenticatedRuntimeSession, SavedCredentialLoginStartInput,
    WebClient,
};

use super::types::{LoginApi, LoginFailureKind, LoginSessionState, TwoFactorMethod};

async fn execute_or_fail(
    api: &dyn LoginApi,
    request: HttpApiRequestInput,
) -> std::result::Result<HttpApiExecuteResponse, LoginSessionState> {
    api.execute(request, ApiScope::Vrchat)
        .await
        .map_err(|error| LoginSessionState::failed(error.to_string(), LoginFailureKind::Network))
}

fn parse_json_or_fail(
    response: &HttpApiExecuteResponse,
) -> std::result::Result<Value, Box<LoginSessionState>> {
    serde_json::from_str(&response.data).map_err(|error| {
        Box::new(LoginSessionState::failed(
            error.to_string(),
            LoginFailureKind::Other,
        ))
    })
}

fn sort_two_factor_methods(methods: &mut [TwoFactorMethod]) {
    methods.sort_by_key(|method| match method.as_str() {
        "totp" => 0,
        "emailOtp" => 1,
        "otp" => 2,
        _ => 3,
    });
}

fn classify_status_failure(response: &HttpApiExecuteResponse) -> LoginFailureKind {
    if response.status == 401 {
        let message = auth_response_error_message(response, String::new());
        if message.contains("Invalid Username/Email or Password") {
            return LoginFailureKind::InvalidCredentials;
        }
        if message.contains("Missing Credentials") {
            return LoginFailureKind::MissingCredentials;
        }
        return LoginFailureKind::SessionInvalidated;
    }
    if response.status == 403 {
        return LoginFailureKind::SessionInvalidated;
    }
    LoginFailureKind::Other
}

fn interpret_login_response(
    response: HttpApiExecuteResponse,
    endpoint: String,
) -> LoginSessionState {
    if response.status != 200 {
        let reason = auth_response_error_message(
            &response,
            format!("Login failed with HTTP {}", response.status),
        );
        let kind = classify_status_failure(&response);
        return LoginSessionState::failed(reason, kind);
    }

    let json = match parse_json_or_fail(&response) {
        Ok(json) => json,
        Err(state) => return *state,
    };

    if json.get("requiresTwoFactorAuth").is_some() {
        return challenge_from_methods(extract_two_factor_methods(&json), None);
    }

    authenticated_from_json(json, endpoint)
}

fn build_basic_login_request(
    endpoint: &str,
    username: String,
    password: String,
) -> std::result::Result<HttpApiRequestInput, Box<LoginSessionState>> {
    login_basic_input(
        endpoint.to_string(),
        username,
        password,
        "Username is required.",
        "Password is required.",
    )
    .map(|(_, request)| request)
    .map_err(|error| {
        Box::new(LoginSessionState::failed(
            error.to_string(),
            LoginFailureKind::Other,
        ))
    })
}

async fn execute_basic_login(
    api: &dyn LoginApi,
    endpoint: &str,
    request: HttpApiRequestInput,
) -> LoginSessionState {
    let response = match execute_or_fail(api, request).await {
        Ok(response) => response,
        Err(state) => return state,
    };

    interpret_login_response(response, endpoint.to_string())
}

#[cfg(test)]
pub(super) async fn start_login(
    api: &dyn LoginApi,
    endpoint: &str,
    username: String,
    password: String,
) -> LoginSessionState {
    let request = match build_basic_login_request(endpoint, username, password) {
        Ok(request) => request,
        Err(state) => return *state,
    };

    execute_basic_login(api, endpoint, request).await
}

pub(super) async fn start_gui_basic_login(
    api: &dyn LoginApi,
    endpoint: &str,
    username: String,
    password: String,
) -> LoginSessionState {
    let request = match build_basic_login_request(endpoint, username, password) {
        Ok(request) => request,
        Err(state) => return *state,
    };

    let config_response = match execute_or_fail(api, config_get_input(endpoint.to_string())).await {
        Ok(response) => response,
        Err(state) => return state,
    };
    if config_response.status != 200 {
        let reason = auth_response_error_message(
            &config_response,
            format!(
                "VRChat config request failed with HTTP {}.",
                config_response.status
            ),
        );
        return LoginSessionState::failed(reason, classify_status_failure(&config_response));
    }

    execute_basic_login(api, endpoint, request).await
}

pub(super) async fn start_saved_credential_login(
    api: &dyn LoginApi,
    config: &ConfigRepository,
    web: &WebClient,
    endpoint: String,
    user_id: String,
) -> LoginSessionState {
    let response = saved_credential_login_start_with_api(
        config,
        web,
        api,
        SavedCredentialLoginStartInput {
            user_id,
            endpoint: endpoint.clone(),
        },
    )
    .await;
    let response = match response {
        Ok(response) => response,
        Err(error) => return LoginSessionState::failed(error.to_string(), LoginFailureKind::Other),
    };

    interpret_login_response(response, endpoint)
}

pub(super) async fn start_cookie_restore(
    api: &dyn LoginApi,
    endpoint: &str,
    expected_user_id: &str,
) -> LoginSessionState {
    match probe_cookie_session(api, endpoint, expected_user_id).await {
        Ok(CookieProbeResult::Authenticated { user, .. }) => {
            authenticated_from_json(user, endpoint.to_string())
        }
        Ok(CookieProbeResult::RequiresTwoFactor(_)) => LoginSessionState::failed(
            "The stored browser session still requires interactive verification.",
            LoginFailureKind::TwoFactorUnavailable,
        ),
        Ok(CookieProbeResult::MissingCredentials(response)) => LoginSessionState::failed(
            auth_response_error_message(
                &response,
                format!("VRChat auth request failed with HTTP {}.", response.status),
            ),
            LoginFailureKind::MissingCredentials,
        ),
        Ok(CookieProbeResult::UserMismatch) => LoginSessionState::failed(
            "The stored browser session belongs to a different account.",
            LoginFailureKind::MissingCredentials,
        ),
        Ok(CookieProbeResult::Rejected { stage, response }) => {
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
            LoginSessionState::failed(reason, classify_status_failure(&response))
        }
        Err(error) => LoginSessionState::failed(error.to_string(), LoginFailureKind::Network),
    }
}

pub(super) async fn respond_to_challenge(
    api: &dyn LoginApi,
    endpoint: &str,
    current_methods: Vec<TwoFactorMethod>,
    current_mode: TwoFactorMethod,
    method: TwoFactorMethod,
    code: String,
) -> LoginSessionState {
    let verify_request = match method.as_str() {
        "emailOtp" => email_otp_verify_input(endpoint.to_string(), code),
        "otp" => otp_verify_input(endpoint.to_string(), code),
        _ => totp_verify_input(endpoint.to_string(), code),
    };

    let verify_response = match execute_or_fail(api, verify_request).await {
        Ok(response) => response,
        Err(state) => return state,
    };

    if verify_response.status != 200 {
        if matches!(verify_response.status, 401 | 403) {
            let reason = auth_response_error_message(
                &verify_response,
                format!(
                    "2FA verification failed with HTTP {}",
                    verify_response.status
                ),
            );
            return LoginSessionState::failed(reason, classify_status_failure(&verify_response));
        }
        return LoginSessionState::Challenge {
            attempt_id: String::new(),
            methods: current_methods,
            mode: current_mode,
            error: Some(format!(
                "2FA verification failed with HTTP {}",
                verify_response.status
            )),
        };
    }

    let user_request = current_user_get_input(endpoint.to_string());
    let user_response = match execute_or_fail(api, user_request).await {
        Ok(response) => response,
        Err(state) => return state,
    };

    if user_response.status != 200 {
        let reason = format!(
            "Failed to fetch user profile after 2FA: HTTP {}",
            user_response.status
        );
        return LoginSessionState::failed(reason, classify_status_failure(&user_response));
    }

    let json = match parse_json_or_fail(&user_response) {
        Ok(json) => json,
        Err(state) => return *state,
    };

    if json.get("requiresTwoFactorAuth").is_some() {
        let methods = extract_two_factor_methods(&json);
        if !methods.is_empty() {
            return challenge_from_methods(methods, None);
        }
    }

    authenticated_from_json(json, endpoint.to_string())
}

fn extract_two_factor_methods(json: &Value) -> Vec<TwoFactorMethod> {
    json.get("requiresTwoFactorAuth")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn challenge_from_methods(
    mut methods: Vec<TwoFactorMethod>,
    error: Option<String>,
) -> LoginSessionState {
    if methods.is_empty() {
        return LoginSessionState::failed(
            "2FA is required but no supported method was returned.",
            LoginFailureKind::TwoFactorUnavailable,
        );
    }
    sort_two_factor_methods(&mut methods);
    let mode = methods[0].clone();
    LoginSessionState::Challenge {
        attempt_id: String::new(),
        methods,
        mode,
        error,
    }
}

fn authenticated_from_json(json: Value, endpoint: String) -> LoginSessionState {
    let session = AuthenticatedRuntimeSession::from_user(json, endpoint, String::new());
    if session.user_id.is_empty() {
        return LoginSessionState::failed(
            "The auth request did not return a valid user payload.",
            LoginFailureKind::Other,
        );
    }
    LoginSessionState::Authenticated {
        session,
        snapshot: None,
    }
}
