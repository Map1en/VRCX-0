use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64},
    Arc, Mutex,
};

use serde::Serialize;
use serde_json::Value;

use super::profile_lock::ProfileLock;
use crate::{
    AuthenticatedRuntimeOrchestrator, GroupOrderSource, NoteExportRuntime, Result,
    RuntimeHostComposition, RuntimeHostContext, RuntimeHostProfile, RuntimeHostProfileExtension,
    SharedCollectionImportRuntime, UnavailableGroupOrderSource,
};
use vrcx_0_application::{
    AuthenticatedSessionMaintenanceOutcome, DataDirMigrationRuntime, FavoriteImportRuntime,
    GroupApiDeps, GroupBanImportRuntime, PrintCleanupDeps, PrintCleanupQueueSink,
    ProfileBackupRuntime, ProfileBackupRuntimeDeps, VrchatGroupBanImportActions,
};
use vrcx_0_application_core::{
    BackendRuntime, ImageCache, UnavailableLocalGameContextSource, WebClient,
};
use vrcx_0_application_realtime::{RealtimeHostRuntime, RealtimeHostRuntimeDeps};
use vrcx_0_host::app_paths::{
    app_data_paths_match, commit_app_data_dir_pointer, AppDataDirResolution, AppDataDirSource,
    AppPaths,
};
use vrcx_0_persistence::data_dir_migration::{
    cleanup_interrupted_data_dir_migration, complete_data_dir_migration,
    finalize_data_dir_migration, read_pending_data_dir_migration,
    record_data_dir_migration_database_open_failure, DataDirMigrationFinalizeOutcome,
    DataDirMigrationJournalPhase, PendingDataDirMigration,
};
use vrcx_0_persistence::legacy_migration::{
    consume_pending_legacy_migration, LegacyMigrationPaths,
};
use vrcx_0_persistence::legacy_vrcx::{LegacyVrcxMigrationStatus, LegacyVrcxSource};
use vrcx_0_persistence::profile_backup::{
    cleanup_profile_backup_artifacts, consume_pending_profile_restore, ProfileRestoreFailureCode,
};
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::DatabaseService;

#[cfg(test)]
use std::sync::atomic::Ordering;
#[cfg(test)]
use vrcx_0_application_core::{BackendRuntimeMode, BackendRuntimePhase};

pub struct RuntimeHostOptions {
    pub realtime_origin: String,
    pub launched_from_autostart: bool,
    pub app_data_dir: AppDataDirResolution,
    pub app_version: String,
    pub profile: RuntimeHostProfile,
}

