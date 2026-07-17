use std::fs;

use crate::profile_backup::{
    BACKUP_STAGING_DIRECTORY, DATABASE_FILE_NAME, RESTORE_PENDING_DIRECTORY,
    RESTORE_ROLLBACK_DIRECTORY,
};

use super::super::journal::active_rollback_directory_name;
use super::super::{
    cleanup_profile_backup_artifacts, clear_profile_restore_rollbacks, has_pending_profile_restore,
    profile_restore_rollback_count,
};
use super::common::{prepare_restore, TestDir};

#[test]
fn profile_restore_rollback_count_ignores_empty_and_invalid_directories() {
    let dir = TestDir::new("rollback-count-empty");
    let app_data = dir.0.join("app");

    assert_eq!(profile_restore_rollback_count(&app_data).unwrap(), 0);

    let rollback_root = app_data.join(RESTORE_ROLLBACK_DIRECTORY);
    fs::create_dir_all(rollback_root.join("20990710-000000")).unwrap();
    let invalid = rollback_root.join("not-a-rollback");
    fs::create_dir_all(&invalid).unwrap();
    fs::write(invalid.join(DATABASE_FILE_NAME), b"invalid").unwrap();

    assert_eq!(profile_restore_rollback_count(&app_data).unwrap(), 0);
}

#[test]
fn profile_restore_rollback_count_reports_database_families() {
    let dir = TestDir::new("rollback-count-data");
    let rollback_root = dir.0.join("app").join(RESTORE_ROLLBACK_DIRECTORY);
    for (name, file_name) in [
        ("20990710-000000", DATABASE_FILE_NAME.to_owned()),
        ("20990711-000000", format!("{DATABASE_FILE_NAME}-wal")),
        ("20990712-000000", format!("{DATABASE_FILE_NAME}-shm")),
    ] {
        let rollback = rollback_root.join(name);
        fs::create_dir_all(&rollback).unwrap();
        fs::write(rollback.join(file_name), b"rollback").unwrap();
    }

    assert_eq!(
        profile_restore_rollback_count(rollback_root.parent().unwrap()).unwrap(),
        3
    );
}

#[test]
fn profile_restore_clear_removes_valid_directories_and_empty_root() {
    let dir = TestDir::new("rollback-clear-all");
    let app_data = dir.0.join("app");
    let rollback_root = app_data.join(RESTORE_ROLLBACK_DIRECTORY);
    let data = rollback_root.join("20990710-000000");
    fs::create_dir_all(&data).unwrap();
    fs::write(data.join(DATABASE_FILE_NAME), b"rollback").unwrap();
    fs::create_dir_all(rollback_root.join("20990711-000000")).unwrap();

    clear_profile_restore_rollbacks(&app_data).unwrap();

    assert!(!rollback_root.exists());
    assert_eq!(profile_restore_rollback_count(&app_data).unwrap(), 0);
}

#[test]
fn profile_restore_clear_preserves_invalid_entries() {
    let dir = TestDir::new("rollback-clear-invalid");
    let app_data = dir.0.join("app");
    let rollback_root = app_data.join(RESTORE_ROLLBACK_DIRECTORY);
    let valid = rollback_root.join("20990710-000000");
    fs::create_dir_all(&valid).unwrap();
    fs::write(valid.join(DATABASE_FILE_NAME), b"rollback").unwrap();
    let invalid = rollback_root.join("keep-me");
    fs::create_dir_all(&invalid).unwrap();
    fs::write(invalid.join(DATABASE_FILE_NAME), b"user-data").unwrap();

    clear_profile_restore_rollbacks(&app_data).unwrap();

    assert!(!valid.exists());
    assert!(invalid.join(DATABASE_FILE_NAME).exists());
    assert_eq!(profile_restore_rollback_count(&app_data).unwrap(), 0);
}

#[cfg(unix)]
#[test]
fn profile_restore_clear_rejects_a_linked_rollback_root() {
    use std::os::unix::fs::symlink;

    let dir = TestDir::new("rollback-linked-root");
    let app_data = dir.0.join("app");
    fs::create_dir_all(&app_data).unwrap();
    let external_rollback = dir.0.join("external").join("20990710-000000");
    fs::create_dir_all(&external_rollback).unwrap();
    let external_database = external_rollback.join(DATABASE_FILE_NAME);
    fs::write(&external_database, b"external").unwrap();
    symlink(
        external_rollback.parent().unwrap(),
        app_data.join(RESTORE_ROLLBACK_DIRECTORY),
    )
    .unwrap();

    assert!(profile_restore_rollback_count(&app_data).is_err());
    assert!(clear_profile_restore_rollbacks(&app_data).is_err());
    assert!(cleanup_profile_backup_artifacts(&app_data).is_err());
    assert!(external_database.exists());
}

#[test]
fn profile_backup_cleanup_preserves_only_active_restore() {
    let dir = TestDir::new("cleanup");
    let (app_data, _, _) = prepare_restore(&dir, "cleanup");
    let backup_staging = app_data.join(BACKUP_STAGING_DIRECTORY);
    fs::create_dir_all(&backup_staging).unwrap();
    fs::write(backup_staging.join("partial"), b"partial").unwrap();
    let rollback_root = app_data.join(RESTORE_ROLLBACK_DIRECTORY);
    for name in ["20990710-000000", "20990711-000000"] {
        fs::create_dir_all(rollback_root.join(name)).unwrap();
    }
    let active_name = active_rollback_directory_name(&app_data).unwrap();
    let active = rollback_root.join(active_name);
    fs::create_dir_all(&active).unwrap();
    fs::write(active.join(DATABASE_FILE_NAME), b"active").unwrap();

    cleanup_profile_backup_artifacts(&app_data).unwrap();

    assert!(!backup_staging.exists());
    assert!(app_data.join(RESTORE_PENDING_DIRECTORY).exists());
    assert!(has_pending_profile_restore(&app_data));
    assert_eq!(fs::read_dir(&rollback_root).unwrap().count(), 1);
    assert!(active.join(DATABASE_FILE_NAME).exists());

    assert!(clear_profile_restore_rollbacks(&app_data).is_err());
    assert!(active.join(DATABASE_FILE_NAME).exists());
}

#[test]
fn profile_backup_cleanup_keeps_only_latest_rollback_without_journal() {
    let dir = TestDir::new("cleanup-latest");
    let app_data = dir.0.join("app");
    let rollback_root = app_data.join(RESTORE_ROLLBACK_DIRECTORY);
    for name in ["20990710-000000", "20990711-000000", "20990712-000000"] {
        let rollback = rollback_root.join(name);
        fs::create_dir_all(&rollback).unwrap();
        fs::write(rollback.join(DATABASE_FILE_NAME), name).unwrap();
    }

    cleanup_profile_backup_artifacts(&app_data).unwrap();

    let remaining = fs::read_dir(&rollback_root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert_eq!(remaining, vec!["20990712-000000"]);
}
