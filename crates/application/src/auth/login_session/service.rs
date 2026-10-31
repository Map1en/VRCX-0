use crate::auth::AuthCredentialStore;
use serde_json::Value;
use vrcx_0_application_core::vrchat_api::VrchatApiResponse as HttpApiExecuteResponse;
use vrcx_0_contracts::vrchat_device_login::{
    interpret_device_code_response, VrchatDeviceAuthorization,
};
use vrcx_0_contracts::vrchat_login::{
    auth_response_error_message, classify_vrchat_login_failure, cookie_probe_rejection_reason,
    interpret_login_config_response, interpret_login_response,
    interpret_two_factor_current_user_response, interpret_two_factor_verify_response,
    unsupported_two_factor_method, CookieProbeResult, VrchatLoginStep,
    VrchatTwoFactorVerifyOutcome,
};

use crate::auth::auth_credentials::saved_credential_login_start_with_api;
use crate::auth::{
    cookie_session::probe_cookie_session, AuthenticatedRuntimeSession,
    SavedCredentialLoginStartInput,
};

use super::types::{
    AuthSessionCookies, LoginApi, LoginFailureKind, LoginRemoteOperation, LoginSessionState,
    TwoFactorMethod,
};

async fn execute_or_fail(
    api: &dyn LoginApi,
    operation: LoginRemoteOperation,
) -> std::result::Result<HttpApiExecuteResponse, Box<LoginSessionState>> {
    api.execute(operation).await.map_err(|error| {
        Box::new(LoginSessionState::failed(
            error.to_string(),
            LoginFailureKind::Network,
        ))
    })
}

fn session_state(step: VrchatLoginStep, endpoint: String) -> LoginSessionState {
    match step {
        VrchatLoginStep::Authenticated { user } => authenticated_state(user, endpoint),
        VrchatLoginStep::TwoFactorRequired { methods, mode } => LoginSessionState::Challenge {
            attempt_id: String::new(),
            methods,
            mode,
            error: None,
        },
        VrchatLoginStep::Failed { reason, kind } => LoginSessionState::failed(reason, kind.into()),
    }
}

fn authenticated_state(user: Value, endpoint: String) -> LoginSessionState {
    LoginSessionState::Authenticated {
        session: AuthenticatedRuntimeSession::from_user(user, endpoint, String::new()),
        snapshot: None,
    }
}

fn basic_login_operation(
    endpoint: &str,
    username: String,
    password: String,
) -> std::result::Result<LoginRemoteOperation, Box<LoginSessionState>> {
    if username.trim().is_empty() {
        return Err(Box::new(LoginSessionState::failed(
            "Username is required.",
            LoginFailureKind::Other,
        )));
    }
    if password.is_empty() {
        return Err(Box::new(LoginSessionState::failed(
            "Password is required.",
            LoginFailureKind::Other,
        )));
    }
    Ok(LoginRemoteOperation::BasicLogin {
        endpoint: endpoint.to_string(),
        username,
        password,
    })
}

async fn execute_basic_login(
    api: &dyn LoginApi,
    endpoint: &str,
    operation: LoginRemoteOperation,
) -> LoginSessionState {
    let response = match execute_or_fail(api, operation).await {
        Ok(response) => response,
        Err(state) => return *state,
    };

    session_state(interpret_login_response(&response), endpoint.to_string())
}

#[cfg(test)]
pub(super) async fn start_login(
    api: &dyn LoginApi,
    endpoint: &str,
    username: String,
    password: String,
) -> LoginSessionState {
    let operation = match basic_login_operation(endpoint, username, password) {
        Ok(operation) => operation,
        Err(state) => return *state,
    };

    execute_basic_login(api, endpoint, operation).await
}

pub(super) async fn start_gui_basic_login(
    api: &dyn LoginApi,
    endpoint: &str,
    username: String,
    password: String,
) -> LoginSessionState {
    let operation = match basic_login_operation(endpoint, username, password) {
        Ok(operation) => operation,
        Err(state) => return *state,
    };

    let config_response = match execute_or_fail(
        api,
        LoginRemoteOperation::Config {
            endpoint: endpoint.to_string(),
        },
    )
    .await
    {
        Ok(response) => response,
        Err(state) => return *state,
    };
    if let Some(step) = interpret_login_config_response(&config_response) {
        return session_state(step, endpoint.to_string());
    }

    execute_basic_login(api, endpoint, operation).await
}