pub(super) fn web_ua_app_version(app_version: &str, profile: RuntimeHostProfile) -> String {
    match profile {
        RuntimeHostProfile::Desktop => app_version.to_string(),
        RuntimeHostProfile::HeadlessData => format!("{app_version} (hl)"),
    }
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackendRuntimeFrontendSessionSnapshot {
    pub authenticated: bool,
    pub user_id: String,
    pub display_name: String,
    pub endpoint: String,
    pub websocket: String,
    pub current_user_snapshot: Value,
}

pub struct RuntimeHostStateBuilder {
    profile: RuntimeHostProfile,
    pub app_data_dir: AppDataDirResolution,
    pub app_version: String,
    pub paths: AppPaths,
    pub storage: Arc<StorageService>,
    pub db: Arc<DatabaseService>,
    pub profile_backup: ProfileBackupRuntime,
    pub data_dir_migration: DataDirMigrationRuntime,
    pub runtime_context: Arc<RuntimeHostContext>,
    pub backend_runtime: BackendRuntime,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub legacy_vrcx_available: bool,
    pub legacy_vrcx_source: Option<LegacyVrcxSource>,
    pub legacy_vrcx_migration_status: LegacyVrcxMigrationStatus,
    pub launched_from_autostart: bool,
    profile_lock: ProfileLock,
}

pub struct RuntimeHostState {
    pub profile: RuntimeHostProfile,
    pub app_data_dir: AppDataDirResolution,
    pub paths: AppPaths,
    pub storage: Arc<StorageService>,
    pub db: Arc<DatabaseService>,
    pub profile_backup: ProfileBackupRuntime,
    pub data_dir_migration: DataDirMigrationRuntime,
    pub runtime_context: Arc<RuntimeHostContext>,
    pub backend_runtime: BackendRuntime,
    pub realtime_runtime: Arc<RealtimeHostRuntime>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub authenticated_runtime: AuthenticatedRuntimeOrchestrator,
    pub favorite_import: FavoriteImportRuntime,
    pub group_ban_import: GroupBanImportRuntime,
    pub shared_collection_import: SharedCollectionImportRuntime,
    pub note_export: NoteExportRuntime,
    pub group_order_source: Arc<dyn GroupOrderSource>,
    pub legacy_vrcx_available: bool,
    pub legacy_vrcx_source: Option<LegacyVrcxSource>,
    pub legacy_vrcx_migration_status: LegacyVrcxMigrationStatus,
    pub launched_from_autostart: bool,
    pub(super) profile_extension: Option<Arc<dyn RuntimeHostProfileExtension>>,
    pub(super) backend_starting: AtomicBool,
    pub(super) background_auth_recovery_running: Arc<AtomicBool>,
    pub(super) social_maintenance_running: Arc<AtomicBool>,
    pub(super) activity_warmup_generation: Arc<AtomicU64>,
    pub(super) background_group_instances_refresh_running: Arc<AtomicBool>,
    pub(super) backend_frontend_session: Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    pub(super) authenticated_session_maintenance:
        Arc<Mutex<Option<AuthenticatedSessionMaintenanceOutcome>>>,
    pub(super) _profile_lock: ProfileLock,
}

trait SecretStartupActions {
    fn initialize(&mut self);
    fn is_encrypting_writes(&mut self) -> bool;
    fn migrate_cookies(&mut self) -> Result<()>;
    fn migrate_saved_credentials(&mut self) -> Result<()>;
    fn read_cleanup_completed(&mut self) -> Result<bool>;
    fn cleanup(&mut self) -> Result<()>;
    fn record_cleanup_completed(&mut self) -> Result<()>;
}

fn run_secret_startup(actions: &mut dyn SecretStartupActions) {
    actions.initialize();
    let mut migrations_succeeded = true;
    if let Err(error) = actions.migrate_cookies() {
        migrations_succeeded = false;
        tracing::warn!(error = %error, "failed to migrate stored cookies to encrypted form");
    }
    if let Err(error) = actions.migrate_saved_credentials() {
        migrations_succeeded = false;
        tracing::warn!(error = %error, "failed to migrate saved credentials to encrypted form");
    }
    let cleanup_completed = match actions.read_cleanup_completed() {
        Ok(completed) => completed,
        Err(error) => {
            tracing::warn!(error = %error, "failed to read secret migration cleanup state");
            false
        }
    };
    if !actions.is_encrypting_writes() || !migrations_succeeded || cleanup_completed {
        return;
    }
    if let Err(error) = actions.cleanup() {
        tracing::warn!(error = %error, "failed to remove plaintext remnants after secret migration");
        return;
    }
    if let Err(error) = actions.record_cleanup_completed() {
        tracing::warn!(error = %error, "failed to record completed secret migration cleanup state");
    }
}

struct SecretStartup<'a> {
    db: &'a Arc<DatabaseService>,
    config: vrcx_0_persistence::config::ConfigRepository,
    allow_encrypted_writes: bool,
}

impl SecretStartupActions for SecretStartup<'_> {
    fn initialize(&mut self) {
        vrcx_0_persistence::secrets::init_secrets(
            vrcx_0_host::machine_key::derive_secrets_key(),
            self.allow_encrypted_writes,
        );
    }

    fn is_encrypting_writes(&mut self) -> bool {
        vrcx_0_persistence::secrets::is_encrypting_writes()
    }

    fn migrate_cookies(&mut self) -> Result<()> {
        vrcx_0_persistence::cookies::migrate_default_cookies(self.db)?;
        Ok(())
    }

    fn migrate_saved_credentials(&mut self) -> Result<()> {
        vrcx_0_application::migrate_saved_credential_secrets(&self.config)?;
        Ok(())
    }

    fn read_cleanup_completed(&mut self) -> Result<bool> {
        Ok(self.config.get_bool(
            vrcx_0_persistence::secrets::CLEANUP_COMPLETED_CONFIG_KEY,
            false,
        )?)
    }

    fn cleanup(&mut self) -> Result<()> {
        Ok(vrcx_0_persistence::maintenance::vacuum_after_secret_migration(self.db)?)
    }

    fn record_cleanup_completed(&mut self) -> Result<()> {
        Ok(self.config.set_bool(
            vrcx_0_persistence::secrets::CLEANUP_COMPLETED_CONFIG_KEY,
            true,
        )?)
    }
}

