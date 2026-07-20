use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use super::filesystem::copy_frozen_database_to_staging_with_verification_hook;
use super::*;
use crate::profile_backup::hash_file_with_progress;
use crate::{DatabaseService, FrozenDatabase, Result};

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-data-dir-migration-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn switched_journal(source: &Path, target: &Path) -> PendingDataDirMigration {
    let mut journal = PendingDataDirMigration::copying(
        source.to_string_lossy().into_owned(),
        target.to_string_lossy().into_owned(),
        "2026-07-18T00:00:00Z".into(),
        false,
    );
    journal.mark_switched(
        &StagedDataDirMigration {
            db_sha256: "abc123".into(),
            db_bytes: 3,
            wal_bytes: None,
        },
        None,
    );
    journal
}

#[test]
fn journal_round_trips_and_rejects_incomplete_switched_state() -> Result<()> {
    let dir = TestDir::new("journal");
    let mut journal = PendingDataDirMigration::copying(
        "source".into(),
        "target".into(),
        "2026-07-18T00:00:00Z".into(),
        true,
    );
    write_pending_data_dir_migration(&dir.path, &journal)?;
    assert_eq!(
        read_pending_data_dir_migration(&dir.path)?,
        Some(journal.clone())
    );

    journal.phase = DataDirMigrationJournalPhase::Switched;
    assert!(write_pending_data_dir_migration(&dir.path, &journal).is_err());

    journal.mark_switched(
        &StagedDataDirMigration {
            db_sha256: "hash".into(),
            db_bytes: 42,
            wal_bytes: Some(7),
        },
        Some("replaced".into()),
    );
    write_pending_data_dir_migration(&dir.path, &journal)?;
    assert_eq!(read_pending_data_dir_migration(&dir.path)?, Some(journal));

    fs::write(
        migration_journal_path(&dir.path),
        br#"{"journalVersion":1,"phase":"unknown","sourceDir":"source","targetDir":"target","requestedAt":"now","replaceExisting":false}"#,
    )?;
    assert!(read_pending_data_dir_migration(&dir.path).is_err());
    Ok(())
}

#[test]
fn target_inspection_distinguishes_empty_existing_and_foreign_content() -> Result<()> {
    let dir = TestDir::new("target-state");
    let target = dir.path.join("target");
    fs::create_dir(&target)?;
    assert_eq!(
        inspect_data_dir_migration_target(&target)?,
        DataDirMigrationTargetState::Empty
    );
    fs::write(target.join("notes.txt"), b"unknown")?;
    assert_eq!(
        inspect_data_dir_migration_target(&target)?,
        DataDirMigrationTargetState::ForeignContent
    );
    fs::write(target.join("VRCX-0.sqlite3"), b"profile")?;
    assert_eq!(
        inspect_data_dir_migration_target(&target)?,
        DataDirMigrationTargetState::ExistingProfile
    );
    Ok(())
}

#[test]
fn required_bytes_counts_only_migrated_data() -> Result<()> {
    let dir = TestDir::new("required-bytes");
    fs::write(dir.path.join("VRCX-0.sqlite3"), b"database")?;
    fs::write(dir.path.join("VRCX-0.sqlite3-wal"), b"wal")?;
    fs::write(dir.path.join("VRCX-0.sqlite3-shm"), b"ignored-shm")?;
    fs::write(dir.path.join("VRCX-0.json"), b"config")?;
    fs::write(dir.path.join("metadataCache.db"), b"metadata")?;
    fs::create_dir(dir.path.join("ScreenshotThumbs"))?;
    fs::write(
        dir.path.join("ScreenshotThumbs").join("thumb.webp"),
        b"thumb",
    )?;
    fs::create_dir(dir.path.join("ImageCache"))?;
    fs::write(dir.path.join("ImageCache").join("ignored"), b"cache")?;

    assert_eq!(
        data_dir_migration_required_bytes(&dir.path)?,
        8 + 3 + 6 + 8 + 5
    );
    Ok(())
}

