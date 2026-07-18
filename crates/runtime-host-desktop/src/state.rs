use std::ops::Deref;
#[cfg(target_os = "windows")]
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex, MutexGuard,
};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use vrcx_0_application::{AppUpdateBuildInfo, AppUpdateRuntime};
use vrcx_0_application_activity::OverlayActivitySnapshot;
use vrcx_0_application_core::{
    BackendRuntimeMode, BackendRuntimePhase, GameProcessEvent, GameProcessEventSink,
    SessionHostRuntime,
};
use vrcx_0_application_game::{
    GameLogLocalGameContextSource, ProcessMonitor, RegistryBackupMaintenanceMode,
    RegistryBackupMaintenanceResult, RegistryBackupSnapshot,
};
use vrcx_0_host::app_paths::{AppDataDirResolution, AppPaths};
use vrcx_0_host_desktop::auto_launch::{
    deserialize_app_launcher_entries, normalize_app_launcher_entries, AppLauncherEntry,
    AppLauncherSnapshot, AutoAppLaunchManager, APP_LAUNCHER_ENABLED_CONFIG_KEY,
    APP_LAUNCHER_ENTRIES_CONFIG_KEY,
};
use vrcx_0_host_desktop::discord_rpc::DiscordRpc;
use vrcx_0_host_desktop::host_capabilities::{
    current_host_capabilities, is_host_capability_available, HostCapability,
};
use vrcx_0_persistence::legacy_migration::cleanup_legacy_updater_files;
use vrcx_0_persistence::screenshot_cache::MetadataCacheDb;
use vrcx_0_runtime_host::telemetry::{TelemetryRuntime, TelemetryRuntimeDeps};
use vrcx_0_runtime_host::{
    Result, RuntimeHostCallback, RuntimeHostComposition, RuntimeHostOptions, RuntimeHostProfile,
    RuntimeHostProfileExtension, RuntimeHostSnapshotCallback, RuntimeHostState,
    RuntimeHostStateBuilder,
};

use crate::group_order::HostGroupOrderSource;
use crate::vr_overlay::{DesktopVrOverlayRuntime, VrOverlayRuntimeSnapshot};
use crate::{
    DesktopRuntimeServices, GameClientHostRuntime, GameLogEventSink, GameLogHostRuntime,
    HostFileAccess, HostGameLogEventFanout, HostGameProcessMonitorActions,
    HostLogLocationSnapshotScanner, HostRegistryBackupActions, LogWatcher,
};

mod background_ticks;

use background_ticks::{
    run_background_discord_tick, run_background_presence_tick, BackgroundTickContext,
    BACKGROUND_DISCORD_CADENCE_SECONDS, BACKGROUND_DISCORD_PRESENCE_JOB,
    BACKGROUND_PRESENCE_AUTOMATION_JOB, BACKGROUND_PRESENCE_CADENCE_SECONDS,
};

const USER_GENERATED_CONTENT_PATH_CONFIG_KEY: &str = "userGeneratedContentPath";
const REGISTRY_BACKUP_MAINTENANCE_JOB: &str = "registryBackupMaintenance";
const REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS: u64 = 3 * 60 * 60;
const BACKGROUND_OVERLAY_ACTIVITY_CONFIG_CADENCE_SECONDS: u64 = 5;

pub struct DesktopRuntimeHostOptions {
    pub realtime_origin: String,
    pub launched_from_autostart: bool,
    pub app_data_dir: AppDataDirResolution,
    pub app_version: String,
    pub app_update_build_label: String,
    pub app_update_build_badge: String,
    pub updater_port: Arc<dyn vrcx_0_application_core::UpdaterPort>,
}

pub struct GameRuntimeBundle {
    pub process_monitor: ProcessMonitor,
    pub log_watcher: LogWatcher,
    pub game_log_runtime: Arc<GameLogHostRuntime>,
    pub game_client_runtime: Arc<GameClientHostRuntime>,
    pub session_runtime: Arc<SessionHostRuntime>,
    pub screenshot_cache: MetadataCacheDb,
    pub auto_launch: AutoAppLaunchManager,
}

pub struct DesktopRuntimeBundle {
    pub services: Arc<DesktopRuntimeServices>,
    pub host_file_access: HostFileAccess,
    pub discord_rpc: Arc<DiscordRpc>,
    pub vr_overlay_runtime: Arc<DesktopVrOverlayRuntime>,
    pub app_update: AppUpdateRuntime,
    pub telemetry: TelemetryRuntime,
}

pub struct DesktopRuntimeHostState {
    runtime: RuntimeHostState,
    pub game: Arc<GameRuntimeBundle>,
    pub desktop: Arc<DesktopRuntimeBundle>,
    extension: Arc<DesktopRuntimeProfileExtension>,
}

struct DesktopRuntimeProfileExtension {
    game: Arc<GameRuntimeBundle>,
    desktop: Arc<DesktopRuntimeBundle>,
    registry_backup_maintenance_running: Arc<AtomicBool>,
    desktop_maintenance_running: Arc<AtomicBool>,
    discord_reconcile_generation: Arc<AtomicU64>,
    registry_backup_lock: Arc<Mutex<()>>,
}

