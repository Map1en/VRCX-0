use super::*;

pub struct RuntimeHostOptions {
    pub realtime_origin: String,
    pub launched_from_autostart: bool,
    pub app_data_dir: AppDataDirResolution,
    pub app_version: String,
    pub is_headless: bool,
    pub app_update_build_label: String,
    pub app_update_build_badge: String,
    pub updater_port: Arc<dyn vrcx_0_application::UpdaterPort>,
}

pub(super) fn web_ua_app_version(app_version: &str, is_headless: bool) -> String {
    if is_headless {
        format!("{app_version} (hl)")
    } else {
        app_version.to_string()
    }
}

const USER_GENERATED_CONTENT_PATH_CONFIG_KEY: &str = "userGeneratedContentPath";

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

pub struct RuntimeHostState {
    pub app_data_dir: AppDataDirResolution,
    pub paths: AppPaths,
    pub storage: Arc<StorageService>,
    pub db: Arc<DatabaseService>,
    pub profile_backup: ProfileBackupRuntime,
    pub discord_rpc: Arc<DiscordRpc>,
    pub process_monitor: ProcessMonitor,
    pub log_watcher: LogWatcher,
    pub runtime_context: Arc<RuntimeHostContext>,
    pub backend_runtime: BackendRuntime,
    pub telemetry: TelemetryRuntime,
    pub game_log_runtime: Arc<GameLogHostRuntime>,
    pub game_client_runtime: Arc<GameClientHostRuntime>,
    pub realtime_runtime: Arc<RealtimeHostRuntime>,
    pub session_runtime: Arc<SessionHostRuntime>,
    pub vr_overlay_runtime: Arc<VrOverlayRuntime>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub app_update: AppUpdateRuntime,
    pub authenticated_runtime: AuthenticatedRuntimeOrchestrator,
    pub host_file_access: HostFileAccess,
    pub screenshot_cache: MetadataCacheDb,
    pub favorite_import: FavoriteImportRuntime,
    pub shared_collection_import: SharedCollectionImportRuntime,
    pub note_export: NoteExportRuntime,

    pub auto_launch: AutoAppLaunchManager,
    pub legacy_vrcx_available: bool,
    pub legacy_vrcx_source: Option<LegacyVrcxSource>,
    pub legacy_vrcx_migration_status: LegacyVrcxMigrationStatus,
    pub launched_from_autostart: bool,
    pub(super) backend_starting: AtomicBool,
    pub(super) background_auth_recovery_running: Arc<AtomicBool>,
    pub(super) registry_backup_maintenance_running: Arc<AtomicBool>,
    pub(super) background_capabilities_running: Arc<AtomicBool>,
    pub(super) discord_reconcile_generation: Arc<AtomicU64>,
    pub(super) activity_warmup_generation: Arc<AtomicU64>,
    pub(super) background_group_instances_refresh_running: Arc<AtomicBool>,
    pub(super) registry_backup_lock: Arc<Mutex<()>>,
    pub(super) backend_frontend_session: Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    pub(super) authenticated_session_maintenance:
        Arc<Mutex<Option<AuthenticatedSessionMaintenanceOutcome>>>,
    pub(super) _profile_lock: ProfileLock,
}

pub(super) struct VrOverlayProcessSink {
    runtime: Arc<VrOverlayRuntime>,
    log_watcher: LogWatcher,
}

impl VrOverlayProcessSink {
    pub(super) fn new(runtime: Arc<VrOverlayRuntime>, log_watcher: LogWatcher) -> Self {
        Self {
            runtime,
            log_watcher,
        }
    }
}

impl GameProcessEventSink for VrOverlayProcessSink {
    fn on_game_process_event(&self, event: GameProcessEvent) -> vrcx_0_application::Result<()> {
        self.runtime.on_game_process_event(event)?;
        if event.is_game_running {
            if let Some(vr_mode) = self.log_watcher.current_vr_mode() {
                self.runtime.set_vr_mode(vr_mode);
            }
        }
        Ok(())
    }
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
        tracing::warn!(error = %error, "failed to record completed secret migration cleanup");
    }
}

