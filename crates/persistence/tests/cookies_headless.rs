use std::path::PathBuf;

use rusqlite::Connection;
use vrcx_0_persistence::{
    config,
    cookies::{get_default_cookies, save_default_cookies},
    secrets::{init_secrets, CLEANUP_COMPLETED_CONFIG_KEY},
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

#[test]
fn headless_plaintext_cookie_write_invalidates_completed_cleanup() {
    let dir = TestDir::new("cookies-headless");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let db = DatabaseService::new(&db_path).unwrap();
    init_secrets(Some([19; 32]), false);
    config::set_bool(&db, CLEANUP_COMPLETED_CONFIG_KEY, true).unwrap();

    save_default_cookies(&db, "portable-cookie-secret").unwrap();

    assert!(!config::get_bool(&db, CLEANUP_COMPLETED_CONFIG_KEY, false).unwrap());
    assert_eq!(
        get_default_cookies(&db).unwrap().as_deref(),
        Some("portable-cookie-secret")
    );
    let raw = Connection::open(&db_path)
        .unwrap()
        .query_row(
            "SELECT value FROM cookies WHERE key = 'default'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    assert_eq!(raw, "portable-cookie-secret");

    config::set_bool(&db, CLEANUP_COMPLETED_CONFIG_KEY, true).unwrap();
    Connection::open(&db_path)
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

    assert!(save_default_cookies(&db, "must-not-persist").is_err());
    assert!(config::get_bool(&db, CLEANUP_COMPLETED_CONFIG_KEY, false).unwrap());
    let raw_after_failed_write = Connection::open(&db_path)
        .unwrap()
        .query_row(
            "SELECT value FROM cookies WHERE key = 'default'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    assert_eq!(raw_after_failed_write, raw);
}
