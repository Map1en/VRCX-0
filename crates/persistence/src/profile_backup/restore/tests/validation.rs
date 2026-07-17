use std::fs::{self, File, OpenOptions};
use std::io::{Cursor, Write};

use rusqlite::Connection;
use tar::EntryType;

use crate::database::schema::VRCX0_SCHEMA_VERSION;
use crate::profile_backup::{
    create_backup_archive, ProfileBackupKind, ProfileBackupManifestMetadata,
    ProfileRestoreFailureCode, DATABASE_FILE_NAME, MANIFEST_FILE_NAME,
};

use super::super::validation::{
    copy_open_archive_with_budget, ensure_restore_archive_copy_budget,
    validate_and_stage_profile_restore_with_progress, ProfileRestoreWorkPhase,
    MAX_RESTORE_ARCHIVE_BYTES, RESTORE_FREE_SPACE_RESERVE_BYTES,
};

#[test]
fn profile_backup_restore_reports_real_stage_progress() {
    let dir = TestDir::new("progress");
    let source = create_profile_backup(
        &dir.0,
        "progress-source",
        "1.2.3",
        VRCX0_SCHEMA_VERSION,
        VRCX0_SCHEMA_VERSION,
        "progress",
    );
    let app_data = dir.0.join("app-data");
    let archive_bytes = fs::metadata(&source).unwrap().len();
    let mut events = Vec::new();

    let outcome = validate_and_stage_profile_restore_with_progress(
        &source,
        &app_data,
        "1.2.3",
        |phase, processed, total| events.push((phase, processed, total)),
    )
    .unwrap();
    let validation = outcome.validation.unwrap();

    for phase in [
        ProfileRestoreWorkPhase::CopyArchive,
        ProfileRestoreWorkPhase::ExtractDatabase,
        ProfileRestoreWorkPhase::VerifyStaging,
    ] {
        let stage = events
            .iter()
            .filter(|event| event.0 == phase)
            .collect::<Vec<_>>();
        assert_eq!(stage.first().unwrap().1, 0);
        let total = stage.first().unwrap().2.unwrap();
        assert_eq!(stage.last().unwrap().1, total);
        assert!(stage.windows(2).all(|pair| pair[0].1 <= pair[1].1));
        assert!(stage.iter().all(|event| event.2 == Some(total)));
        if phase == ProfileRestoreWorkPhase::CopyArchive {
            assert_eq!(total, archive_bytes);
        } else {
            assert_eq!(total, validation.staged_bytes);
        }
    }

    let database_check = events
        .iter()
        .filter(|event| event.0 == ProfileRestoreWorkPhase::CheckDatabase)
        .collect::<Vec<_>>();
    assert_eq!(
        database_check,
        vec![&(ProfileRestoreWorkPhase::CheckDatabase, 0, None,)]
    );
}
use super::common::{
    create_profile_backup, manifest_for_database, rejected_code,
    write_archive_with_decompressed_trailing_data, write_concatenated_archives,
    write_custom_archive, write_custom_archive_with_types, write_pax_archive,
    write_profile_database, TestDir,
};