fn prepare_secrets_at_rest(db: &Arc<DatabaseService>, profile: RuntimeHostProfile) {
    let allow_encrypted_writes = match profile {
        RuntimeHostProfile::Desktop => true,
        RuntimeHostProfile::HeadlessData => false,
    };
    let mut startup = SecretStartup {
        db,
        config: vrcx_0_persistence::config::ConfigRepository::new(Arc::clone(db)),
        allow_encrypted_writes,
    };
    run_secret_startup(&mut startup);
}

struct PreparedDataDirMigration {
    journal: PendingDataDirMigration,
    outcome: DataDirMigrationFinalizeOutcome,
}

struct OpenedProfile {
    storage: Arc<StorageService>,
    db: Arc<DatabaseService>,
    legacy_vrcx_available: bool,
    legacy_vrcx_source: Option<LegacyVrcxSource>,
    legacy_vrcx_migration_status: LegacyVrcxMigrationStatus,
}

fn set_active_data_dir(resolution: &mut AppDataDirResolution, path: PathBuf) {
    resolution.current_dir = path.clone();
    if app_data_paths_match(&path, &resolution.default_dir) {
        resolution.persisted_dir = None;
        resolution.source = AppDataDirSource::Default;
    } else {
        resolution.persisted_dir = Some(path);
        resolution.source = AppDataDirSource::Persisted;
    }
}

fn prepare_data_dir_migration_startup(
    resolution: &mut AppDataDirResolution,
) -> Result<Option<PreparedDataDirMigration>> {
    if resolution.source == AppDataDirSource::Cli {
        return Ok(None);
    }
    let Some(journal) = read_pending_data_dir_migration(&resolution.default_dir)? else {
        return Ok(None);
    };
    match journal.phase {
        DataDirMigrationJournalPhase::Copying => {
            if !app_data_paths_match(&resolution.current_dir, Path::new(&journal.source_dir)) {
                return Err(crate::Error::Custom(format!(
                    "Interrupted data directory migration does not match the active directory: {}",
                    resolution.current_dir.display()
                )));
            }
            cleanup_interrupted_data_dir_migration(&resolution.default_dir, &journal)?;
            Ok(None)
        }
        DataDirMigrationJournalPhase::Switched => {
            let source_dir = PathBuf::from(&journal.source_dir);
            let target_dir = PathBuf::from(&journal.target_dir).canonicalize()?;
            if app_data_paths_match(&resolution.current_dir, &source_dir) {
                commit_app_data_dir_pointer(&resolution.default_dir, &target_dir)?;
                set_active_data_dir(resolution, target_dir);
            } else if !app_data_paths_match(&resolution.current_dir, &target_dir) {
                return Err(crate::Error::Custom(format!(
                    "Pending data directory migration does not match the active directory: {}",
                    resolution.current_dir.display()
                )));
            }
            let outcome = finalize_data_dir_migration(&resolution.default_dir, &journal)?;
            Ok(Some(PreparedDataDirMigration { journal, outcome }))
        }
    }
}

fn open_profile(paths: &AppPaths) -> Result<OpenedProfile> {
    let migration_paths = LegacyMigrationPaths::from_app_data(paths.app_data.clone());
    consume_pending_legacy_migration(&migration_paths)?;
    let pending_profile_restore = consume_pending_profile_restore(&paths.app_data, &paths.db_file)?;
    if let Err(error) = cleanup_profile_backup_artifacts(&paths.app_data) {
        tracing::warn!(error = %error, "failed to clean up profile backup artifacts");
    }
    let legacy_vrcx_discovery = vrcx_0_persistence::legacy_vrcx::discover_legacy_vrcx_migration(
        &paths.db_file,
        &paths.config_file,
    );
    let legacy_vrcx_source = legacy_vrcx_discovery.importable_source;
    let legacy_vrcx_migration_status = legacy_vrcx_discovery.status;
    let legacy_vrcx_available = legacy_vrcx_migration_status.available;
    let storage = Arc::new(StorageService::new(&paths.config_file)?);
    let db = match DatabaseService::new(&paths.db_file) {
        Ok(db) => {
            if let Some(pending) = pending_profile_restore {
                if let Err(error) = pending.finalize() {
                    tracing::warn!(
                        error = %error,
                        "failed to finalize profile restore; journal remains for the next start"
                    );
                }
            }
            db
        }
        Err(error) => {
            let Some(pending) = pending_profile_restore else {
                return Err(error.into());
            };
            pending.rollback(ProfileRestoreFailureCode::DatabaseOpenFailed)?;
            DatabaseService::new(&paths.db_file)?
        }
    };
    Ok(OpenedProfile {
        storage,
        db: Arc::new(db),
        legacy_vrcx_available,
        legacy_vrcx_source,
        legacy_vrcx_migration_status,
    })
}

