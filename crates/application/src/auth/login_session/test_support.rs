use std::collections::VecDeque;
use std::sync::Mutex;

use serde_json::{json, Value};
use vrcx_0_application_core::vrchat_api::VrchatApiResponse as HttpApiExecuteResponse;
use vrcx_0_contracts::vrchat_api::vrchat_response;

use crate::auth::test_support::{MemoryAuthCredentialStore, MemoryAuthSessionCookies};
use crate::auth::{record_login_success, AuthCredentialStore, LoginSuccessRecordInput};
use vrcx_0_application_core::Error;

use super::types::{LoginApi, LoginApiFuture, LoginRemoteOperation};

struct RecordedCall {
    name: String,
}

pub(super) struct FakeLoginApi {
    responses: Mutex<VecDeque<std::result::Result<HttpApiExecuteResponse, String>>>,
    calls: Mutex<Vec<RecordedCall>>,
}

impl FakeLoginApi {
    pub(super) fn new(responses: Vec<(i32, Value)>) -> Self {
        Self::new_raw(
            responses
                .into_iter()
                .map(|(status, body)| (status, body.to_string()))
                .collect(),
        )
    }

    pub(super) fn new_raw(responses: Vec<(i32, String)>) -> Self {
        Self {
            responses: Mutex::new(
                responses
                    .into_iter()
                    .map(|(status, body)| Ok(vrchat_response(status, body)))
                    .collect(),
            ),
            calls: Mutex::new(Vec::new()),
        }
    }

    pub(super) fn with_network_error(mut self, message: &str) -> Self {
        self.responses
            .get_mut()
            .unwrap()
            .push_back(Err(message.to_string()));
        self
    }

    pub(super) fn call_names(&self) -> Vec<String> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .map(|call| call.name.clone())
            .collect()
    }
}

impl LoginApi for FakeLoginApi {
    fn execute(&self, operation: LoginRemoteOperation) -> LoginApiFuture<'_> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(RecordedCall {
                name: operation_name(&operation).into(),
            });
            let next = self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("test queued too few fake responses");
            next.map_err(Error::Custom)
        })
    }
}

fn operation_name(operation: &LoginRemoteOperation) -> &'static str {
    match operation {
        LoginRemoteOperation::Config { .. } => "config",
        LoginRemoteOperation::CurrentUser { .. } => "current_user",
        LoginRemoteOperation::BasicLogin { .. } => "basic_login",
        LoginRemoteOperation::VerifyTotp { .. } => "verify_totp",
        LoginRemoteOperation::VerifyEmailOtp { .. } => "verify_email_otp",
        LoginRemoteOperation::VerifyOtp { .. } => "verify_otp",
        LoginRemoteOperation::DeviceCode { .. } => "device_code",
        LoginRemoteOperation::DeviceStatus { .. } => "device_status",
    }
}

pub(super) fn user_json() -> Value {
    json!({ "id": "usr_123", "displayName": "Example" })
}

pub(super) struct TestDir {
    path: std::path::PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-login-session-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

pub(super) fn test_env(
    name: &str,
) -> (
    TestDir,
    MemoryAuthCredentialStore,
    MemoryAuthSessionCookies,
    (),
) {
    let dir = TestDir::new(name);
    let config = MemoryAuthCredentialStore::default();
    let web = MemoryAuthSessionCookies::default();
    (dir, config, web, ())
}

pub(super) fn seed_saved_credential(
    config: &dyn AuthCredentialStore,
    web: &MemoryAuthSessionCookies,
    user_id: &str,
) {
    record_login_success(
        config,
        web,
        LoginSuccessRecordInput {
            user: json!({ "id": user_id, "displayName": "Saved User" }).into(),
            login_params: json!({ "username": "saved@example.test", "password": "secret" }).into(),
            stored_login_params: None,
            record: crate::auth::SavedCredentialRecordMode::WithPassword,
        },
    )
    .unwrap();
}
