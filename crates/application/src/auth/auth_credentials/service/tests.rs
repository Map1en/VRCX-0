use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::DatabaseService;

use super::super::snapshot::saved_snapshot;
use super::super::storage::{
    read_saved_credentials, LAST_USER_LOGGED_IN_KEY, SAVED_CREDENTIALS_KEY,
};
use super::super::types::LoginSuccessRecordInput;
use super::record_login_success;
use vrcx_0_application_core::WebClient;

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
                    "userIcon": "https://example.test/icon.png",
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
    let serialized_snapshot = serde_json::to_value(&snapshot)?;
    assert!(!contains_secret_key(&serialized_snapshot));
    let credential = &snapshot.saved_credentials_list[0];
    assert_eq!(credential.login_params.username, "login@example.com",);
    assert_eq!(credential.user.id, "usr_1");
    assert_eq!(credential.user.display_name.as_deref(), Some("Example"));
    assert_eq!(credential.user.username.as_deref(), Some("example"));
    assert_eq!(
        credential.user.user_icon.as_deref(),
        Some("https://example.test/icon.png")
    );
    assert!(credential.has_login_credentials);
    assert!(credential.has_cookies);
    assert!(serialized_snapshot
        .pointer("/savedCredentialsList/0/loginParams/endpoint")
        .is_none());
    assert!(serialized_snapshot
        .pointer("/savedCredentialsList/0/loginParams/websocket")
        .is_none());

    Ok(())
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

    let saved_credentials = read_saved_credentials(&config)?;
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

    let saved_credentials = read_saved_credentials(&config)?;
    let record = saved_credentials
        .get("usr_1")
        .expect("existing saved credential must be kept");
    assert_eq!(record.user.display_name.as_deref(), Some("New Name"));
    assert_eq!(
        record.login_params.password.as_deref(),
        Some("original-secret"),
        "save_credentials=false must never overwrite the stored password"
    );
    assert!(
        record.cookies.is_none(),
        "cookies must be synced from the live WebClient, which has none in this test"
    );
    Ok(())
}

#[test]
fn legacy_records_decode_to_typed_credentials_and_keep_snapshot_ordering() -> crate::Result<()> {
    let dir = TestDir::new("auth-typed-legacy-decode");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let config = ConfigRepository::new(db);
    config.set_string(
        SAVED_CREDENTIALS_KEY,
        &json!({
            "legacy-key": {
                "user": {
                    "id": "usr_z",
                    "displayName": "Zulu",
                    "username": "zulu",
                    "userIcon": "https://example.test/icon",
                    "password": "must-not-reach-the-snapshot"
                },
                "loginParmas": {
                    "username": "zulu@example.test",
                    "password": "zulu-secret"
                }
            },
            "usr_a": {
                "user": { "id": "usr_a", "displayName": "Alpha" },
                "loginParams": {
                    "username": "alpha@example.test",
                    "password": "alpha-secret",
                    "endpoint": "https://legacy.example.test",
                    "websocket": "wss://legacy.example.test"
                }
            }
        })
        .to_string(),
    )?;
    config.set_string(LAST_USER_LOGGED_IN_KEY, "usr_z")?;

    let credentials = read_saved_credentials(&config)?;
    assert!(!credentials.contains_key("legacy-key"));
    assert_eq!(
        credentials["usr_z"].user.display_name.as_deref(),
        Some("Zulu")
    );
    assert_eq!(
        credentials["usr_z"].user.user_icon.as_deref(),
        Some("https://example.test/icon")
    );
    assert_eq!(
        credentials["usr_z"].login_params.password.as_deref(),
        Some("zulu-secret")
    );
    assert_eq!(credentials["usr_a"].login_params.endpoint, "");
    assert_eq!(credentials["usr_a"].login_params.websocket, "");

    let snapshot = saved_snapshot(&config)?;
    assert_eq!(snapshot.saved_credentials_list[0].user.id, "usr_z");
    assert_eq!(
        snapshot.saved_credentials_list[0]
            .user
            .display_name
            .as_deref(),
        Some("Zulu")
    );
    assert_eq!(
        snapshot.saved_credentials_list[0].user.username.as_deref(),
        Some("zulu")
    );
    assert_eq!(
        snapshot.saved_credentials_list[0].user.user_icon.as_deref(),
        Some("https://example.test/icon")
    );
    assert_eq!(snapshot.saved_credentials_list[1].user.id, "usr_a");
    let serialized = serde_json::to_value(snapshot)?;
    assert!(!contains_secret_key(&serialized));

    let persisted: serde_json::Value = serde_json::from_str(
        &config
            .get_raw(SAVED_CREDENTIALS_KEY)?
            .expect("normalized credentials must be persisted"),
    )?;
    assert!(persisted.get("legacy-key").is_none());
    assert!(persisted["usr_z"].get("loginParmas").is_none());
    assert_eq!(
        persisted["usr_z"]["user"]["userIcon"],
        "https://example.test/icon"
    );
    assert_eq!(persisted["usr_a"]["loginParams"]["endpoint"], "");
    assert_eq!(persisted["usr_a"]["loginParams"]["websocket"], "");
    Ok(())
}
