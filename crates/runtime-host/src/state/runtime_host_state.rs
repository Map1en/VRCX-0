use super::*;

pub struct RuntimeHostOptions {
    pub realtime_origin: String,
    pub launched_from_autostart: bool,
    pub app_data_dir: AppDataDirResolution,
    pub app_version: String,
    pub is_headless: bool,
}

pub(super) fn web_ua_app_version(app_version: &str, is_headless: bool) -> String {
    if is_headless {
        format!("{app_version} (hl)")
    } else {
        app_version.to_string()
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

pub struct RuntimeHostState {
    pub app_data_dir: AppDataDirResolution,
    pub paths: AppPaths,
    pub storage: StorageService,
    pub db: Arc<DatabaseService>,
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
    pub host_file_access: HostFileAccess,
    pub screenshot_cache: MetadataCacheDb,

    pub auto_launch: AutoAppLaunchManager,
    pub legacy_vrcx_available: bool,
    pub legacy_vrcx_source: Option<LegacyVrcxSource>,
    pub legacy_vrcx_migration_status: LegacyVrcxMigrationStatus,
    pub launched_from_autostart: bool,
    pub(super) backend_starting: AtomicBool,
    pub(super) background_auth_recovery_running: Arc<AtomicBool>,
    pub(super) registry_backup_maintenance_running: Arc<AtomicBool>,
    pub(super) background_capabilities_running: Arc<AtomicBool>,
    pub(super) background_group_instances_refresh_running: Arc<AtomicBool>,
    pub(super) registry_backup_lock: Arc<Mutex<()>>,
    pub(super) backend_frontend_session: Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
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

impl RuntimeHostState {
    pub fn new(options: RuntimeHostOptions) -> Result<Self> {
        let RuntimeHostOptions {
            realtime_origin,
            launched_from_autostart,
            app_data_dir,
            app_version,
            is_headless,
        } = options;
        let paths = AppPaths::from_app_data(app_data_dir.current_dir.clone());
        cleanup_legacy_updater_files(&paths.app_data);

        let profile_lock = ProfileLock::acquire(&paths.app_data)?;

        let migration_paths = LegacyMigrationPaths::from_app_data(paths.app_data.clone());
        consume_pending_legacy_migration(&migration_paths)?;

        let (legacy_vrcx_source, legacy_vrcx_migration_status) =
            vrcx_0_persistence::legacy_vrcx::discover_legacy_vrcx_migration(
                &paths.db_file,
                &paths.config_file,
            );
        let legacy_vrcx_available = legacy_vrcx_migration_status.available;

        let storage = StorageService::new(&paths.config_file)?;

        let db = Arc::new(DatabaseService::new(&paths.db_file)?);
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
        let session_runtime = Arc::new(SessionHostRuntime::new(
            runtime_context.session.clone(),
            runtime_context.event_bus.clone(),
        ));
        let screenshot_cache = MetadataCacheDb::new(&paths.app_data.join("metadataCache.db"))?;

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
            host_file_access,
            screenshot_cache,
            auto_launch,
            legacy_vrcx_available,
            legacy_vrcx_source,
            legacy_vrcx_migration_status,
            launched_from_autostart,
            backend_starting: AtomicBool::new(false),
            background_auth_recovery_running: Arc::new(AtomicBool::new(false)),
            registry_backup_maintenance_running: Arc::new(AtomicBool::new(false)),
            background_capabilities_running: Arc::new(AtomicBool::new(false)),
            background_group_instances_refresh_running: Arc::new(AtomicBool::new(false)),
            registry_backup_lock: Arc::new(Mutex::new(())),
            backend_frontend_session: Arc::new(Mutex::new(None)),
            _profile_lock: profile_lock,
        })
    }

    pub fn start_telemetry_runtime(&self) {
        self.telemetry.start();
    }
}