fn rollback_failed_data_dir_migration_startup(
    resolution: &mut AppDataDirResolution,
    prepared: &PreparedDataDirMigration,
) -> Result<()> {
    let source_dir = PathBuf::from(&prepared.journal.source_dir).canonicalize()?;
    commit_app_data_dir_pointer(&resolution.default_dir, &source_dir)?;
    record_data_dir_migration_database_open_failure(&resolution.default_dir, &prepared.journal)?;
    set_active_data_dir(resolution, source_dir);
    Ok(())
}

impl RuntimeHostStateBuilder {
    pub fn new(options: RuntimeHostOptions) -> Result<Self> {
        let RuntimeHostOptions {
            realtime_origin,
            launched_from_autostart,
            mut app_data_dir,
            app_version,
            profile,
        } = options;
        let prepared_migration = prepare_data_dir_migration_startup(&mut app_data_dir)?;
        let mut paths = AppPaths::from_app_data(app_data_dir.current_dir.clone());
        let mut profile_lock = ProfileLock::acquire(&paths.app_data)?;
        let opened = match open_profile(&paths) {
            Ok(opened) => opened,
            Err(error) => {
                let Some(prepared) = prepared_migration.as_ref() else {
                    return Err(error);
                };
                tracing::warn!(error = %error, "migrated database failed to open; rolling back data directory pointer");
                drop(profile_lock);
                rollback_failed_data_dir_migration_startup(&mut app_data_dir, prepared)?;
                paths = AppPaths::from_app_data(app_data_dir.current_dir.clone());
                profile_lock = ProfileLock::acquire(&paths.app_data)?;
                open_profile(&paths)?
            }
        };
        if let Some(prepared) = prepared_migration.as_ref() {
            if app_data_paths_match(&paths.app_data, Path::new(&prepared.journal.target_dir)) {
                if let Err(error) = complete_data_dir_migration(
                    &app_data_dir.default_dir,
                    &prepared.journal,
                    &prepared.outcome,
                ) {
                    tracing::warn!(error = %error, "failed to complete data directory migration startup journal");
                }
            }
        }
        let OpenedProfile {
            storage,
            db,
            legacy_vrcx_available,
            legacy_vrcx_source,
            legacy_vrcx_migration_status,
        } = opened;
        prepare_secrets_at_rest(&db, profile);
        let web = Arc::new(WebClient::new(
            &storage,
            &db,
            realtime_origin,
            &web_ua_app_version(&app_version, profile),
        )?);
        let image_fetcher = web.image_fetcher()?;
        let image_cache = Arc::new(ImageCache::new(paths.image_cache.clone(), image_fetcher)?);
        let runtime_context = Arc::new(RuntimeHostContext::new(
            Arc::clone(&db),
            Arc::clone(&web),
            Arc::clone(&image_cache),
        ));
        let profile_backup = ProfileBackupRuntime::new(ProfileBackupRuntimeDeps {
            app_data: paths.app_data.clone(),
            control_dir: app_data_dir.default_dir.clone(),
            db: Arc::clone(&db),
            storage: Arc::clone(&storage),
            event_bus: runtime_context.event_bus.clone(),
            tasks: runtime_context.tasks.clone(),
            background_jobs: runtime_context.background_jobs.clone(),
            app_version: app_version.clone(),
        });
        let pointer_control_dir = app_data_dir.default_dir.clone();
        let data_dir_migration = DataDirMigrationRuntime::new(
            paths.app_data.clone(),
            app_data_dir.default_dir.clone(),
            Arc::clone(&db),
            runtime_context.event_bus.clone(),
            profile_backup.operation_gate(),
            Arc::new(move |target| {
                commit_app_data_dir_pointer(&pointer_control_dir, target)
                    .map_err(|error| vrcx_0_application_core::Error::Custom(error.to_string()))
            }),
        );

        Ok(Self {
            profile,
            app_data_dir,
            app_version,
            paths,
            storage,
            db,
            profile_backup,
            data_dir_migration,
            runtime_context,
            backend_runtime: BackendRuntime::new(),
            web,
            image_cache,
            legacy_vrcx_available,
            legacy_vrcx_source,
            legacy_vrcx_migration_status,
            launched_from_autostart,
            profile_lock,
        })
    }

