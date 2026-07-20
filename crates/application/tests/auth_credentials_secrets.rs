use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};
use vrcx_0_application::{
    migrate_saved_credential_secrets, saved_credential_session_data, saved_snapshot,
    SavedAuthAutoLoginStatus,
};
use vrcx_0_persistence::{
    config::ConfigRepository,
    maintenance::vacuum_after_secret_migration,
    secrets::{init_secrets, is_sealed_secret, open_secret},
    DatabaseService,
};

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

fn raw_saved_credentials(config: &ConfigRepository) -> Value {
    serde_json::from_str(&config.get_raw("savedCredentials").unwrap().unwrap()).unwrap()
}

fn contains_bytes(path: &std::path::Path, needle: &[u8]) -> bool {
    std::fs::read(path)
        .ok()
        .is_some_and(|bytes| bytes.windows(needle.len()).any(|window| window == needle))
}

#[test]
fn auth_credentials_encrypt_migrate_decrypt_and_clear_damaged_fields() {
    let dir = TestDir::new("auth-credential-secrets");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let db = Arc::new(DatabaseService::new(&db_path).unwrap());
    let config = ConfigRepository::new(Arc::clone(&db));
    init_secrets(Some([11; 32]), true);
    config
        .set_bool(
            vrcx_0_persistence::secrets::CLEANUP_COMPLETED_CONFIG_KEY,
            true,
        )
        .unwrap();

    config
        .set_string(
            "savedCredentials",
            &json!({
                "usr_1": {
                    "user": { "id": "usr_1", "displayName": "Example" },
                    "loginParams": {
                        "username": "login@example.com",
                        "password": "password-secret",
                        "endpoint": "",
                        "websocket": ""
                    },
                    "cookies": "saved-cookie-secret"
                },
                "usr_typo": {
                    "user": { "id": "usr_typo", "displayName": "Typo" },
                    "loginParmas": {
                        "username": "typo@example.com",
                        "password": "typo-password"
                    }
                },
                "usr_literal": {
                    "user": { "id": "usr_literal", "displayName": "Literal" },
                    "loginParams": {
                        "username": "literal@example.com",
                        "password": "enc1:literal-password",
                        "passwordStorage": "plain"
                    }
                },
                "usr_invalid": {
                    "user": { "id": "usr_invalid", "displayName": "Invalid" },
                    "loginParams": { "username": "invalid@example.com", "password": "" },
                    "cookies": { "not": "a string" }
                }
            })
            .to_string(),
        )
        .unwrap();
    config.set_string("lastUserLoggedIn", "usr_1").unwrap();

    assert!(migrate_saved_credential_secrets(&config).unwrap());
    assert!(!migrate_saved_credential_secrets(&config).unwrap());

    let raw = raw_saved_credentials(&config);
    let password = raw["usr_1"]["loginParams"]["password"]
        .as_str()
        .unwrap()
        .to_string();
    let cookies = raw["usr_1"]["cookies"].as_str().unwrap().to_string();
    assert!(is_sealed_secret(&password));
    assert!(is_sealed_secret(&cookies));
    assert!(is_sealed_secret(
        raw["usr_typo"]["loginParams"]["password"].as_str().unwrap()
    ));
    let literal_password = raw["usr_literal"]["loginParams"]["password"]
        .as_str()
        .unwrap();
    assert_ne!(literal_password, "enc1:literal-password");
    assert!(is_sealed_secret(literal_password));
    assert_eq!(
        open_secret(literal_password).as_deref(),
        Some("enc1:literal-password")
    );
    assert!(raw["usr_literal"]["loginParams"]
        .get("passwordStorage")
        .is_none());
    assert!(raw["usr_typo"].get("loginParmas").is_none());
    assert!(raw["usr_invalid"].get("cookies").is_none());
    assert!(!config
        .get_bool(
            vrcx_0_persistence::secrets::CLEANUP_COMPLETED_CONFIG_KEY,
            false
        )
        .unwrap());
    vacuum_after_secret_migration(&db).unwrap();
    for secret in [
        b"password-secret".as_slice(),
        b"saved-cookie-secret".as_slice(),
        b"typo-password".as_slice(),
        b"enc1:literal-password".as_slice(),
    ] {
        assert!(!contains_bytes(&db_path, secret));
        assert!(!contains_bytes(
            &PathBuf::from(format!("{}-wal", db_path.display())),
            secret
        ));
    }

    let snapshot = saved_snapshot(&config).unwrap();
    let credential = snapshot
        .saved_credentials_list
        .iter()
        .find(|credential| credential.user.id == "usr_1")
        .unwrap();
    assert!(credential.has_login_credentials);
    assert!(credential.has_cookies);
    assert!(snapshot
        .saved_credentials_list
        .iter()
        .any(|credential| credential.user.id == "usr_literal" && credential.has_login_credentials));
    let session = saved_credential_session_data(&config, "usr_1")
        .unwrap()
        .unwrap();
    assert_eq!(session.cookies.as_deref(), Some("saved-cookie-secret"));

    let mut damaged = raw;
    damaged["usr_1"]["loginParams"]["password"] = Value::String(format!("{password}A"));
    damaged["usr_1"]["cookies"] = Value::String(format!("{cookies}A"));
    config
        .set_string("savedCredentials", &damaged.to_string())
        .unwrap();

    let snapshot = saved_snapshot(&config).unwrap();
    let credential = snapshot
        .saved_credentials_list
        .iter()
        .find(|credential| credential.user.id == "usr_1")
        .unwrap();
    assert!(!credential.has_login_credentials);
    assert!(!credential.has_cookies);
    assert_eq!(
        snapshot.auto_login_status,
        SavedAuthAutoLoginStatus::MissingCredentials
    );
    let cleaned = raw_saved_credentials(&config);
    assert!(cleaned["usr_1"].get("cookies").is_none());
    assert!(cleaned["usr_1"]["loginParams"].get("password").is_none());
    assert_eq!(
        saved_credential_session_data(&config, "usr_1")
            .unwrap()
            .unwrap()
            .cookies,
        None
    );

    config
        .set_string("savedCredentials", "{broken-json")
        .unwrap();
    assert!(migrate_saved_credential_secrets(&config).unwrap());
    assert_eq!(raw_saved_credentials(&config), json!({}));

    drop(config);
    drop(db);
}
