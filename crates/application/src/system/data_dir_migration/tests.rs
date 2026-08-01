use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use vrcx_0_application_core::{Error, RuntimeEventBus};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::data_dir_migration::{
    read_pending_data_dir_migration, write_data_dir_cleanup_pending,
    write_pending_data_dir_migration, DataDirCleanupPending, DataDirMigrationJournalPhase,
    DataDirMigrationTargetState, PendingDataDirMigration,
};
use vrcx_0_persistence::DatabaseService;

use super::*;
use crate::system::profile_backup::{OperationGuard, ProfileOperationGate};

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
            "vrcx-0-application-data-dir-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn test_database(source_dir: &Path) -> Arc<DatabaseService> {
    let db = Arc::new(DatabaseService::new(&source_dir.join("VRCX-0.sqlite3")).unwrap());
    ConfigRepository::new(Arc::clone(&db))
        .set_string("migration-test", "source")
        .unwrap();
    db
}

fn test_runtime(
    source_dir: PathBuf,
    control_dir: PathBuf,
    db: Arc<DatabaseService>,
    gate: ProfileOperationGate,
    pointer_committer: DataDirPointerCommitter,
) -> (DataDirMigrationRuntime, RuntimeEventBus) {
    let event_bus = RuntimeEventBus::new();
    (
        DataDirMigrationRuntime::new(
            source_dir,
            control_dir,
            db,
            event_bus.clone(),
            gate,
            pointer_committer,
        ),
        event_bus,
    )
}

#[test]
fn request_migration_owns_mode_and_space_validation() {
    let dir = TestDir::new("request-validation");
    let source = dir.path.join("source");
    let control = dir.path.join("control");
    std::fs::create_dir(&source).unwrap();
    std::fs::create_dir(&control).unwrap();
    let db = test_database(&source);
    let (runtime, _) = test_runtime(
        source,
        control,
        db,
        ProfileOperationGate::default(),
        Arc::new(|_| Ok(())),
    );
    let plan = |target_state, required_bytes, available_bytes| DataDirMigrationPlan {
        target_path: dir.path.join("target").to_string_lossy().into_owned(),
        required_bytes,
        available_bytes,
        target_state,
    };

    let insufficient = runtime.request_migration(
        plan(DataDirMigrationTargetState::Empty, 2, 1),
        DataDirMigrationMode::Migrate,
    );
    assert_eq!(
        insufficient.error.expect("space error").code,
        DataDirMigrationErrorCode::InsufficientSpace
    );

    let invalid_adoption = runtime.request_migration(
        plan(DataDirMigrationTargetState::Empty, 0, 0),
        DataDirMigrationMode::AdoptExisting,
    );
    assert_eq!(
        invalid_adoption.error.expect("adoption error").code,
        DataDirMigrationErrorCode::InvalidAdoptionTarget
    );

    let invalid_fresh_start = runtime.request_migration(
        plan(DataDirMigrationTargetState::ExistingProfile, 0, 0),
        DataDirMigrationMode::FreshStart,
    );
    assert_eq!(
        invalid_fresh_start.error.expect("fresh start error").code,
        DataDirMigrationErrorCode::InvalidFreshStartTarget
    );
}

#[test]
fn migration_happy_path_freezes_copies_and_commits_pointer() {
    let dir = TestDir::new("happy");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    let control = dir.path.join("control");
    for path in [&source, &target, &control] {
        std::fs::create_dir(path).unwrap();
    }
    let db = test_database(&source);
    let committed = Arc::new(Mutex::new(None));
    let committed_for_callback = Arc::clone(&committed);
    let pointer: DataDirPointerCommitter = Arc::new(move |path| {
        *committed_for_callback.lock().unwrap() = Some(path.to_path_buf());
        Ok(())
    });
    let (runtime, event_bus) = test_runtime(
        source.clone(),
        control.clone(),
        Arc::clone(&db),
        ProfileOperationGate::default(),
        pointer,
    );

    let outcome = runtime.run_migration(target.clone(), false);

    assert!(outcome.accepted);
    assert_eq!(outcome.status.state, DataDirMigrationState::Completed);
    assert_eq!(*committed.lock().unwrap(), Some(target.clone()));
    assert!(!db.is_main_mode());
    assert!(target.join("VRCX-0.sqlite3").is_file());
    assert_eq!(
        read_pending_data_dir_migration(&control)
            .unwrap()
            .expect("switched journal")
            .phase,
        DataDirMigrationJournalPhase::Switched
    );
    let events = event_bus.take_events_for_test();
    assert!(events.iter().all(|event| event.name == "dataDirMigration"));
    assert!(events.len() >= 5);
}

#[test]
fn migration_uses_the_profile_backup_operation_gate() {
    let dir = TestDir::new("operation-gate");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    let control = dir.path.join("control");
    for path in [&source, &target, &control] {
        std::fs::create_dir(path).unwrap();
    }
    let db = test_database(&source);
    let gate = ProfileOperationGate::default();
    let _guard = OperationGuard::try_acquire(&gate).expect("operation guard");
    let (runtime, _) = test_runtime(source, control, db, gate, Arc::new(|_| Ok(())));

    let pointer_change = runtime.switch_data_dir_pointer(target.clone());
    assert!(!pointer_change.accepted);
    assert_eq!(
        pointer_change.error.expect("operation busy error").code,
        DataDirMigrationErrorCode::OperationBusy
    );
    assert!(runtime.cleanup_migrated_data().is_err());
    assert!(runtime.dismiss_cleanup().is_err());
    assert!(runtime
        .mark_cleanup_prompted("2026-07-18T00:00:00Z".into())
        .is_err());

    let outcome = runtime.run_migration(target, false);

    assert!(!outcome.accepted);
    assert_eq!(
        outcome.error.expect("operation busy error").code,
        DataDirMigrationErrorCode::OperationBusy
    );
}