struct VrOverlayProcessSink {
    runtime: Arc<DesktopVrOverlayRuntime>,
    log_watcher: LogWatcher,
}

impl GameProcessEventSink for VrOverlayProcessSink {
    fn on_game_process_event(
        &self,
        event: GameProcessEvent,
    ) -> vrcx_0_application_core::Result<()> {
        let current_vr_mode = if event.is_game_running {
            self.log_watcher.current_vr_mode()
        } else {
            None
        };
        self.runtime.on_game_process_event(event, current_vr_mode)
    }
}

impl DesktopRuntimeHostState {
    pub fn new(options: DesktopRuntimeHostOptions) -> Result<Self> {
        let DesktopRuntimeHostOptions {
            realtime_origin,
            launched_from_autostart,
            app_data_dir,
            app_version,
            app_update_build_label,
            app_update_build_badge,
            updater_port,
        } = options;
        let paths = AppPaths::from_app_data(app_data_dir.current_dir.clone());
        cleanup_legacy_updater_files(&paths.app_data);
        let builder = RuntimeHostStateBuilder::new(RuntimeHostOptions {
            realtime_origin,
            launched_from_autostart,
            app_data_dir,
            app_version: app_version.clone(),
            profile: RuntimeHostProfile::Desktop,
        })?;
        let host_file_access = HostFileAccess::new();
        register_desktop_file_access_grants(
            &host_file_access,
            &builder.profile_backup,
            builder.runtime_context.config(),
        )?;
        let desktop_services = Arc::new(DesktopRuntimeServices::new(Arc::clone(
            &builder.runtime_context,
        )));
        let overlay_activity = desktop_services.overlay_activity();
        let game_log_snapshot = desktop_services.game_log_snapshot_handle();
        let discord_rpc = Arc::new(DiscordRpc::new());
        let process_monitor = ProcessMonitor::new();
        let telemetry = TelemetryRuntime::new(TelemetryRuntimeDeps {
            config: builder.runtime_context.config.clone(),
            tasks: builder.runtime_context.tasks.clone(),
            backend_runtime: builder.backend_runtime.clone(),
            app_version: app_version.clone(),
            app_data: builder.paths.app_data.clone(),
            system_theme_category: Arc::new(|| {
                vrcx_0_host_desktop::system_theme::current_system_theme_category()
                    .unwrap_or_default()
                    .to_string()
            }),
        });
        let app_update = AppUpdateRuntime::new(
            Arc::clone(&builder.web),
            Arc::clone(&builder.db),
            Arc::clone(&builder.storage),
            builder.runtime_context.event_bus.clone(),
            builder.runtime_context.background_jobs.clone(),
            AppUpdateBuildInfo {
                app_version: app_version.clone(),
                build_label: app_update_build_label,
                build_badge: app_update_build_badge,
            },
            Arc::new(|| vrcx_0_host_desktop::updater_policy::expected_updater_target().ok()),
            updater_port,
            builder.runtime_context.tasks.clone(),
        );
        let game_log_runtime = Arc::new(GameLogHostRuntime::new(
            Arc::clone(&builder.runtime_context),
            host_file_access.clone(),
            builder.paths.clone(),
            Arc::clone(&game_log_snapshot),
            overlay_activity.clone(),
        ));
        let vr_overlay_runtime =
            Arc::new(DesktopVrOverlayRuntime::new(Arc::clone(&desktop_services))?);
        let game_log_sink: Arc<dyn GameLogEventSink> = Arc::new(HostGameLogEventFanout::new(vec![
            game_log_runtime.clone(),
            vr_overlay_runtime.clone(),
        ]));
        let log_watcher = LogWatcher::new_with_location_snapshot_scanner(
            Some(game_log_sink),
            Arc::new(HostLogLocationSnapshotScanner),
        );
        let game_client_runtime = Arc::new(GameClientHostRuntime::new(
            Arc::clone(&builder.runtime_context),
            log_watcher.clone(),
            host_file_access.clone(),
            builder.paths.clone(),
            desktop_services.host.clone(),
        ));
        let session_runtime = Arc::new(SessionHostRuntime::new(
            builder.runtime_context.session.clone(),
            builder.runtime_context.event_bus.clone(),
        ));
        let screenshot_cache =
            MetadataCacheDb::new(&builder.paths.app_data.join("metadataCache.db"))?;
        let app_launcher_enabled = builder
            .runtime_context
            .config()
            .get_bool(APP_LAUNCHER_ENABLED_CONFIG_KEY, true)?;
        let app_launcher_entries = deserialize_app_launcher_entries(
            builder
                .runtime_context
                .config()
                .get_json(APP_LAUNCHER_ENTRIES_CONFIG_KEY, json!([]))?,
        );
        let auto_launch = AutoAppLaunchManager::new(app_launcher_enabled, app_launcher_entries);
        let game = Arc::new(GameRuntimeBundle {
            process_monitor,
            log_watcher,
            game_log_runtime,
            game_client_runtime,
            session_runtime,
            screenshot_cache,
            auto_launch,
        });
        let desktop = Arc::new(DesktopRuntimeBundle {
            services: Arc::clone(&desktop_services),
            host_file_access: host_file_access.clone(),
            discord_rpc,
            vr_overlay_runtime,
            app_update,
            telemetry,
        });
        let extension = Arc::new(DesktopRuntimeProfileExtension {
            game: Arc::clone(&game),
            desktop: Arc::clone(&desktop),
            registry_backup_maintenance_running: Arc::new(AtomicBool::new(false)),
            desktop_maintenance_running: Arc::new(AtomicBool::new(false)),
            discord_reconcile_generation: Arc::new(AtomicU64::new(0)),
            registry_backup_lock: Arc::new(Mutex::new(())),
        });
        let local_game_context = Arc::new(GameLogLocalGameContextSource::new(
            builder.runtime_context.session.clone(),
            game_log_snapshot,
        ));
        let friend_note_change_sink: RuntimeHostCallback = {
            let vr_overlay_runtime = Arc::clone(&desktop.vr_overlay_runtime);
            Arc::new(move || {
                vr_overlay_runtime.invalidate_friends_panel_note_memo_cache();
            })
        };
        let favorites_sink: RuntimeHostSnapshotCallback = {
            let vr_overlay_runtime = Arc::clone(&desktop.vr_overlay_runtime);
            Arc::new(move |snapshot: &Value| {
                vr_overlay_runtime.update_friends_panel_favorite_groups_from_baseline(snapshot);
            })
        };
        let runtime = builder.finish(RuntimeHostComposition {
            local_game_context,
            group_order_source: Arc::new(HostGroupOrderSource),
            friend_note_change_sink: Some(friend_note_change_sink),
            favorites_sink: Some(favorites_sink),
            profile_extension: Some(extension.clone()),
        })?;
        let realtime_runtime = Arc::clone(&runtime.realtime_runtime);
        desktop
            .vr_overlay_runtime
            .set_friends_panel_snapshot_provider(move || realtime_runtime.friend_snapshot());
        desktop
            .services
            .set_realtime_user_image_resolver(Arc::clone(&runtime.realtime_runtime));

        Ok(Self {
            runtime,
            game,
            desktop,
            extension,
        })
    }

