use std::cell::Cell;

use rusqlite::{params, Connection};

use super::*;
use crate::legacy_vrcx::LegacyVrcxMigrationStatus;

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

    fn app_paths(&self) -> LegacyMigrationPaths {
        let app_data = self.path.join("VRCX-0");
        std::fs::create_dir_all(&app_data).unwrap();
        LegacyMigrationPaths::from_app_data(app_data)
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn write_file(path: &Path, contents: &[u8]) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, contents).unwrap();
}

fn open_test_database(path: &Path) -> Connection {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    let connection = Connection::open(path).unwrap();
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA wal_autocheckpoint=0;
             CREATE TABLE IF NOT EXISTS migration_test (value TEXT NOT NULL);",
        )
        .unwrap();
    connection
}

fn insert_value(connection: &Connection, value: &str) {
    connection
        .execute(
            "INSERT INTO migration_test (value) VALUES (?1)",
            params![value],
        )
        .unwrap();
}

fn read_values(path: &Path) -> Vec<String> {
    let connection = Connection::open(path).unwrap();
    let mut statement = connection
        .prepare("SELECT value FROM migration_test ORDER BY rowid")
        .unwrap();
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap()
}

fn source(db_path: PathBuf, config_path: Option<PathBuf>) -> LegacyVrcxSource {
    LegacyVrcxSource {
        db_path,
        config_path,
        version: 16,
    }
}

