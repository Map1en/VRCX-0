use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use vrcx_0_persistence::{
    config,
    cookies::{get_default_cookies, migrate_default_cookies, save_default_cookies},
    maintenance::vacuum_after_secret_migration,
    secrets::{init_secrets, is_sealed_secret, seal_secret},
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

fn read_raw_cookie(db_path: &Path) -> String {
    Connection::open(db_path)
        .unwrap()
        .query_row(
            "SELECT value FROM cookies WHERE key = 'default'",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

fn contains_bytes(path: &Path, needle: &[u8]) -> bool {
    std::fs::read(path)
        .ok()
        .is_some_and(|bytes| bytes.windows(needle.len()).any(|window| window == needle))
}

#[test]
fn secrets_at_rest_cookie_migration_roundtrips_and_rejects_damage() {
    let dir = TestDir::new("secrets-at-rest-cookie");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let connection = Connection::open(&db_path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE cookies (key TEXT PRIMARY KEY, value TEXT);
             INSERT INTO cookies (key, value) VALUES ('default', 'legacy-cookie-secret');",
        )
        .unwrap();
    drop(connection);

    let db = DatabaseService::new(&db_path).unwrap();
    assert_eq!(seal_secret("before-init"), "before-init");
    init_secrets(Some([3; 32]), true);
    config::set_bool(
        &db,
        vrcx_0_persistence::secrets::CLEANUP_COMPLETED_CONFIG_KEY,
        true,
    )
    .unwrap();

    assert!(migrate_default_cookies(&db).unwrap());
    assert!(!migrate_default_cookies(&db).unwrap());
    assert_eq!(
        get_default_cookies(&db).unwrap().as_deref(),
        Some("legacy-cookie-secret")
    );
    let sealed = read_raw_cookie(&db_path);
    assert!(is_sealed_secret(&sealed));
    assert!(!config::get_bool(
        &db,
        vrcx_0_persistence::secrets::CLEANUP_COMPLETED_CONFIG_KEY,
        false
    )
    .unwrap());

    vacuum_after_secret_migration(&db).unwrap();
    assert!(!contains_bytes(&db_path, b"legacy-cookie-secret"));
    assert!(!contains_bytes(
        &PathBuf::from(format!("{}-wal", db_path.display())),
        b"legacy-cookie-secret"
    ));

    let damaged = format!("{sealed}A");
    Connection::open(&db_path)
        .unwrap()
        .execute(
            "UPDATE cookies SET value = ?1 WHERE key = 'default'",
            params![damaged],
        )
        .unwrap();
    assert_eq!(get_default_cookies(&db).unwrap(), None);

    save_default_cookies(&db, "fresh-cookie-secret").unwrap();
    assert!(is_sealed_secret(&read_raw_cookie(&db_path)));
    assert_eq!(
        get_default_cookies(&db).unwrap().as_deref(),
        Some("fresh-cookie-secret")
    );

    drop(db);
}