    pub fn start_telemetry_runtime(&self) {
        self.desktop.telemetry.start();
    }

    pub fn start_game_services(&self) {
        self.extension.start_game_services(&self.runtime);
    }

    pub fn start_desktop_services(&self) {
        self.extension.start_desktop_services(&self.runtime);
    }

    pub fn request_discord_reconcile(&self) -> u64 {
        self.extension
            .discord_reconcile_generation
            .fetch_add(1, Ordering::AcqRel)
            .saturating_add(1)
    }

    pub fn app_launcher_snapshot(&self) -> AppLauncherSnapshot {
        self.game.auto_launch.snapshot()
    }

    pub fn set_vr_overlay_enabled(&self, enabled: bool) -> Result<VrOverlayRuntimeSnapshot> {
        self.desktop.vr_overlay_runtime.set_enabled(enabled)
    }

    pub fn reload_vr_overlay_config(&self) -> Result<VrOverlayRuntimeSnapshot> {
        self.desktop.vr_overlay_runtime.reload_config()
    }

    pub fn vr_overlay_snapshot(&self) -> Result<VrOverlayRuntimeSnapshot> {
        self.desktop.vr_overlay_runtime.snapshot()
    }

    pub fn is_vr_overlay_running(&self) -> bool {
        self.desktop.vr_overlay_runtime.is_running()
    }

    pub fn overlay_activity_snapshot(&self) -> OverlayActivitySnapshot {
        self.desktop.services.overlay_activity().snapshot()
    }

    pub fn reload_overlay_activity_filters(&self) {
        self.desktop.services.reload_overlay_activity_filters();
        self.desktop.vr_overlay_runtime.reconcile_current();
    }

    pub fn set_app_launcher_enabled(&self, enabled: bool) -> Result<AppLauncherSnapshot> {
        self.runtime_context
            .config()
            .set_bool(APP_LAUNCHER_ENABLED_CONFIG_KEY, enabled)?;
        Ok(self.game.auto_launch.set_enabled(enabled))
    }

    pub fn set_app_launcher_entries(
        &self,
        entries: Vec<AppLauncherEntry>,
    ) -> Result<AppLauncherSnapshot> {
        let entries = normalize_app_launcher_entries(entries);
        self.runtime_context.config().set_json(
            APP_LAUNCHER_ENTRIES_CONFIG_KEY,
            &serde_json::to_value(&entries)?,
        )?;
        Ok(self.game.auto_launch.set_entries(entries))
    }

    pub fn test_app_launcher_entry(&self, entry_id: &str) -> Result<AppLauncherSnapshot> {
        self.game
            .auto_launch
            .test_entry(entry_id)
            .map_err(vrcx_0_runtime_host::Error::Custom)
    }

    pub fn stop_app_launcher_test_run(&self, run_id: &str) -> Result<AppLauncherSnapshot> {
        self.game
            .auto_launch
            .stop_test_run(run_id)
            .map_err(vrcx_0_runtime_host::Error::Custom)
    }

