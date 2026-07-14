use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use chrono::{DateTime, Local, TimeZone, Utc};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::profile_backup::{DATABASE_FILE_NAME, RESTORE_JOURNAL_FILE_NAME};
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::DatabaseService;

use crate::background::RuntimeBackgroundJobs;
use crate::event_bus::RuntimeEventBus;
use crate::task_supervisor::TaskSupervisor;

use super::pipeline::{backup_file_name, create_delivery_temporary, DeliveryAttempt};
use super::scheduler::is_auto_backup_due;
use vrcx_0_persistence::VRCX0_SCHEMA_VERSION_KEY as DATABASE_VERSION_KEY;

use super::{
    ProfileBackupKind, ProfileBackupPhase, ProfileBackupRuntime, ProfileBackupState,
    ProfileBackupStatus, AUTO_JOB,
};
use crate::profile_backup::ProfileBackupErrorCode;

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
    ProfileBackupRuntime::new(
        app_data,
        db,
        storage,
        RuntimeEventBus::new(),
        TaskSupervisor::new(),
        RuntimeBackgroundJobs::new(),
        "2.13.0".into(),
    )
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

    let accepted = runtime.run_manual(&target);
    assert!(accepted.accepted);
    assert_eq!(accepted.status.state, ProfileBackupState::Running);

    let completed = wait_for_status(&runtime, ProfileBackupState::Idle);
    let outcome = completed.last_outcome.unwrap();
    assert!(outcome.succeeded);
    assert_eq!(outcome.revision, completed.revision);
    let final_path = target.join(outcome.file_name.unwrap());
    assert!(final_path.is_file());

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mode = fs::metadata(final_path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    let revisions = runtime
        .inner
        .event_bus
        .take_events_for_test()
        .into_iter()
        .filter(|event| event.name == "profileBackupStatus")
        .filter_map(|event| {
            event
                .payload
                .get("revision")
                .and_then(|value| value.as_u64())
        })
        .collect::<Vec<_>>();
    assert!(revisions.windows(2).all(|pair| pair[0] < pair[1]));
}

#[test]
fn delivery_failure_keeps_artifact_for_explicit_retry() {
    let dir = TestDir::new("retry");
    let target = dir.0.join("removable-target");
    let runtime = test_runtime(&dir);

    assert!(runtime.run_manual(&target).accepted);
    let retryable = wait_for_status(&runtime, ProfileBackupState::Retryable);
    assert_eq!(
        retryable.error.as_ref().unwrap().code,
        ProfileBackupErrorCode::DirectoryUnavailable
    );
    assert!(!runtime.run_manual(&target).accepted);

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

    assert!(
        runtime
            .start_backup(ProfileBackupKind::Auto, target.clone())
            .accepted
    );
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
    assert!(
        runtime
            .start_backup(ProfileBackupKind::Auto, target.clone())
            .accepted
    );
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

    let outcome = runtime.run_manual(&target);
    assert!(!outcome.accepted);
    assert_eq!(
        outcome.error.unwrap().code,
        ProfileBackupErrorCode::PendingRestore
    );
    assert_eq!(runtime.current_status().state, ProfileBackupState::Idle);
}

#[test]
fn manual_pending_delivery_blocks_auto_cycle_with_dedicated_code() {
    let dir = TestDir::new("manual-pending-blocks-auto");
    let target = dir.0.join("removable-target");
    let runtime = test_runtime(&dir);

    assert!(runtime.run_manual(&target).accepted);
    wait_for_status(&runtime, ProfileBackupState::Retryable);

    let outcome = runtime.start_backup(ProfileBackupKind::Auto, target.clone());
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

    runtime.begin_running(ProfileBackupKind::Manual, ProfileBackupPhase::Snapshot, 12);
    runtime.inner.event_bus.take_events_for_test();
    let before = runtime.current_status();

    let dismissed = runtime.dismiss_error();

    assert_eq!(dismissed, before);
    assert!(runtime.inner.event_bus.take_events_for_test().is_empty());
}
