use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::DatabaseService;

use super::super::login::{
    authenticated_response_user_mismatches, response_allows_saved_credential_fallback,
    response_requires_two_factor,
};
use super::super::snapshot::saved_snapshot;
use super::super::storage::{
    read_saved_credentials_map, LAST_USER_LOGGED_IN_KEY, SAVED_CREDENTIALS_KEY,
};
use super::super::types::LoginSuccessRecordInput;
use super::record_login_success;
use vrcx_0_application_core::WebClient;
use vrcx_0_vrchat_client::http_api::HttpApiExecuteResponse;

fn http_response(status: i32, data: serde_json::Value) -> HttpApiExecuteResponse {
    HttpApiExecuteResponse {
        status,
        data: data.to_string(),
        raw: data,
    }
}

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn contains_secret_key(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(object) => object.iter().any(|(key, value)| {
            matches!(key.as_str(), "password" | "cookies") || contains_secret_key(value)
        }),
        serde_json::Value::Array(values) => values.iter().any(contains_secret_key),
        _ => false,
    }
}

#[test]
fn saved_snapshot_redacts_passwords_and_cookies() -> crate::Result<()> {
    let dir = TestDir::new("auth-snapshot-redacted");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let config = ConfigRepository::new(db);
    config.set_string(
        SAVED_CREDENTIALS_KEY,
        &json!({
            "usr_1": {
                "user": {
                    "id": "usr_1",
                    "displayName": "Example",
                    "username": "example",
                    "password": "nested-secret",
                    "profile": {
                        "cookies": "nested-cookie"
                    }
                },
                "loginParams": {
                    "username": "login@example.com",
                    "password": "secret"
                },
                "cookies": "raw-cookie-b64"
            }
        })
        .to_string(),
    )?;
    config.set_string(LAST_USER_LOGGED_IN_KEY, "usr_1")?;

    let snapshot = saved_snapshot(&config)?;
    assert!(!contains_secret_key(&snapshot));
    assert_eq!(
        snapshot["savedCredentials"]["usr_1"]["loginParams"]["username"],
        "login@example.com"
    );
    assert_eq!(
        snapshot["savedCredentials"]["usr_1"]["hasLoginCredentials"],
        true
    );
    assert_eq!(snapshot["savedCredentials"]["usr_1"]["hasCookies"], true);
    assert_eq!(snapshot["savedCredentialFallbackAvailable"], true);
    Ok(())
}

#[test]
fn response_allows_saved_credential_fallback_requires_401_and_missing_credentials_message() {
    assert!(response_allows_saved_credential_fallback(&http_response(
        401,
        json!({ "error": { "message": "Missing Credentials" } })
    )));
    assert!(!response_allows_saved_credential_fallback(&http_response(
        401,
        json!({ "error": { "message": "Invalid Username/Email or Password" } })
    )));
    assert!(!response_allows_saved_credential_fallback(&http_response(
        403,
        json!({ "error": { "message": "Missing Credentials" } })
    )));
}

#[test]
fn response_requires_two_factor_detects_nonempty_methods_array() {
    assert!(response_requires_two_factor(&http_response(
        200,
        json!({ "requiresTwoFactorAuth": ["totp", "otp"] })
    )));
    assert!(!response_requires_two_factor(&http_response(
        200,
        json!({ "requiresTwoFactorAuth": [] })
    )));
    assert!(!response_requires_two_factor(&http_response(
        200,
        json!({ "id": "usr_1" })
    )));
}

#[test]
fn authenticated_response_user_mismatches_flags_a_different_authenticated_user() {
    assert!(authenticated_response_user_mismatches(
        &http_response(200, json!({ "id": "usr_other" })),
        "usr_expected"
    ));
    assert!(!authenticated_response_user_mismatches(
        &http_response(200, json!({ "id": "usr_expected" })),
        "usr_expected"
    ));
    assert!(
        !authenticated_response_user_mismatches(
            &http_response(
                200,
                json!({ "id": "usr_other", "requiresTwoFactorAuth": ["totp"] })
            ),
            "usr_expected"
        ),
        "an in-progress two-factor challenge is not a user mismatch"
    );
    assert!(!authenticated_response_user_mismatches(
        &http_response(401, json!({ "id": "usr_other" })),
        "usr_expected"
    ));
    assert!(!authenticated_response_user_mismatches(
        &http_response(200, json!({ "id": "usr_other" })),
        ""
    ));
}

fn test_web_client(dir: &TestDir, db: &Arc<DatabaseService>) -> crate::Result<WebClient> {
    let storage = StorageService::new(&dir.path.join("VRCX-0.json"))?;
    WebClient::new(&storage, db.as_ref(), "https://app.example".into(), "2.9.2")
}

#[test]
fn record_login_success_without_save_credentials_does_not_persist_a_new_entry() -> crate::Result<()>
{
    let dir = TestDir::new("login-success-no-save");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let config = ConfigRepository::new(Arc::clone(&db));
    let web = test_web_client(&dir, &db)?;

    record_login_success(
        &config,
        &web,
        LoginSuccessRecordInput {
            user: json!({ "id": "usr_new", "displayName": "New User" }),
            login_params: json!({
                "username": "new@example.test",
                "password": "secret"
            }),
            stored_login_params: None,
            save_credentials: false,
        },
    )?;

    let saved_credentials = read_saved_credentials_map(&config)?;
    assert!(
        !saved_credentials.contains_key("usr_new"),
        "headless/non-interactive logins must never persist a new saved credential"
    );
    assert_eq!(config.get_string(LAST_USER_LOGGED_IN_KEY, "")?, "usr_new");
    Ok(())
}

#[test]
fn record_login_success_without_save_credentials_refreshes_an_existing_record_in_place(
) -> crate::Result<()> {
    let dir = TestDir::new("login-success-refresh-existing");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let config = ConfigRepository::new(Arc::clone(&db));
    let web = test_web_client(&dir, &db)?;

    config.set_string(
        SAVED_CREDENTIALS_KEY,
        &json!({
            "usr_1": {
                "user": { "id": "usr_1", "displayName": "Old Name" },
                "loginParams": {
                    "username": "login@example.com",
                    "password": "original-secret"
                },
                "cookies": "stale-cookie"
            }
        })
        .to_string(),
    )?;

    record_login_success(
        &config,
        &web,
        LoginSuccessRecordInput {
            user: json!({ "id": "usr_1", "displayName": "New Name" }),
            login_params: json!({
                "username": "login@example.com",
                "password": "ignored-because-save-credentials-is-false"
            }),
            stored_login_params: None,
            save_credentials: false,
        },
    )?;

    let saved_credentials = read_saved_credentials_map(&config)?;
    let record = saved_credentials
        .get("usr_1")
        .expect("existing saved credential must be kept");
    assert_eq!(record["user"]["displayName"], "New Name");
    assert_eq!(
        record["loginParams"]["password"], "original-secret",
        "save_credentials=false must never overwrite the stored password"
    );
    assert!(
        record.get("cookies").is_none(),
        "cookies must be synced from the live WebClient, which has none in this test"
    );
    Ok(())
}
