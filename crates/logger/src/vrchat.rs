use std::time::Duration;

use serde_json::Value;
use vrcx_0_contracts::vrchat_api::{vrchat_response, VrchatResponse};
use vrcx_0_contracts::vrchat_login::{
    interpret_cookie_probe_config_response, interpret_cookie_probe_current_user_response,
    interpret_login_config_response, interpret_login_response,
    interpret_two_factor_current_user_response, interpret_two_factor_verify_response,
    unsupported_two_factor_method, CookieProbeResult, VrchatLoginFailureKind, VrchatLoginStep,
    VrchatTwoFactorVerifyOutcome,
};
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::vrchat_endpoints::{
    VRCHAT_API_DEFAULT_ENDPOINT, VRCHAT_WEBSOCKET_DEFAULT_ENDPOINT,
};
use vrcx_0_core::TwoFactorMethod;
use vrcx_0_logger_protocol::wire::SnapshotPayload;
use vrcx_0_vrchat_client::auth::{
    config_get_input, current_user_get_input, email_otp_verify_input, login_basic_input,
    otp_verify_input, session_get_input, totp_verify_input,
};
use vrcx_0_vrchat_client::friends::friends_get_input;
use vrcx_0_vrchat_client::http_api::{build_web_execute_request, ApiScope, HttpApiRequestInput};
use vrcx_0_vrchat_client::realtime::{
    auth_token_from_response, build_transport_url, connect_websocket, Error as RealtimeError,
    RealtimeConnectionOptions, RealtimeWebSocketStream,
};
use vrcx_0_vrchat_client::users::profile_get_input;
use vrcx_0_vrchat_client::web_client::WebClient;

use crate::app::LOGGER_VERSION;