#[test]
fn copy_failure_reopens_the_source_database_and_removes_journal() {
    let dir = TestDir::new("copy-failure");
    let source = dir.path.join("source");
    let target = dir.path.join("target-file");
    let control = dir.path.join("control");
    std::fs::create_dir(&source).unwrap();
    std::fs::create_dir(&control).unwrap();
    std::fs::write(&target, b"not-a-directory").unwrap();
    let db = test_database(&source);
    let (runtime, _) = test_runtime(
        source,
        control.clone(),
        Arc::clone(&db),
        ProfileOperationGate::default(),
        Arc::new(|_| Ok(())),
    );

    let outcome = runtime.run_migration(target, false);

    assert!(!outcome.accepted);
    assert_eq!(
        outcome.error.expect("copy error").code,
        DataDirMigrationErrorCode::CopyFailed
    );
    assert!(db.is_main_mode());
    assert!(read_pending_data_dir_migration(&control).unwrap().is_none());
    ConfigRepository::new(db)
        .set_string("migration-test", "after-abort")
        .unwrap();
}

#[test]
fn pointer_failure_keeps_switched_journal_and_database_closed() {
    let dir = TestDir::new("pointer-failure");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    let control = dir.path.join("control");
    for path in [&source, &target, &control] {
        std::fs::create_dir(path).unwrap();
    }
    let db = test_database(&source);
    let (runtime, _) = test_runtime(
        source,
        control.clone(),
        Arc::clone(&db),
        ProfileOperationGate::default(),
        Arc::new(|_| Err(Error::Custom("injected pointer failure".into()))),
    );

    let outcome = runtime.run_migration(target, false);

    assert!(!outcome.accepted);
    assert_eq!(
        outcome.error.expect("pointer error").code,
        DataDirMigrationErrorCode::PointerCommitFailed
    );
    assert!(!db.is_main_mode());
    assert_eq!(
        read_pending_data_dir_migration(&control)
            .unwrap()
            .expect("switched journal")
            .phase,
        DataDirMigrationJournalPhase::Switched
    );
}

#[test]
fn migration_rejects_restore_legacy_and_cleanup_conflicts() {
    let dir = TestDir::new("conflicts");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    let control = dir.path.join("control");
    for path in [&source, &target, &control] {
        std::fs::create_dir(path).unwrap();
    }
    let db = test_database(&source);
    let (runtime, _) = test_runtime(
        source.clone(),
        control.clone(),
        db,
        ProfileOperationGate::default(),
        Arc::new(|_| Ok(())),
    );

    std::fs::write(source.join("pending_profile_restore.json"), b"restore").unwrap();
    let restore = runtime.run_migration(target.clone(), false);
    assert_eq!(
        restore.error.expect("restore conflict").code,
        DataDirMigrationErrorCode::PendingRestore
    );
    std::fs::remove_file(source.join("pending_profile_restore.json")).unwrap();

    std::fs::write(source.join("pending_vrcx_migration"), b"legacy").unwrap();
    let legacy = runtime.run_migration(target.clone(), false);
    assert_eq!(
        legacy.error.expect("legacy conflict").code,
        DataDirMigrationErrorCode::PendingLegacyMigration
    );
    std::fs::remove_file(source.join("pending_vrcx_migration")).unwrap();

    write_data_dir_cleanup_pending(
        &control,
        &DataDirCleanupPending {
            old_dir: target.to_string_lossy().into_owned(),
            bytes: 0,
            migrated_at: "now".into(),
            last_prompted_at: None,
            dismissed: false,
            replaced_dir: None,
        },
    )
    .unwrap();
    let cleanup = runtime.run_migration(target, false);
    assert_eq!(
        cleanup.error.expect("cleanup conflict").code,
        DataDirMigrationErrorCode::CleanupConflict
    );

    std::fs::write(
        control.join("data-dir-cleanup-pending.json"),
        b"invalid cleanup state",
    )
    .unwrap();
    let corrupt_cleanup = runtime.run_migration(dir.path.join("other-target"), false);
    assert_eq!(
        corrupt_cleanup.error.expect("cleanup state error").code,
        DataDirMigrationErrorCode::Io
    );
}

#[test]
fn existing_migration_journal_is_rejected_without_overwrite() {
    let dir = TestDir::new("pending-journal");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    let control = dir.path.join("control");
    for path in [&source, &target, &control] {
        std::fs::create_dir(path).unwrap();
    }
    let db = test_database(&source);
    let journal = PendingDataDirMigration::copying(
        "preserved-source".into(),
        "preserved-target".into(),
        "now".into(),
        false,
    );
    write_pending_data_dir_migration(&control, &journal).unwrap();
    let (runtime, _) = test_runtime(
        source,
        control.clone(),
        db,
        ProfileOperationGate::default(),
        Arc::new(|_| Ok(())),
    );

    let outcome = runtime.run_migration(target, false);

    assert_eq!(
        outcome.error.expect("pending migration").code,
        DataDirMigrationErrorCode::PendingMigration
    );
    assert_eq!(
        read_pending_data_dir_migration(&control).unwrap(),
        Some(journal)
    );
}