#[test]
fn profile_backup_restore_hardening_rejects_invalid_entry_sets() {
    let dir = TestDir::new("entry-hardening");
    let db_path = dir.0.join("valid.sqlite3");
    write_profile_database(&db_path, VRCX0_SCHEMA_VERSION, "valid");
    let db_bytes = fs::read(db_path).unwrap();
    let manifest = serde_json::to_vec(&manifest_for_database(&db_bytes)).unwrap();
    let cases = [
        (
            "missing",
            vec![(DATABASE_FILE_NAME.into(), db_bytes.clone())],
            ProfileRestoreFailureCode::InvalidEntries,
        ),
        (
            "missing-database",
            vec![(MANIFEST_FILE_NAME.into(), manifest.clone())],
            ProfileRestoreFailureCode::InvalidEntries,
        ),
        (
            "extra",
            vec![
                (DATABASE_FILE_NAME.into(), db_bytes.clone()),
                (MANIFEST_FILE_NAME.into(), manifest.clone()),
                ("extra.txt".into(), Vec::new()),
            ],
            ProfileRestoreFailureCode::InvalidEntries,
        ),
        (
            "traversal",
            vec![
                ("../VRCX-0.sqlite3".into(), db_bytes.clone()),
                (MANIFEST_FILE_NAME.into(), manifest.clone()),
            ],
            ProfileRestoreFailureCode::InvalidEntries,
        ),
    ];

    for (name, entries, expected) in cases {
        let archive = dir.0.join(format!("{name}.vrcx0backup"));
        write_custom_archive(&archive, entries);
        let app_data = dir.0.join(format!("app-{name}"));
        assert_eq!(
            rejected_code(&archive, &app_data, "1.2.3"),
            expected,
            "{name}"
        );
    }

    let duplicate_archive = dir.0.join("duplicate.vrcx0backup");
    write_custom_archive(
        &duplicate_archive,
        vec![
            (DATABASE_FILE_NAME.into(), db_bytes.clone()),
            (DATABASE_FILE_NAME.into(), db_bytes.clone()),
        ],
    );
    assert_eq!(
        rejected_code(&duplicate_archive, &dir.0.join("app-duplicate"), "1.2.3"),
        ProfileRestoreFailureCode::InvalidEntries
    );

    for (name, entry_type) in [
        ("directory", EntryType::Directory),
        ("symlink", EntryType::Symlink),
        ("gnu-long-name", EntryType::GNULongName),
    ] {
        let archive = dir.0.join(format!("{name}.vrcx0backup"));
        write_custom_archive_with_types(
            &archive,
            vec![
                (DATABASE_FILE_NAME.into(), db_bytes.clone(), entry_type),
                (
                    MANIFEST_FILE_NAME.into(),
                    manifest.clone(),
                    EntryType::Regular,
                ),
            ],
        );
        assert_eq!(
            rejected_code(&archive, &dir.0.join(format!("app-{name}")), "1.2.3"),
            ProfileRestoreFailureCode::InvalidEntries,
            "{name}"
        );
    }

    let pax_archive = dir.0.join("pax.vrcx0backup");
    write_pax_archive(&pax_archive, &db_bytes, &manifest);
    assert_eq!(
        rejected_code(&pax_archive, &dir.0.join("app-pax"), "1.2.3"),
        ProfileRestoreFailureCode::InvalidEntries
    );
}

#[test]
fn profile_backup_restore_rejects_hash_size_and_compatibility_failures() {
    let dir = TestDir::new("validation-failures");
    let db_path = dir.0.join("valid.sqlite3");
    write_profile_database(&db_path, VRCX0_SCHEMA_VERSION, "valid");
    let db_bytes = fs::read(&db_path).unwrap();

    let mut wrong_hash = manifest_for_database(&db_bytes);
    wrong_hash.contents[0].sha256 = "00".repeat(32);
    let wrong_hash_archive = dir.0.join("wrong-hash.vrcx0backup");
    write_custom_archive(
        &wrong_hash_archive,
        vec![
            (DATABASE_FILE_NAME.into(), db_bytes.clone()),
            (
                MANIFEST_FILE_NAME.into(),
                serde_json::to_vec(&wrong_hash).unwrap(),
            ),
        ],
    );
    assert_eq!(
        rejected_code(&wrong_hash_archive, &dir.0.join("hash-app"), "1.2.3"),
        ProfileRestoreFailureCode::ContentHashMismatch
    );

    let mut wrong_size = manifest_for_database(&db_bytes);
    wrong_size.contents[0].bytes += 1;
    let wrong_size_archive = dir.0.join("wrong-size.vrcx0backup");
    write_custom_archive(
        &wrong_size_archive,
        vec![
            (DATABASE_FILE_NAME.into(), db_bytes.clone()),
            (
                MANIFEST_FILE_NAME.into(),
                serde_json::to_vec(&wrong_size).unwrap(),
            ),
        ],
    );
    assert_eq!(
        rejected_code(&wrong_size_archive, &dir.0.join("size-app"), "1.2.3"),
        ProfileRestoreFailureCode::ContentSizeMismatch
    );

    let newer_app = create_profile_backup(
        &dir.0,
        "newer-app",
        "2.0.0",
        VRCX0_SCHEMA_VERSION,
        VRCX0_SCHEMA_VERSION,
        "new",
    );
    assert_eq!(
        rejected_code(&newer_app, &dir.0.join("newer-app-data"), "1.9.9"),
        ProfileRestoreFailureCode::NewerAppVersion
    );

    let newer_database = create_profile_backup(
        &dir.0,
        "newer-database",
        "1.2.3",
        VRCX0_SCHEMA_VERSION + 1,
        VRCX0_SCHEMA_VERSION,
        "new",
    );
    assert_eq!(
        rejected_code(&newer_database, &dir.0.join("newer-db-data"), "1.2.3"),
        ProfileRestoreFailureCode::NewerDatabaseVersion
    );

    let mismatched_database = create_profile_backup(
        &dir.0,
        "mismatched-database",
        "1.2.3",
        VRCX0_SCHEMA_VERSION - 1,
        VRCX0_SCHEMA_VERSION,
        "new",
    );
    assert_eq!(
        rejected_code(
            &mismatched_database,
            &dir.0.join("mismatched-db-data"),
            "1.2.3"
        ),
        ProfileRestoreFailureCode::DatabaseVersionMismatch
    );
}

