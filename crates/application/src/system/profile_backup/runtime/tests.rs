use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use chrono::{DateTime, Local, TimeZone, Utc};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::data_dir_migration::{
    write_pending_data_dir_migration, PendingDataDirMigration,
};
use vrcx_0_persistence::profile_backup::{
    create_backup_archive, ProfileBackupManifestMetadata, DATABASE_FILE_NAME,
    RESTORE_JOURNAL_FILE_NAME, RESTORE_PENDING_DIRECTORY, RESTORE_ROLLBACK_DIRECTORY,
};
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::DatabaseService;

use vrcx_0_application_core::{RuntimeBackgroundJobs, RuntimeEventBus, TaskSupervisor};

use super::pipeline::{
    active_stage_percent, backup_file_name, compression_workers, create_delivery_temporary,
    is_backup_temporary_file_name, DeliveryAttempt,
};
use super::scheduler::is_auto_backup_due;
use vrcx_0_persistence::VRCX0_SCHEMA_VERSION_KEY as DATABASE_VERSION_KEY;

use super::super::ProfileBackupErrorCode;
use super::super::{ProfileRestoreFailureCode, ProfileRestoreProgress};
use super::{
    ProfileBackupKind, ProfileBackupPhase, ProfileBackupRuntime, ProfileBackupRuntimeDeps,
    ProfileBackupState, ProfileBackupStatus, AUTO_JOB,
};

struct TestDir(PathBuf);

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-profile-backup-runtime-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn test_runtime(dir: &TestDir) -> ProfileBackupRuntime {
    let app_data = dir.0.join("app-data");
    fs::create_dir_all(&app_data).unwrap();
    let db = Arc::new(DatabaseService::new(&app_data.join(DATABASE_FILE_NAME)).unwrap());
    ConfigRepository::new(Arc::clone(&db))
        .set_string(DATABASE_VERSION_KEY, "18")
        .unwrap();
    let storage = Arc::new(StorageService::new(&app_data.join("VRCX-0.json")).unwrap());
    ProfileBackupRuntime::new(ProfileBackupRuntimeDeps {
        app_data: app_data.clone(),
        control_dir: app_data,
        db,
        storage,
        event_bus: RuntimeEventBus::new(),
        tasks: TaskSupervisor::new(),
        background_jobs: RuntimeBackgroundJobs::new(),
        app_version: "2.13.0".into(),
    })
}

fn create_restore_archive(dir: &TestDir, name: &str) -> PathBuf {
    let database = dir.0.join(format!("{name}.sqlite3"));
    let connection = rusqlite::Connection::open(&database).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO configs (key, value) VALUES
             ('config:vrcx_0_databaseversion', '18');",
        )
        .unwrap();
    drop(connection);
    let archive = dir.0.join(format!("{name}.vrcx0backup"));
    create_backup_archive(
        &database,
        &archive,
        ProfileBackupManifestMetadata {
            app_version: "2.13.0".into(),
            db_version: 18,
            created_at: "2026-07-15T00:00:00Z".into(),
            platform: "windows".into(),
            kind: ProfileBackupKind::Manual,
        },
    )
    .unwrap();
    archive
}

#[test]
fn pending_data_dir_migration_blocks_backup_and_restore() {
    let dir = TestDir::new("pending-data-dir-migration");
    let runtime = test_runtime(&dir);
    let app_data = dir.0.join("app-data");
    write_pending_data_dir_migration(
        &app_data,
        &PendingDataDirMigration::copying(
            app_data.to_string_lossy().into_owned(),
            dir.0.join("target").to_string_lossy().into_owned(),
            Utc::now().to_rfc3339(),
            false,
        ),
    )
    .unwrap();

    let backup = runtime.run_manual(dir.0.join("manual.vrcx0backup"));
    assert_eq!(
        backup.error.unwrap().code,
        ProfileBackupErrorCode::PendingDataDirMigration
    );
    let restore = runtime.validate_restore(&dir.0.join("missing.vrcx0backup"));
    assert_eq!(
        restore.failure.unwrap().code,
        ProfileRestoreFailureCode::PendingDataDirMigration
    );
}

