use super::*;
use std::path::PathBuf;
use std::sync::atomic::AtomicUsize;
use vrcx_0_persistence::data_dir_migration::{
    read_pending_data_dir_migration, take_data_dir_migration_result,
    write_pending_data_dir_migration, DataDirMigrationResultStatus, PendingDataDirMigration,
    StagedDataDirMigration,
};
use vrcx_0_platform::app_paths::AppDataDirSource;

#[derive(Default)]
struct TestProfileExtension {
    stop_count: AtomicUsize,
}

impl RuntimeHostProfileExtension for TestProfileExtension {
    fn stop_profile_services(&self) {
        self.stop_count.fetch_add(1, Ordering::AcqRel);
    }
}

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
            "vrcx-0-composition-{name}-{}-{nonce}",
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

fn cli_options(
    app_data: PathBuf,
    profile: RuntimeHostProfile,
    task_executor: Option<Arc<dyn RuntimeTaskExecutor>>,
) -> RuntimeHostOptions {
    RuntimeHostOptions {
        realtime_origin: "http://localhost:9000".into(),
        launched_from_autostart: false,
        app_data_dir: AppDataDirResolution {
            current_dir: app_data.clone(),
            default_dir: app_data.clone(),
            persisted_dir: None,
            cli_dir: Some(app_data),
            source: AppDataDirSource::Cli,
        },
        app_version: "0.0.0-test".into(),
        profile,
        database_maintenance_cache_dir: None,
        task_executor,
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
            db_sha256: "test".into(),
            db_bytes: 1,
            wal_bytes: None,
        },
        None,
    );
    journal
}

fn persisted_resolution(source: &Path) -> AppDataDirResolution {
    AppDataDirResolution {
        current_dir: source.to_path_buf(),
        default_dir: source.to_path_buf(),
        persisted_dir: None,
        cli_dir: None,
        source: AppDataDirSource::Default,
    }
}

#[test]
fn switched_data_dir_migration_finishes_before_profile_startup() -> Result<()> {
    let dir = TestDir::new("data-dir-migration-success");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    std::fs::create_dir_all(&source)?;
    std::fs::create_dir_all(&target)?;
    drop(DatabaseService::new(&source.join("VRCX-0.sqlite3"))?);
    drop(DatabaseService::new(&target.join("VRCX-0.sqlite3"))?);
    write_pending_data_dir_migration(&source, &switched_journal(&source, &target))?;

    let builder = RuntimeHostStateBuilder::new(RuntimeHostOptions {
        realtime_origin: "http://localhost:9000".into(),
        launched_from_autostart: false,
        app_data_dir: persisted_resolution(&source),
        app_version: "0.0.0-test".into(),
        profile: RuntimeHostProfile::HeadlessData,
        database_maintenance_cache_dir: None,
        task_executor: None,
    })?;

    assert!(app_data_paths_match(&builder.paths.app_data, &target));
    assert_eq!(
        take_data_dir_migration_result(&source)?
            .expect("migration result")
            .status,
        DataDirMigrationResultStatus::Succeeded
    );
    Ok(())
}

#[test]
fn migrated_database_open_failure_rolls_back_to_source() -> Result<()> {
    let dir = TestDir::new("data-dir-migration-rollback");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    std::fs::create_dir_all(&source)?;
    std::fs::create_dir_all(target.join("VRCX-0.sqlite3"))?;
    drop(DatabaseService::new(&source.join("VRCX-0.sqlite3"))?);
    write_pending_data_dir_migration(&source, &switched_journal(&source, &target))?;

    let builder = RuntimeHostStateBuilder::new(RuntimeHostOptions {
        realtime_origin: "http://localhost:9000".into(),
        launched_from_autostart: false,
        app_data_dir: persisted_resolution(&source),
        app_version: "0.0.0-test".into(),
        profile: RuntimeHostProfile::HeadlessData,
        database_maintenance_cache_dir: None,
        task_executor: None,
    })?;

    assert!(app_data_paths_match(&builder.paths.app_data, &source));
    assert_eq!(
        take_data_dir_migration_result(&source)?
            .expect("migration result")
            .status,
        DataDirMigrationResultStatus::DatabaseOpenFailed
    );
    Ok(())
}