    pub fn registry_backup_list(&self) -> Result<Vec<RegistryBackupSnapshot>> {
        self.with_registry_backup_lock(|| {
            vrcx_0_application_game::registry_backup_list(self.db.as_ref())
        })
    }

    pub fn registry_backup_create(&self, name: &str) -> Result<Vec<RegistryBackupSnapshot>> {
        self.with_registry_backup_lock(|| {
            vrcx_0_application_game::registry_backup_create(
                self.db.as_ref(),
                &HostRegistryBackupActions,
                name,
            )
        })
    }

    pub fn registry_backup_restore(&self, key: &str) -> Result<RegistryBackupSnapshot> {
        self.with_registry_backup_lock(|| {
            vrcx_0_application_game::registry_backup_restore(
                self.db.as_ref(),
                &HostRegistryBackupActions,
                key,
            )
        })
    }

    pub fn registry_backup_delete(&self, key: &str) -> Result<Vec<RegistryBackupSnapshot>> {
        self.with_registry_backup_lock(|| {
            vrcx_0_application_game::registry_backup_delete(self.db.as_ref(), key)
        })
    }

    pub fn registry_backup_export_json(&self, key: &str) -> Result<String> {
        self.with_registry_backup_lock(|| {
            vrcx_0_application_game::registry_backup_export_json(self.db.as_ref(), key)
        })
    }

    pub fn registry_backup_import_json(&self, json: &str) -> Result<()> {
        self.with_registry_backup_lock(|| {
            vrcx_0_application_game::registry_backup_import_json(
                self.db.as_ref(),
                &HostRegistryBackupActions,
                json,
            )
        })
    }

    pub fn registry_backup_maintenance_run(
        &self,
        reason: &str,
        mode: RegistryBackupMaintenanceMode,
    ) -> Result<RegistryBackupMaintenanceResult> {
        self.with_registry_backup_lock(|| {
            vrcx_0_application_game::registry_backup_maintenance_run(
                self.db.as_ref(),
                &HostRegistryBackupActions,
                mode,
                reason,
            )
        })
    }

    fn with_registry_backup_lock<T>(
        &self,
        operation: impl FnOnce() -> vrcx_0_application_core::Result<T>,
    ) -> Result<T> {
        let _guard = self.acquire_registry_backup_lock()?;
        Ok(operation()?)
    }

    fn acquire_registry_backup_lock(&self) -> Result<MutexGuard<'_, ()>> {
        self.extension.registry_backup_lock.lock().map_err(|error| {
            vrcx_0_runtime_host::Error::Custom(format!("registry backup lock poisoned: {error}"))
        })
    }
}

impl Deref for DesktopRuntimeHostState {
    type Target = RuntimeHostState;

    fn deref(&self) -> &Self::Target {
        &self.runtime
    }
}

impl RuntimeHostProfileExtension for DesktopRuntimeProfileExtension {
    fn observe_runtime_event(&self, event: &str, payload: &Value) {
        self.desktop.services.observe_runtime_event(event, payload);
    }

    fn start_profile_services(&self, state: &RuntimeHostState) {
        self.start_desktop_services(state);
        self.start_game_services(state);
    }

    fn stop_profile_services(&self) {
        self.desktop.vr_overlay_runtime.stop();
        self.game.process_monitor.stop();
        self.game.log_watcher.stop();
        self.game.game_log_runtime.stop();
        self.game.game_client_runtime.stop();
    }

    fn start_profile_maintenance(&self, state: &RuntimeHostState) {
        self.start_registry_backup_loop(state);
        self.start_desktop_maintenance_loops(state);
    }

    fn clear_profile_session(&self) {
        self.desktop
            .vr_overlay_runtime
            .clear_friends_panel_session_state();
    }

    fn wait_for_profile_maintenance_stopped(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while self
            .registry_backup_maintenance_running
            .load(Ordering::Acquire)
            || self.desktop_maintenance_running.load(Ordering::Acquire)
        {
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        true
    }
}

impl DesktopRuntimeProfileExtension {
    fn start_desktop_services(&self, state: &RuntimeHostState) {
        self.desktop
            .app_update
            .start_loop(state.runtime_context.tasks.clone());
    }

    fn start_game_services(&self, state: &RuntimeHostState) {
        let capabilities = current_host_capabilities();
        tracing::info!(platform = %capabilities.platform, "host capabilities resolved");
        self.start_log_watcher_for_current_platform(state, &capabilities);
        if is_host_capability_available(HostCapability::GameProcessMonitor) {
            let vr_overlay_process_sink: Arc<dyn GameProcessEventSink> =
                Arc::new(VrOverlayProcessSink {
                    runtime: Arc::clone(&self.desktop.vr_overlay_runtime),
                    log_watcher: self.game.log_watcher.clone(),
                });
            let game_process_sinks: Vec<Arc<dyn GameProcessEventSink>> = vec![
                self.game.session_runtime.clone(),
                self.game.game_log_runtime.clone(),
                self.game.game_client_runtime.clone(),
                state.realtime_runtime.clone(),
                vr_overlay_process_sink,
            ];
            self.game.process_monitor.start(
                HostGameProcessMonitorActions::new(self.game.auto_launch.clone()),
                self.game.log_watcher.clone(),
                game_process_sinks,
            );
            state
                .runtime_context
                .background_jobs
                .mark_running("gameProcessMonitor", "Game process monitor is active.");
        } else {
            state.runtime_context.background_jobs.register_job(
                "gameProcessMonitor",
                "rust-host",
                None,
                "unavailable",
                "Game process monitor capability is unavailable.",
            );
        }
    }