#[test]
fn restore_confirmation_uses_the_validated_staging_after_source_removal() {
    let dir = TestDir::new("restore-staged-source");
    let runtime = test_runtime(&dir);
    let source = create_restore_archive(&dir, "restore-source");

    let validation = runtime.validate_restore(&source).validation.unwrap();
    fs::remove_file(source).unwrap();
    let outcome = runtime.request_restore(&validation.staged_sha256);

    assert!(outcome.validation.is_some());
    assert!(runtime
        .inner
        .app_data
        .join(RESTORE_JOURNAL_FILE_NAME)
        .is_file());
}

#[test]
fn restore_confirmation_rejects_expired_and_corrupted_staging() {
    let expired_dir = TestDir::new("restore-expired");
    let expired_runtime = test_runtime(&expired_dir);
    let source = create_restore_archive(&expired_dir, "expired-source");
    expired_runtime.validate_restore(&source);
    let expired = expired_runtime.request_restore("wrong-sha");
    assert_eq!(
        expired.failure.unwrap().code,
        ProfileRestoreFailureCode::ValidationExpired
    );
    assert!(!expired_runtime
        .inner
        .app_data
        .join(RESTORE_JOURNAL_FILE_NAME)
        .exists());

    let corrupt_dir = TestDir::new("restore-corrupt");
    let corrupt_runtime = test_runtime(&corrupt_dir);
    let source = create_restore_archive(&corrupt_dir, "corrupt-source");
    let validation = corrupt_runtime
        .validate_restore(&source)
        .validation
        .unwrap();
    fs::write(
        corrupt_runtime
            .inner
            .app_data
            .join(RESTORE_PENDING_DIRECTORY)
            .join(DATABASE_FILE_NAME),
        b"changed",
    )
    .unwrap();
    let corrupted = corrupt_runtime.request_restore(&validation.staged_sha256);
    assert_eq!(
        corrupted.failure.unwrap().code,
        ProfileRestoreFailureCode::StagingCorrupted
    );
    assert!(!corrupt_runtime
        .inner
        .app_data
        .join(RESTORE_JOURNAL_FILE_NAME)
        .exists());
}

#[test]
fn restore_progress_has_indeterminate_database_check_and_determinate_hashes() {
    let dir = TestDir::new("restore-progress");
    let runtime = test_runtime(&dir);
    let source = create_restore_archive(&dir, "progress-source");

    let validation = runtime.validate_restore(&source).validation.unwrap();
    let validate_events = runtime
        .inner
        .event_bus
        .take_events_for_test()
        .into_iter()
        .filter(|event| event.name == "profileRestoreProgress")
        .map(|event| serde_json::from_value::<ProfileRestoreProgress>(event.payload).unwrap())
        .collect::<Vec<_>>();
    assert!(validate_events.iter().any(|event| {
        event.phase == super::ProfileRestoreProgressPhase::CheckDatabase
            && event.percent.is_none()
            && event.total_bytes.is_none()
    }));
    assert!(validate_events.iter().any(|event| {
        event.phase == super::ProfileRestoreProgressPhase::VerifyStaging
            && event.percent == Some(100)
    }));

    runtime.request_restore(&validation.staged_sha256);
    let prepare_events = runtime
        .inner
        .event_bus
        .take_events_for_test()
        .into_iter()
        .filter(|event| event.name == "profileRestoreProgress")
        .map(|event| serde_json::from_value::<ProfileRestoreProgress>(event.payload).unwrap())
        .collect::<Vec<_>>();
    assert!(prepare_events.iter().any(|event| {
        event.operation == super::ProfileRestoreProgressOperation::Prepare
            && event.phase == super::ProfileRestoreProgressPhase::VerifyStaging
            && event.percent == Some(100)
    }));
}

#[test]
fn discard_staged_restore_is_idempotent_and_expires_validation() {
    let dir = TestDir::new("restore-discard");
    let runtime = test_runtime(&dir);
    let source = create_restore_archive(&dir, "discard-source");
    let validation = runtime.validate_restore(&source).validation.unwrap();

    runtime.discard_staged_restore().unwrap();
    runtime.discard_staged_restore().unwrap();

    assert!(!runtime
        .inner
        .app_data
        .join(RESTORE_PENDING_DIRECTORY)
        .exists());
    assert_eq!(
        runtime
            .request_restore(&validation.staged_sha256)
            .failure
            .unwrap()
            .code,
        ProfileRestoreFailureCode::ValidationExpired
    );
}