fn prepare_secrets_at_rest(db: &Arc<DatabaseService>, is_headless: bool) {
    let config = vrcx_0_persistence::config::ConfigRepository::new(Arc::clone(db));
    run_secret_startup(
        || {
            vrcx_0_persistence::secrets::init_secrets(
                vrcx_0_host::machine_key::derive_secrets_key(),
                !is_headless,
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

impl RuntimeHostState {
    pub fn new(options: RuntimeHostOptions) -> Result<Self> {
        let RuntimeHostOptions {
            realtime_origin,
            launched_from_autostart,
            app_data_dir,
            app_version,
            is_headless,
            app_update_build_label,
            app_update_build_badge,
            updater_port,
        } = options;
        let paths = AppPaths::from_app_data(app_data_dir.current_dir.clone());
        cleanup_legacy_updater_files(&paths.app_data);

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
        prepare_secrets_at_rest(&db, is_headless);
        let discord_rpc = Arc::new(DiscordRpc::new());
        let process_monitor = ProcessMonitor::new();
        let web_user_agent_version = web_ua_app_version(&app_version, is_headless);
        let web = Arc::new(WebClient::new(
            &storage,
            &db,
            realtime_origin,
            &web_user_agent_version,
        )?);
        let image_fetcher = web.image_fetcher()?;
        let image_cache = Arc::new(ImageCache::new(paths.image_cache.clone(), image_fetcher)?);
        let host_file_access = HostFileAccess::new();
        let runtime_context = Arc::new(RuntimeHostContext::new(
            Arc::clone(&db),
            Arc::clone(&web),
            Arc::clone(&image_cache),
        ));
        let app_update = AppUpdateRuntime::new(
            Arc::clone(&web),
            Arc::clone(&db),
            Arc::clone(&storage),
            runtime_context.event_bus.clone(),
            runtime_context.background_jobs.clone(),
            AppUpdateBuildInfo {
                app_version: app_version.clone(),
                build_label: app_update_build_label,
                build_badge: app_update_build_badge,
            },
            Arc::new(|| vrcx_0_host::updater_policy::expected_updater_target().ok()),
            updater_port,
            runtime_context.tasks.clone(),
        );
        let profile_backup = ProfileBackupRuntime::new(
            paths.app_data.clone(),
            Arc::clone(&db),
            Arc::clone(&storage),
            runtime_context.event_bus.clone(),
            runtime_context.tasks.clone(),
            runtime_context.background_jobs.clone(),
            app_version.clone(),
        );
        let profile_backup_target = profile_backup.settings().auto_target_dir;
        if !profile_backup_target.is_empty() {
            host_file_access.register_path(profile_backup_target);
        }
        register_persisted_user_generated_content_path_grant(
            &host_file_access,
            runtime_context.config(),
        )?;
        let backend_runtime = BackendRuntime::new();
        let telemetry = TelemetryRuntime::new(TelemetryRuntimeDeps {
            config: runtime_context.config.clone(),
            session: runtime_context.session.clone(),
            tasks: runtime_context.tasks.clone(),
            backend_runtime: backend_runtime.clone(),
            app_version: app_version.clone(),
            app_data: paths.app_data.clone(),
        });
        let game_log_runtime = Arc::new(GameLogHostRuntime::new(
            Arc::clone(&runtime_context),
            host_file_access.clone(),
            paths.clone(),
        ));
        let vr_overlay_runtime = Arc::new(VrOverlayRuntime::new(Arc::clone(&runtime_context)));
        let vr_overlay_enabled = runtime_context
            .config()
            .get_bool(VR_OVERLAY_ENABLED_CONFIG_KEY, false)?;
        vr_overlay_runtime.set_enabled(vr_overlay_enabled);
        vr_overlay_runtime.start_refresh_loop(runtime_context.tasks.clone());
        runtime_context.set_overlay_activity_extra_sink(Arc::new(VrOverlayActivitySink::new(
            Arc::clone(&vr_overlay_runtime),
        )));
        start_preview_bridge_if_enabled(Arc::clone(&runtime_context));
        let game_log_sink: Arc<dyn GameLogEventSink> = Arc::new(HostGameLogEventFanout::new(vec![
            game_log_runtime.clone(),
            vr_overlay_runtime.clone(),
        ]));
        let log_watcher = LogWatcher::new_with_location_snapshot_scanner(
            Some(game_log_sink),
            Arc::new(HostLogLocationSnapshotScanner),
        );
        let game_client_runtime = Arc::new(GameClientHostRuntime::new(
            Arc::clone(&runtime_context),
            log_watcher.clone(),
            host_file_access.clone(),
            paths.clone(),
        ));
        let realtime_runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
            db: Arc::clone(&runtime_context.db),
            web: Arc::clone(&runtime_context.web),
            event_bus: runtime_context.event_bus.clone(),
            sync: runtime_context.sync.clone(),
            tasks: runtime_context.tasks.clone(),
            session: runtime_context.session.clone(),
            auth_scope: runtime_context.auth_scope.clone(),
            game_log_snapshot: runtime_context.game_log_snapshot_handle(),
            overlay_activity: runtime_context.overlay_activity.clone(),
            world_cache: Arc::clone(&runtime_context.world_cache),
            print_cleanup: runtime_context.print_cleanup.clone(),
            friend_note_change_sink: Some({
                let vr_overlay_runtime = Arc::clone(&vr_overlay_runtime);
                Arc::new(move || {
                    vr_overlay_runtime.invalidate_friends_panel_note_memo_cache();
                })
            }),
        }));
        {
            let realtime_runtime = Arc::clone(&realtime_runtime);
            vr_overlay_runtime
                .set_friends_panel_snapshot_provider(move || realtime_runtime.friend_snapshot());
        }
        runtime_context.set_realtime_user_image_resolver(Arc::clone(&realtime_runtime));
        let authenticated_runtime = AuthenticatedRuntimeOrchestrator::new(
            Arc::clone(&db),
            Arc::clone(&web),
            runtime_context.event_bus.clone(),
            runtime_context.tasks.clone(),
            runtime_context.auth_scope.clone(),
            runtime_context.session.clone(),
            Arc::clone(&realtime_runtime),
            runtime_context.overlay_activity.clone(),
            Arc::clone(&vr_overlay_runtime),
        );
        let session_runtime = Arc::new(SessionHostRuntime::new(
            runtime_context.session.clone(),
            runtime_context.event_bus.clone(),
        ));
        let screenshot_cache = MetadataCacheDb::new(&paths.app_data.join("metadataCache.db"))?;
        let favorite_import = FavoriteImportRuntime::new(
            Arc::clone(&db),
            Arc::clone(&web),
            Arc::clone(&runtime_context.world_cache),
            runtime_context.event_bus.clone(),
            runtime_context.tasks.clone(),
            runtime_context.auth_scope.clone(),
        );
        let shared_collection_import = SharedCollectionImportRuntime::new(
            Arc::clone(&db),
            Arc::clone(&web),
            Arc::clone(&runtime_context.world_cache),
            runtime_context.event_bus.clone(),
            runtime_context.tasks.clone(),
            runtime_context.auth_scope.clone(),
        );
        let note_export = NoteExportRuntime::new(
            Arc::clone(&db),
            Arc::clone(&web),
            runtime_context.event_bus.clone(),
            runtime_context.tasks.clone(),
            runtime_context.auth_scope.clone(),
        );

        let app_launcher_enabled = runtime_context
            .config()
            .get_bool(APP_LAUNCHER_ENABLED_CONFIG_KEY, true)?;
        let app_launcher_entries = deserialize_app_launcher_entries(
            runtime_context
                .config()
                .get_json(APP_LAUNCHER_ENTRIES_CONFIG_KEY, json!([]))?,
        );
        let auto_launch = AutoAppLaunchManager::new(app_launcher_enabled, app_launcher_entries);

        Ok(Self {
            app_data_dir,
            paths,
            storage,
            db,
            profile_backup,
            discord_rpc,
            process_monitor,
            log_watcher,
            runtime_context,
            backend_runtime,
            telemetry,
            game_log_runtime,
            game_client_runtime,
            realtime_runtime,
            session_runtime,
            vr_overlay_runtime,
            web,
            image_cache,
            app_update,
            authenticated_runtime,
            host_file_access,
            screenshot_cache,
            favorite_import,
            shared_collection_import,
            note_export,
            auto_launch,
            legacy_vrcx_available,
            legacy_vrcx_source,
            legacy_vrcx_migration_status,
            launched_from_autostart,
            backend_starting: AtomicBool::new(false),
            background_auth_recovery_running: Arc::new(AtomicBool::new(false)),
            registry_backup_maintenance_running: Arc::new(AtomicBool::new(false)),
            background_capabilities_running: Arc::new(AtomicBool::new(false)),
            discord_reconcile_generation: Arc::new(AtomicU64::new(0)),
            activity_warmup_generation: Arc::new(AtomicU64::new(0)),
            background_group_instances_refresh_running: Arc::new(AtomicBool::new(false)),
            registry_backup_lock: Arc::new(Mutex::new(())),
            backend_frontend_session: Arc::new(Mutex::new(None)),
            authenticated_session_maintenance: Arc::new(Mutex::new(None)),
            _profile_lock: profile_lock,
        })
    }

    pub fn start_telemetry_runtime(&self) {
        self.telemetry.start();
    }

    pub fn request_discord_reconcile(&self) -> u64 {
        self.discord_reconcile_generation
            .fetch_add(1, Ordering::AcqRel)
            .saturating_add(1)
    }
}

fn register_persisted_user_generated_content_path_grant(
    host_file_access: &HostFileAccess,
    config: &vrcx_0_persistence::config::ConfigRepository,
) -> Result<()> {
    let ugc_path = config.get_string(USER_GENERATED_CONTENT_PATH_CONFIG_KEY, "")?;
    let ugc_path = ugc_path.trim();
    if !ugc_path.is_empty() {
        host_file_access.register_path(ugc_path);
    }
    Ok(())
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
mod persisted_file_access_tests {
    use super::{
        register_persisted_user_generated_content_path_grant,
        USER_GENERATED_CONTENT_PATH_CONFIG_KEY,
    };
    use crate::{HostFileAccess, Result};
    use std::path::PathBuf;
    use std::sync::Arc;
    use vrcx_0_host::app_paths::AppPaths;
    use vrcx_0_persistence::{config::ConfigRepository, DatabaseService};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
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
    fn restores_persisted_user_generated_content_path_for_open_and_save() -> Result<()> {
        let dir = TestDir::new("persisted-ugc-grant");
        let app_data = dir.path.join("app-data");
        let ugc_path = dir.path.join("custom-ugc");
        std::fs::create_dir_all(&app_data)?;
        std::fs::create_dir_all(&ugc_path)?;
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        let config = ConfigRepository::new(db);
        config.set_string(
            USER_GENERATED_CONTENT_PATH_CONFIG_KEY,
            &ugc_path.to_string_lossy(),
        )?;

        let host_file_access = HostFileAccess::new();
        let app_paths = AppPaths::from_app_data(app_data);
        assert!(host_file_access
            .ensure_read_allowed(&ugc_path, &app_paths)
            .is_err());
        assert!(host_file_access
            .ensure_write_allowed(&ugc_path, &app_paths)
            .is_err());

        register_persisted_user_generated_content_path_grant(&host_file_access, &config)?;

        host_file_access.ensure_read_allowed(&ugc_path, &app_paths)?;
        host_file_access.ensure_write_allowed(ugc_path.join("Prints"), &app_paths)?;
        Ok(())
    }
}
