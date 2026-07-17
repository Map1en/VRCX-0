use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};
use vrcx_0_application::{delete_saved_credential, saved_snapshot};
use vrcx_0_persistence::{config::ConfigRepository, secrets::init_secrets, DatabaseService};

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

#[test]
fn headless_plaintext_passwords_preserve_literal_encrypted_prefixes() {
    let dir = TestDir::new("auth-credential-headless");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let db = Arc::new(DatabaseService::new(&db_path).unwrap());
    let config = ConfigRepository::new(db);
    init_secrets(Some([17; 32]), false);
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
                    "user": { "id": "usr_1" },
                    "loginParams": {
                        "username": "login@example.com",
                        "password": "ordinary-password",
                        "endpoint": "",
                        "websocket": ""
                    },
                    "cookies": "portable-saved-cookie"
                }
            })
            .to_string(),
        )
        .unwrap();

    delete_saved_credential(&config, "missing-user".into()).unwrap();
    let mut raw = raw_saved_credentials(&config);
    assert_eq!(raw["usr_1"]["loginParams"]["passwordStorage"], "plain");
    assert_eq!(raw["usr_1"]["cookies"], "portable-saved-cookie");
    assert!(!config
        .get_bool(
            vrcx_0_persistence::secrets::CLEANUP_COMPLETED_CONFIG_KEY,
            false,
        )
        .unwrap());

    raw["usr_1"]["loginParams"]["password"] = Value::String("enc1:literal-password".into());
    config
        .set_string("savedCredentials", &raw.to_string())
        .unwrap();

    for _ in 0..2 {
        let snapshot = saved_snapshot(&config).unwrap();
        assert_eq!(
            snapshot["savedCredentials"]["usr_1"]["hasLoginCredentials"],
            true
        );
        let raw = raw_saved_credentials(&config);
        assert_eq!(
            raw["usr_1"]["loginParams"]["password"],
            "enc1:literal-password"
        );
        assert_eq!(raw["usr_1"]["loginParams"]["passwordStorage"], "plain");
        assert_eq!(raw["usr_1"]["cookies"], "portable-saved-cookie");
    }

    config
        .set_bool(
            vrcx_0_persistence::secrets::CLEANUP_COMPLETED_CONFIG_KEY,
            true,
        )
        .unwrap();
    let raw_before_failed_write = config.get_raw("savedCredentials").unwrap();
    rusqlite::Connection::open(&db_path)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER block_cleanup_marker_delete
             BEFORE DELETE ON configs
             WHEN OLD.key = 'config:vrcx_secretsatrestcleanupcompletedv1'
             BEGIN
                 SELECT RAISE(ABORT, 'blocked cleanup marker delete');
             END;",
        )
        .unwrap();

    assert!(delete_saved_credential(&config, "missing-user".into()).is_err());
    assert!(config
        .get_bool(
            vrcx_0_persistence::secrets::CLEANUP_COMPLETED_CONFIG_KEY,
            false,
        )
        .unwrap());
    assert_eq!(
        config.get_raw("savedCredentials").unwrap(),
        raw_before_failed_write
    );
}
