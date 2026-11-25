use std::fs;

use crate::profile_backup::{
    ProfileRestoreDataDisposition, ProfileRestoreFailureCode, ProfileRestoreResult,
    ProfileRestoreResultStatus, DATABASE_FILE_NAME, RESTORE_JOURNAL_FILE_NAME,
    RESTORE_PENDING_DIRECTORY, RESTORE_ROLLBACK_DIRECTORY,
};

use super::super::filesystem::{
    database_sidecar_path, install_staged_database, move_database_family_to_rollback,
    remove_file_if_exists, write_restore_result,
};
use super::super::journal::{
    advance_journal_phase, read_journal, rollback_restore, RestoreJournalPhase,
};
use super::super::{
    consume_pending_profile_restore, has_pending_profile_restore, request_staged_profile_restore,
    take_last_profile_restore_result,
};
use super::common::{prepare_restore, read_restore_value, write_profile_database, TestDir};

#[test]
fn profile_backup_restore_roundtrip_keeps_journal_until_database_open_succeeds() {
    let dir = TestDir::new("roundtrip");
    let (app_data, db_path, validation) = prepare_restore(&dir, "roundtrip");
    assert!(has_pending_profile_restore(&app_data));
    let old_rollback = app_data
        .join(RESTORE_ROLLBACK_DIRECTORY)
        .join("20990710-000000");
    fs::create_dir_all(&old_rollback).unwrap();
    fs::write(old_rollback.join(DATABASE_FILE_NAME), b"old rollback").unwrap();

    let pending = consume_pending_profile_restore(&app_data, &db_path)
        .unwrap()
        .unwrap();
    assert!(has_pending_profile_restore(&app_data));
    assert_eq!(read_restore_value(&db_path), "new");
    assert!(!old_rollback.exists());
    assert_eq!(
        fs::read_dir(app_data.join(RESTORE_ROLLBACK_DIRECTORY))
            .unwrap()
            .count(),
        1
    );

    let result = pending.finalize().unwrap();
    assert_eq!(result.status, ProfileRestoreResultStatus::Succeeded);
    assert_eq!(
        result.data_disposition,
        ProfileRestoreDataDisposition::Replaced
    );
    assert_eq!(result.source_file_name, validation.source_file_name);
    assert!(!has_pending_profile_restore(&app_data));
    assert_eq!(
        take_last_profile_restore_result(&app_data).unwrap(),
        Some(result)
    );
    assert_eq!(take_last_profile_restore_result(&app_data).unwrap(), None);
}

#[test]
fn profile_backup_restore_rolls_back_when_database_open_fails() {
    let dir = TestDir::new("open-failure");
    let (app_data, db_path, _) = prepare_restore(&dir, "open-failure");
    let pending = consume_pending_profile_restore(&app_data, &db_path)
        .unwrap()
        .unwrap();
    let result = pending
        .rollback(ProfileRestoreFailureCode::DatabaseOpenFailed)
        .unwrap();

    assert_eq!(read_restore_value(&db_path), "old");
    assert_eq!(result.status, ProfileRestoreResultStatus::Failed);
    assert_eq!(
        result.data_disposition,
        ProfileRestoreDataDisposition::RolledBack
    );
    assert_eq!(
        result.failure.unwrap().code,
        ProfileRestoreFailureCode::DatabaseOpenFailed
    );
    assert!(!has_pending_profile_restore(&app_data));
}

#[test]
fn profile_backup_restore_rejects_corrupted_staging_without_touching_current_database() {
    let dir = TestDir::new("staging-corrupt");
    let (app_data, db_path, _) = prepare_restore(&dir, "staging-corrupt");
    fs::write(
        app_data
            .join(RESTORE_PENDING_DIRECTORY)
            .join(DATABASE_FILE_NAME),
        b"corrupt",
    )
    .unwrap();

    assert!(consume_pending_profile_restore(&app_data, &db_path)
        .unwrap()
        .is_none());
    assert_eq!(read_restore_value(&db_path), "old");
    let result = take_last_profile_restore_result(&app_data)
        .unwrap()
        .unwrap();
    assert_eq!(
        result.failure.unwrap().code,
        ProfileRestoreFailureCode::StagingCorrupted
    );
    assert_eq!(
        result.data_disposition,
        ProfileRestoreDataDisposition::Unchanged
    );
}