    pub fn finish(self, composition: RuntimeHostComposition) -> Result<RuntimeHostState> {
        match self.profile {
            RuntimeHostProfile::Desktop => {
                if composition.profile_extension.is_none() {
                    return Err(crate::Error::Custom(
                        "Desktop runtime profile requires a profile extension.".into(),
                    ));
                }
            }
            RuntimeHostProfile::HeadlessData => {
                if composition.profile_extension.is_some() {
                    return Err(crate::Error::Custom(
                        "HeadlessData runtime profile must not receive a profile extension.".into(),
                    ));
                }
            }
        }
        let RuntimeHostComposition {
            local_game_context,
            group_order_source,
            friend_note_change_sink,
            favorites_sink,
            profile_extension,
        } = composition;
        let realtime_runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
            db: Arc::clone(&self.runtime_context.db),
            web: Arc::clone(&self.runtime_context.web),
            event_bus: self.runtime_context.event_bus.clone(),
            sync: self.runtime_context.sync.clone(),
            tasks: self.runtime_context.tasks.clone(),
            session: self.runtime_context.session.clone(),
            auth_scope: self.runtime_context.auth_scope.clone(),
            local_game_context,
            activity_sink: Some(Arc::new(self.runtime_context.overlay_activity())),
            world_cache: Arc::clone(&self.runtime_context.world_cache),
            print_cleanup: Arc::new(PrintCleanupQueueSink::new(
                self.runtime_context.print_cleanup.clone(),
                self.runtime_context.tasks.clone(),
                PrintCleanupDeps {
                    db: Arc::clone(&self.runtime_context.db),
                    web: Arc::clone(&self.runtime_context.web),
                    event_bus: self.runtime_context.event_bus.clone(),
                },
            )),
            friend_note_change_sink,
        }));
        let favorites_sink = {
            let overlay_activity = self.runtime_context.overlay_activity();
            let profile_sink = favorites_sink;
            Some(Arc::new(move |snapshot: &Value| {
                overlay_activity.set_favorite_groups(
                    vrcx_0_application_activity::OverlayFavoriteGroups::from_map(
                        crate::favorite_group_membership_from_snapshot(snapshot),
                    ),
                );
                if let Some(profile_sink) = &profile_sink {
                    profile_sink(snapshot);
                }
            }) as crate::RuntimeHostSnapshotCallback)
        };
        let authenticated_runtime = AuthenticatedRuntimeOrchestrator::new(
            Arc::clone(&self.db),
            Arc::clone(&self.web),
            self.runtime_context.event_bus.clone(),
            self.runtime_context.tasks.clone(),
            self.runtime_context.auth_scope.clone(),
            self.runtime_context.session.clone(),
            Arc::clone(&realtime_runtime),
            favorites_sink,
        );
        let favorite_import = FavoriteImportRuntime::new(
            Arc::clone(&self.db),
            Arc::clone(&self.web),
            Arc::clone(&self.runtime_context.world_cache),
            self.runtime_context.event_bus.clone(),
            self.runtime_context.tasks.clone(),
            self.runtime_context.auth_scope.clone(),
        );
        let group_ban_import = GroupBanImportRuntime::new(
            Arc::new(VrchatGroupBanImportActions {
                deps: GroupApiDeps {
                    db: Arc::clone(&self.db),
                    web: Arc::clone(&self.web),
                    diagnostics: self.runtime_context.diagnostics.clone(),
                    sync: self.runtime_context.sync.clone(),
                },
            }),
            self.runtime_context.event_bus.clone(),
            self.runtime_context.tasks.clone(),
            self.runtime_context.auth_scope.clone(),
        );
        let shared_collection_import = SharedCollectionImportRuntime::new(
            Arc::clone(&self.db),
            Arc::clone(&self.web),
            Arc::clone(&self.runtime_context.world_cache),
            self.runtime_context.event_bus.clone(),
            self.runtime_context.tasks.clone(),
            self.runtime_context.auth_scope.clone(),
        );
        let note_export = NoteExportRuntime::new(
            Arc::clone(&self.db),
            Arc::clone(&self.web),
            self.runtime_context.event_bus.clone(),
            self.runtime_context.tasks.clone(),
            self.runtime_context.auth_scope.clone(),
        );
        Ok(RuntimeHostState {
            profile: self.profile,
            app_data_dir: self.app_data_dir,
            paths: self.paths,
            storage: self.storage,
            db: self.db,
            profile_backup: self.profile_backup,
            data_dir_migration: self.data_dir_migration,
            runtime_context: self.runtime_context,
            backend_runtime: self.backend_runtime,
            realtime_runtime,
            web: self.web,
            image_cache: self.image_cache,
            authenticated_runtime,
            favorite_import,
            group_ban_import,
            shared_collection_import,
            note_export,
            group_order_source,
            legacy_vrcx_available: self.legacy_vrcx_available,
            legacy_vrcx_source: self.legacy_vrcx_source,
            legacy_vrcx_migration_status: self.legacy_vrcx_migration_status,
            launched_from_autostart: self.launched_from_autostart,
            profile_extension,
            backend_starting: AtomicBool::new(false),
            background_auth_recovery_running: Arc::new(AtomicBool::new(false)),
            social_maintenance_running: Arc::new(AtomicBool::new(false)),
            activity_warmup_generation: Arc::new(AtomicU64::new(0)),
            background_group_instances_refresh_running: Arc::new(AtomicBool::new(false)),
            backend_frontend_session: Arc::new(Mutex::new(None)),
            authenticated_session_maintenance: Arc::new(Mutex::new(None)),
            _profile_lock: self.profile_lock,
        })
    }
}