    fn start_log_watcher_for_current_platform(
        &self,
        state: &RuntimeHostState,
        _capabilities: &vrcx_0_host_desktop::host_capabilities::HostCapabilities,
    ) {
        #[cfg(target_os = "windows")]
        if is_host_capability_available(HostCapability::GameLogWatcher) {
            let local_low = std::env::var("LOCALAPPDATA")
                .map(|path| PathBuf::from(path).join("..\\LocalLow\\VRChat\\VRChat"))
                .unwrap_or_default();
            if let Err(error) = self
                .game
                .game_log_runtime
                .prime_log_watcher(&self.game.log_watcher)
            {
                tracing::warn!("failed to prime GameLog watcher from runtime DB: {error}");
            }
            self.game.log_watcher.start(local_low);
            state
                .runtime_context
                .background_jobs
                .mark_running("gameLogWatcher", "Windows GameLog watcher is active.");
            emit_game_log_watcher_status(state, "running");
        }
        #[cfg(target_os = "windows")]
        if !is_host_capability_available(HostCapability::GameLogWatcher) {
            state.runtime_context.background_jobs.register_job(
                "gameLogWatcher",
                "rust-host",
                None,
                "unavailable",
                "GameLog watcher capability is unavailable.",
            );
            emit_game_log_watcher_status(state, "unavailable");
        }
        #[cfg(target_os = "linux")]
        if is_host_capability_available(HostCapability::GameLogWatcher) {
            match vrcx_0_host_desktop::vrchat_paths::discover_linux_vrchat_log_paths() {
                Ok(paths) => {
                    if let Err(error) = self
                        .game
                        .game_log_runtime
                        .prime_log_watcher(&self.game.log_watcher)
                    {
                        tracing::warn!("failed to prime GameLog watcher from runtime DB: {error}");
                    }
                    self.game
                        .log_watcher
                        .start_without_process_monitor(paths.app_data);
                    state
                        .runtime_context
                        .background_jobs
                        .mark_running("gameLogWatcher", "Linux GameLog watcher is active.");
                    emit_game_log_watcher_status(state, "running");
                }
                Err(reason) => {
                    state.runtime_context.background_jobs.register_job(
                        "gameLogWatcher",
                        "rust-host",
                        None,
                        "unavailable",
                        reason,
                    );
                    emit_game_log_watcher_status(state, "unavailable");
                }
            }
        }
        #[cfg(target_os = "linux")]
        if !is_host_capability_available(HostCapability::GameLogWatcher) {
            state.runtime_context.background_jobs.register_job(
                "gameLogWatcher",
                "rust-host",
                None,
                "unavailable",
                _capabilities
                    .game_log_watcher
                    .reason
                    .clone()
                    .unwrap_or_else(|| "GameLog watcher capability is unavailable.".into()),
            );
            emit_game_log_watcher_status(state, "unavailable");
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            let _ = _capabilities;
            state.runtime_context.background_jobs.register_job(
                "gameLogWatcher",
                "rust-host",
                None,
                "unavailable",
                "GameLog watcher is unavailable on this platform.",
            );
            emit_game_log_watcher_status(state, "unavailable");
        }
    }

