use std::sync::Arc;

use serde_json::Value;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_vrchat_client::auth::{
    config_get_input, current_user_get_input, email_otp_verify_input, login_basic_input,
    otp_verify_input, totp_verify_input,
};
use vrcx_0_vrchat_client::http_api::{ApiScope, HttpApiExecuteResponse, HttpApiRequestInput};

use crate::{
    auth_response_error_message, saved_credential_login_start, AuthenticatedRuntimeSession,
    SavedCredentialLoginStartInput, WebClient,
};

use super::types::{LoginApi, LoginFailureKind, LoginSessionState, TwoFactorMethod};

async fn execute_or_fail(
    api: &dyn LoginApi,
    request: HttpApiRequestInput,
) -> std::result::Result<HttpApiExecuteResponse, LoginSessionState> {
    api.execute(request, ApiScope::Vrchat)
        .await
        .map_err(|error| LoginSessionState::Failed {
            reason: error.to_string(),
            kind: LoginFailureKind::Network,
        })
}

fn parse_json_or_fail(
    response: &HttpApiExecuteResponse,
) -> std::result::Result<Value, Box<LoginSessionState>> {
    serde_json::from_str(&response.data).map_err(|error| {
        Box::new(LoginSessionState::Failed {
            reason: error.to_string(),
            kind: LoginFailureKind::Other,
        })
    })
}

pub(super) fn sort_two_factor_methods(methods: &mut [TwoFactorMethod]) {
    methods.sort_by_key(|method| match method.as_str() {
        "totp" => 0,
        "emailOtp" => 1,
        "otp" => 2,
        _ => 3,
    });
}

pub struct LoginSession {
    api: Arc<dyn LoginApi>,
    endpoint: String,
    state: LoginSessionState,
}

impl LoginSession {
    pub async fn start(
        api: Arc<dyn LoginApi>,
        endpoint: String,
        username: String,
        password: String,
    ) -> Self {
        let state = start_login(api.as_ref(), &endpoint, username, password).await;
        Self {
            api,
            endpoint,
            state,
        }
    }

    pub async fn start_gui_basic(
        api: Arc<dyn LoginApi>,
        endpoint: String,
        username: String,
        password: String,
    ) -> Self {
        let state = start_gui_basic_login(api.as_ref(), &endpoint, username, password).await;
        Self {
            api,
            endpoint,
            state,
        }
    }

    pub async fn start_saved_credential(
        api: Arc<dyn LoginApi>,
        config: &ConfigRepository,
        web: &WebClient,
        endpoint: String,
        user_id: String,
    ) -> Self {
        let state =
            start_saved_credential_login(api.as_ref(), config, web, endpoint.clone(), user_id)
                .await;
        Self {
            api,
            endpoint,
            state,
        }
    }

    pub async fn start_cookie_restore(api: Arc<dyn LoginApi>, endpoint: String) -> Self {
        let state = start_cookie_restore(api.as_ref(), &endpoint).await;
        Self {
            api,
            endpoint,
            state,
        }
    }

    pub fn state(&self) -> &LoginSessionState {
        &self.state
    }

    pub fn into_state(self) -> LoginSessionState {
        self.state
    }

    pub async fn respond(&mut self, method: TwoFactorMethod, code: String) -> &LoginSessionState {
        let LoginSessionState::Challenge { methods, mode, .. } = &self.state else {
            return &self.state;
        };
        let current_methods = methods.clone();
        let current_mode = mode.clone();
        self.state = respond_to_challenge(
            self.api.as_ref(),
            &self.endpoint,
            current_methods,
            current_mode,
            method,
            code,
        )
        .await;
        &self.state
    }

    pub fn cancel(&mut self) -> &LoginSessionState {
        self.state = LoginSessionState::Cancelled;
        &self.state
    }
}