impl RuntimeHostState {
    pub fn new(options: RuntimeHostOptions) -> Result<Self> {
        match options.profile {
            RuntimeHostProfile::Desktop => {
                return Err(crate::Error::Custom(
                    "Desktop runtime profile must be constructed by runtime-host-desktop.".into(),
                ));
            }
            RuntimeHostProfile::HeadlessData => {}
        }
        RuntimeHostStateBuilder::new(options)?.finish(RuntimeHostComposition {
            local_game_context: Arc::new(UnavailableLocalGameContextSource),
            group_order_source: Arc::new(UnavailableGroupOrderSource),
            friend_note_change_sink: None,
            favorites_sink: None,
            profile_extension: None,
        })
    }

    pub fn backend_frontend_session_handle(
        &self,
    ) -> Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>> {
        Arc::clone(&self.backend_frontend_session)
    }
}

#[cfg(test)]
mod secret_startup_tests {
    use super::{run_secret_startup, SecretStartupActions};
    use crate::{Error, Result};

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum Step {
        Initialize,
        MigrateCookies,
        MigrateSavedCredentials,
        ReadCleanupCompleted,
        IsEncryptingWrites,
        Cleanup,
        RecordCleanupCompleted,
    }

    struct TestSecretStartup {
        events: Vec<Step>,
        fail_at: Option<Step>,
        encrypting_writes: bool,
        cleanup_completed: bool,
        cleanup_recorded: bool,
    }

    impl TestSecretStartup {
        fn step(&mut self, current: Step) -> Result<()> {
            self.events.push(current);
            if self.fail_at == Some(current) {
                return Err(Error::Custom(format!("{current:?} failed")));
            }
            Ok(())
        }
    }

    impl SecretStartupActions for TestSecretStartup {
        fn initialize(&mut self) {
            self.events.push(Step::Initialize);
        }

        fn is_encrypting_writes(&mut self) -> bool {
            self.events.push(Step::IsEncryptingWrites);
            self.encrypting_writes
        }

        fn migrate_cookies(&mut self) -> Result<()> {
            self.step(Step::MigrateCookies)
        }

        fn migrate_saved_credentials(&mut self) -> Result<()> {
            self.step(Step::MigrateSavedCredentials)
        }

        fn read_cleanup_completed(&mut self) -> Result<bool> {
            self.step(Step::ReadCleanupCompleted)?;
            Ok(self.cleanup_completed)
        }

        fn cleanup(&mut self) -> Result<()> {
            self.step(Step::Cleanup)
        }

        fn record_cleanup_completed(&mut self) -> Result<()> {
            self.step(Step::RecordCleanupCompleted)?;
            self.cleanup_recorded = true;
            Ok(())
        }
    }