const ENDPOINT: &str = VRCHAT_API_DEFAULT_ENDPOINT;
const WEBSOCKET: &str = VRCHAT_WEBSOCKET_DEFAULT_ENDPOINT;
const REALTIME_ORIGIN: &str = "http://tauri.localhost";
const NETWORK_STATUS: i32 = -1;
const RATE_LIMITED_STATUS: i32 = 429;
const FRIEND_PAGE_SIZE: i32 = 50;
const FRIEND_PAGE_RETRIES: usize = 5;
const FRIEND_PAGE_RETRY_DELAY: Duration = Duration::from_secs(5);
const REALTIME_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, PartialEq)]
pub enum LoginOutcome {
    Authenticated {
        account_id: String,
    },
    TwoFactorRequired {
        methods: Vec<TwoFactorMethod>,
    },
    Failed {
        reason: String,
        kind: VrchatLoginFailureKind,
    },
    RateLimited,
    Network {
        reason: String,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub enum TwoFactorOutcome {
    Login(LoginOutcome),
    Retry { error: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProbeOutcome {
    Valid,
    Invalid { reason: String },
    Unreachable { reason: String },
}

pub struct Vrchat {
    web: WebClient,
}

impl Vrchat {
    pub fn new(cookies: Option<&str>) -> Result<Self, String> {
        let web = WebClient::new(None, cookies, &format!("logger-{LOGGER_VERSION}"))
            .map_err(|error| error.to_string())?;
        Ok(Self { web })
    }

    pub fn cookies(&self) -> String {
        self.web.get_cookies()
    }

    pub fn clear_session(&self) {
        self.web.clear_auth_cookies();
    }

    pub async fn login(&self, username: String, password: String) -> LoginOutcome {
        let config = self.execute(config_get_input(ENDPOINT.into())).await;
        if let Some(outcome) = transport_outcome(&config) {
            return outcome;
        }
        if let Some(step) = interpret_login_config_response(&config) {
            return login_outcome(step);
        }

        let input = match login_basic_input(
            ENDPOINT.into(),
            username,
            password,
            "Username is required.",
            "Password is required.",
        ) {
            Ok((_, input)) => input,
            Err(error) => {
                return LoginOutcome::Failed {
                    reason: error.to_string(),
                    kind: VrchatLoginFailureKind::Other,
                }
            }
        };
        let response = self.execute(input).await;
        if let Some(outcome) = transport_outcome(&response) {
            return outcome;
        }
        login_outcome(interpret_login_response(&response))
    }

    pub async fn verify_two_factor(&self, method: &str, code: String) -> TwoFactorOutcome {
        let method = TwoFactorMethod::from(method);
        let input = match method {
            TwoFactorMethod::Totp => totp_verify_input(ENDPOINT.into(), code),
            TwoFactorMethod::EmailOtp => email_otp_verify_input(ENDPOINT.into(), code),
            TwoFactorMethod::Otp => otp_verify_input(ENDPOINT.into(), code),
            TwoFactorMethod::Unknown(_) => {
                return TwoFactorOutcome::Login(login_outcome(unsupported_two_factor_method(
                    &method,
                )))
            }
        };
        let response = self.execute(input).await;
        if let Some(outcome) = transport_outcome(&response) {
            return TwoFactorOutcome::Login(outcome);
        }
        match interpret_two_factor_verify_response(&response) {
            VrchatTwoFactorVerifyOutcome::Verified => {}
            VrchatTwoFactorVerifyOutcome::Rejected { reason, kind } => {
                return TwoFactorOutcome::Login(LoginOutcome::Failed { reason, kind })
            }
            VrchatTwoFactorVerifyOutcome::Retry { error } => {
                return TwoFactorOutcome::Retry { error }
            }
        }

        let user = self.execute(current_user_get_input(ENDPOINT.into())).await;
        if let Some(outcome) = transport_outcome(&user) {
            return TwoFactorOutcome::Login(outcome);
        }
        TwoFactorOutcome::Login(login_outcome(interpret_two_factor_current_user_response(
            &user,
        )))
    }

    pub async fn probe(&self, expected_account_id: &str) -> ProbeOutcome {
        let config = self.execute(config_get_input(ENDPOINT.into())).await;
        if config.status == NETWORK_STATUS {
            return ProbeOutcome::Unreachable {
                reason: config.data,
            };
        }
        let result = match interpret_cookie_probe_config_response(config) {
            Some(result) => result,
            None => {
                let response = self.execute(current_user_get_input(ENDPOINT.into())).await;
                if response.status == NETWORK_STATUS {
                    return ProbeOutcome::Unreachable {
                        reason: response.data,
                    };
                }
                match interpret_cookie_probe_current_user_response(response, expected_account_id) {
                    Ok(result) => result,
                    Err(reason) => return ProbeOutcome::Unreachable { reason },
                }
            }
        };
        probe_outcome(result)
    }

    pub async fn connect_realtime(&self) -> Result<RealtimeWebSocketStream, RealtimeError> {
        tokio::time::timeout(REALTIME_CONNECT_TIMEOUT, async {
            let token = match self.web.auth_cookie_value() {
                Some(token) => token,
                None => {
                    let mut response = self.execute(session_get_input(ENDPOINT.into())).await;
                    if !(200..300).contains(&response.status) {
                        response = self.execute_fresh(session_get_input(ENDPOINT.into())).await;
                    }
                    auth_token_from_response(response.status, &response.data)?
                }
            };
            let url = build_transport_url(WEBSOCKET, &token)?;
            let options = RealtimeConnectionOptions {
                origin: REALTIME_ORIGIN.to_string(),
                proxy_url: None,
            };
            connect_websocket(&url, &options).await
        })
        .await
        .unwrap_or_else(|_| {
            Err(RealtimeError::Other(format!(
                "websocket connect timed out after {} seconds",
                REALTIME_CONNECT_TIMEOUT.as_secs()
            )))
        })
    }

    pub async fn snapshot(&self) -> Result<SnapshotPayload, String> {
        let user = self.execute(current_user_get_input(ENDPOINT.into())).await;
        if user.status != 200 {
            return Err(format!("current user request failed ({})", user.status));
        }
        let current_user = serde_json::from_str::<Value>(&user.data)
            .map_err(|error| format!("current user response: {error}"))?;
        let online_friends = self.friends(false).await?;
        let offline_friends = self.friends(true).await?;
        Ok(SnapshotPayload {
            after_seq: None,
            current_user,
            online_friends,
            offline_friends,
        })
    }

    pub async fn profile(&self, user_id: &str) -> VrchatResponse {
        match profile_get_input(ENDPOINT.into(), user_id.into(), false) {
            Ok((_, input)) => self.execute(input).await,
            Err(error) => network_failure(error),
        }
    }

    async fn friends(&self, offline: bool) -> Result<Vec<Value>, String> {
        let mut rows = Vec::new();
        let mut offset = 0;
        loop {
            let page = self.friend_page(offline, offset).await?;
            let page_len = page.len();
            rows.extend(page);
            if page_len < FRIEND_PAGE_SIZE as usize {
                return Ok(rows);
            }
            offset += FRIEND_PAGE_SIZE;
        }
    }

    async fn friend_page(&self, offline: bool, offset: i32) -> Result<Vec<Value>, String> {
        for _ in 0..FRIEND_PAGE_RETRIES {
            let response = self
                .execute(friends_get_input(
                    ENDPOINT.into(),
                    offline,
                    FRIEND_PAGE_SIZE,
                    offset,
                ))
                .await;
            if response.status == RATE_LIMITED_STATUS {
                tokio::time::sleep(FRIEND_PAGE_RETRY_DELAY).await;
                continue;
            }
            if response.status != 200 {
                return Err(format!("friends request failed ({})", response.status));
            }
            return match serde_json::from_str::<Value>(&response.data) {
                Ok(Value::Array(rows)) => Ok(rows),
                Ok(_) => Ok(Vec::new()),
                Err(error) => Err(format!("friends response: {error}")),
            };
        }
        Err("friends request kept being rate limited".into())
    }

    async fn execute(&self, input: HttpApiRequestInput) -> VrchatResponse {
        match build_web_execute_request(input, ApiScope::Vrchat) {
            Ok(request) => response(self.web.execute(request).await),
            Err(error) => network_failure(error),
        }
    }

    async fn execute_fresh(&self, input: HttpApiRequestInput) -> VrchatResponse {
        match build_web_execute_request(input, ApiScope::Vrchat) {
            Ok(request) => response(self.web.execute_fresh_standard(request).await),
            Err(error) => network_failure(error),
        }
    }
}

fn response<E: std::fmt::Display>(result: Result<(i32, String), E>) -> VrchatResponse {
    match result {
        Ok((status, data)) => vrchat_response(status, data),
        Err(error) => network_failure(error),
    }
}

fn network_failure(error: impl std::fmt::Display) -> VrchatResponse {
    vrchat_response(NETWORK_STATUS, error.to_string())
}

fn transport_outcome(response: &VrchatResponse) -> Option<LoginOutcome> {
    match response.status {
        NETWORK_STATUS => Some(LoginOutcome::Network {
            reason: response.data.clone(),
        }),
        RATE_LIMITED_STATUS => Some(LoginOutcome::RateLimited),
        500..=599 => Some(LoginOutcome::Network {
            reason: format!("VRChat returned {}", response.status),
        }),
        _ => None,
    }
}

fn login_outcome(step: VrchatLoginStep) -> LoginOutcome {
    match step {
        VrchatLoginStep::Authenticated { user } => {
            match user.scalar_field("id").filter(|id| !id.is_empty()) {
                Some(account_id) => LoginOutcome::Authenticated { account_id },
                None => LoginOutcome::Failed {
                    reason: "VRChat did not return the account id".into(),
                    kind: VrchatLoginFailureKind::Other,
                },
            }
        }
        VrchatLoginStep::TwoFactorRequired { methods, .. } => {
            LoginOutcome::TwoFactorRequired { methods }
        }
        VrchatLoginStep::Failed { reason, kind } => LoginOutcome::Failed { reason, kind },
    }
}

fn probe_outcome(result: CookieProbeResult) -> ProbeOutcome {
    match result {
        CookieProbeResult::Authenticated { .. } => ProbeOutcome::Valid,
        CookieProbeResult::MissingCredentials(_) => ProbeOutcome::Invalid {
            reason: "VRChat session is missing".into(),
        },
        CookieProbeResult::RequiresTwoFactor(_) => ProbeOutcome::Invalid {
            reason: "VRChat session requires two-factor verification again".into(),
        },
        CookieProbeResult::UserMismatch { .. } => ProbeOutcome::Invalid {
            reason: "VRChat session belongs to a different account".into(),
        },
        CookieProbeResult::Rejected { response, .. } if matches!(response.status, 401 | 403) => {
            ProbeOutcome::Invalid {
                reason: format!("VRChat rejected the session ({})", response.status),
            }
        }
        CookieProbeResult::Rejected { response, .. } => ProbeOutcome::Unreachable {
            reason: format!("VRChat session check failed ({})", response.status),
        },
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use vrcx_0_contracts::vrchat_login::CookieProbeStage;

    use super::*;

    fn session_check_answered(status: i32) -> ProbeOutcome {
        probe_outcome(CookieProbeResult::Rejected {
            stage: CookieProbeStage::CurrentUser,
            response: vrchat_response(status, json!({ "error": "nope" }).to_string()),
        })
    }

    #[test]
    fn a_login_that_does_not_identify_the_account_is_not_treated_as_signed_in() {
        let outcome = login_outcome(VrchatLoginStep::Authenticated {
            user: json!({ "displayName": "Someone" }),
        });

        assert!(matches!(outcome, LoginOutcome::Failed { .. }));
        assert_eq!(
            login_outcome(VrchatLoginStep::Authenticated {
                user: json!({ "id": "usr_self" }),
            }),
            LoginOutcome::Authenticated {
                account_id: "usr_self".into()
            }
        );
    }

    #[test]
    fn a_session_vrchat_rejects_is_treated_as_invalid() {
        for status in [401, 403] {
            assert!(
                matches!(session_check_answered(status), ProbeOutcome::Invalid { .. }),
                "{status}"
            );
        }
    }

    #[test]
    fn a_vrchat_server_error_during_login_counts_as_unreachable_not_a_failed_login() {
        for status in [500, 502, 503] {
            assert!(
                matches!(
                    transport_outcome(&vrchat_response(status, String::new())),
                    Some(LoginOutcome::Network { .. })
                ),
                "{status}"
            );
        }
        assert_eq!(
            transport_outcome(&vrchat_response(401, String::new())),
            None
        );
    }

    #[test]
    fn a_vrchat_server_error_means_unreachable_not_an_invalid_session() {
        for status in [500, 502, 503] {
            assert!(
                matches!(
                    session_check_answered(status),
                    ProbeOutcome::Unreachable { .. }
                ),
                "{status}"
            );
        }
    }
}