fn classify_status_failure(
    response: &HttpApiExecuteResponse,
    treat_any_401_as_invalid_credentials: bool,
) -> LoginFailureKind {
    if response.status == 401 {
        let message = auth_response_error_message(response, String::new());
        if treat_any_401_as_invalid_credentials
            || message.contains("Invalid Username/Email or Password")
        {
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
    treat_any_401_as_invalid_credentials: bool,
) -> LoginSessionState {
    if response.status != 200 {
        let reason = auth_response_error_message(
            &response,
            format!("Login failed with HTTP {}", response.status),
        );
        let kind = classify_status_failure(&response, treat_any_401_as_invalid_credentials);
        return LoginSessionState::Failed { reason, kind };
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
        Box::new(LoginSessionState::Failed {
            reason: error.to_string(),
            kind: LoginFailureKind::Other,
        })
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

    interpret_login_response(response, endpoint.to_string(), true)
}

async fn start_login(
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

async fn start_gui_basic_login(
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
    if config_response.status == 403 {
        let reason = auth_response_error_message(
            &config_response,
            format!(
                "VRChat config request failed with HTTP {}.",
                config_response.status
            ),
        );
        return LoginSessionState::Failed {
            reason,
            kind: LoginFailureKind::SessionInvalidated,
        };
    }

    execute_basic_login(api, endpoint, request).await
}

async fn start_saved_credential_login(
    api: &dyn LoginApi,
    config: &ConfigRepository,
    web: &WebClient,
    endpoint: String,
    user_id: String,
) -> LoginSessionState {
    let response = saved_credential_login_start(
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
        Err(error) => {
            return LoginSessionState::Failed {
                reason: error.to_string(),
                kind: LoginFailureKind::Other,
            }
        }
    };

    interpret_login_response(response, endpoint, false)
}

async fn start_cookie_restore(api: &dyn LoginApi, endpoint: &str) -> LoginSessionState {
    let config_response = match execute_or_fail(api, config_get_input(endpoint.to_string())).await {
        Ok(response) => response,
        Err(state) => return state,
    };
    if config_response.status == 403 {
        let reason = auth_response_error_message(
            &config_response,
            format!(
                "VRChat config request failed with HTTP {}.",
                config_response.status
            ),
        );
        return LoginSessionState::Failed {
            reason,
            kind: LoginFailureKind::SessionInvalidated,
        };
    }

    let user_response =
        match execute_or_fail(api, current_user_get_input(endpoint.to_string())).await {
            Ok(response) => response,
            Err(state) => return state,
        };

    if user_response.status != 200 {
        let reason = auth_response_error_message(
            &user_response,
            format!(
                "VRChat current-user request failed with HTTP {}.",
                user_response.status
            ),
        );
        let kind = classify_status_failure(&user_response, false);
        return LoginSessionState::Failed { reason, kind };
    }

    let json = match parse_json_or_fail(&user_response) {
        Ok(json) => json,
        Err(state) => return *state,
    };

    if json
        .get("requiresTwoFactorAuth")
        .and_then(Value::as_array)
        .is_some_and(|methods| !methods.is_empty())
    {
        return LoginSessionState::Failed {
            reason: "The stored browser session still requires interactive verification.".into(),
            kind: LoginFailureKind::TwoFactorUnavailable,
        };
    }

    authenticated_from_json(json, endpoint.to_string())
}

async fn respond_to_challenge(
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
        return LoginSessionState::Challenge {
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
        let kind = classify_status_failure(&user_response, false);
        return LoginSessionState::Failed { reason, kind };
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
        return LoginSessionState::Failed {
            reason: "2FA is required but no supported method was returned.".into(),
            kind: LoginFailureKind::TwoFactorUnavailable,
        };
    }
    sort_two_factor_methods(&mut methods);
    let mode = methods[0].clone();
    LoginSessionState::Challenge {
        methods,
        mode,
        error,
    }
}

fn authenticated_from_json(json: Value, endpoint: String) -> LoginSessionState {
    let session = AuthenticatedRuntimeSession::from_user(json, endpoint, String::new());
    if session.user_id.is_empty() {
        return LoginSessionState::Failed {
            reason: "The auth request did not return a valid user payload.".into(),
            kind: LoginFailureKind::Other,
        };
    }
    LoginSessionState::Authenticated { session }
}