    fn run(
        fail_at: Option<Step>,
        encrypting_writes: bool,
        cleanup_completed: bool,
    ) -> (Vec<Step>, bool) {
        let mut startup = TestSecretStartup {
            events: Vec::new(),
            fail_at,
            encrypting_writes,
            cleanup_completed,
            cleanup_recorded: false,
        };
        run_secret_startup(&mut startup);
        (startup.events, startup.cleanup_recorded)
    }

    #[test]
    fn secret_startup_runs_all_steps_in_order() {
        let (events, cleanup_recorded) = run(None, true, false);
        assert_eq!(
            events,
            vec![
                Step::Initialize,
                Step::MigrateCookies,
                Step::MigrateSavedCredentials,
                Step::ReadCleanupCompleted,
                Step::IsEncryptingWrites,
                Step::Cleanup,
                Step::RecordCleanupCompleted,
            ]
        );
        assert!(cleanup_recorded);
    }

    #[test]
    fn secret_startup_requires_both_migrations_before_cleanup() {
        for failed_step in [Step::MigrateCookies, Step::MigrateSavedCredentials] {
            let (events, cleanup_recorded) = run(Some(failed_step), true, false);
            assert_eq!(
                events,
                vec![
                    Step::Initialize,
                    Step::MigrateCookies,
                    Step::MigrateSavedCredentials,
                    Step::ReadCleanupCompleted,
                    Step::IsEncryptingWrites,
                ]
            );
            assert!(!cleanup_recorded);
        }
    }

    #[test]
    fn secret_startup_skips_cleanup_when_disabled_or_already_completed() {
        for (encrypting_writes, cleanup_completed) in [(false, false), (true, true)] {
            let (events, cleanup_recorded) = run(None, encrypting_writes, cleanup_completed);
            assert!(!events.contains(&Step::Cleanup));
            assert!(!cleanup_recorded);
        }
    }

    #[test]
    fn secret_startup_does_not_record_failed_cleanup() {
        let (events, cleanup_recorded) = run(Some(Step::Cleanup), true, false);
        assert!(events.contains(&Step::Cleanup));
        assert!(!events.contains(&Step::RecordCleanupCompleted));
        assert!(!cleanup_recorded);
    }

    #[test]
    fn secret_startup_retries_when_cleanup_state_cannot_be_read() {
        let (events, cleanup_recorded) = run(Some(Step::ReadCleanupCompleted), true, false);
        assert!(events.contains(&Step::Cleanup));
        assert!(cleanup_recorded);
    }

    #[test]
    fn secret_startup_keeps_cleanup_retryable_when_recording_fails() {
        let (events, cleanup_recorded) = run(Some(Step::RecordCleanupCompleted), true, false);
        assert!(events.contains(&Step::Cleanup));
        assert!(events.contains(&Step::RecordCleanupCompleted));
        assert!(!cleanup_recorded);
    }
}

#[cfg(test)]
mod profile_bundle_tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicUsize;
    use vrcx_0_host::app_paths::AppDataDirSource;
    use vrcx_0_persistence::data_dir_migration::{
        read_pending_data_dir_migration, take_data_dir_migration_result,
        write_pending_data_dir_migration, DataDirMigrationResultStatus, PendingDataDirMigration,
        StagedDataDirMigration,
    };

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
                "vrcx-0-runtime-host-{name}-{}-{nonce}",
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
        let state = RuntimeHostState::new(RuntimeHostOptions {
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
            profile: RuntimeHostProfile::HeadlessData,
        })?;
        assert!(state.profile_extension.is_none());
        assert!(!state.paths.app_data.join("metadataCache.db").exists());
        state.backend_runtime.set_mode(BackendRuntimeMode::Headless);
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
        let state = RuntimeHostStateBuilder::new(RuntimeHostOptions {
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
            profile: RuntimeHostProfile::Desktop,
        })?
        .finish(RuntimeHostComposition {
            local_game_context: Arc::new(UnavailableLocalGameContextSource),
            group_order_source: Arc::new(UnavailableGroupOrderSource),
            friend_note_change_sink: None,
            favorites_sink: None,
            profile_extension: Some(extension.clone()),
        })?;

        let before = state.backend_runtime.snapshot();
        assert_eq!(before.phase, BackendRuntimePhase::Idle);
        let stopped = state.stop_backend_runtime("application-exit");
        assert_eq!(stopped.updated_at, before.updated_at);
        assert_eq!(extension.stop_count.load(Ordering::Acquire), 1);
        Ok(())
    }
}
