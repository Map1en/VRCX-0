use std::sync::Arc;

use vrcx_0_application::auth::{
    AuthSessionCookies, LoginApi, LoginApiFuture, LoginRemoteOperation,
};
use vrcx_0_application_core::vrchat_api::VrchatScope;
use vrcx_0_application_core::{Result, WebClient};
use vrcx_0_vrchat_client::auth::{
    config_get_input, current_user_get_input, device_code_input, device_status_input,
    email_otp_verify_input, login_basic_input, otp_verify_input, totp_verify_input,
};

pub struct VrchatLoginApi {
    web: Arc<WebClient>,
}

impl VrchatLoginApi {
    pub fn new(web: Arc<WebClient>) -> Self {
        Self { web }
    }
}

impl LoginApi for VrchatLoginApi {
    fn execute(&self, operation: LoginRemoteOperation) -> LoginApiFuture<'_> {
        Box::pin(async move {
            let request = match operation {
                LoginRemoteOperation::Config { endpoint } => config_get_input(endpoint),
                LoginRemoteOperation::CurrentUser { endpoint } => current_user_get_input(endpoint),
                LoginRemoteOperation::BasicLogin {
                    endpoint,
                    username,
                    password,
                } => {
                    login_basic_input(
                        endpoint,
                        username,
                        password,
                        "Username is required.",
                        "Password is required.",
                    )?
                    .1
                }
                LoginRemoteOperation::VerifyTotp { endpoint, code } => {
                    totp_verify_input(endpoint, code)
                }
                LoginRemoteOperation::VerifyEmailOtp { endpoint, code } => {
                    email_otp_verify_input(endpoint, code)
                }
                LoginRemoteOperation::VerifyOtp { endpoint, code } => {
                    otp_verify_input(endpoint, code)
                }
                LoginRemoteOperation::DeviceCode { endpoint } => device_code_input(endpoint),
                LoginRemoteOperation::DeviceStatus {
                    endpoint,
                    device_code,
                } => device_status_input(endpoint, device_code),
            };
            self.web.execute_api(request, VrchatScope::Vrchat).await
        })
    }
}

pub struct WebAuthSessionCookies {
    web: Arc<WebClient>,
}

impl WebAuthSessionCookies {
    pub fn new(web: Arc<WebClient>) -> Self {
        Self { web }
    }
}

impl AuthSessionCookies for WebAuthSessionCookies {
    fn get(&self) -> String {
        self.web.get_cookies()
    }

    fn set(&self, cookies: &str) -> Result<()> {
        self.web.set_cookies(cookies)
    }

    fn clear(&self) {
        self.web.clear_cookies();
    }

    fn clear_everywhere(&self) {
        self.web.clear_cookies_everywhere();
    }

    fn clear_auth(&self) {
        self.web.clear_auth_cookies();
    }

    fn save(&self) {
        self.web.save_cookies();
    }
}