pub(super) async fn start_device_login(
    api: &dyn LoginApi,
    endpoint: &str,
) -> std::result::Result<VrchatDeviceAuthorization, Box<LoginSessionState>> {
    let config_response = execute_or_fail(
        api,
        LoginRemoteOperation::Config {
            endpoint: endpoint.to_string(),
        },
    )
    .await?;
    if let Some(step) = interpret_login_config_response(&config_response) {
        return Err(Box::new(session_state(step, endpoint.to_string())));
    }
    let response = execute_or_fail(
        api,
        LoginRemoteOperation::DeviceCode {
            endpoint: endpoint.to_string(),
        },
    )
    .await?;
    interpret_device_code_response(&response)
        .map_err(|reason| Box::new(LoginSessionState::failed(reason, LoginFailureKind::Other)))
}

pub(super) async fn complete_device_login(api: &dyn LoginApi, endpoint: &str) -> LoginSessionState {
    let response = match execute_or_fail(
        api,
        LoginRemoteOperation::CurrentUser {
            endpoint: endpoint.to_string(),
        },
    )
    .await
    {
        Ok(response) => response,
        Err(state) => return *state,
    };
    session_state(interpret_login_response(&response), endpoint.to_string())
}

pub(super) async fn start_saved_credential_login(
    api: &dyn LoginApi,
    config: &dyn AuthCredentialStore,
    cookies: &dyn AuthSessionCookies,
    endpoint: String,
    user_id: String,
) -> LoginSessionState {
    let response = saved_credential_login_start_with_api(
        config,
        cookies,
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

    session_state(interpret_login_response(&response), endpoint)
}

pub(super) async fn start_cookie_restore(
    api: &dyn LoginApi,
    endpoint: &str,
    expected_user_id: &str,
) -> LoginSessionState {
    match probe_cookie_session(api, endpoint, expected_user_id).await {
        Ok(CookieProbeResult::Authenticated { user, .. }) => {
            authenticated_state(user, endpoint.to_string())
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
        Ok(CookieProbeResult::UserMismatch { .. }) => LoginSessionState::failed(
            "The stored browser session belongs to a different account.",
            LoginFailureKind::MissingCredentials,
        ),
        Ok(CookieProbeResult::Rejected { stage, response }) => LoginSessionState::failed(
            cookie_probe_rejection_reason(stage, &response),
            classify_vrchat_login_failure(&response).into(),
        ),
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
    let verify_operation = match method {
        TwoFactorMethod::Totp => LoginRemoteOperation::VerifyTotp {
            endpoint: endpoint.to_string(),
            code,
        },
        TwoFactorMethod::EmailOtp => LoginRemoteOperation::VerifyEmailOtp {
            endpoint: endpoint.to_string(),
            code,
        },
        TwoFactorMethod::Otp => LoginRemoteOperation::VerifyOtp {
            endpoint: endpoint.to_string(),
            code,
        },
        TwoFactorMethod::Unknown(_) => {
            return session_state(unsupported_two_factor_method(&method), endpoint.to_string());
        }
    };

    let verify_response = match execute_or_fail(api, verify_operation).await {
        Ok(response) => response,
        Err(state) => return *state,
    };

    match interpret_two_factor_verify_response(&verify_response) {
        VrchatTwoFactorVerifyOutcome::Verified => {}
        VrchatTwoFactorVerifyOutcome::Rejected { reason, kind } => {
            return LoginSessionState::failed(reason, kind.into());
        }
        VrchatTwoFactorVerifyOutcome::Retry { error } => {
            return LoginSessionState::Challenge {
                attempt_id: String::new(),
                methods: current_methods,
                mode: current_mode,
                error: Some(error),
            };
        }
    }

    let user_response = match execute_or_fail(
        api,
        LoginRemoteOperation::CurrentUser {
            endpoint: endpoint.to_string(),
        },
    )
    .await
    {
        Ok(response) => response,
        Err(state) => return *state,
    };

    session_state(
        interpret_two_factor_current_user_response(&user_response),
        endpoint.to_string(),
    )
}