#[test]
fn interrupted_copy_is_cleaned_before_profile_startup() -> Result<()> {
    let dir = TestDir::new("data-dir-migration-interrupted");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    let staging = target.join(".migrate-staging");
    std::fs::create_dir_all(&source)?;
    std::fs::create_dir_all(&staging)?;
    std::fs::write(staging.join("VRCX-0.sqlite3"), b"partial")?;
    write_pending_data_dir_migration(
        &source,
        &PendingDataDirMigration::copying(
            source.to_string_lossy().into_owned(),
            target.to_string_lossy().into_owned(),
            "2026-07-18T00:00:00Z".into(),
            false,
        ),
    )?;

    let mut resolution = persisted_resolution(&source);
    assert!(prepare_data_dir_migration_startup(&mut resolution)?.is_none());
    assert!(app_data_paths_match(&resolution.current_dir, &source));
    assert!(!staging.exists());
    assert!(read_pending_data_dir_migration(&source)?.is_none());
    assert_eq!(
        take_data_dir_migration_result(&source)?
            .expect("migration result")
            .status,
        DataDirMigrationResultStatus::Interrupted
    );
    Ok(())
}

#[test]
fn cli_override_leaves_switched_migration_pending() -> Result<()> {
    let dir = TestDir::new("data-dir-migration-cli-override");
    let control = dir.path.join("control");
    let source = dir.path.join("source");
    let target = dir.path.join("target");
    let cli = dir.path.join("cli");
    for path in [&control, &source, &target, &cli] {
        std::fs::create_dir_all(path)?;
    }
    write_pending_data_dir_migration(&control, &switched_journal(&source, &target))?;
    let mut resolution = AppDataDirResolution {
        current_dir: cli.clone(),
        default_dir: control.clone(),
        persisted_dir: Some(source),
        cli_dir: Some(cli.clone()),
        source: AppDataDirSource::Cli,
    };

    assert!(prepare_data_dir_migration_startup(&mut resolution)?.is_none());
    assert!(app_data_paths_match(&resolution.current_dir, &cli));
    assert!(read_pending_data_dir_migration(&control)?.is_some());
    assert!(take_data_dir_migration_result(&control)?.is_none());
    Ok(())
}

#[test]
fn headless_data_constructs_no_game_or_desktop_bundle_and_stops_idempotently() -> Result<()> {
    let dir = TestDir::new("headless-profile");
    let app_data = dir.path.join("app-data");
    std::fs::create_dir_all(&app_data)?;
    let state = RuntimeHostState::new(cli_options(
        app_data,
        RuntimeHostProfile::HeadlessData,
        None,
    ))?;
    assert!(state.profile_extension.is_none());
    assert!(!state.paths.app_data.join("metadataCache.db").exists());
    state
        .backend_runtime
        .set_phase(BackendRuntimePhase::Running);
    let first = state.stop_backend_runtime("test");
    assert_eq!(first.phase, BackendRuntimePhase::Idle);
    let second = state.stop_backend_runtime("test-again");
    assert_eq!(second.phase, BackendRuntimePhase::Idle);
    assert_eq!(second.updated_at, first.updated_at);
    Ok(())
}

#[test]
fn desktop_idle_stop_still_cleans_up_profile_services() -> Result<()> {
    let dir = TestDir::new("desktop-idle-stop");
    let app_data = dir.path.join("app-data");
    std::fs::create_dir_all(&app_data)?;
    let extension = Arc::new(TestProfileExtension::default());
    let state =
        RuntimeHostStateBuilder::new(cli_options(app_data, RuntimeHostProfile::Desktop, None))?
            .finish(RuntimeHostComposition {
                local_game_context: Arc::new(UnavailableLocalGameContextSource),
                group_order_source: Arc::new(UnavailableGroupOrderSource),
                friend_projection_observer: None,
                profile_extension: Some(extension.clone()),
            })?;

    let before = state.backend_runtime.snapshot();
    assert_eq!(before.phase, BackendRuntimePhase::Idle);
    let stopped = state.stop_backend_runtime("application-exit");
    assert_eq!(stopped.updated_at, before.updated_at);
    assert_eq!(extension.stop_count.load(Ordering::Acquire), 1);
    Ok(())
}

#[test]
fn construction_time_tasks_run_on_the_provided_executor() -> Result<()> {
    let dir = TestDir::new("construction-executor");
    let app_data = dir.path.join("app-data");
    std::fs::create_dir_all(&app_data)?;
    let executor = vrcx_0_application_core::CountingTaskExecutor::default();

    let _state = RuntimeHostState::new(cli_options(
        app_data,
        RuntimeHostProfile::HeadlessData,
        Some(Arc::new(executor.clone())),
    ))?;

    assert!(executor.spawned() > 0);
    Ok(())
}
