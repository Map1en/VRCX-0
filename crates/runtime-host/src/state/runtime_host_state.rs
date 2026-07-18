use super::*;

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
    pub runtime_context: Arc<RuntimeHostContext>,
    pub backend_runtime: BackendRuntime,
    pub realtime_runtime: Arc<RealtimeHostRuntime>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub authenticated_runtime: AuthenticatedRuntimeOrchestrator,
    pub favorite_import: FavoriteImportRuntime,
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

fn run_secret_startup(
    initialize: impl FnOnce(),
    is_encrypting_writes: impl FnOnce() -> bool,
    migrate_cookies: impl FnOnce() -> Result<()>,
    migrate_saved_credentials: impl FnOnce() -> Result<()>,
    read_cleanup_completed: impl FnOnce() -> Result<bool>,
    cleanup: impl FnOnce() -> Result<()>,
    record_cleanup_completed: impl FnOnce() -> Result<()>,
) {
    initialize();
    let mut migrations_succeeded = true;
    if let Err(error) = migrate_cookies() {
        migrations_succeeded = false;
        tracing::warn!(error = %error, "failed to migrate stored cookies to encrypted form");
    }
    if let Err(error) = migrate_saved_credentials() {
        migrations_succeeded = false;
        tracing::warn!(error = %error, "failed to migrate saved credentials to encrypted form");
    }
    let cleanup_completed = match read_cleanup_completed() {
        Ok(completed) => completed,
        Err(error) => {
            tracing::warn!(error = %error, "failed to read secret migration cleanup state");
            false
        }
    };
    if !is_encrypting_writes() || !migrations_succeeded || cleanup_completed {
        return;
    }
    if let Err(error) = cleanup() {
        tracing::warn!(error = %error, "failed to remove plaintext remnants after secret migration");
        return;
    }
    if let Err(error) = record_cleanup_completed() {
        tracing::warn!(error = %error, "failed to record completed secret migration cleanup state");
    }
}

fn prepare_secrets_at_rest(db: &Arc<DatabaseService>, profile: RuntimeHostProfile) {
    let config = vrcx_0_persistence::config::ConfigRepository::new(Arc::clone(db));
    let allow_encrypted_writes = match profile {
        RuntimeHostProfile::Desktop => true,
        RuntimeHostProfile::HeadlessData => false,
    };
    run_secret_startup(
        || {
            vrcx_0_persistence::secrets::init_secrets(
                vrcx_0_host::machine_key::derive_secrets_key(),
                allow_encrypted_writes,
            );
        },
        vrcx_0_persistence::secrets::is_encrypting_writes,
        || {
            vrcx_0_persistence::cookies::migrate_default_cookies(db)?;
            Ok(())
        },
        || {
            vrcx_0_application::migrate_saved_credential_secrets(&config)?;
            Ok(())
        },
        || {
            Ok(config.get_bool(
                vrcx_0_persistence::secrets::CLEANUP_COMPLETED_CONFIG_KEY,
                false,
            )?)
        },
        || Ok(vrcx_0_persistence::maintenance::vacuum_after_secret_migration(db)?),
        || {
            Ok(config.set_bool(
                vrcx_0_persistence::secrets::CLEANUP_COMPLETED_CONFIG_KEY,
                true,
            )?)
        },
    );
}

impl RuntimeHostStateBuilder {
    pub fn new(options: RuntimeHostOptions) -> Result<Self> {
        let RuntimeHostOptions {
            realtime_origin,
            launched_from_autostart,
            app_data_dir,
            app_version,
            profile,
        } = options;
        let paths = AppPaths::from_app_data(app_data_dir.current_dir.clone());
        let profile_lock = ProfileLock::acquire(&paths.app_data)?;
        let migration_paths = LegacyMigrationPaths::from_app_data(paths.app_data.clone());
        consume_pending_legacy_migration(&migration_paths)?;
        let pending_profile_restore =
            consume_pending_profile_restore(&paths.app_data, &paths.db_file)?;
        if let Err(error) = cleanup_profile_backup_artifacts(&paths.app_data) {
            tracing::warn!(error = %error, "failed to clean up profile backup artifacts");
        }
        let (legacy_vrcx_source, legacy_vrcx_migration_status) =
            vrcx_0_persistence::legacy_vrcx::discover_legacy_vrcx_migration(
                &paths.db_file,
                &paths.config_file,
            );
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
        let db = Arc::new(db);
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
        let profile_backup = ProfileBackupRuntime::new(
            paths.app_data.clone(),
            Arc::clone(&db),
            Arc::clone(&storage),
            runtime_context.event_bus.clone(),
            runtime_context.tasks.clone(),
            runtime_context.background_jobs.clone(),
            app_version.clone(),
        );

        Ok(Self {
            profile,
            app_data_dir,
            app_version,
            paths,
            storage,
            db,
            profile_backup,
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
            runtime_context: self.runtime_context,
            backend_runtime: self.backend_runtime,
            realtime_runtime,
            web: self.web,
            image_cache: self.image_cache,
            authenticated_runtime,
            favorite_import,
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
    use super::run_secret_startup;
    use crate::{Error, Result};
    use std::cell::{Cell, RefCell};

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

    fn run(
        fail_at: Option<Step>,
        encrypting_writes: bool,
        cleanup_completed: bool,
    ) -> (Vec<Step>, bool) {
        let events = RefCell::new(Vec::new());
        let cleanup_recorded = Cell::new(false);
        let step = |current| -> Result<()> {
            events.borrow_mut().push(current);
            if fail_at == Some(current) {
                return Err(Error::Custom(format!("{current:?} failed")));
            }
            Ok(())
        };
        run_secret_startup(
            || events.borrow_mut().push(Step::Initialize),
            || {
                events.borrow_mut().push(Step::IsEncryptingWrites);
                encrypting_writes
            },
            || step(Step::MigrateCookies),
            || step(Step::MigrateSavedCredentials),
            || {
                step(Step::ReadCleanupCompleted)?;
                Ok(cleanup_completed)
            },
            || step(Step::Cleanup),
            || {
                step(Step::RecordCleanupCompleted)?;
                cleanup_recorded.set(true);
                Ok(())
            },
        );
        (events.into_inner(), cleanup_recorded.get())
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
