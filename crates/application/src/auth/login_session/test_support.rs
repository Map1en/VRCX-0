use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::{
    execute_response, ApiScope, HttpApiExecuteResponse, HttpApiRequestInput,
};

use crate::{record_login_success, Error, LoginSuccessRecordInput, WebClient};

use super::types::{LoginApi, LoginApiFuture};

struct RecordedCall {
    path: String,
    body: Option<Value>,
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
                    .map(|(status, body)| Ok(execute_response(status, body)))
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

    pub(super) fn call_paths(&self) -> Vec<String> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .map(|call| call.path.clone())
            .collect()
    }

    pub(super) fn call_bodies(&self) -> Vec<Option<Value>> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .map(|call| call.body.clone())
            .collect()
    }
}

impl LoginApi for FakeLoginApi {
    fn execute<'a>(&'a self, input: HttpApiRequestInput, _scope: ApiScope) -> LoginApiFuture<'a> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(RecordedCall {
                path: input.path.clone().unwrap_or_default(),
                body: input.body.as_json().cloned(),
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

pub(super) fn test_env(name: &str) -> (TestDir, ConfigRepository, WebClient, Arc<DatabaseService>) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    let config = ConfigRepository::new(Arc::clone(&db));
    let storage = StorageService::new(&dir.path.join("VRCX-0.json")).unwrap();
    let web = WebClient::new(&storage, db.as_ref(), "https://app.example".into(), "2.9.2").unwrap();
    (dir, config, web, db)
}

pub(super) fn seed_saved_credential(config: &ConfigRepository, web: &WebClient, user_id: &str) {
    record_login_success(
        config,
        web,
        LoginSuccessRecordInput {
            user: json!({ "id": user_id, "displayName": "Saved User" }),
            login_params: json!({ "username": "saved@example.test", "password": "secret" }),
            stored_login_params: None,
            save_credentials: true,
        },
    )
    .unwrap();
}