#[test]
fn profile_backup_restore_resumes_at_each_journal_boundary() {
    for boundary in [
        "staged",
        "rollback-moved",
        "installed",
        "database-moved",
        "result-written",
    ] {
        let dir = TestDir::new(boundary);
        let (app_data, db_path, _) = prepare_restore(&dir, boundary);
        let journal_path = app_data.join(RESTORE_JOURNAL_FILE_NAME);
        let mut journal = read_journal(&journal_path).unwrap();
        let rollback_dir = app_data
            .join(RESTORE_ROLLBACK_DIRECTORY)
            .join(&journal.rollback_directory_name);
        if boundary != "staged" {
            advance_journal_phase(
                &journal_path,
                &mut journal,
                RestoreJournalPhase::RollbackMoved,
            )
            .unwrap();
        }
        if matches!(boundary, "installed" | "database-moved" | "result-written") {
            fs::create_dir_all(&rollback_dir).unwrap();
            move_database_family_to_rollback(&db_path, &rollback_dir).unwrap();
            advance_journal_phase(&journal_path, &mut journal, RestoreJournalPhase::Installed)
                .unwrap();
        }
        if matches!(boundary, "database-moved" | "result-written") {
            install_staged_database(
                &app_data
                    .join(RESTORE_PENDING_DIRECTORY)
                    .join(DATABASE_FILE_NAME),
                &db_path,
            )
            .unwrap();
        }
        if boundary == "result-written" {
            write_restore_result(
                &app_data,
                &ProfileRestoreResult {
                    status: ProfileRestoreResultStatus::Succeeded,
                    data_disposition: ProfileRestoreDataDisposition::Replaced,
                    source_file_name: journal.source_file_name.clone(),
                    failure: None,
                },
            )
            .unwrap();
        }

        let pending = consume_pending_profile_restore(&app_data, &db_path)
            .unwrap()
            .unwrap();
        assert_eq!(read_restore_value(&db_path), "new", "{boundary}");
        pending.finalize().unwrap();
    }
}

#[test]
fn profile_backup_restore_partial_rollback_preserves_unmoved_sidecars() {
    let dir = TestDir::new("partial-sidecars");
    let (app_data, db_path, _) = prepare_restore(&dir, "partial-sidecars");
    let wal = database_sidecar_path(&db_path, "wal");
    let shm = database_sidecar_path(&db_path, "shm");
    fs::write(&wal, b"old wal").unwrap();
    fs::write(&shm, b"old shm").unwrap();
    let journal_path = app_data.join(RESTORE_JOURNAL_FILE_NAME);
    let mut journal = read_journal(&journal_path).unwrap();
    advance_journal_phase(
        &journal_path,
        &mut journal,
        RestoreJournalPhase::RollbackMoved,
    )
    .unwrap();
    let rollback_dir = app_data
        .join(RESTORE_ROLLBACK_DIRECTORY)
        .join(&journal.rollback_directory_name);
    fs::create_dir_all(&rollback_dir).unwrap();
    fs::rename(&db_path, rollback_dir.join(DATABASE_FILE_NAME)).unwrap();
    fs::rename(&wal, rollback_dir.join(format!("{DATABASE_FILE_NAME}-wal"))).unwrap();

    let result =
        rollback_restore(&app_data, &db_path, &journal, ProfileRestoreFailureCode::Io).unwrap();
    assert_eq!(
        result.data_disposition,
        ProfileRestoreDataDisposition::RolledBack
    );
    assert_eq!(fs::read(wal).unwrap(), b"old wal");
    assert_eq!(fs::read(shm).unwrap(), b"old shm");
    assert_eq!(read_restore_value(&db_path), "old");
}

#[test]
fn profile_backup_restore_resumes_after_main_database_is_rolled_back_before_sidecars() {
    let dir = TestDir::new("rollback-main-before-sidecars");
    let (app_data, db_path, _) = prepare_restore(&dir, "rollback-main-before-sidecars");
    let wal = database_sidecar_path(&db_path, "wal");
    let shm = database_sidecar_path(&db_path, "shm");
    let old_database = fs::read(&db_path).unwrap();
    fs::write(&wal, b"old wal").unwrap();
    fs::write(&shm, b"old shm").unwrap();

    consume_pending_profile_restore(&app_data, &db_path)
        .unwrap()
        .unwrap();
    let journal_path = app_data.join(RESTORE_JOURNAL_FILE_NAME);
    let mut journal = read_journal(&journal_path).unwrap();
    let rollback_dir = app_data
        .join(RESTORE_ROLLBACK_DIRECTORY)
        .join(&journal.rollback_directory_name);
    advance_journal_phase(
        &journal_path,
        &mut journal,
        RestoreJournalPhase::RollingBackClearing,
    )
    .unwrap();
    remove_file_if_exists(&db_path).unwrap();
    remove_file_if_exists(&wal).unwrap();
    remove_file_if_exists(&shm).unwrap();
    advance_journal_phase(
        &journal_path,
        &mut journal,
        RestoreJournalPhase::RollingBackRestoring,
    )
    .unwrap();
    fs::rename(rollback_dir.join(DATABASE_FILE_NAME), &db_path).unwrap();

    assert!(consume_pending_profile_restore(&app_data, &db_path)
        .unwrap()
        .is_none());
    assert_eq!(fs::read(&db_path).unwrap(), old_database);
    assert_eq!(fs::read(&wal).unwrap(), b"old wal");
    assert_eq!(fs::read(&shm).unwrap(), b"old shm");
    assert!(!has_pending_profile_restore(&app_data));
    let result = take_last_profile_restore_result(&app_data)
        .unwrap()
        .unwrap();
    assert_eq!(result.failure.unwrap().code, ProfileRestoreFailureCode::Io);
    assert_eq!(
        result.data_disposition,
        ProfileRestoreDataDisposition::RolledBack
    );
}