fn wait_for_status(
    runtime: &ProfileBackupRuntime,
    expected: ProfileBackupState,
) -> ProfileBackupStatus {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let status = runtime.current_status();
        if status.state == expected {
            return status;
        }
        assert!(std::time::Instant::now() < deadline, "status: {status:?}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn due_when_missing_expired_or_clock_moved_backwards() {
    let now = DateTime::parse_from_rfc3339("2026-07-14T10:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    assert!(is_auto_backup_due(None, now, 7));
    assert!(is_auto_backup_due(Some("2026-07-07T09:59:59Z"), now, 7));
    assert!(is_auto_backup_due(Some("2026-07-15T10:00:00Z"), now, 7));
    assert!(!is_auto_backup_due(Some("2026-07-08T10:00:00Z"), now, 7));
}

#[test]
fn backup_names_keep_manual_files_out_of_auto_rotation_pattern() {
    let now = Local
        .with_ymd_and_hms(2026, 7, 14, 7, 30, 0)
        .single()
        .unwrap();
    assert_eq!(
        backup_file_name(ProfileBackupKind::Manual, now),
        "VRCX-0-backup-20260714-073000.vrcx0backup"
    );
    assert_eq!(
        backup_file_name(ProfileBackupKind::Auto, now),
        "VRCX-0-backup-auto-20260714-073000.vrcx0backup"
    );
}

#[test]
fn stage_progress_handles_multi_gibibyte_files_and_reserves_completion() {
    let eight_gib = 8 * 1024 * 1024 * 1024;
    assert_eq!(active_stage_percent(0, eight_gib), 0);
    assert_eq!(active_stage_percent(eight_gib / 2, eight_gib), 50);
    assert_eq!(active_stage_percent(eight_gib, eight_gib), 99);
}

#[test]
fn compression_workers_preserve_one_core_for_manual_backups_and_disable_mt_for_auto() {
    assert_eq!(compression_workers(ProfileBackupKind::Auto, 32), 0);
    assert_eq!(compression_workers(ProfileBackupKind::Manual, 1), 1);
    assert_eq!(compression_workers(ProfileBackupKind::Manual, 2), 1);
    assert_eq!(compression_workers(ProfileBackupKind::Manual, 8), 7);
    assert_eq!(compression_workers(ProfileBackupKind::Manual, 32), 16);
}

#[test]
fn progress_events_are_rate_limited_without_suppressing_boundaries() {
    let dir = TestDir::new("progress-rate-limit");
    let runtime = test_runtime(&dir);
    runtime.begin_running(
        ProfileBackupKind::Manual,
        ProfileBackupPhase::Snapshot,
        None,
    );
    runtime.inner.event_bus.take_events_for_test();

    let start = Instant::now();
    runtime.inner.state.lock().unwrap().last_progress_event_at = Some(start);
    runtime.update_progress_at(
        ProfileBackupPhase::Snapshot,
        Some(1),
        start + Duration::from_millis(5),
    );
    runtime.update_progress_at(
        ProfileBackupPhase::Snapshot,
        Some(2),
        start + Duration::from_millis(20),
    );
    runtime.update_progress_at(
        ProfileBackupPhase::Snapshot,
        Some(3),
        start + Duration::from_millis(21),
    );
    runtime.update_progress_at(
        ProfileBackupPhase::Deliver,
        Some(0),
        start + Duration::from_millis(21),
    );
    runtime.update_progress_at(
        ProfileBackupPhase::Deliver,
        None,
        start + Duration::from_millis(21),
    );
    runtime.update_progress_at(
        ProfileBackupPhase::Deliver,
        Some(100),
        start + Duration::from_millis(21),
    );

    let statuses = runtime
        .inner
        .event_bus
        .take_events_for_test()
        .into_iter()
        .map(|event| serde_json::from_value::<ProfileBackupStatus>(event.payload).unwrap())
        .map(|status| (status.phase, status.percent))
        .collect::<Vec<_>>();
    assert_eq!(
        statuses,
        vec![
            (Some(ProfileBackupPhase::Snapshot), Some(2)),
            (Some(ProfileBackupPhase::Deliver), Some(0)),
            (Some(ProfileBackupPhase::Deliver), None),
            (Some(ProfileBackupPhase::Deliver), Some(100)),
        ]
    );
}

#[test]
fn initial_delivery_preserves_an_existing_temporary_file_but_retry_replaces_it() {
    let dir = TestDir::new("delivery-temporary");
    let temporary_path = dir.0.join("backup.vrcx0backup.tmp");
    fs::write(&temporary_path, b"existing delivery").unwrap();

    let initial_error =
        create_delivery_temporary(&temporary_path, DeliveryAttempt::Initial).unwrap_err();
    assert_eq!(initial_error.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!(fs::read(&temporary_path).unwrap(), b"existing delivery");

    let retry_file = create_delivery_temporary(&temporary_path, DeliveryAttempt::Retry).unwrap();
    drop(retry_file);
    assert_eq!(fs::metadata(&temporary_path).unwrap().len(), 0);
}

#[test]
fn manual_backup_runs_off_thread_and_finishes_with_revisioned_outcome() {
    let dir = TestDir::new("manual");
    let target = dir.0.join("target");
    fs::create_dir_all(&target).unwrap();
    let runtime = test_runtime(&dir);

    let accepted = runtime.run_manual(target.join("Custom profile.vrcx0backup"));
    assert!(accepted.accepted);
    assert_eq!(accepted.status.state, ProfileBackupState::Running);

    let completed = wait_for_status(&runtime, ProfileBackupState::Idle);
    let outcome = completed.last_outcome.unwrap();
    assert!(outcome.succeeded);
    assert_eq!(outcome.revision, completed.revision);
    assert_eq!(
        outcome.file_name.as_deref(),
        Some("Custom profile.vrcx0backup")
    );
    let final_path = target.join(outcome.file_name.unwrap());
    assert!(final_path.is_file());

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mode = fs::metadata(final_path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    let events = runtime
        .inner
        .event_bus
        .take_events_for_test()
        .into_iter()
        .filter(|event| event.name == "profileBackupStatus")
        .collect::<Vec<_>>();
    let revisions = events
        .iter()
        .filter_map(|event| {
            event
                .payload
                .get("revision")
                .and_then(|value| value.as_u64())
        })
        .collect::<Vec<_>>();
    assert!(revisions.windows(2).all(|pair| pair[0] < pair[1]));
    assert!(events.iter().any(|event| {
        event.payload.get("phase").and_then(|value| value.as_str()) == Some("snapshot")
            && event
                .payload
                .get("percent")
                .is_some_and(serde_json::Value::is_null)
    }));
    assert!(events.iter().any(|event| {
        event.payload.get("phase").and_then(|value| value.as_str()) == Some("package")
            && event
                .payload
                .get("percent")
                .and_then(|value| value.as_u64())
                == Some(100)
    }));
    assert!(events.iter().any(|event| {
        event.payload.get("phase").and_then(|value| value.as_str()) == Some("deliver")
            && event
                .payload
                .get("percent")
                .is_some_and(serde_json::Value::is_null)
    }));
}

#[test]
fn manual_backup_rejects_a_modified_extension() {
    let dir = TestDir::new("manual-extension");
    let target = dir.0.join("target");
    fs::create_dir_all(&target).unwrap();
    let runtime = test_runtime(&dir);

    let outcome = runtime.run_manual(target.join("Custom profile.zip"));

    assert!(!outcome.accepted);
    assert_eq!(
        outcome.error.unwrap().code,
        ProfileBackupErrorCode::DirectoryUnavailable
    );
    assert_eq!(runtime.current_status().state, ProfileBackupState::Idle);
}

#[test]
fn manual_backup_rejects_the_automatic_rotation_namespace() {
    let dir = TestDir::new("manual-auto-name");
    let target = dir.0.join("target");
    fs::create_dir_all(&target).unwrap();
    let runtime = test_runtime(&dir);

    let outcome = runtime.run_manual(target.join("VRCX-0-backup-auto-20260715-120000.vrcx0backup"));

    assert!(!outcome.accepted);
    assert_eq!(
        outcome.error.unwrap().code,
        ProfileBackupErrorCode::AlreadyExists
    );
    assert_eq!(runtime.current_status().state, ProfileBackupState::Idle);
}

#[test]
fn orphan_cleanup_recognizes_custom_backup_file_names() {
    assert!(is_backup_temporary_file_name("My profile.vrcx0backup.tmp"));
    assert!(!is_backup_temporary_file_name("My profile.tmp"));
    assert!(!is_backup_temporary_file_name("My profile.vrcx0backup"));
}

#[test]
fn delivery_failure_keeps_artifact_for_explicit_retry() {
    let dir = TestDir::new("retry");
    let target = dir.0.join("removable-target");
    let runtime = test_runtime(&dir);

    assert!(
        runtime
            .run_manual(target.join("manual.vrcx0backup"))
            .accepted
    );
    let retryable = wait_for_status(&runtime, ProfileBackupState::Retryable);
    assert_eq!(
        retryable.error.as_ref().unwrap().code,
        ProfileBackupErrorCode::DirectoryUnavailable
    );
    assert!(
        !runtime
            .run_manual(target.join("manual.vrcx0backup"))
            .accepted
    );

    fs::create_dir_all(&target).unwrap();
    let file_name = retryable
        .last_outcome
        .as_ref()
        .and_then(|outcome| outcome.file_name.as_ref())
        .unwrap();
    let temporary_path = target.join(format!("{file_name}.tmp"));
    fs::write(&temporary_path, b"incomplete delivery").unwrap();

    assert!(runtime.retry_delivery().accepted);
    let completed = wait_for_status(&runtime, ProfileBackupState::Idle);
    assert!(completed.last_outcome.unwrap().succeeded);
    assert!(!temporary_path.exists());
}

#[test]
fn auto_delivery_failure_is_recorded_and_next_cycle_runs_a_fresh_backup() {
    let dir = TestDir::new("auto-retry-next-cycle");
    let target = dir.0.join("removable-target");
    let runtime = test_runtime(&dir);

    assert!(runtime.start_auto_backup(target.clone()).accepted);
    let retryable = wait_for_status(&runtime, ProfileBackupState::Retryable);
    let stale_archive = runtime
        .inner
        .state
        .lock()
        .unwrap()
        .pending_delivery
        .as_ref()
        .unwrap()
        .archive
        .clone();
    assert!(stale_archive.is_file());

    let failed_job = runtime
        .inner
        .background_jobs
        .snapshot()
        .into_iter()
        .find(|job| job.name == AUTO_JOB)
        .unwrap();
    assert_eq!(failed_job.status, "error");
    assert_eq!(failed_job.failure_count, 1);
    assert_eq!(
        retryable.error.unwrap().code,
        ProfileBackupErrorCode::DirectoryUnavailable
    );

    fs::create_dir_all(&target).unwrap();
    assert!(runtime.start_auto_backup(target.clone()).accepted);
    let completed = wait_for_status(&runtime, ProfileBackupState::Idle);
    let outcome = completed.last_outcome.unwrap();
    assert!(outcome.succeeded);
    assert!(target.join(outcome.file_name.unwrap()).is_file());
    assert!(!stale_archive.exists());
}

#[test]
fn pending_restore_journal_blocks_new_backups() {
    let dir = TestDir::new("pending-restore-blocks");
    let target = dir.0.join("target");
    fs::create_dir_all(&target).unwrap();
    let runtime = test_runtime(&dir);
    fs::write(
        runtime.inner.app_data.join(RESTORE_JOURNAL_FILE_NAME),
        b"{}",
    )
    .unwrap();

    let outcome = runtime.run_manual(target.join("manual.vrcx0backup"));
    assert!(!outcome.accepted);
    assert_eq!(
        outcome.error.unwrap().code,
        ProfileBackupErrorCode::PendingRestore
    );
    assert_eq!(runtime.current_status().state, ProfileBackupState::Idle);
}

#[test]
fn restore_rollback_cleanup_rejects_pending_restore_without_removing_data() {
    let dir = TestDir::new("rollback-pending");
    let runtime = test_runtime(&dir);
    let rollback = runtime
        .inner
        .app_data
        .join(RESTORE_ROLLBACK_DIRECTORY)
        .join("20990710-000000");
    fs::create_dir_all(&rollback).unwrap();
    let rollback_database = rollback.join(DATABASE_FILE_NAME);
    fs::write(&rollback_database, b"rollback").unwrap();
    fs::write(
        runtime.inner.app_data.join(RESTORE_JOURNAL_FILE_NAME),
        b"{}",
    )
    .unwrap();

    let state = runtime.restore_rollback_state().unwrap();
    assert_eq!(state.count, 1);
    assert!(!state.cleanup_allowed);

    let outcome = runtime.clear_restore_rollback();
    assert!(!outcome.accepted);
    assert_eq!(outcome.state, state);
    assert_eq!(
        outcome.error.unwrap().code,
        ProfileBackupErrorCode::PendingRestore
    );
    assert!(rollback_database.exists());
}

#[test]
fn restore_rollback_cleanup_returns_refreshed_empty_state() {
    let dir = TestDir::new("rollback-clear");
    let runtime = test_runtime(&dir);
    let rollback = runtime
        .inner
        .app_data
        .join(RESTORE_ROLLBACK_DIRECTORY)
        .join("20990710-000000");
    fs::create_dir_all(&rollback).unwrap();
    fs::write(rollback.join(DATABASE_FILE_NAME), b"rollback").unwrap();

    let outcome = runtime.clear_restore_rollback();

    assert!(outcome.accepted);
    assert_eq!(outcome.state.count, 0);
    assert!(!outcome.state.cleanup_allowed);
    assert!(outcome.error.is_none());
}

#[test]
fn restore_rollback_cleanup_reports_busy_and_io_errors() {
    let busy_dir = TestDir::new("rollback-busy");
    let busy_runtime = test_runtime(&busy_dir);
    let busy_rollback = busy_runtime
        .inner
        .app_data
        .join(RESTORE_ROLLBACK_DIRECTORY)
        .join("20990710-000000");
    fs::create_dir_all(&busy_rollback).unwrap();
    fs::write(busy_rollback.join(DATABASE_FILE_NAME), b"rollback").unwrap();
    busy_runtime
        .inner
        .operation_gate
        .flag
        .store(true, std::sync::atomic::Ordering::Release);

    let busy = busy_runtime.clear_restore_rollback();
    assert!(!busy.accepted);
    assert_eq!(
        busy.error.unwrap().code,
        ProfileBackupErrorCode::OperationBusy
    );
    assert_eq!(busy.state.count, 1);
    busy_runtime
        .inner
        .operation_gate
        .flag
        .store(false, std::sync::atomic::Ordering::Release);

    let io_dir = TestDir::new("rollback-io");
    let io_runtime = test_runtime(&io_dir);
    fs::write(
        io_runtime.inner.app_data.join(RESTORE_ROLLBACK_DIRECTORY),
        b"not a directory",
    )
    .unwrap();

    let io = io_runtime.clear_restore_rollback();
    assert!(!io.accepted);
    assert_eq!(io.error.unwrap().code, ProfileBackupErrorCode::Io);
}

#[test]
fn manual_pending_delivery_blocks_auto_cycle_with_dedicated_code() {
    let dir = TestDir::new("manual-pending-blocks-auto");
    let target = dir.0.join("removable-target");
    let runtime = test_runtime(&dir);

    assert!(
        runtime
            .run_manual(target.join("manual.vrcx0backup"))
            .accepted
    );
    wait_for_status(&runtime, ProfileBackupState::Retryable);

    let outcome = runtime.start_auto_backup(target.clone());
    assert!(!outcome.accepted);
    assert_eq!(
        outcome.error.unwrap().code,
        ProfileBackupErrorCode::DeliveryPending
    );
}

#[test]
fn dismiss_error_does_not_change_or_emit_a_running_status() {
    let dir = TestDir::new("dismiss-running");
    let runtime = test_runtime(&dir);

    runtime.begin_running(
        ProfileBackupKind::Manual,
        ProfileBackupPhase::Snapshot,
        Some(12),
    );
    runtime.inner.event_bus.take_events_for_test();
    let before = runtime.current_status();

    let dismissed = runtime.dismiss_error();

    assert_eq!(dismissed, before);
    assert!(runtime.inner.event_bus.take_events_for_test().is_empty());
}