    fn start_registry_backup_loop(&self, state: &RuntimeHostState) {
        let current = state.backend_runtime.snapshot();
        if current.mode != BackendRuntimeMode::Background
            || current.phase != BackendRuntimePhase::Running
        {
            return;
        }
        if !is_host_capability_available(HostCapability::RegistryPrefs) {
            state.runtime_context.background_jobs.register_job(
                REGISTRY_BACKUP_MAINTENANCE_JOB,
                "rust-host",
                Some(REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS),
                "unavailable",
                "Registry backup maintenance is unavailable on this platform.",
            );
            return;
        }
        if self
            .registry_backup_maintenance_running
            .swap(true, Ordering::AcqRel)
        {
            return;
        }
        state.runtime_context.background_jobs.register_job(
            REGISTRY_BACKUP_MAINTENANCE_JOB,
            "rust-host",
            Some(REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS),
            "scheduled",
            "Registry backup maintenance is scheduled for background mode.",
        );
        let db = Arc::clone(&state.db);
        let backend_runtime = state.backend_runtime.clone();
        let runtime_context = Arc::clone(&state.runtime_context);
        let background_jobs = state.runtime_context.background_jobs.clone();
        let running = Arc::clone(&self.registry_backup_maintenance_running);
        let registry_backup_lock = Arc::clone(&self.registry_backup_lock);
        state.runtime_context.tasks.spawn_cancellable_thread(
            "registry-backup-maintenance",
            move |stop_token| {
                let cadence = Duration::from_secs(REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS);
                let sleep_chunk = Duration::from_secs(5);
                loop {
                    if stop_token.is_stop_requested()
                        || !is_background_registry_maintenance_active(&backend_runtime)
                    {
                        break;
                    }
                    background_jobs.mark_running(
                        REGISTRY_BACKUP_MAINTENANCE_JOB,
                        "Running background registry backup maintenance.",
                    );
                    let result = match registry_backup_lock.lock() {
                        Ok(_guard) => vrcx_0_application_game::registry_backup_maintenance_run(
                            db.as_ref(),
                            &HostRegistryBackupActions,
                            RegistryBackupMaintenanceMode::Silent,
                            "background-mode",
                        ),
                        Err(error) => Err(vrcx_0_application_core::Error::Custom(format!(
                            "registry backup lock poisoned: {error}"
                        ))),
                    };
                    match result {
                        Ok(result) => {
                            if result.auto_backup_created {
                                emit_profile_background_info(
                                    &runtime_context,
                                    &backend_runtime,
                                    result.detail.clone(),
                                );
                            }
                            background_jobs
                                .mark_completed(REGISTRY_BACKUP_MAINTENANCE_JOB, result.detail);
                            background_jobs.mark_scheduled(
                                REGISTRY_BACKUP_MAINTENANCE_JOB,
                                "Next background registry backup maintenance run is waiting.",
                                REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS,
                            );
                        }
                        Err(error) => {
                            tracing::warn!(
                                error = %error,
                                "background registry backup maintenance failed"
                            );
                            emit_profile_background_error(
                                &runtime_context,
                                &backend_runtime,
                                format!("registry backup maintenance failed: {error}."),
                            );
                            background_jobs
                                .mark_failed(REGISTRY_BACKUP_MAINTENANCE_JOB, error.to_string());
                            background_jobs.mark_scheduled(
                                REGISTRY_BACKUP_MAINTENANCE_JOB,
                                "Next background registry backup maintenance retry is waiting.",
                                REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS,
                            );
                        }
                    }
                    let mut remaining = cadence;
                    while remaining > Duration::ZERO {
                        if stop_token.is_stop_requested()
                            || !is_background_registry_maintenance_active(&backend_runtime)
                        {
                            running.store(false, Ordering::Release);
                            background_jobs.mark_completed(
                                REGISTRY_BACKUP_MAINTENANCE_JOB,
                                "Background registry backup maintenance stopped.",
                            );
                            return;
                        }
                        let chunk = remaining.min(sleep_chunk);
                        std::thread::sleep(chunk);
                        remaining = remaining.saturating_sub(chunk);
                    }
                }
                running.store(false, Ordering::Release);
                background_jobs.mark_completed(
                    REGISTRY_BACKUP_MAINTENANCE_JOB,
                    "Background registry backup maintenance stopped.",
                );
            },
        );
    }