#[test]
fn prepares_consistent_snapshot_with_page_progress_without_mutating_source() {
    let dir = TestDir::new("legacy-consistent-snapshot");
    let paths = dir.app_paths();
    let legacy_dir = dir.path.join("VRCX");
    let legacy_db = legacy_dir.join("VRCX.sqlite3");
    let legacy_config = legacy_dir.join("VRCX.json");
    let connection = open_test_database(&legacy_db);
    insert_value(&connection, "before");
    insert_value(&connection, "committed-in-wal");
    write_file(&legacy_config, br#"{"VRCX_CloseToTray":"true"}"#);
    let mut progress = Vec::new();

    prepare_legacy_migration(
        &paths,
        &source(legacy_db.clone(), Some(legacy_config.clone())),
        |snapshot| progress.push(snapshot),
    )
    .unwrap();

    let staged_database = paths
        .app_data
        .join(STAGING_DIRECTORY)
        .join(STAGED_DATABASE_FILE);
    assert_eq!(
        read_values(&staged_database),
        ["before", "committed-in-wal"]
    );
    assert_eq!(read_values(&legacy_db), ["before", "committed-in-wal"]);
    assert_eq!(
        std::fs::read_to_string(legacy_config).unwrap(),
        r#"{"VRCX_CloseToTray":"true"}"#
    );
    assert!(progress.iter().any(|snapshot| matches!(
        snapshot,
        LegacyMigrationProgress::DatabaseCopy {
            completed_pages,
            total_pages
        } if *total_pages > 0 && completed_pages == total_pages
    )));
    assert!(progress.contains(&LegacyMigrationProgress::Configuration));
    assert!(progress.contains(&LegacyMigrationProgress::Finalizing));
    assert!(paths.app_data.join(PENDING_MIGRATION_FILE).is_file());
}

fn set_readonly(path: &Path) {
    let mut permissions = std::fs::metadata(path).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(path, permissions).unwrap();
}

#[test]
fn prepares_snapshot_from_read_only_legacy_config() {
    let dir = TestDir::new("legacy-read-only-config");
    let paths = dir.app_paths();
    let legacy_db = dir.path.join("VRCX").join("VRCX.sqlite3");
    let legacy_config = dir.path.join("VRCX").join("VRCX.json");
    let connection = open_test_database(&legacy_db);
    insert_value(&connection, "legacy");
    write_file(&legacy_config, br#"{"source":"legacy"}"#);
    set_readonly(&legacy_config);

    prepare_legacy_migration(&paths, &source(legacy_db, Some(legacy_config)), |_| {}).unwrap();

    assert_eq!(
        std::fs::read(
            paths
                .app_data
                .join(STAGING_DIRECTORY)
                .join(STAGED_CONFIG_FILE)
        )
        .unwrap(),
        br#"{"source":"legacy"}"#
    );
}

#[test]
fn startup_installs_staged_snapshot_without_reopening_legacy_source() {
    let dir = TestDir::new("legacy-staged-install");
    let paths = dir.app_paths();
    let legacy_db = dir.path.join("VRCX").join("VRCX.sqlite3");
    let legacy_config = dir.path.join("VRCX").join("VRCX.json");
    let source_connection = open_test_database(&legacy_db);
    insert_value(&source_connection, "legacy");
    write_file(&legacy_config, br#"{"source":"legacy"}"#);
    let target_connection = open_test_database(&paths.db_file);
    insert_value(&target_connection, "precreated");
    drop(target_connection);
    write_file(&paths.config_file, br#"{"source":"precreated"}"#);
    prepare_legacy_migration(&paths, &source(legacy_db, Some(legacy_config)), |_| {}).unwrap();
    let discovery_called = Cell::new(false);

    consume_pending_legacy_migration_with_discovery(&paths, || {
        discovery_called.set(true);
        LegacyVrcxDiscovery {
            importable_source: None,
            status: LegacyVrcxMigrationStatus::unavailable(),
        }
    })
    .unwrap();

    assert!(!discovery_called.get());
    assert_eq!(read_values(&paths.db_file), ["legacy"]);
    assert_eq!(
        std::fs::read_to_string(&paths.config_file).unwrap(),
        r#"{"source":"legacy"}"#
    );
    assert!(!paths.app_data.join(PENDING_MIGRATION_FILE).exists());
    assert!(!paths.app_data.join(STAGING_DIRECTORY).exists());
}

fn create_configs(connection: &Connection) {
    connection
        .execute_batch("CREATE TABLE IF NOT EXISTS configs (key TEXT PRIMARY KEY, value TEXT)")
        .unwrap();
}

fn read_config(path: &Path, key: &str) -> Option<String> {
    Connection::open(path)
        .unwrap()
        .query_row("SELECT value FROM configs WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .ok()
}

#[test]
fn staged_install_keeps_the_telemetry_error_cursor_of_the_replaced_database() {
    let dir = TestDir::new("legacy-keeps-error-cursor");
    let paths = dir.app_paths();
    let legacy_db = dir.path.join("VRCX").join("VRCX.sqlite3");
    let source_connection = open_test_database(&legacy_db);
    create_configs(&source_connection);
    drop(source_connection);
    let target_connection = open_test_database(&paths.db_file);
    create_configs(&target_connection);
    target_connection
        .execute(
            "INSERT INTO configs (key, value) VALUES ('config:vrcx_telemetryclienterrorcursor', '2026-11-25T05:26:50.000Z')",
            [],
        )
        .unwrap();
    drop(target_connection);
    prepare_legacy_migration(&paths, &source(legacy_db, None), |_| {}).unwrap();

    consume_pending_legacy_migration_with_discovery(&paths, || {
        LegacyVrcxDiscovery::without_source(LegacyVrcxMigrationStatus::unavailable())
    })
    .unwrap();

    assert_eq!(
        read_config(&paths.db_file, "config:vrcx_telemetryclienterrorcursor").as_deref(),
        Some("2026-11-25T05:26:50.000Z")
    );
}

#[test]
fn staged_install_keeps_the_telemetry_install_id_of_the_replaced_database() {
    let dir = TestDir::new("legacy-keeps-install-id");
    let paths = dir.app_paths();
    let legacy_db = dir.path.join("VRCX").join("VRCX.sqlite3");
    let source_connection = open_test_database(&legacy_db);
    create_configs(&source_connection);
    source_connection
        .execute(
            "INSERT INTO configs (key, value) VALUES ('config:vrcx_lastvrcxversion', '2025.12.01')",
            [],
        )
        .unwrap();
    drop(source_connection);
    let target_connection = open_test_database(&paths.db_file);
    create_configs(&target_connection);
    target_connection
        .execute(
            "INSERT INTO configs (key, value) VALUES ('config:vrcx_telemetryinstallid', 'install-before'), ('config:vrcx_telemetryconfigreportedversion', '2.31.0')",
            [],
        )
        .unwrap();
    drop(target_connection);
    prepare_legacy_migration(&paths, &source(legacy_db, None), |_| {}).unwrap();

    consume_pending_legacy_migration_with_discovery(&paths, || {
        LegacyVrcxDiscovery::without_source(LegacyVrcxMigrationStatus::unavailable())
    })
    .unwrap();

    assert_eq!(
        read_config(&paths.db_file, "config:vrcx_telemetryinstallid").as_deref(),
        Some("install-before")
    );
    assert_eq!(
        read_config(&paths.db_file, "config:vrcx_lastvrcxversion").as_deref(),
        Some("2025.12.01")
    );
    assert_eq!(
        read_config(&paths.db_file, "config:vrcx_telemetryconfigreportedversion"),
        None
    );
}

#[test]
fn old_pending_flag_uses_online_backup_compatibility_fallback() {
    let dir = TestDir::new("legacy-old-flag");
    let paths = dir.app_paths();
    let legacy_db = dir.path.join("VRCX").join("VRCX.sqlite3");
    let source_connection = open_test_database(&legacy_db);
    insert_value(&source_connection, "legacy");
    write_file(&paths.app_data.join(PENDING_MIGRATION_FILE), b"1");

    consume_pending_legacy_migration_with_discovery(&paths, || LegacyVrcxDiscovery {
        importable_source: Some(source(legacy_db, None)),
        status: LegacyVrcxMigrationStatus::unavailable(),
    })
    .unwrap();

    assert_eq!(read_values(&paths.db_file), ["legacy"]);
    assert!(!paths.config_file.exists());
    assert!(!paths.app_data.join(PENDING_MIGRATION_FILE).exists());
}

#[test]
fn preparation_failure_preserves_existing_targets_and_clears_partial_staging() {
    let dir = TestDir::new("legacy-prepare-failure");
    let paths = dir.app_paths();
    let legacy_db = dir.path.join("VRCX").join("VRCX.sqlite3");
    let bad_config = dir.path.join("VRCX").join("bad-config-directory");
    let source_connection = open_test_database(&legacy_db);
    insert_value(&source_connection, "legacy");
    std::fs::create_dir_all(&bad_config).unwrap();
    let target_connection = open_test_database(&paths.db_file);
    insert_value(&target_connection, "existing");
    drop(target_connection);
    write_file(&paths.config_file, b"existing-config");

    let result = prepare_legacy_migration(&paths, &source(legacy_db, Some(bad_config)), |_| {});

    assert!(result.is_err());
    assert_eq!(read_values(&paths.db_file), ["existing"]);
    assert_eq!(
        std::fs::read(&paths.config_file).unwrap(),
        b"existing-config"
    );
    assert!(!paths.app_data.join(PENDING_MIGRATION_FILE).exists());
    assert!(!paths.app_data.join(STAGING_DIRECTORY).exists());
}

#[test]
fn staged_install_failure_keeps_flag_and_snapshot_for_retry() {
    let dir = TestDir::new("legacy-staged-install-failure");
    let paths = dir.app_paths();
    let legacy_db = dir.path.join("VRCX").join("VRCX.sqlite3");
    let source_connection = open_test_database(&legacy_db);
    insert_value(&source_connection, "legacy");
    prepare_legacy_migration(&paths, &source(legacy_db, None), |_| {}).unwrap();
    std::fs::create_dir_all(&paths.db_file).unwrap();
    let discovery_called = Cell::new(false);
    let discover = || {
        discovery_called.set(true);
        LegacyVrcxDiscovery {
            importable_source: None,
            status: LegacyVrcxMigrationStatus::unavailable(),
        }
    };

    let failed = consume_pending_legacy_migration_with_discovery(&paths, discover);

    assert!(failed.is_err());
    assert!(paths.app_data.join(PENDING_MIGRATION_FILE).is_file());
    assert!(paths
        .app_data
        .join(STAGING_DIRECTORY)
        .join(STAGED_DATABASE_FILE)
        .is_file());

    std::fs::remove_dir_all(&paths.db_file).unwrap();
    consume_pending_legacy_migration_with_discovery(&paths, discover).unwrap();

    assert!(!discovery_called.get());
    assert_eq!(read_values(&paths.db_file), ["legacy"]);
    assert!(!paths.app_data.join(PENDING_MIGRATION_FILE).exists());
}

#[test]
fn stale_staged_flag_without_snapshot_is_discarded_without_recopying() {
    let dir = TestDir::new("legacy-stale-staged-flag");
    let paths = dir.app_paths();
    let migration_flag = paths.app_data.join(PENDING_MIGRATION_FILE);
    write_file(&paths.db_file, b"installed-db");
    write_file(&migration_flag, b"staged-v1");
    let discovery_called = Cell::new(false);

    consume_pending_legacy_migration_with_discovery(&paths, || {
        discovery_called.set(true);
        LegacyVrcxDiscovery {
            importable_source: None,
            status: LegacyVrcxMigrationStatus::unavailable(),
        }
    })
    .unwrap();

    assert!(!discovery_called.get());
    assert_eq!(std::fs::read(&paths.db_file).unwrap(), b"installed-db");
    assert!(!migration_flag.exists());
}

#[test]
fn copy_replace_failure_preserves_existing_destination() {
    let dir = TestDir::new("legacy-copy-preserves-destination");
    let source = dir.path.join("source-directory");
    let destination = dir.path.join("destination.json");
    std::fs::create_dir_all(&source).unwrap();
    write_file(&destination, b"existing-destination");

    let result = copy_replace(source, destination.clone());

    assert!(result.is_err());
    assert_eq!(std::fs::read(destination).unwrap(), b"existing-destination");
}

#[test]
fn completed_legacy_migration_is_idempotent_without_pending_flag() {
    let dir = TestDir::new("legacy-complete-idempotent");
    let paths = dir.app_paths();
    let legacy_db = dir.path.join("VRCX").join("VRCX.sqlite3");
    let source_connection = open_test_database(&legacy_db);
    insert_value(&source_connection, "v1");
    write_file(&paths.app_data.join(PENDING_MIGRATION_FILE), b"1");
    consume_pending_legacy_migration_with_discovery(&paths, || LegacyVrcxDiscovery {
        importable_source: Some(source(legacy_db.clone(), None)),
        status: LegacyVrcxMigrationStatus::unavailable(),
    })
    .unwrap();
    insert_value(&source_connection, "v2");

    consume_pending_legacy_migration_with_discovery(&paths, || LegacyVrcxDiscovery {
        importable_source: Some(source(legacy_db, None)),
        status: LegacyVrcxMigrationStatus::unavailable(),
    })
    .unwrap();

    assert_eq!(read_values(&paths.db_file), ["v1"]);
}

#[test]
fn request_legacy_migration_writes_durable_staged_flag() {
    let dir = TestDir::new("legacy-request-flag");
    let paths = dir.app_paths();

    request_legacy_migration(&paths).unwrap();

    assert_eq!(
        std::fs::read(paths.app_data.join(PENDING_MIGRATION_FILE)).unwrap(),
        b"staged-v1"
    );
}

#[test]
fn pending_legacy_migration_without_source_clears_flag_without_replacing_targets() {
    let dir = TestDir::new("legacy-pending-no-source");
    let paths = dir.app_paths();
    let migration_flag = paths.app_data.join(PENDING_MIGRATION_FILE);
    write_file(&paths.db_file, b"existing-db");
    write_file(&paths.config_file, b"existing-config");
    write_file(&migration_flag, b"1");

    consume_pending_legacy_migration_with_discovery(&paths, || LegacyVrcxDiscovery {
        importable_source: None,
        status: LegacyVrcxMigrationStatus {
            detected: true,
            available: false,
            version: None,
            db_path: None,
            config_path: None,
            reason: Some("Legacy source unavailable.".into()),
        },
    })
    .unwrap();

    assert_eq!(std::fs::read(&paths.db_file).unwrap(), b"existing-db");
    assert_eq!(
        std::fs::read(&paths.config_file).unwrap(),
        b"existing-config"
    );
    assert!(!migration_flag.exists());
}

#[test]
fn cleans_legacy_updater_artifacts_from_app_data() {
    let dir = TestDir::new("updater-cleanup");
    for name in [
        "update.exe",
        "VRCX-0_Setup.exe",
        "tempDownload",
        "tempDownload-123",
        "tempDownload2",
        "keep.txt",
    ] {
        write_file(&dir.path.join(name), b"artifact");
    }

    cleanup_legacy_updater_files(&dir.path);

    for removed in [
        "update.exe",
        "VRCX-0_Setup.exe",
        "tempDownload",
        "tempDownload-123",
    ] {
        assert!(
            !dir.path.join(removed).exists(),
            "{removed} should be removed"
        );
    }
    for kept in ["tempDownload2", "keep.txt"] {
        assert!(dir.path.join(kept).exists(), "{kept} should be kept");
    }
}
