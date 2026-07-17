use super::*;

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

fn write_file(path: &Path, contents: &[u8]) -> Result<(), Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, contents)?;
    Ok(())
}

fn read_file(path: &Path) -> Result<Vec<u8>, Error> {
    Ok(std::fs::read(path)?)
}

#[test]
fn copies_legacy_vrcx_data_into_empty_vrcx0_targets() -> Result<(), Error> {
    let dir = TestDir::new("legacy-copy");
    let paths = dir.app_paths();
    let legacy_dir = dir.path.join("VRCX");
    let legacy_db = legacy_dir.join("VRCX.sqlite3");
    let legacy_config = legacy_dir.join("VRCX.json");

    write_file(&legacy_db, b"legacy-db")?;
    write_file(&sidecar_path(&legacy_db, "shm"), b"legacy-shm")?;
    write_file(&sidecar_path(&legacy_db, "wal"), b"legacy-wal")?;
    write_file(&legacy_config, br#"{"VRCX_CloseToTray":"true"}"#)?;

    let source = LegacyVrcxSource {
        db_path: legacy_db,
        config_path: Some(legacy_config),
        version: 16,
    };

    copy_legacy_vrcx_data(&paths, &source)?;

    assert_eq!(std::fs::read(&paths.db_file)?, b"legacy-db");
    assert_eq!(
        std::fs::read(paths.app_data.join("VRCX-0.sqlite3-shm"))?,
        b"legacy-shm"
    );
    assert_eq!(
        std::fs::read(paths.app_data.join("VRCX-0.sqlite3-wal"))?,
        b"legacy-wal"
    );
    assert_eq!(
        std::fs::read_to_string(&paths.config_file)?,
        r#"{"VRCX_CloseToTray":"true"}"#
    );
    Ok(())
}

#[test]
fn copying_legacy_vrcx_data_never_mutates_source_files() -> Result<(), Error> {
    let dir = TestDir::new("legacy-source-unchanged");
    let paths = dir.app_paths();
    let legacy_dir = dir.path.join("VRCX");
    let legacy_db = legacy_dir.join("VRCX.sqlite3");
    let legacy_shm = sidecar_path(&legacy_db, "shm");
    let legacy_wal = sidecar_path(&legacy_db, "wal");
    let legacy_config = legacy_dir.join("VRCX.json");

    write_file(&legacy_db, b"legacy-db")?;
    write_file(&legacy_shm, b"legacy-shm")?;
    write_file(&legacy_wal, b"legacy-wal")?;
    write_file(&legacy_config, br#"{"VRCX_CloseToTray":"true"}"#)?;
    let before = [
        read_file(&legacy_db)?,
        read_file(&legacy_shm)?,
        read_file(&legacy_wal)?,
        read_file(&legacy_config)?,
    ];

    copy_legacy_vrcx_data(
        &paths,
        &LegacyVrcxSource {
            db_path: legacy_db.clone(),
            config_path: Some(legacy_config.clone()),
            version: 16,
        },
    )?;

    let after = [
        read_file(&legacy_db)?,
        read_file(&legacy_shm)?,
        read_file(&legacy_wal)?,
        read_file(&legacy_config)?,
    ];
    assert_eq!(after, before);
    Ok(())
}

#[test]
fn removes_stale_vrcx0_sidecars_when_legacy_sidecars_are_missing() -> Result<(), Error> {
    let dir = TestDir::new("legacy-sidecars");
    let paths = dir.app_paths();
    let legacy_db = dir.path.join("VRCX").join("VRCX.sqlite3");

    write_file(&legacy_db, b"legacy-db")?;
    write_file(&paths.config_file, b"stale-config")?;
    write_file(&paths.app_data.join("VRCX-0.sqlite3-shm"), b"stale-shm")?;
    write_file(&paths.app_data.join("VRCX-0.sqlite3-wal"), b"stale-wal")?;

    let source = LegacyVrcxSource {
        db_path: legacy_db,
        config_path: None,
        version: 16,
    };

    copy_legacy_vrcx_data(&paths, &source)?;

    assert_eq!(std::fs::read(&paths.db_file)?, b"legacy-db");
    assert!(!paths.config_file.exists());
    assert!(!paths.app_data.join("VRCX-0.sqlite3-shm").exists());
    assert!(!paths.app_data.join("VRCX-0.sqlite3-wal").exists());
    Ok(())
}

#[test]
fn confirmed_legacy_migration_replaces_precreated_vrcx0_targets() -> Result<(), Error> {
    let dir = TestDir::new("legacy-pending-replace");
    let paths = dir.app_paths();
    let migration_flag = paths.app_data.join("pending_vrcx_migration");
    let legacy_dir = dir.path.join("VRCX");
    let legacy_db = legacy_dir.join("VRCX.sqlite3");
    let legacy_config = legacy_dir.join("VRCX.json");

    write_file(&legacy_db, b"legacy-db")?;
    write_file(&legacy_config, br#"{"VRCX_CloseToTray":"true"}"#)?;
    write_file(&paths.db_file, b"precreated-db")?;
    write_file(&paths.config_file, b"{}")?;
    write_file(&migration_flag, b"1")?;

    consume_pending_legacy_migration_with_discovery(&paths, || {
        (
            Some(LegacyVrcxSource {
                db_path: legacy_db,
                config_path: Some(legacy_config),
                version: 16,
            }),
            LegacyVrcxMigrationStatus::unavailable(),
        )
    })?;

    assert_eq!(std::fs::read(&paths.db_file)?, b"legacy-db");
    assert_eq!(
        std::fs::read_to_string(&paths.config_file)?,
        r#"{"VRCX_CloseToTray":"true"}"#
    );
    assert!(!migration_flag.exists());
    Ok(())
}

#[test]
fn pending_legacy_migration_survives_partial_failure_and_can_retry() -> Result<(), Error> {
    let dir = TestDir::new("legacy-pending-retry");
    let paths = dir.app_paths();
    let migration_flag = paths.app_data.join("pending_vrcx_migration");
    let legacy_dir = dir.path.join("VRCX");
    let legacy_db = legacy_dir.join("VRCX.sqlite3");
    let legacy_config = legacy_dir.join("VRCX.json");
    let bad_config_source = legacy_dir.join("bad-config-dir");

    write_file(&legacy_db, b"legacy-db")?;
    std::fs::create_dir_all(&bad_config_source)?;
    write_file(&paths.db_file, b"precreated-db")?;
    write_file(&paths.config_file, b"precreated-config")?;
    write_file(&migration_flag, b"1")?;

    let failed = consume_pending_legacy_migration_with_discovery(&paths, || {
        (
            Some(LegacyVrcxSource {
                db_path: legacy_db.clone(),
                config_path: Some(bad_config_source.clone()),
                version: 16,
            }),
            LegacyVrcxMigrationStatus::unavailable(),
        )
    });
    assert!(failed.is_err());
    assert!(migration_flag.exists());

    std::fs::remove_dir_all(&bad_config_source)?;
    write_file(&legacy_config, br#"{"VRCX_CloseToTray":"true"}"#)?;

    consume_pending_legacy_migration_with_discovery(&paths, || {
        (
            Some(LegacyVrcxSource {
                db_path: legacy_db,
                config_path: Some(legacy_config),
                version: 16,
            }),
            LegacyVrcxMigrationStatus::unavailable(),
        )
    })?;

    assert_eq!(std::fs::read(&paths.db_file)?, b"legacy-db");
    assert_eq!(
        std::fs::read_to_string(&paths.config_file)?,
        r#"{"VRCX_CloseToTray":"true"}"#
    );
    assert!(!migration_flag.exists());
    Ok(())
}

#[test]
fn completed_legacy_migration_is_idempotent_without_pending_flag() -> Result<(), Error> {
    let dir = TestDir::new("legacy-complete-idempotent");
    let paths = dir.app_paths();
    let migration_flag = paths.app_data.join("pending_vrcx_migration");
    let legacy_dir = dir.path.join("VRCX");
    let legacy_db = legacy_dir.join("VRCX.sqlite3");
    let legacy_config = legacy_dir.join("VRCX.json");

    write_file(&legacy_db, b"legacy-db-v1")?;
    write_file(&legacy_config, br#"{"value":"v1"}"#)?;
    write_file(&migration_flag, b"1")?;
    consume_pending_legacy_migration_with_discovery(&paths, || {
        (
            Some(LegacyVrcxSource {
                db_path: legacy_db.clone(),
                config_path: Some(legacy_config.clone()),
                version: 16,
            }),
            LegacyVrcxMigrationStatus::unavailable(),
        )
    })?;
    assert!(!migration_flag.exists());

    write_file(&legacy_db, b"legacy-db-v2")?;
    write_file(&legacy_config, br#"{"value":"v2"}"#)?;
    consume_pending_legacy_migration_with_discovery(&paths, || {
        (
            Some(LegacyVrcxSource {
                db_path: legacy_db,
                config_path: Some(legacy_config),
                version: 16,
            }),
            LegacyVrcxMigrationStatus::unavailable(),
        )
    })?;

    assert_eq!(std::fs::read(&paths.db_file)?, b"legacy-db-v1");
    assert_eq!(
        std::fs::read_to_string(&paths.config_file)?,
        r#"{"value":"v1"}"#
    );
    Ok(())
}

#[test]
fn request_legacy_migration_writes_pending_flag() -> Result<(), Error> {
    let dir = TestDir::new("legacy-request-flag");
    let paths = dir.app_paths();

    request_legacy_migration(&paths)?;

    assert_eq!(
        std::fs::read(paths.app_data.join("pending_vrcx_migration"))?,
        b"1"
    );
    Ok(())
}

#[test]
fn pending_legacy_migration_without_source_clears_flag_without_replacing_targets(
) -> Result<(), Error> {
    let dir = TestDir::new("legacy-pending-no-source");
    let paths = dir.app_paths();
    let migration_flag = paths.app_data.join("pending_vrcx_migration");

    write_file(&paths.db_file, b"existing-db")?;
    write_file(&paths.config_file, b"existing-config")?;
    write_file(&migration_flag, b"1")?;

    consume_pending_legacy_migration_with_discovery(&paths, || {
        (
            None,
            LegacyVrcxMigrationStatus {
                detected: true,
                available: false,
                version: None,
                db_path: None,
                config_path: None,
                reason: Some("Legacy source unavailable.".into()),
            },
        )
    })?;

    assert_eq!(std::fs::read(&paths.db_file)?, b"existing-db");
    assert_eq!(std::fs::read(&paths.config_file)?, b"existing-config");
    assert!(!migration_flag.exists());
    Ok(())
}

#[test]
fn cleans_legacy_updater_artifacts_from_app_data() -> Result<(), Error> {
    let dir = TestDir::new("updater-cleanup");

    for name in [
        "update.exe",
        "VRCX-0_Setup.exe",
        "tempDownload",
        "tempDownload-123",
        "tempDownload2",
        "keep.txt",
    ] {
        write_file(&dir.path.join(name), b"artifact")?;
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
    Ok(())
}