    fn start_desktop_maintenance_loops(&self, state: &RuntimeHostState) {
        let session_slot = state.backend_frontend_session_handle();
        if !is_authenticated_maintenance_active(state, &session_slot)
            || !desktop_session_scope_matches_auth(state, &session_slot)
        {
            return;
        }
        if self
            .desktop_maintenance_running
            .swap(true, Ordering::AcqRel)
        {
            return;
        }
        for (name, cadence, detail) in [
            (
                BACKGROUND_PRESENCE_AUTOMATION_JOB,
                BACKGROUND_PRESENCE_CADENCE_SECONDS,
                "Background presence automation is scheduled.",
            ),
            (
                BACKGROUND_DISCORD_PRESENCE_JOB,
                BACKGROUND_DISCORD_CADENCE_SECONDS,
                "Background Discord presence is scheduled.",
            ),
        ] {
            state.runtime_context.background_jobs.register_job(
                name,
                "rust-host",
                Some(cadence),
                "scheduled",
                detail,
            );
        }
        let db = Arc::clone(&state.db);
        let web = Arc::clone(&state.web);
        let backend_runtime = state.backend_runtime.clone();
        let background_jobs = state.runtime_context.background_jobs.clone();
        let running = Arc::clone(&self.desktop_maintenance_running);
        let realtime_runtime = Arc::clone(&state.realtime_runtime);
        let authenticated_runtime = state.authenticated_runtime.clone();
        let runtime_context = Arc::clone(&state.runtime_context);
        let desktop_services = Arc::clone(&self.desktop.services);
        let discord_rpc = Arc::clone(&self.desktop.discord_rpc);
        let discord_reconcile_generation = Arc::clone(&self.discord_reconcile_generation);
        state
            .runtime_context
            .tasks
            .spawn_cancellable(move |stop_token| async move {
                let mut presence_state =
                    vrcx_0_application_game::BackgroundPresenceAutomationState::default();
                let mut discord_state =
                    vrcx_0_application_game::BackgroundDiscordPresenceState::default();
                let mut last_discord_output: Option<String> = None;
                let mut next_presence = Instant::now();
                let mut next_discord = Instant::now();
                let mut next_overlay_activity_config = Instant::now();
                let mut observed_discord_reconcile_generation =
                    discord_reconcile_generation.load(Ordering::Acquire);
                let mut active_scope_key =
                    background_capability_session_scope_key(&session_slot).unwrap_or_default();
                loop {
                    if stop_token.is_stop_requested()
                        || !is_authenticated_maintenance_active_parts(
                            &backend_runtime,
                            &runtime_context,
                            &session_slot,
                        )
                    {
                        break;
                    }
                    let now = Instant::now();
                    if observe_discord_reconcile_request(
                        &discord_reconcile_generation,
                        &mut observed_discord_reconcile_generation,
                    ) {
                        next_discord = now;
                    }
                    let scope_key =
                        background_capability_session_scope_key(&session_slot).unwrap_or_default();
                    if scope_key != active_scope_key {
                        active_scope_key = scope_key;
                        presence_state =
                            vrcx_0_application_game::BackgroundPresenceAutomationState::default();
                        discord_state =
                            vrcx_0_application_game::BackgroundDiscordPresenceState::default();
                        last_discord_output = None;
                        next_presence = now;
                        next_discord = now;
                        next_overlay_activity_config = now;
                    }
                    if now >= next_overlay_activity_config {
                        desktop_services.reload_overlay_activity_filters();
                        next_overlay_activity_config = now
                            + Duration::from_secs(
                                BACKGROUND_OVERLAY_ACTIVITY_CONFIG_CADENCE_SECONDS,
                            );
                    }
                    let favorite_friend_groups_by_key = authenticated_runtime
                        .snapshot()
                        .favorites_baseline
                        .as_ref()
                        .and_then(|baseline| baseline.snapshot.as_ref())
                        .map(|snapshot| {
                            vrcx_0_runtime_host::favorite_group_membership_from_snapshot(
                                snapshot.as_value(),
                            )
                        })
                        .unwrap_or_default();
                    let tick_context = BackgroundTickContext {
                        db: &db,
                        web: &web,
                        session_slot: &session_slot,
                        realtime_runtime: &realtime_runtime,
                        runtime_context: &runtime_context,
                        desktop_services: &desktop_services,
                        backend_runtime: &backend_runtime,
                        background_jobs: &background_jobs,
                    };
                    if now >= next_presence {
                        run_background_presence_tick(
                            &tick_context,
                            &mut presence_state,
                            &favorite_friend_groups_by_key,
                        )
                        .await;
                        next_presence =
                            now + Duration::from_secs(BACKGROUND_PRESENCE_CADENCE_SECONDS);
                    }
                    if now >= next_discord {
                        run_background_discord_tick(
                            &tick_context,
                            &discord_rpc,
                            &mut discord_state,
                            &mut last_discord_output,
                            &favorite_friend_groups_by_key,
                        )
                        .await;
                        next_discord =
                            now + Duration::from_secs(BACKGROUND_DISCORD_CADENCE_SECONDS);
                    }
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
                running.store(false, Ordering::Release);
                background_jobs.mark_completed(
                    BACKGROUND_PRESENCE_AUTOMATION_JOB,
                    "Background presence automation stopped.",
                );
                background_jobs.mark_completed(
                    BACKGROUND_DISCORD_PRESENCE_JOB,
                    "Background Discord presence stopped.",
                );
            });
    }
}

fn emit_game_log_watcher_status(state: &RuntimeHostState, status: &str) {
    let snapshot = state.backend_runtime.set_game_log_status(status);
    state
        .runtime_context
        .event_bus
        .emit(vrcx_0_application_core::BackendRuntimeTelemetry {
            kind: "gameLogWatcher".into(),
            detail: status.into(),
            snapshot,
        });
}

fn register_desktop_file_access_grants(
    file_access: &HostFileAccess,
    profile_backup: &vrcx_0_application::ProfileBackupRuntime,
    config: &vrcx_0_persistence::config::ConfigRepository,
) -> Result<()> {
    let profile_backup_target = profile_backup.settings().auto_target_dir;
    if !profile_backup_target.is_empty() {
        file_access.register_path(profile_backup_target);
    }
    register_persisted_user_generated_content_path_grant(file_access, config)
}

fn register_persisted_user_generated_content_path_grant(
    file_access: &HostFileAccess,
    config: &vrcx_0_persistence::config::ConfigRepository,
) -> Result<()> {
    let ugc_path = config.get_string(USER_GENERATED_CONTENT_PATH_CONFIG_KEY, "")?;
    let ugc_path = ugc_path.trim();
    if !ugc_path.is_empty() {
        file_access.register_path(ugc_path);
    }
    Ok(())
}

fn is_background_registry_maintenance_active(
    runtime: &vrcx_0_application_core::BackendRuntime,
) -> bool {
    let snapshot = runtime.snapshot();
    snapshot.mode == BackendRuntimeMode::Background
        && snapshot.phase == BackendRuntimePhase::Running
}

fn is_authenticated_maintenance_active(
    state: &RuntimeHostState,
    session_slot: &Arc<Mutex<Option<vrcx_0_runtime_host::BackendRuntimeFrontendSessionSnapshot>>>,
) -> bool {
    is_authenticated_maintenance_active_parts(
        &state.backend_runtime,
        &state.runtime_context,
        session_slot,
    )
}

fn desktop_session_scope_matches_auth(
    state: &RuntimeHostState,
    session_slot: &Arc<Mutex<Option<vrcx_0_runtime_host::BackendRuntimeFrontendSessionSnapshot>>>,
) -> bool {
    let auth_scope = state.runtime_context.auth_scope.snapshot();
    session_matches_auth_scope(
        background_ticks::background_capability_session(session_slot).as_ref(),
        &auth_scope,
    )
}

fn session_matches_auth_scope(
    session: Option<&vrcx_0_application_core::BackgroundCapabilitySession>,
    auth_scope: &vrcx_0_application_core::RuntimeAuthScopeSnapshot,
) -> bool {
    session
        .map(|session| {
            auth_scope.active
                && session.current_user_id == auth_scope.current_user_id
                && vrcx_0_vrchat_client::http_api::normalize_vrchat_api_endpoint(Some(
                    &session.endpoint,
                )) == auth_scope.endpoint
        })
        .unwrap_or(false)
}

fn is_authenticated_maintenance_active_parts(
    runtime: &vrcx_0_application_core::BackendRuntime,
    runtime_context: &Arc<vrcx_0_runtime_host::RuntimeHostContext>,
    session_slot: &Arc<Mutex<Option<vrcx_0_runtime_host::BackendRuntimeFrontendSessionSnapshot>>>,
) -> bool {
    let snapshot = runtime.snapshot();
    let auth_scope = runtime_context.auth_scope.snapshot();
    if snapshot.phase != BackendRuntimePhase::Running
        || snapshot.auth_status != "authenticated"
        || snapshot.auth_user_id.trim().is_empty()
        || !auth_scope.active
        || auth_scope.current_user_id != snapshot.auth_user_id
    {
        return false;
    }
    background_ticks::background_capability_session(session_slot)
        .map(|session| {
            session.current_user_id == auth_scope.current_user_id
                && vrcx_0_vrchat_client::http_api::normalize_vrchat_api_endpoint(Some(
                    &session.endpoint,
                )) == auth_scope.endpoint
        })
        .unwrap_or(auth_scope.active)
}

fn background_capability_session_scope_key(
    session_slot: &Arc<Mutex<Option<vrcx_0_runtime_host::BackendRuntimeFrontendSessionSnapshot>>>,
) -> Option<String> {
    background_ticks::background_capability_session(session_slot).map(|session| {
        format!(
            "{}:{}",
            session.current_user_id,
            vrcx_0_vrchat_client::http_api::normalize_vrchat_api_endpoint(Some(&session.endpoint))
        )
    })
}

fn observe_discord_reconcile_request(generation: &AtomicU64, observed: &mut u64) -> bool {
    let requested = generation.load(Ordering::Acquire);
    if requested == *observed {
        return false;
    }
    *observed = requested;
    true
}

fn emit_profile_background_info(
    runtime_context: &Arc<vrcx_0_runtime_host::RuntimeHostContext>,
    backend_runtime: &vrcx_0_application_core::BackendRuntime,
    detail: impl Into<String>,
) {
    emit_profile_background_output(runtime_context, backend_runtime, "backgroundInfo", detail);
}

fn emit_profile_background_error(
    runtime_context: &Arc<vrcx_0_runtime_host::RuntimeHostContext>,
    backend_runtime: &vrcx_0_application_core::BackendRuntime,
    detail: impl Into<String>,
) {
    emit_profile_background_output(runtime_context, backend_runtime, "backgroundError", detail);
}

fn emit_profile_background_output(
    runtime_context: &Arc<vrcx_0_runtime_host::RuntimeHostContext>,
    backend_runtime: &vrcx_0_application_core::BackendRuntime,
    kind: &str,
    detail: impl Into<String>,
) {
    let snapshot = backend_runtime.snapshot();
    if snapshot.mode == BackendRuntimeMode::Headless
        || snapshot.phase != BackendRuntimePhase::Running
    {
        return;
    }
    runtime_context
        .event_bus
        .emit(vrcx_0_application_core::BackendRuntimeTelemetry {
            kind: kind.into(),
            detail: detail.into(),
            snapshot,
        });
}

#[cfg(test)]
mod background {
    mod discord_reconcile_tests {
        use super::super::*;

        #[test]
        fn observes_each_reconcile_generation_once() {
            let generation = AtomicU64::new(0);
            let mut observed = 0;
            assert!(!observe_discord_reconcile_request(
                &generation,
                &mut observed
            ));
            generation.fetch_add(1, Ordering::AcqRel);
            assert!(observe_discord_reconcile_request(
                &generation,
                &mut observed
            ));
            assert_eq!(observed, 1);
            assert!(!observe_discord_reconcile_request(
                &generation,
                &mut observed
            ));
            let auth_scope = vrcx_0_application_core::RuntimeAuthScopeSnapshot {
                current_user_id: "usr_test".into(),
                endpoint: "https://api.vrchat.cloud/api/1".into(),
                generation: 1,
                active: true,
            };
            assert!(!session_matches_auth_scope(None, &auth_scope));
        }
    }
}

#[cfg(test)]
mod runtime_host_state {
    mod persisted_file_access_tests {
        use super::super::{
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
                let path = std::env::temp_dir()
                    .join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
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
}