#[test]
fn profile_backup_restore_only_clears_invalid_journal_before_profile_files_move() {
    let dir = TestDir::new("invalid-journal-initial");
    let (app_data, db_path, _) = prepare_restore(&dir, "invalid-journal-initial");
    fs::write(app_data.join(RESTORE_JOURNAL_FILE_NAME), b"invalid").unwrap();

    assert!(consume_pending_profile_restore(&app_data, &db_path)
        .unwrap()
        .is_none());
    assert_eq!(read_restore_value(&db_path), "old");
    assert!(!has_pending_profile_restore(&app_data));

    let dir = TestDir::new("invalid-journal-after-move");
    let (app_data, db_path, _) = prepare_restore(&dir, "invalid-journal-after-move");
    let journal_path = app_data.join(RESTORE_JOURNAL_FILE_NAME);
    let mut journal = read_journal(&journal_path).unwrap();
    let rollback_dir = app_data
        .join(RESTORE_ROLLBACK_DIRECTORY)
        .join(&journal.rollback_directory_name);
    fs::create_dir_all(&rollback_dir).unwrap();
    advance_journal_phase(
        &journal_path,
        &mut journal,
        RestoreJournalPhase::RollbackMoved,
    )
    .unwrap();
    fs::rename(&db_path, rollback_dir.join(DATABASE_FILE_NAME)).unwrap();
    fs::write(&journal_path, b"invalid").unwrap();

    assert!(consume_pending_profile_restore(&app_data, &db_path).is_err());
    assert!(has_pending_profile_restore(&app_data));
    assert!(rollback_dir.join(DATABASE_FILE_NAME).exists());
    assert!(app_data
        .join(RESTORE_PENDING_DIRECTORY)
        .join(DATABASE_FILE_NAME)
        .exists());
}

fn read_install_id(path: &std::path::Path) -> Option<String> {
    rusqlite::Connection::open(path)
        .unwrap()
        .query_row(
            "SELECT value FROM configs WHERE key = 'config:vrcx_telemetryinstallid'",
            [],
            |row| row.get(0),
        )
        .ok()
}

#[test]
fn profile_backup_restore_keeps_the_current_install_id_when_the_backup_has_none() {
    let dir = TestDir::new("install-id-missing");
    let (app_data, db_path, validation) = prepare_restore(&dir, "install-id-missing");
    fs::remove_file(app_data.join(RESTORE_JOURNAL_FILE_NAME)).unwrap();
    rusqlite::Connection::open(&db_path)
        .unwrap()
        .execute(
            "INSERT INTO configs (key, value) VALUES ('config:vrcx_telemetryinstallid', 'install-current')",
            [],
        )
        .unwrap();
    request_staged_profile_restore(&app_data, &validation).unwrap();

    let pending = consume_pending_profile_restore(&app_data, &db_path)
        .unwrap()
        .unwrap();
    pending.finalize().unwrap();

    assert_eq!(read_restore_value(&db_path), "new");
    assert_eq!(
        read_install_id(&db_path).as_deref(),
        Some("install-current")
    );
}

#[test]
fn profile_backup_restore_keeps_the_install_id_carried_by_the_backup() {
    let dir = TestDir::new("install-id-carried");
    let db_path = dir.0.join(DATABASE_FILE_NAME);
    write_profile_database(&db_path, 1, "new");
    rusqlite::Connection::open(&db_path)
        .unwrap()
        .execute(
            "INSERT INTO configs (key, value) VALUES ('config:vrcx_telemetryinstallid', 'install-backup')",
            [],
        )
        .unwrap();

    crate::config::merge_preserved_config_into_restore(
        &db_path,
        &[(
            "config:vrcx_telemetryinstallid".to_string(),
            "install-current".to_string(),
        )],
    );

    assert_eq!(read_install_id(&db_path).as_deref(), Some("install-backup"));
}

#[test]
fn profile_backup_restore_replaces_the_error_cursor_carried_by_the_backup() {
    let dir = TestDir::new("error-cursor-carried");
    let db_path = dir.0.join(DATABASE_FILE_NAME);
    write_profile_database(&db_path, 1, "new");
    rusqlite::Connection::open(&db_path)
        .unwrap()
        .execute(
            "INSERT INTO configs (key, value) VALUES ('config:vrcx_telemetryclienterrorcursor', '2026-10-01T00:00:00.000Z')",
            [],
        )
        .unwrap();

    crate::config::merge_preserved_config_into_restore(
        &db_path,
        &[(
            "config:vrcx_telemetryclienterrorcursor".to_string(),
            "2026-11-25T05:26:50.000Z".to_string(),
        )],
    );

    let cursor: String = rusqlite::Connection::open(&db_path)
        .unwrap()
        .query_row(
            "SELECT value FROM configs WHERE key = 'config:vrcx_telemetryclienterrorcursor'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(cursor, "2026-11-25T05:26:50.000Z");
}