#[test]
fn profile_backup_restore_rejects_non_archives_and_non_profile_databases() {
    let dir = TestDir::new("invalid-inputs");
    let not_archive = dir.0.join("not-archive.vrcx0backup");
    fs::write(&not_archive, b"not zstd").unwrap();
    assert_eq!(
        rejected_code(&not_archive, &dir.0.join("not-archive-app"), "1.2.3"),
        ProfileRestoreFailureCode::InvalidArchive
    );

    let plain_db = dir.0.join("plain.sqlite3");
    Connection::open(&plain_db)
        .unwrap()
        .execute("CREATE TABLE unrelated (value TEXT)", [])
        .unwrap();
    let plain_backup = dir.0.join("plain.vrcx0backup");
    create_backup_archive(
        &plain_db,
        &plain_backup,
        ProfileBackupManifestMetadata {
            app_version: "1.2.3".into(),
            db_version: VRCX0_SCHEMA_VERSION,
            created_at: "2026-07-14T07:30:00Z".into(),
            platform: "windows".into(),
            kind: ProfileBackupKind::Manual,
        },
    )
    .unwrap();
    assert_eq!(
        rejected_code(&plain_backup, &dir.0.join("plain-app"), "1.2.3"),
        ProfileRestoreFailureCode::NotProfileDatabase
    );
}

#[test]
fn profile_backup_restore_rejects_corrupt_zstd_and_tar_data() {
    let dir = TestDir::new("corrupt-archive");
    let db_path = dir.0.join("valid.sqlite3");
    write_profile_database(&db_path, VRCX0_SCHEMA_VERSION, "valid");
    let db_bytes = fs::read(db_path).unwrap();
    let manifest = serde_json::to_vec(&manifest_for_database(&db_bytes)).unwrap();

    let truncated = dir.0.join("truncated-zstd.vrcx0backup");
    write_custom_archive(
        &truncated,
        vec![
            (DATABASE_FILE_NAME.into(), db_bytes),
            (MANIFEST_FILE_NAME.into(), manifest),
        ],
    );
    let truncated_len = fs::metadata(&truncated).unwrap().len();
    OpenOptions::new()
        .write(true)
        .open(&truncated)
        .unwrap()
        .set_len(truncated_len - 1)
        .unwrap();
    assert_eq!(
        rejected_code(&truncated, &dir.0.join("app-truncated"), "1.2.3"),
        ProfileRestoreFailureCode::InvalidArchive
    );

    let corrupt_tar = dir.0.join("corrupt-tar.vrcx0backup");
    fs::write(
        &corrupt_tar,
        zstd::stream::encode_all(Cursor::new(b"not a complete tar header"), 5).unwrap(),
    )
    .unwrap();
    assert_eq!(
        rejected_code(&corrupt_tar, &dir.0.join("app-corrupt-tar"), "1.2.3"),
        ProfileRestoreFailureCode::InvalidArchive
    );
}