#[test]
fn frozen_database_copies_verifies_and_installs_without_shm() -> Result<()> {
    let dir = TestDir::new("copy-install");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    fs::create_dir(&source)?;
    fs::create_dir(&target)?;
    let db_path = source.join("VRCX-0.sqlite3");
    let db = DatabaseService::new(&db_path)?;
    let empty = HashMap::new();
    db.execute_non_query("CREATE TABLE migration_items (value TEXT NOT NULL)", &empty)?;
    db.execute_non_query(
        "INSERT INTO migration_items (value) VALUES ('copied')",
        &empty,
    )?;
    let frozen = db.freeze_for_migration()?;
    fs::write(source.join("VRCX-0.sqlite3-shm"), b"must not copy")?;
    let source_hash = hash_file_with_progress(&frozen.db_path, |_, _| {})?;
    let mut last_progress = (0, 0);

    let copied = copy_frozen_database_to_staging(&frozen, &target, |processed, total| {
        last_progress = (processed, total);
    })?;
    let replaced = install_staged_data_dir_database(&target, false)?;

    assert!(replaced.is_none());
    assert_eq!(copied.db_sha256, source_hash.0);
    assert_eq!(copied.db_bytes, source_hash.1);
    assert_eq!(last_progress.0, last_progress.1);
    assert!(!target.join("VRCX-0.sqlite3-shm").exists());
    let target_db = Connection::open_with_flags(
        target.join("VRCX-0.sqlite3"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|error| crate::Error::Database(error.to_string()))?;
    let value: String = target_db
        .query_row("SELECT value FROM migration_items", [], |row| row.get(0))
        .map_err(|error| crate::Error::Database(error.to_string()))?;
    assert_eq!(value, "copied");
    assert_eq!(
        hash_file_with_progress(&frozen.db_path, |_, _| {})?,
        source_hash
    );
    Ok(())
}

#[test]
fn copy_detects_target_tampering_and_abort_reopens_source_database() -> Result<()> {
    let dir = TestDir::new("copy-tamper");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    fs::create_dir(&source)?;
    fs::create_dir(&target)?;
    let db = DatabaseService::new(&source.join("VRCX-0.sqlite3"))?;
    let empty = HashMap::new();
    db.execute_non_query("CREATE TABLE migration_items (value TEXT NOT NULL)", &empty)?;
    let frozen = db.freeze_for_migration()?;

    let result = copy_frozen_database_to_staging_with_verification_hook(
        &frozen,
        &target,
        |_, _| true,
        |staged_db| {
            let mut file = fs::OpenOptions::new().append(true).open(staged_db)?;
            file.write_all(b"tampered")?;
            Ok(())
        },
    );

    assert!(result.is_err());
    db.reopen_after_migration_abort()?;
    assert!(db.is_main_mode());
    db.execute_non_query(
        "INSERT INTO migration_items (value) VALUES ('writable-again')",
        &empty,
    )?;
    Ok(())
}

#[test]
fn cancellable_copy_stops_before_finishing_the_database() -> Result<()> {
    let dir = TestDir::new("copy-cancelled");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    fs::create_dir(&source)?;
    fs::create_dir(&target)?;
    let db_path = source.join("VRCX-0.sqlite3");
    fs::write(&db_path, vec![1_u8; 512 * 1024])?;
    let frozen = FrozenDatabase {
        db_path,
        db_bytes: 512 * 1024,
        wal_path: None,
        wal_bytes: None,
    };

    let result = copy_frozen_database_to_staging_cancellable(&frozen, &target, |processed, _| {
        processed == 0
    });

    assert!(result.is_err());
    let partial = target
        .join(DATA_DIR_MIGRATION_STAGING_DIRECTORY)
        .join("VRCX-0.sqlite3");
    assert!(fs::metadata(partial)?.len() < frozen.db_bytes);
    Ok(())
}

#[test]
fn copy_includes_nonempty_wal_and_never_copies_shm() -> Result<()> {
    let dir = TestDir::new("copy-wal");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    fs::create_dir(&source)?;
    fs::create_dir(&target)?;
    let db_path = source.join("VRCX-0.sqlite3");
    let wal_path = source.join("VRCX-0.sqlite3-wal");
    fs::write(&db_path, b"database")?;
    fs::write(&wal_path, b"wal")?;
    fs::write(source.join("VRCX-0.sqlite3-shm"), b"shm")?;
    let frozen = FrozenDatabase {
        db_path,
        db_bytes: 8,
        wal_path: Some(wal_path),
        wal_bytes: Some(3),
    };

    let copied = copy_frozen_database_to_staging(&frozen, &target, |_, _| {})?;

    assert_eq!(copied.wal_bytes, Some(3));
    let staging = target.join(DATA_DIR_MIGRATION_STAGING_DIRECTORY);
    assert_eq!(fs::read(staging.join("VRCX-0.sqlite3-wal"))?, b"wal");
    assert!(!staging.join("VRCX-0.sqlite3-shm").exists());
    Ok(())
}

#[test]
fn replacing_existing_profile_preserves_target_files() -> Result<()> {
    let dir = TestDir::new("replace-existing");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    fs::create_dir(&source)?;
    fs::create_dir(&target)?;
    let db_path = source.join("VRCX-0.sqlite3");
    fs::write(&db_path, b"new-database")?;
    fs::write(target.join("VRCX-0.sqlite3"), b"old-database")?;
    fs::write(target.join("VRCX-0.json"), b"old-config")?;
    fs::create_dir(target.join("ScreenshotThumbs"))?;
    fs::write(
        target.join("ScreenshotThumbs").join("old.webp"),
        b"old-thumbnail",
    )?;
    let frozen = FrozenDatabase {
        db_path,
        db_bytes: 12,
        wal_path: None,
        wal_bytes: None,
    };
    copy_frozen_database_to_staging(&frozen, &target, |_, _| {})?;

    let replaced = install_staged_data_dir_database(&target, true)?.expect("replaced directory");

    assert_eq!(fs::read(target.join("VRCX-0.sqlite3"))?, b"new-database");
    assert_eq!(fs::read(replaced.join("VRCX-0.sqlite3"))?, b"old-database");
    assert_eq!(fs::read(replaced.join("VRCX-0.json"))?, b"old-config");
    assert_eq!(
        fs::read(replaced.join("ScreenshotThumbs").join("old.webp"))?,
        b"old-thumbnail"
    );
    Ok(())
}

#[test]
fn finalize_is_idempotent_copies_best_effort_data_and_removes_only_pure_caches() -> Result<()> {
    let dir = TestDir::new("finalize");
    let control = dir.path.join("control");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    for path in [&control, &source, &target] {
        fs::create_dir(path)?;
    }
    fs::write(source.join("VRCX-0.sqlite3"), b"source-db")?;
    fs::write(source.join("VRCX-0.json"), b"source-config")?;
    fs::write(source.join("metadataCache.db"), b"metadata")?;
    fs::create_dir(source.join("ScreenshotThumbs"))?;
    fs::write(
        source.join("ScreenshotThumbs").join("thumb.webp"),
        b"thumbnail",
    )?;
    fs::create_dir(source.join("ImageCache"))?;
    fs::write(source.join("ImageCache").join("cached.bin"), b"cache")?;
    fs::write(source.join("ws-events.jsonl"), b"events")?;
    fs::write(source.join("unknown.txt"), b"unknown")?;
    fs::write(target.join("VRCX-0.sqlite3"), b"target-db")?;
    let journal = switched_journal(&source, &target);

    let first = finalize_data_dir_migration(&control, &journal)?;
    let second = finalize_data_dir_migration(&control, &journal)?;

    assert!(first.warnings.is_empty());
    assert!(second.warnings.is_empty());
    assert_eq!(fs::read(target.join("VRCX-0.json"))?, b"source-config");
    assert_eq!(fs::read(target.join("metadataCache.db"))?, b"metadata");
    assert_eq!(
        fs::read(target.join("ScreenshotThumbs").join("thumb.webp"))?,
        b"thumbnail"
    );
    assert_eq!(fs::read(source.join("VRCX-0.sqlite3"))?, b"source-db");
    assert_eq!(fs::read(source.join("VRCX-0.json"))?, b"source-config");
    assert!(!source.join("ImageCache").exists());
    assert!(!source.join("ws-events.jsonl").exists());
    assert_eq!(fs::read(source.join("unknown.txt"))?, b"unknown");
    assert!(read_data_dir_cleanup_pending(&control)?.is_none());
    complete_data_dir_migration(&control, &journal, &first)?;
    complete_data_dir_migration(&control, &journal, &second)?;
    assert_eq!(
        read_data_dir_cleanup_pending(&control)?,
        Some(second.cleanup_pending)
    );
    Ok(())
}

#[test]
fn finalize_reports_config_and_gallery_copy_failures_without_failing() -> Result<()> {
    let dir = TestDir::new("finalize-warnings");
    let control = dir.path.join("control");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    for path in [&control, &source, &target] {
        fs::create_dir(path)?;
    }
    fs::create_dir(source.join("VRCX-0.json"))?;
    fs::create_dir(source.join("metadataCache.db"))?;
    let journal = switched_journal(&source, &target);

    let outcome = finalize_data_dir_migration(&control, &journal)?;

    assert!(outcome
        .warnings
        .contains(&DataDirMigrationWarning::ConfigCopyFailed));
    assert!(outcome
        .warnings
        .contains(&DataDirMigrationWarning::GalleryCopyFailed));
    Ok(())
}

#[test]
fn interrupted_copy_removes_only_staging_and_records_result() -> Result<()> {
    let dir = TestDir::new("interrupted");
    let control = dir.path.join("control");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    for path in [&control, &source, &target] {
        fs::create_dir(path)?;
    }
    let staging = target.join(DATA_DIR_MIGRATION_STAGING_DIRECTORY);
    fs::create_dir(&staging)?;
    fs::write(staging.join("partial"), b"partial")?;
    fs::write(source.join("VRCX-0.sqlite3"), b"source")?;
    let journal = PendingDataDirMigration::copying(
        source.to_string_lossy().into_owned(),
        target.to_string_lossy().into_owned(),
        "2026-07-18T00:00:00Z".into(),
        false,
    );
    write_pending_data_dir_migration(&control, &journal)?;

    cleanup_interrupted_data_dir_migration(&control, &journal)?;

    assert!(!staging.exists());
    assert_eq!(fs::read(source.join("VRCX-0.sqlite3"))?, b"source");
    assert!(!has_pending_data_dir_migration(&control));
    assert_eq!(
        take_data_dir_migration_result(&control)?
            .expect("interrupted result")
            .status,
        DataDirMigrationResultStatus::Interrupted
    );
    Ok(())
}

#[test]
fn cleanup_removes_only_manifest_entries_and_preserves_control_and_unknown_files() -> Result<()> {
    let dir = TestDir::new("cleanup");
    let old = dir.path.join("old");
    let current = dir.path.join("current");
    fs::create_dir(&old)?;
    fs::create_dir(&current)?;
    fs::write(old.join("VRCX-0.sqlite3"), b"db")?;
    fs::write(old.join("VRCX-0.json"), b"config")?;
    fs::create_dir(old.join("ScreenshotThumbs"))?;
    fs::write(old.join("ScreenshotThumbs").join("thumb.webp"), b"thumb")?;
    fs::write(old.join("unknown.txt"), b"unknown")?;
    fs::write(old.join("VRCX-0.data-dir.json"), b"pointer")?;
    fs::write(
        old.join(DATA_DIR_MIGRATION_JOURNAL_FILE_NAME),
        b"control-journal",
    )?;
    fs::write(
        old.join(DATA_DIR_MIGRATION_RESULT_FILE_NAME),
        b"control-result",
    )?;
    let replaced = current.join(format!(
        "{DATA_DIR_MIGRATION_REPLACED_PREFIX}20260718-000000"
    ));
    fs::create_dir(&replaced)?;
    fs::write(replaced.join("old.db"), b"replaced")?;
    let pending = DataDirCleanupPending {
        old_dir: old.to_string_lossy().into_owned(),
        bytes: 0,
        migrated_at: "2026-07-18T00:00:00Z".into(),
        last_prompted_at: None,
        dismissed: false,
        replaced_dir: Some(replaced.to_string_lossy().into_owned()),
    };
    write_data_dir_cleanup_pending(&old, &pending)?;

    let report = cleanup_migrated_data(&old, &current, &pending)?;

    assert!(report.skipped.is_empty());
    assert_eq!(report.freed_bytes, 2 + 6 + 5 + 8);
    assert!(!old.join("VRCX-0.sqlite3").exists());
    assert!(!old.join("VRCX-0.json").exists());
    assert!(!old.join("ScreenshotThumbs").exists());
    assert!(!replaced.exists());
    assert_eq!(fs::read(old.join("unknown.txt"))?, b"unknown");
    assert_eq!(fs::read(old.join("VRCX-0.data-dir.json"))?, b"pointer");
    assert!(old.join(DATA_DIR_MIGRATION_JOURNAL_FILE_NAME).exists());
    assert!(old.join(DATA_DIR_MIGRATION_RESULT_FILE_NAME).exists());
    assert!(!old.join(DATA_DIR_CLEANUP_PENDING_FILE_NAME).exists());
    Ok(())
}

#[test]
fn cleanup_rejects_the_active_data_directory() -> Result<()> {
    let dir = TestDir::new("cleanup-active");
    fs::write(dir.path.join("VRCX-0.sqlite3"), b"db")?;
    let pending = DataDirCleanupPending {
        old_dir: dir.path.to_string_lossy().into_owned(),
        bytes: 2,
        migrated_at: "2026-07-18T00:00:00Z".into(),
        last_prompted_at: None,
        dismissed: false,
        replaced_dir: None,
    };

    assert!(cleanup_migrated_data(&dir.path, &dir.path, &pending).is_err());
    assert_eq!(fs::read(dir.path.join("VRCX-0.sqlite3"))?, b"db");
    Ok(())
}

#[test]
fn cleanup_completes_when_the_old_directory_was_already_removed() -> Result<()> {
    let dir = TestDir::new("cleanup-missing");
    let current = dir.path.join("current");
    let old = dir.path.join("already-removed");
    fs::create_dir(&current)?;
    let pending = DataDirCleanupPending {
        old_dir: old.to_string_lossy().into_owned(),
        bytes: 0,
        migrated_at: "2026-07-18T00:00:00Z".into(),
        last_prompted_at: None,
        dismissed: false,
        replaced_dir: None,
    };
    write_data_dir_cleanup_pending(&dir.path, &pending)?;

    let report = cleanup_migrated_data(&dir.path, &current, &pending)?;

    assert!(report.skipped.is_empty());
    assert_eq!(report.freed_bytes, 0);
    assert!(read_data_dir_cleanup_pending(&dir.path)?.is_none());
    Ok(())
}

#[test]
fn cleanup_pending_queue_preserves_and_promotes_older_migrations() -> Result<()> {
    let dir = TestDir::new("cleanup-queue");
    let first = DataDirCleanupPending {
        old_dir: dir.path.join("first").to_string_lossy().into_owned(),
        bytes: 1,
        migrated_at: "2026-07-18T00:00:00Z".into(),
        last_prompted_at: None,
        dismissed: false,
        replaced_dir: None,
    };
    let second = DataDirCleanupPending {
        old_dir: dir.path.join("second").to_string_lossy().into_owned(),
        bytes: 2,
        migrated_at: "2026-07-19T00:00:00Z".into(),
        last_prompted_at: None,
        dismissed: false,
        replaced_dir: None,
    };

    super::journal::append_data_dir_cleanup_pending(&dir.path, &first)?;
    super::journal::append_data_dir_cleanup_pending(&dir.path, &second)?;
    super::journal::append_data_dir_cleanup_pending(&dir.path, &second)?;

    assert_eq!(
        read_data_dir_cleanup_pendings(&dir.path)?,
        vec![first.clone(), second.clone()]
    );
    let mut dismissed_first = first.clone();
    dismissed_first.dismissed = true;
    write_data_dir_cleanup_pending(&dir.path, &dismissed_first)?;
    super::journal::append_data_dir_cleanup_pending(&dir.path, &first)?;
    assert_eq!(
        read_data_dir_cleanup_pendings(&dir.path)?,
        vec![second.clone(), dismissed_first.clone()]
    );
    remove_data_dir_cleanup_pending(&dir.path)?;
    assert_eq!(
        read_data_dir_cleanup_pending(&dir.path)?,
        Some(dismissed_first)
    );
    Ok(())
}

#[test]
fn database_open_failure_preserves_an_older_cleanup_pending() -> Result<()> {
    let dir = TestDir::new("database-open-failure");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    fs::create_dir(&source)?;
    fs::create_dir(&target)?;
    let journal = switched_journal(&source, &target);
    write_pending_data_dir_migration(&dir.path, &journal)?;
    write_data_dir_cleanup_pending(
        &dir.path,
        &DataDirCleanupPending {
            old_dir: dir.path.join("older-source").to_string_lossy().into_owned(),
            bytes: 1,
            migrated_at: journal.requested_at.clone(),
            last_prompted_at: None,
            dismissed: false,
            replaced_dir: None,
        },
    )?;

    record_data_dir_migration_database_open_failure(&dir.path, &journal)?;

    assert!(!has_pending_data_dir_migration(&dir.path));
    assert_eq!(
        read_data_dir_cleanup_pending(&dir.path)?
            .expect("older cleanup pending")
            .old_dir,
        dir.path.join("older-source").to_string_lossy()
    );
    assert_eq!(
        take_data_dir_migration_result(&dir.path)?
            .expect("database open failure result")
            .status,
        DataDirMigrationResultStatus::DatabaseOpenFailed
    );
    Ok(())
}