#[test]
fn profile_backup_restore_rejects_data_after_tar_or_zstd_frame() {
    let dir = TestDir::new("trailing-data");
    let db_path = dir.0.join("valid.sqlite3");
    write_profile_database(&db_path, VRCX0_SCHEMA_VERSION, "valid");
    let db_bytes = fs::read(db_path).unwrap();
    let manifest = serde_json::to_vec(&manifest_for_database(&db_bytes)).unwrap();
    let entries = vec![
        (DATABASE_FILE_NAME.into(), db_bytes),
        (MANIFEST_FILE_NAME.into(), manifest),
    ];

    let decompressed_trailing = dir.0.join("decompressed-trailing.vrcx0backup");
    write_archive_with_decompressed_trailing_data(
        &decompressed_trailing,
        entries.clone(),
        b"smuggled",
    );
    assert_eq!(
        rejected_code(
            &decompressed_trailing,
            &dir.0.join("app-decompressed-trailing"),
            "1.2.3"
        ),
        ProfileRestoreFailureCode::InvalidArchive
    );

    let zero_padded = dir.0.join("zero-padded.vrcx0backup");
    write_archive_with_decompressed_trailing_data(&zero_padded, entries.clone(), &[0; 512]);
    assert_eq!(
        rejected_code(&zero_padded, &dir.0.join("app-zero-padded"), "1.2.3"),
        ProfileRestoreFailureCode::InvalidArchive
    );

    let concatenated_tar = dir.0.join("concatenated-tar.vrcx0backup");
    write_concatenated_archives(
        &concatenated_tar,
        vec![vec![entries[0].clone()], vec![entries[1].clone()]],
    );
    assert_eq!(
        rejected_code(
            &concatenated_tar,
            &dir.0.join("app-concatenated-tar"),
            "1.2.3"
        ),
        ProfileRestoreFailureCode::InvalidEntries
    );

    let raw_trailing = dir.0.join("raw-trailing.vrcx0backup");
    write_custom_archive(&raw_trailing, entries.clone());
    OpenOptions::new()
        .append(true)
        .open(&raw_trailing)
        .unwrap()
        .write_all(b"smuggled")
        .unwrap();
    assert_eq!(
        rejected_code(&raw_trailing, &dir.0.join("app-raw-trailing"), "1.2.3"),
        ProfileRestoreFailureCode::InvalidArchive
    );

    let second_frame = dir.0.join("second-frame.vrcx0backup");
    write_custom_archive(&second_frame, entries);
    OpenOptions::new()
        .append(true)
        .open(&second_frame)
        .unwrap()
        .write_all(&zstd::stream::encode_all(Cursor::new(b"smuggled"), 5).unwrap())
        .unwrap();
    assert_eq!(
        rejected_code(&second_frame, &dir.0.join("app-second-frame"), "1.2.3"),
        ProfileRestoreFailureCode::InvalidArchive
    );
}

#[test]
fn profile_backup_restore_enforces_archive_and_extraction_resource_budgets() {
    assert_eq!(
        ensure_restore_archive_copy_budget(MAX_RESTORE_ARCHIVE_BYTES + 1, u64::MAX),
        Err(ProfileRestoreFailureCode::InvalidArchive)
    );
    assert_eq!(
        ensure_restore_archive_copy_budget(1, RESTORE_FREE_SPACE_RESERVE_BYTES),
        Err(ProfileRestoreFailureCode::Io)
    );
}

#[test]
fn profile_backup_restore_copy_detects_source_growth_and_truncation_from_open_handle() {
    let dir = TestDir::new("source-length-race");
    let source = dir.0.join("source.vrcx0backup");
    fs::write(&source, b"initial").unwrap();
    let mut input = File::open(&source).unwrap();
    let initial_len = input.metadata().unwrap().len();
    OpenOptions::new()
        .append(true)
        .open(&source)
        .unwrap()
        .write_all(b"extra")
        .unwrap();
    assert_eq!(
        copy_open_archive_with_budget(
            &mut input,
            initial_len,
            u64::MAX,
            &dir.0.join("grown-copy.vrcx0backup"),
        ),
        Err(ProfileRestoreFailureCode::InvalidArchive)
    );

    fs::write(&source, b"initial").unwrap();
    let mut input = File::open(&source).unwrap();
    let initial_len = input.metadata().unwrap().len();
    OpenOptions::new()
        .write(true)
        .open(&source)
        .unwrap()
        .set_len(3)
        .unwrap();
    assert_eq!(
        copy_open_archive_with_budget(
            &mut input,
            initial_len,
            u64::MAX,
            &dir.0.join("truncated-copy.vrcx0backup"),
        ),
        Err(ProfileRestoreFailureCode::InvalidArchive)
    );
}

#[test]
fn profile_backup_restore_rejects_non_regular_source() {
    let dir = TestDir::new("non-regular-source");
    assert_eq!(
        rejected_code(&dir.0, &dir.0.join("app"), "1.2.3"),
        ProfileRestoreFailureCode::InvalidArchive
    );
}

#[cfg(unix)]
#[test]
fn profile_backup_restore_staging_files_are_private_on_unix() {
    use std::os::unix::fs::PermissionsExt;

    let dir = TestDir::new("private-staging");
    let source = create_profile_backup(
        &dir.0,
        "private-staging-source",
        "1.2.3",
        VRCX0_SCHEMA_VERSION,
        VRCX0_SCHEMA_VERSION,
        "new",
    );
    let app_data = dir.0.join("private-staging-app");
    let validation = super::common::accepted_validation(&source, &app_data, "1.2.3");
    let staged = app_data
        .join(crate::profile_backup::RESTORE_PENDING_DIRECTORY)
        .join(DATABASE_FILE_NAME);

    assert_eq!(
        validation.staged_bytes,
        fs::metadata(&staged).unwrap().len()
    );
    assert_eq!(
        fs::metadata(staged).unwrap().permissions().mode() & 0o777,
        0o600
    );
}
