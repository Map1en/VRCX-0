use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, MutexGuard,
};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::{
    vr_overlay::{
        start_preview_bridge_if_enabled, VrOverlayActivitySink, VrOverlayRuntime,
        VrOverlayRuntimeSnapshot, VR_OVERLAY_ENABLED_CONFIG_KEY,
    },
    GameClientHostRuntime, GameLogEventSink, GameLogHostRuntime, HostFileAccess,
    HostGameLogEventFanout, HostLogLocationSnapshotScanner, HostRegistryBackupActions, LogWatcher,
    Result, RuntimeHostContext, RuntimeHostEventSink,
};
use vrcx_0_application::{
    build_background_discord_presence_command, build_background_presence_facts,
    build_favorites_baseline, build_friend_roster_baseline, record_login_success, record_logout,
    refresh_background_current_user, refresh_background_group_instances,
    refresh_player_moderations, run_background_presence_automation, saved_credential_login_start,
    saved_snapshot, BackendRuntime, BackendRuntimeMode, BackendRuntimePhase,
    BackendRuntimeSnapshot, BackendRuntimeTelemetry, BackgroundCapabilitySession,
    BackgroundDiscordPresenceCommand, BackgroundDiscordPresenceState,
    BackgroundPresenceAutomationState, BackgroundPresenceFactsInput, GameProcessEvent,
    GameProcessEventSink, ImageCache, LoginSuccessRecordInput, LogoutRecordInput,
    ModerationSyncDeps, ModerationSyncRefreshInput, OverlayActivitySnapshot, OverlayFavoriteGroups,
    ProcessMonitor, RealtimeHostRuntime, RealtimeHostRuntimeDeps, RealtimeStopRequest,
    RegistryBackupMaintenanceMode, RegistryBackupMaintenanceResult, RegistryBackupSnapshot,
    RuntimeBackgroundJobs, RuntimeEventSink, SavedCredentialLoginStartInput, SessionHostRuntime,
    SocialBaselineDeps, SocialFavoritesBaselineInput, SocialFriendRosterBaselineInput, WebClient,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::json::RawJson;
use vrcx_0_host::app_paths::{AppDataDirResolution, AppPaths};
use vrcx_0_host::auto_launch::{
    deserialize_app_launcher_entries, normalize_app_launcher_entries, AppLauncherEntry,
    AppLauncherSnapshot, AutoAppLaunchManager, APP_LAUNCHER_ENABLED_CONFIG_KEY,
    APP_LAUNCHER_ENTRIES_CONFIG_KEY,
};
use vrcx_0_host::discord_rpc::DiscordRpc;
use vrcx_0_host::host_capabilities::{
    current_host_capabilities, is_host_capability_available, HostCapability,
};
use vrcx_0_persistence::legacy_migration::{
    cleanup_legacy_updater_files, consume_pending_legacy_migration, LegacyMigrationPaths,
};
use vrcx_0_persistence::legacy_vrcx::{LegacyVrcxMigrationStatus, LegacyVrcxSource};
use vrcx_0_persistence::screenshot_cache::MetadataCacheDb;
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::auth::{config_get_input, current_user_get_input};
use vrcx_0_vrchat_client::http_api::{
    normalize_vrchat_api_endpoint, ApiScope, HttpApiExecuteResponse,
};
use vrcx_0_vrchat_client::realtime::normalize_websocket_domain;

const SAVED_CREDENTIALS_KEY: &str = "savedCredentials";
const PROFILE_LOCK_FILE: &str = "runtime.lock";
const REGISTRY_BACKUP_MAINTENANCE_JOB: &str = "registryBackupMaintenance";
const REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS: u64 = 3 * 60 * 60;
const BACKGROUND_PRESENCE_AUTOMATION_JOB: &str = "backgroundPresenceAutomation";
const BACKGROUND_DISCORD_PRESENCE_JOB: &str = "backgroundDiscordPresence";
const BACKGROUND_FACTS_REFRESH_JOB: &str = "backgroundFactsRefresh";
const BACKGROUND_MODERATION_REFRESH_JOB: &str = "backgroundModerationRefresh";
const BACKGROUND_PRESENCE_CADENCE_SECONDS: u64 = 3;
const BACKGROUND_DISCORD_CADENCE_SECONDS: u64 = 3;
const BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS: u64 = 300;
const BACKGROUND_CURRENT_USER_CADENCE_SECONDS: u64 = 300;
const BACKGROUND_OVERLAY_ACTIVITY_CONFIG_CADENCE_SECONDS: u64 = 5;
const BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS: u64 = 3_600;
const BACKGROUND_MODERATION_CADENCE_SECONDS: u64 = 3_600;
const CURRENT_USER_REFRESH_LOCAL_AUTHORITY_FIELDS: &[&str] = &[
    "friends",
    "onlineFriends",
    "activeFriends",
    "offlineFriends",
    "status",
    "statusDescription",
    "state",
    "stateBucket",
    "pendingOffline",
    "location",
    "$location",
    "$location_at",
    "locationUpdatedAt",
    "worldId",
    "instanceId",
    "travelingToLocation",
    "travelingToWorld",
    "travelingToInstance",
    "$travelingToLocation",
    "$travelingToTime",
    "travelingToTime",
    "$previousLocation",
    "$previousLocation_at",
];

pub struct RuntimeHostOptions {
    pub realtime_origin: String,
    pub launched_from_autostart: bool,
    pub app_data_dir: AppDataDirResolution,
}

#[derive(Clone, Debug, Default, Serialize)]
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
    backend_starting: AtomicBool,
    registry_backup_maintenance_running: Arc<AtomicBool>,
    background_capabilities_running: Arc<AtomicBool>,
    background_group_instances_refresh_running: Arc<AtomicBool>,
    registry_backup_lock: Arc<Mutex<()>>,
    backend_frontend_session: Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    _profile_lock: ProfileLock,
}

struct VrOverlayProcessSink {
    runtime: Arc<VrOverlayRuntime>,
    log_watcher: LogWatcher,
}

impl VrOverlayProcessSink {
    fn new(runtime: Arc<VrOverlayRuntime>, log_watcher: LogWatcher) -> Self {
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
        let web = Arc::new(WebClient::new(&storage, &db, realtime_origin)?);
        let image_fetcher = web.image_fetcher()?;
        let image_cache = Arc::new(ImageCache::new(paths.image_cache.clone(), image_fetcher)?);
        let host_file_access = HostFileAccess::new();
        let runtime_context = Arc::new(RuntimeHostContext::new(
            Arc::clone(&db),
            Arc::clone(&web),
            Arc::clone(&image_cache),
        ));
        let backend_runtime = BackendRuntime::new();
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
            game_log_snapshot: runtime_context.game_log_snapshot_handle(),
            overlay_activity: runtime_context.overlay_activity.clone(),
        }));
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
            registry_backup_maintenance_running: Arc::new(AtomicBool::new(false)),
            background_capabilities_running: Arc::new(AtomicBool::new(false)),
            background_group_instances_refresh_running: Arc::new(AtomicBool::new(false)),
            registry_backup_lock: Arc::new(Mutex::new(())),
            backend_frontend_session: Arc::new(Mutex::new(None)),
            _profile_lock: profile_lock,
        })
    }

    pub fn set_event_sink<S>(&self, sink: S)
    where
        S: RuntimeEventSink + 'static,
    {
        self.runtime_context
            .event_bus
            .set_sink(RuntimeHostEventSink::new(
                self.backend_runtime.clone(),
                Arc::clone(&self.runtime_context),
                sink,
            ));
    }

    pub fn snapshot_backend_runtime(&self) -> BackendRuntimeSnapshot {
        self.backend_runtime.snapshot()
    }

    pub fn app_launcher_snapshot(&self) -> AppLauncherSnapshot {
        self.auto_launch.snapshot()
    }

    pub fn set_vr_overlay_enabled(&self, enabled: bool) -> Result<VrOverlayRuntimeSnapshot> {
        self.runtime_context
            .config()
            .set_bool(VR_OVERLAY_ENABLED_CONFIG_KEY, enabled)?;
        self.vr_overlay_runtime.set_enabled(enabled);
        Ok(self.vr_overlay_runtime.snapshot())
    }

    pub fn reload_vr_overlay_config(&self) -> VrOverlayRuntimeSnapshot {
        self.vr_overlay_runtime.reconcile_current();
        self.vr_overlay_runtime.snapshot()
    }

    pub fn vr_overlay_snapshot(&self) -> VrOverlayRuntimeSnapshot {
        self.vr_overlay_runtime.snapshot()
    }

    pub fn is_vr_overlay_running(&self) -> bool {
        self.vr_overlay_runtime.is_running()
    }

    pub fn overlay_activity_snapshot(&self) -> OverlayActivitySnapshot {
        self.runtime_context.overlay_activity.snapshot()
    }

    pub fn reload_overlay_activity_filters(&self) {
        self.runtime_context.reload_overlay_activity_filters();
        self.vr_overlay_runtime.reconcile_current();
    }

    pub fn set_app_launcher_enabled(&self, enabled: bool) -> Result<AppLauncherSnapshot> {
        self.runtime_context
            .config()
            .set_bool(APP_LAUNCHER_ENABLED_CONFIG_KEY, enabled)?;
        Ok(self.auto_launch.set_enabled(enabled))
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
        Ok(self.auto_launch.set_entries(entries))
    }

    pub fn test_app_launcher_entry(&self, entry_id: &str) -> Result<AppLauncherSnapshot> {
        self.auto_launch
            .test_entry(entry_id)
            .map_err(crate::Error::Custom)
    }

    pub fn stop_app_launcher_test_run(&self, run_id: &str) -> Result<AppLauncherSnapshot> {
        self.auto_launch
            .stop_test_run(run_id)
            .map_err(crate::Error::Custom)
    }

    pub fn registry_backup_list(&self) -> Result<Vec<RegistryBackupSnapshot>> {
        let _guard = self.acquire_registry_backup_lock()?;
        Ok(vrcx_0_application::registry_backup_list(self.db.as_ref())?)
    }

    pub fn registry_backup_create(&self, name: &str) -> Result<Vec<RegistryBackupSnapshot>> {
        let _guard = self.acquire_registry_backup_lock()?;
        let host = HostRegistryBackupActions;
        Ok(vrcx_0_application::registry_backup_create(
            self.db.as_ref(),
            &host,
            name,
        )?)
    }

    pub fn registry_backup_restore(&self, key: &str) -> Result<RegistryBackupSnapshot> {
        let _guard = self.acquire_registry_backup_lock()?;
        let host = HostRegistryBackupActions;
        Ok(vrcx_0_application::registry_backup_restore(
            self.db.as_ref(),
            &host,
            key,
        )?)
    }

    pub fn registry_backup_delete(&self, key: &str) -> Result<Vec<RegistryBackupSnapshot>> {
        let _guard = self.acquire_registry_backup_lock()?;
        Ok(vrcx_0_application::registry_backup_delete(
            self.db.as_ref(),
            key,
        )?)
    }

    pub fn registry_backup_export_json(&self, key: &str) -> Result<String> {
        let _guard = self.acquire_registry_backup_lock()?;
        Ok(vrcx_0_application::registry_backup_export_json(
            self.db.as_ref(),
            key,
        )?)
    }

    pub fn registry_backup_import_json(&self, json: &str) -> Result<()> {
        let _guard = self.acquire_registry_backup_lock()?;
        let host = HostRegistryBackupActions;
        Ok(vrcx_0_application::registry_backup_import_json(
            self.db.as_ref(),
            &host,
            json,
        )?)
    }

    pub fn registry_backup_maintenance_run(
        &self,
        reason: &str,
        mode: RegistryBackupMaintenanceMode,
    ) -> Result<RegistryBackupMaintenanceResult> {
        let _guard = self.acquire_registry_backup_lock()?;
        let host = HostRegistryBackupActions;
        Ok(vrcx_0_application::registry_backup_maintenance_run(
            self.db.as_ref(),
            &host,
            mode,
            reason,
        )?)
    }

    fn acquire_registry_backup_lock(&self) -> Result<MutexGuard<'_, ()>> {
        self.registry_backup_lock.lock().map_err(|error| {
            crate::Error::Custom(format!("registry backup lock poisoned: {error}"))
        })
    }

    pub fn backend_runtime_frontend_session_snapshot(
        &self,
    ) -> Option<BackendRuntimeFrontendSessionSnapshot> {
        let runtime = self.backend_runtime.snapshot();
        if runtime.phase != BackendRuntimePhase::Running
            || runtime.auth_status != "authenticated"
            || runtime.auth_user_id.is_empty()
        {
            return None;
        }

        let cached = self
            .backend_frontend_session
            .lock()
            .ok()
            .and_then(|snapshot| snapshot.clone());
        let auth_scope = self.runtime_context.auth_scope.snapshot();
        let current_user_snapshot = self
            .realtime_runtime
            .current_user_snapshot()
            .or_else(|| {
                cached
                    .as_ref()
                    .map(|snapshot| snapshot.current_user_snapshot.clone())
            })
            .unwrap_or_else(|| {
                json!({
                    "id": runtime.auth_user_id,
                    "displayName": runtime.auth_display_name,
                })
            });
        let friend_snapshot = self.realtime_runtime.friend_snapshot();
        let auth_scope_endpoint = if auth_scope.active {
            Some(auth_scope.endpoint)
        } else {
            None
        };

        Some(BackendRuntimeFrontendSessionSnapshot {
            authenticated: true,
            user_id: runtime.auth_user_id,
            display_name: runtime.auth_display_name,
            endpoint: friend_snapshot
                .as_ref()
                .map(|snapshot| snapshot.endpoint.clone())
                .filter(|endpoint| !endpoint.trim().is_empty())
                .or(auth_scope_endpoint)
                .or_else(|| cached.as_ref().map(|snapshot| snapshot.endpoint.clone()))
                .unwrap_or_default(),
            websocket: friend_snapshot
                .as_ref()
                .map(|snapshot| snapshot.websocket.clone())
                .filter(|websocket| !websocket.trim().is_empty())
                .or_else(|| cached.as_ref().map(|snapshot| snapshot.websocket.clone()))
                .unwrap_or_default(),
            current_user_snapshot,
        })
    }

    pub fn release_profile_lock(&self) {
        self._profile_lock.release();
    }

    pub fn start_shell_neutral_services(&self) {
        let host_capabilities = current_host_capabilities();
        tracing::info!(
            platform = %host_capabilities.platform,
            "host capabilities resolved"
        );
        self.runtime_context
            .runtime
            .set_host_services_started(true, "Runtime host services installed.");
        self.runtime_context
            .background_jobs
            .register_frontend_job_catalog();
        self.runtime_context.background_jobs.register_job(
            "startupRecovery",
            "rust-host",
            None,
            "checkpoint",
            "Rust runtime startup recovery checkpoint recorded; no durable recovery queue is configured.",
        );
        self.runtime_context.runtime.record_phase(
            "startupRecovery",
            "checkpoint",
            "Rust runtime startup recovery checkpoint recorded; no durable recovery queue is configured.",
        );
        self.runtime_context.sync.record(
            "startupRecovery",
            "observed",
            "Rust runtime startup recovery checkpoint recorded; no durable recovery queue is configured.",
            0,
        );
        self.runtime_context
            .background_jobs
            .start_database_optimize_loop(Arc::clone(&self.db), self.runtime_context.tasks.clone());

        self.start_log_watcher_for_current_platform(&host_capabilities);

        if is_host_capability_available(HostCapability::GameProcessMonitor) {
            let vr_overlay_process_sink: Arc<dyn GameProcessEventSink> =
                Arc::new(VrOverlayProcessSink::new(
                    self.vr_overlay_runtime.clone(),
                    self.log_watcher.clone(),
                ));
            let game_process_sinks: Vec<Arc<dyn GameProcessEventSink>> = vec![
                self.session_runtime.clone(),
                self.game_log_runtime.clone(),
                self.game_client_runtime.clone(),
                self.realtime_runtime.clone(),
                vr_overlay_process_sink,
            ];
            self.process_monitor.start(
                crate::HostGameProcessMonitorActions::new(self.auto_launch.clone()),
                self.log_watcher.clone(),
                game_process_sinks,
            );
            self.runtime_context
                .background_jobs
                .mark_running("gameProcessMonitor", "Game process monitor is active.");
        } else {
            self.runtime_context.background_jobs.register_job(
                "gameProcessMonitor",
                "rust-host",
                None,
                "unavailable",
                "Game process monitor capability is unavailable.",
            );
        }
    }

    pub fn stop_backend_runtime(&self, reason: impl Into<String>) -> BackendRuntimeSnapshot {
        let reason = reason.into();
        self.backend_runtime
            .set_phase(BackendRuntimePhase::Stopping);
        self.realtime_runtime.stop(RealtimeStopRequest::default());
        self.vr_overlay_runtime.stop();
        self.process_monitor.stop();
        self.log_watcher.stop();
        self.game_log_runtime.stop();
        self.game_client_runtime.stop();
        self.backend_runtime.set_ws_status("idle");
        self.backend_runtime.set_game_log_status("idle");
        self.backend_runtime.set_process_status("unknown");
        self.backend_runtime.set_phase(BackendRuntimePhase::Idle);
        self.emit_backend_runtime_telemetry("runtimeStopped", reason);
        self.backend_runtime.snapshot()
    }

    pub fn set_gui_backend_runtime_mode(&self, mode: BackendRuntimeMode) -> BackendRuntimeSnapshot {
        let current = self.backend_runtime.snapshot();
        if current.mode == BackendRuntimeMode::Headless || mode == BackendRuntimeMode::Headless {
            return current;
        }
        let snapshot = self.backend_runtime.set_mode(mode);
        if snapshot.mode == BackendRuntimeMode::Background
            && snapshot.phase == BackendRuntimePhase::Running
        {
            self.start_gui_background_registry_backup_loop();
        }
        if snapshot.phase == BackendRuntimePhase::Running {
            self.start_gui_background_capability_loops();
        }
        let detail = match mode {
            BackendRuntimeMode::Foreground => "foreground",
            BackendRuntimeMode::Background => "background",
            BackendRuntimeMode::Headless => "headless",
        };
        self.emit_backend_runtime_telemetry_snapshot("modeChanged", detail, snapshot.clone());
        snapshot
    }

    pub fn wait_for_gui_background_capability_loops_stopped(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while self.background_capabilities_running.load(Ordering::Acquire) {
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        true
    }

    pub fn clear_backend_frontend_session(&self) {
        let previous = self
            .backend_frontend_session
            .lock()
            .ok()
            .and_then(|mut slot| slot.take());
        self.runtime_context.overlay_activity.clear_runtime_state();
        self.realtime_runtime.stop(RealtimeStopRequest::default());
        self.runtime_context.session.clear_realtime_context();
        if let Some(previous) = previous {
            self.runtime_context
                .event_bus
                .emit_runtime_group_instances_projection(json!({
                    "status": "idle",
                    "userId": previous.user_id,
                    "endpoint": previous.endpoint,
                    "instances": [],
                    "groupOrder": [],
                    "error": "",
                }));
        }
    }

    pub fn clear_backend_authenticated_session(
        &self,
        reason: impl Into<String>,
    ) -> BackendRuntimeSnapshot {
        self.clear_backend_frontend_session();
        let snapshot = self.backend_runtime.clear_authentication();
        self.emit_backend_runtime_telemetry_snapshot("authCleared", reason, snapshot.clone());
        snapshot
    }

    pub async fn refresh_runtime_group_instances(&self) {
        run_background_group_instance_refresh(
            &self.db,
            &self.web,
            &self.backend_frontend_session,
            &self.runtime_context,
            &self.backend_runtime,
            &self.runtime_context.background_jobs,
            &self.background_group_instances_refresh_running,
        )
        .await;
    }

    pub async fn start_backend_runtime(
        &self,
        mode: BackendRuntimeMode,
    ) -> Result<BackendRuntimeSnapshot> {
        let Some(_start_guard) = BackendStartGuard::try_acquire(&self.backend_starting) else {
            return Ok(self.backend_runtime.snapshot());
        };
        let current = self.backend_runtime.snapshot();
        if matches!(
            current.phase,
            BackendRuntimePhase::Starting
                | BackendRuntimePhase::Authenticating
                | BackendRuntimePhase::Running
        ) {
            self.backend_runtime.set_mode(mode);
            if mode == BackendRuntimeMode::Background
                && current.phase == BackendRuntimePhase::Running
            {
                self.start_gui_background_registry_backup_loop();
            }
            if current.phase == BackendRuntimePhase::Running {
                self.start_gui_background_capability_loops();
            }
            return Ok(self.backend_runtime.snapshot());
        }

        self.backend_runtime.set_mode(mode);
        self.backend_runtime
            .set_phase(BackendRuntimePhase::Starting);
        self.start_shell_neutral_services();

        self.backend_runtime.set_authenticating();
        let auth_scope = self.runtime_context.auth_scope.snapshot();
        let auth_result = if auth_scope.active {
            self.current_user_from_cookie(
                auth_scope.current_user_id.clone(),
                auth_scope.endpoint.clone(),
                String::new(),
            )
            .await
        } else {
            self.authenticate_non_interactive().await
        };
        let session = match auth_result {
            Ok(session) => session,
            Err(NonInteractiveAuthError::InteractionRequired(reason)) => {
                self.backend_runtime
                    .set_auth_interaction_required(reason.clone());
                return Err(crate::Error::Custom(reason));
            }
            Err(NonInteractiveAuthError::SessionInvalidated { user_id, reason }) => {
                self.clear_invalid_non_interactive_auth_session(&user_id, &reason);
                return Err(crate::Error::Custom(reason));
            }
            Err(NonInteractiveAuthError::Failed(reason)) => {
                self.backend_runtime.set_auth_error(reason.clone());
                return Err(crate::Error::Custom(reason));
            }
        };

        self.runtime_context
            .auth_scope
            .set(&session.user_id, &session.endpoint);
        vrcx_0_persistence::maintenance::user_tables_ensure(
            self.db.as_ref(),
            session.user_id.clone(),
        )?;
        let snapshot = self
            .backend_runtime
            .set_auth_success(session.user_id.clone(), session.display_name.clone());
        self.emit_backend_runtime_telemetry_snapshot(
            "authSuccess",
            session.display_name.clone(),
            snapshot,
        );

        let social_baseline = match self.build_backend_social_baseline(&session).await {
            Ok(social_baseline) => social_baseline,
            Err(error) => {
                tracing::warn!(error = %error, "failed to build backend social baseline");
                BackendSocialBaseline::default()
            }
        };
        self.set_backend_frontend_session(&session);
        self.runtime_context
            .overlay_activity
            .set_favorite_groups(OverlayFavoriteGroups::from_map(
                social_baseline.favorite_groups,
            ));
        self.realtime_runtime.start(
            session.user_id,
            session.endpoint,
            session.websocket,
            0,
            session.current_user,
            social_baseline.friends_by_id,
        )?;
        self.backend_runtime.set_phase(BackendRuntimePhase::Running);
        if self.backend_runtime.snapshot().mode == BackendRuntimeMode::Background {
            self.start_gui_background_registry_backup_loop();
        }
        self.start_gui_background_capability_loops();
        Ok(self.backend_runtime.snapshot())
    }

    async fn authenticate_non_interactive(
        &self,
    ) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
        let snapshot = saved_snapshot(self.runtime_context.config())
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        let last_user = string_field(&snapshot, "lastUserLoggedIn").unwrap_or_default();
        if last_user.is_empty() {
            return Err(NonInteractiveAuthError::Failed(
                "No saved account is available for headless login.".into(),
            ));
        }

        let raw_saved_credentials = self
            .runtime_context
            .config()
            .get_json(SAVED_CREDENTIALS_KEY, serde_json::json!({}))
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        let saved_record = raw_saved_credentials.get(&last_user).cloned();
        let endpoint = saved_record
            .as_ref()
            .and_then(|record| record.get("loginParams"))
            .and_then(|login_params| string_field(login_params, "endpoint"))
            .unwrap_or_default();
        let websocket = saved_record
            .as_ref()
            .and_then(|record| record.get("loginParams"))
            .and_then(|login_params| string_field(login_params, "websocket"))
            .unwrap_or_default();

        match self
            .probe_current_user_from_cookie(
                last_user.clone(),
                endpoint.clone(),
                websocket.clone(),
                false,
            )
            .await
        {
            Ok(CookieSessionProbe::Authenticated(session)) => {
                self.record_non_interactive_login_success(&session)?;
                return Ok(session);
            }
            Ok(CookieSessionProbe::Fallback) => {}
            Err(NonInteractiveAuthError::InteractionRequired(reason)) => {
                return Err(NonInteractiveAuthError::InteractionRequired(reason));
            }
            Err(NonInteractiveAuthError::SessionInvalidated { user_id, reason }) => {
                return Err(NonInteractiveAuthError::SessionInvalidated { user_id, reason });
            }
            Err(NonInteractiveAuthError::Failed(reason)) => {
                tracing::warn!(reason, "global cookie auth restore failed");
            }
        }

        if let Some(cookies) = saved_record
            .as_ref()
            .and_then(|record| record.get("cookies"))
            .and_then(serde_json::Value::as_str)
            .filter(|cookies| !cookies.trim().is_empty())
        {
            if let Err(error) = self.web.set_cookies(cookies) {
                tracing::warn!(error = %error, "failed to restore saved auth cookies");
            } else {
                match self
                    .probe_current_user_from_cookie(
                        last_user.clone(),
                        endpoint.clone(),
                        websocket.clone(),
                        true,
                    )
                    .await
                {
                    Ok(CookieSessionProbe::Authenticated(session)) => {
                        self.record_non_interactive_login_success(&session)?;
                        return Ok(session);
                    }
                    Ok(CookieSessionProbe::Fallback) => {}
                    Err(NonInteractiveAuthError::InteractionRequired(reason)) => {
                        return Err(NonInteractiveAuthError::InteractionRequired(reason));
                    }
                    Err(NonInteractiveAuthError::SessionInvalidated { user_id, reason }) => {
                        return Err(NonInteractiveAuthError::SessionInvalidated {
                            user_id,
                            reason,
                        });
                    }
                    Err(NonInteractiveAuthError::Failed(reason)) => {
                        tracing::warn!(reason, "saved cookie auth restore failed");
                    }
                }
            }
        }

        let fallback_available = snapshot
            .get("savedCredentialFallbackAvailable")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        if !fallback_available {
            return Err(NonInteractiveAuthError::Failed(
                "Saved credentials are not available for headless login.".into(),
            ));
        }

        let response = saved_credential_login_start(
            self.runtime_context.config(),
            self.web.as_ref(),
            self.db.as_ref(),
            SavedCredentialLoginStartInput {
                user_id: last_user.clone(),
                endpoint: endpoint.clone(),
            },
        )
        .await
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        if response.status == 403 {
            return Err(NonInteractiveAuthError::SessionInvalidated {
                user_id: last_user.clone(),
                reason: auth_response_error_message(
                    &response,
                    format!(
                        "VRChat config request failed with HTTP {}.",
                        response.status
                    ),
                ),
            });
        }
        let user = parse_current_user_response(response)?;
        let session = AuthenticatedRuntimeSession::from_user(user, endpoint, websocket);
        self.record_non_interactive_login_success(&session)?;
        Ok(session)
    }

    fn record_non_interactive_login_success(
        &self,
        session: &AuthenticatedRuntimeSession,
    ) -> std::result::Result<(), NonInteractiveAuthError> {
        record_login_success(
            self.runtime_context.config(),
            self.web.as_ref(),
            LoginSuccessRecordInput {
                user: session.current_user.clone(),
                login_params: serde_json::json!({
                    "endpoint": session.endpoint,
                    "websocket": session.websocket,
                }),
                stored_login_params: None,
                save_credentials: false,
            },
        )
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        Ok(())
    }

    async fn probe_current_user_from_cookie(
        &self,
        user_id: String,
        endpoint: String,
        websocket: String,
        allow_unmatched_two_factor: bool,
    ) -> std::result::Result<CookieSessionProbe, NonInteractiveAuthError> {
        let config_response = self
            .web
            .execute_api(
                config_get_input(endpoint.clone()),
                ApiScope::Vrchat,
                &self.db,
            )
            .await
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        if response_allows_saved_credential_fallback(&config_response) {
            return Ok(CookieSessionProbe::Fallback);
        }
        if config_response.status == 403 {
            return Err(NonInteractiveAuthError::SessionInvalidated {
                user_id: user_id.clone(),
                reason: auth_response_error_message(
                    &config_response,
                    format!(
                        "VRChat config request failed with HTTP {}.",
                        config_response.status
                    ),
                ),
            });
        }
        if !(200..=399).contains(&config_response.status) {
            return Err(NonInteractiveAuthError::Failed(
                auth_response_error_message(
                    &config_response,
                    format!(
                        "VRChat config request failed with HTTP {}.",
                        config_response.status
                    ),
                ),
            ));
        }

        let response = self
            .web
            .execute_api(
                current_user_get_input(endpoint.clone()),
                ApiScope::Vrchat,
                &self.db,
            )
            .await
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        if response_allows_saved_credential_fallback(&response) {
            return Ok(CookieSessionProbe::Fallback);
        }
        if !allow_unmatched_two_factor && response_requires_two_factor(&response) {
            return Ok(CookieSessionProbe::Fallback);
        }
        if response.status == 403 {
            return Err(NonInteractiveAuthError::SessionInvalidated {
                user_id,
                reason: auth_response_error_message(
                    &response,
                    format!(
                        "VRChat current-user request failed with HTTP {}.",
                        response.status
                    ),
                ),
            });
        }
        let user = parse_current_user_response(response)?;
        let response_user_id = string_field(&user, "id").unwrap_or_default();
        if !user_id.trim().is_empty() && response_user_id != user_id.trim() {
            return Ok(CookieSessionProbe::Fallback);
        }
        Ok(CookieSessionProbe::Authenticated(
            AuthenticatedRuntimeSession::from_user(user, endpoint, websocket),
        ))
    }

    async fn current_user_from_cookie(
        &self,
        user_id: String,
        endpoint: String,
        websocket: String,
    ) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
        let config_response = self
            .web
            .execute_api(
                config_get_input(endpoint.clone()),
                ApiScope::Vrchat,
                &self.db,
            )
            .await
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        if matches!(config_response.status, 401 | 403) {
            return Err(NonInteractiveAuthError::SessionInvalidated {
                user_id: user_id.clone(),
                reason: auth_response_error_message(
                    &config_response,
                    format!(
                        "VRChat config request failed with HTTP {}.",
                        config_response.status
                    ),
                ),
            });
        }

        let response = self
            .web
            .execute_api(
                current_user_get_input(endpoint.clone()),
                ApiScope::Vrchat,
                &self.db,
            )
            .await
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        if matches!(response.status, 401 | 403) {
            return Err(NonInteractiveAuthError::SessionInvalidated {
                user_id,
                reason: auth_response_error_message(
                    &response,
                    format!(
                        "VRChat current-user request failed with HTTP {}.",
                        response.status
                    ),
                ),
            });
        }
        let user = parse_current_user_response(response)?;
        Ok(AuthenticatedRuntimeSession::from_user(
            user, endpoint, websocket,
        ))
    }

    fn clear_invalid_non_interactive_auth_session(
        &self,
        user_id: &str,
        reason: &str,
    ) -> BackendRuntimeSnapshot {
        self.web.clear_cookies();
        self.web.save_cookies(&self.db);
        self.runtime_context.auth_scope.set("", "");
        if !user_id.trim().is_empty() {
            if let Err(error) = record_logout(
                self.runtime_context.config(),
                self.web.as_ref(),
                LogoutRecordInput {
                    user_or_user_id: Value::String(user_id.trim().to_string()),
                    clear_last_user_logged_in: Some(true),
                    cookies: Some(Value::Null),
                },
            ) {
                tracing::warn!(
                    error = %error,
                    user_id = %user_id,
                    "failed to clear saved auth after invalid VRChat session"
                );
            }
        }
        self.clear_backend_authenticated_session(reason)
    }

    async fn build_backend_social_baseline(
        &self,
        session: &AuthenticatedRuntimeSession,
    ) -> Result<BackendSocialBaseline> {
        let deps = SocialBaselineDeps {
            db: Arc::clone(&self.db),
            web: Arc::clone(&self.web),
            auth_scope: self.runtime_context.auth_scope.clone(),
            session: self.runtime_context.session.clone(),
        };
        let output = build_friend_roster_baseline(
            deps.clone(),
            SocialFriendRosterBaselineInput {
                user_id: session.user_id.clone(),
                endpoint: session.endpoint.clone(),
                current_user_snapshot: RawJson::from(session.current_user.clone()),
                explicit_add_intent_user_ids: Vec::new(),
            },
        )
        .await?;
        let Some(snapshot) = output.snapshot else {
            return Ok(BackendSocialBaseline::default());
        };
        let snapshot = snapshot.into_value();
        let friends_by_id = snapshot
            .get("friendsById")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        let friends_by_id_map =
            serde_json::from_value::<HashMap<String, FriendRecord>>(friends_by_id.clone())?;
        let favorite_groups = match build_favorites_baseline(
            deps,
            SocialFavoritesBaselineInput {
                user_id: session.user_id.clone(),
                endpoint: session.endpoint.clone(),
                current_user_snapshot: RawJson::from(session.current_user.clone()),
                friend_roster_by_id: RawJson::from(friends_by_id),
            },
        )
        .await
        {
            Ok(output) => output
                .snapshot
                .map(|snapshot| favorite_group_membership_from_snapshot(snapshot.into_value()))
                .unwrap_or_default(),
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    "failed to build backend favorite baseline for overlay activity"
                );
                HashMap::new()
            }
        };
        Ok(BackendSocialBaseline {
            friends_by_id: friends_by_id_map,
            favorite_groups,
        })
    }

    fn set_backend_frontend_session(&self, session: &AuthenticatedRuntimeSession) {
        let snapshot = BackendRuntimeFrontendSessionSnapshot {
            authenticated: true,
            user_id: session.user_id.clone(),
            display_name: session.display_name.clone(),
            endpoint: session.endpoint.clone(),
            websocket: session.websocket.clone(),
            current_user_snapshot: session.current_user.clone(),
        };
        if let Ok(mut slot) = self.backend_frontend_session.lock() {
            let scope_changed = slot
                .as_ref()
                .map(|current| {
                    current.user_id != snapshot.user_id
                        || current.endpoint != snapshot.endpoint
                        || current.websocket != snapshot.websocket
                })
                .unwrap_or(true);
            if scope_changed {
                self.runtime_context.overlay_activity.clear_runtime_state();
            }
            *slot = Some(snapshot);
        }
    }

    pub fn sync_frontend_authenticated_session(
        &self,
        user_id: String,
        endpoint: String,
        websocket: String,
        current_user_snapshot: Value,
    ) {
        let user_id = user_id.trim().to_string();
        if user_id.is_empty() {
            return;
        }
        let display_name = string_field(&current_user_snapshot, "displayName")
            .or_else(|| string_field(&current_user_snapshot, "username"))
            .unwrap_or_else(|| user_id.clone());
        self.runtime_context.auth_scope.set(&user_id, &endpoint);
        let snapshot = BackendRuntimeFrontendSessionSnapshot {
            authenticated: true,
            user_id: user_id.clone(),
            display_name: display_name.clone(),
            endpoint,
            websocket,
            current_user_snapshot,
        };
        if let Ok(mut slot) = self.backend_frontend_session.lock() {
            let scope_changed = slot
                .as_ref()
                .map(|current| {
                    current.user_id != snapshot.user_id
                        || current.endpoint != snapshot.endpoint
                        || current.websocket != snapshot.websocket
                })
                .unwrap_or(true);
            if scope_changed {
                self.runtime_context.overlay_activity.clear_runtime_state();
            }
            *slot = Some(snapshot);
        }
        self.backend_runtime
            .set_auth_success(user_id, display_name.clone());
        let snapshot = self.backend_runtime.set_phase(BackendRuntimePhase::Running);
        self.emit_backend_runtime_telemetry_snapshot("authSuccess", display_name, snapshot);
        self.start_gui_background_capability_loops();
    }

    fn start_log_watcher_for_current_platform(
        &self,
        _host_capabilities: &vrcx_0_host::host_capabilities::HostCapabilities,
    ) {
        #[cfg(target_os = "windows")]
        if is_host_capability_available(HostCapability::GameLogWatcher) {
            let local_low = std::env::var("LOCALAPPDATA")
                .map(|p| PathBuf::from(p).join("..\\LocalLow\\VRChat\\VRChat"))
                .unwrap_or_default();
            if let Err(error) = self.game_log_runtime.prime_log_watcher(&self.log_watcher) {
                tracing::warn!("failed to prime GameLog watcher from runtime DB: {error}");
            }
            self.log_watcher.start(local_low);
            self.runtime_context
                .background_jobs
                .mark_running("gameLogWatcher", "Windows GameLog watcher is active.");
            self.emit_game_log_watcher_status("running");
        }

        #[cfg(target_os = "windows")]
        if !is_host_capability_available(HostCapability::GameLogWatcher) {
            self.runtime_context.background_jobs.register_job(
                "gameLogWatcher",
                "rust-host",
                None,
                "unavailable",
                "GameLog watcher capability is unavailable.",
            );
            self.emit_game_log_watcher_status("unavailable");
        }

        #[cfg(target_os = "linux")]
        if is_host_capability_available(HostCapability::GameLogWatcher) {
            match vrcx_0_host::vrchat_paths::discover_linux_vrchat_log_paths() {
                Ok(paths) => {
                    let latest_log = paths
                        .latest_log
                        .as_ref()
                        .map(|path| path.display().to_string())
                        .unwrap_or_else(|| "pending".to_string());
                    tracing::info!(
                        log_dir = %paths.app_data.display(),
                        latest_log,
                        "starting Linux GameLog watcher"
                    );
                    if let Err(error) = self.game_log_runtime.prime_log_watcher(&self.log_watcher) {
                        tracing::warn!("failed to prime GameLog watcher from runtime DB: {error}");
                    }
                    self.log_watcher
                        .start_without_process_monitor(paths.app_data);
                    self.runtime_context
                        .background_jobs
                        .mark_running("gameLogWatcher", "Linux GameLog watcher is active.");
                    self.emit_game_log_watcher_status("running");
                }
                Err(reason) => {
                    tracing::warn!(reason, "Linux GameLog watcher is unavailable");
                    self.runtime_context.background_jobs.register_job(
                        "gameLogWatcher",
                        "rust-host",
                        None,
                        "unavailable",
                        reason,
                    );
                    self.emit_game_log_watcher_status("unavailable");
                }
            }
        }

        #[cfg(target_os = "linux")]
        if !is_host_capability_available(HostCapability::GameLogWatcher) {
            self.runtime_context.background_jobs.register_job(
                "gameLogWatcher",
                "rust-host",
                None,
                "unavailable",
                _host_capabilities
                    .game_log_watcher
                    .reason
                    .clone()
                    .unwrap_or_else(|| "GameLog watcher capability is unavailable.".into()),
            );
            self.emit_game_log_watcher_status("unavailable");
        }

        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            let _ = _host_capabilities;
            self.runtime_context.background_jobs.register_job(
                "gameLogWatcher",
                "rust-host",
                None,
                "unavailable",
                "GameLog watcher is unavailable on this platform.",
            );
            self.emit_game_log_watcher_status("unavailable");
        }
    }

    fn emit_game_log_watcher_status(&self, status: &str) {
        let snapshot = self.backend_runtime.set_game_log_status(status);
        self.emit_backend_runtime_telemetry_snapshot("gameLogWatcher", status, snapshot);
    }

    fn start_gui_background_registry_backup_loop(&self) {
        let current = self.backend_runtime.snapshot();
        if current.mode != BackendRuntimeMode::Background
            || current.phase != BackendRuntimePhase::Running
        {
            return;
        }
        if !is_host_capability_available(HostCapability::RegistryPrefs) {
            self.runtime_context.background_jobs.register_job(
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

        self.runtime_context.background_jobs.register_job(
            REGISTRY_BACKUP_MAINTENANCE_JOB,
            "rust-host",
            Some(REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS),
            "scheduled",
            "Registry backup maintenance is scheduled for background mode.",
        );

        let db = Arc::clone(&self.db);
        let backend_runtime = self.backend_runtime.clone();
        let runtime_context = Arc::clone(&self.runtime_context);
        let background_jobs = self.runtime_context.background_jobs.clone();
        let running = Arc::clone(&self.registry_backup_maintenance_running);
        let registry_backup_lock = Arc::clone(&self.registry_backup_lock);
        self.runtime_context.tasks.spawn_cancellable_thread(
            "registry-backup-maintenance",
            move |stop_token| {
                let host = HostRegistryBackupActions;
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
                        Ok(_guard) => vrcx_0_application::registry_backup_maintenance_run(
                            db.as_ref(),
                            &host,
                            RegistryBackupMaintenanceMode::Silent,
                            "background-mode",
                        ),
                        Err(error) => Err(vrcx_0_application::Error::Custom(format!(
                            "registry backup lock poisoned: {error}"
                        ))),
                    };
                    match result {
                        Ok(result) => {
                            if result.auto_backup_created {
                                tracing::info!("background mode registry auto backup created");
                                emit_background_info(
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
                            emit_background_error(
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

    fn start_gui_background_capability_loops(&self) {
        let current = self.backend_runtime.snapshot();
        let auth_scope = self.runtime_context.auth_scope.snapshot();
        let active_runtime =
            is_authenticated_gui_maintenance_active_snapshot(&current, &auth_scope);
        let active_session =
            background_session_scope_matches_auth(&self.backend_frontend_session, &auth_scope);
        if !active_runtime || !active_session {
            return;
        }
        if self
            .background_capabilities_running
            .swap(true, Ordering::AcqRel)
        {
            return;
        }

        for (name, cadence, detail) in [
            (
                BACKGROUND_PRESENCE_AUTOMATION_JOB,
                BACKGROUND_PRESENCE_CADENCE_SECONDS,
                "Background presence automation is scheduled for GUI background mode.",
            ),
            (
                BACKGROUND_DISCORD_PRESENCE_JOB,
                BACKGROUND_DISCORD_CADENCE_SECONDS,
                "Background Discord presence is scheduled for GUI background mode.",
            ),
            (
                BACKGROUND_FACTS_REFRESH_JOB,
                BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
                "Background facts refresh is scheduled for GUI background mode.",
            ),
            (
                BACKGROUND_MODERATION_REFRESH_JOB,
                BACKGROUND_MODERATION_CADENCE_SECONDS,
                "Background moderation refresh is scheduled for GUI background mode.",
            ),
        ] {
            self.runtime_context.background_jobs.register_job(
                name,
                "rust-host",
                Some(cadence),
                "scheduled",
                detail,
            );
        }

        let db = Arc::clone(&self.db);
        let web = Arc::clone(&self.web);
        let backend_runtime = self.backend_runtime.clone();
        let background_jobs = self.runtime_context.background_jobs.clone();
        let running = Arc::clone(&self.background_capabilities_running);
        let group_instances_refresh_running =
            Arc::clone(&self.background_group_instances_refresh_running);
        let session_slot = Arc::clone(&self.backend_frontend_session);
        let realtime_runtime = Arc::clone(&self.realtime_runtime);
        let runtime_context = Arc::clone(&self.runtime_context);
        let discord_rpc = Arc::clone(&self.discord_rpc);

        self.runtime_context
            .tasks
            .spawn_cancellable(move |stop_token| async move {
                let mut presence_state = BackgroundPresenceAutomationState::default();
                let mut discord_state = BackgroundDiscordPresenceState::default();
                let mut discord_success_info: Option<String> = None;
                let mut next_presence = Instant::now();
                let mut next_discord = Instant::now();
                let mut next_current_user = Instant::now();
                let mut next_group_instances = Instant::now();
                let mut next_overlay_activity_config = Instant::now();
                let mut next_social = Instant::now();
                let mut next_moderation = Instant::now();
                let mut favorite_friend_groups_by_key: HashMap<String, Vec<String>> =
                    HashMap::new();
                let mut active_scope_key =
                    background_capability_session_scope_key(&session_slot).unwrap_or_default();
                let sleep_chunk = Duration::from_secs(1);

                loop {
                    if stop_token.is_stop_requested()
                        || !is_authenticated_gui_maintenance_active(
                            &backend_runtime,
                            &runtime_context,
                            &session_slot,
                        )
                    {
                        break;
                    }

                    let now = Instant::now();
                    let scope_key =
                        background_capability_session_scope_key(&session_slot).unwrap_or_default();
                    if scope_key != active_scope_key {
                        active_scope_key = scope_key;
                        presence_state = BackgroundPresenceAutomationState::default();
                        discord_state = BackgroundDiscordPresenceState::default();
                        discord_success_info = None;
                        favorite_friend_groups_by_key.clear();
                        runtime_context.overlay_activity.clear_runtime_state();
                        next_presence = now;
                        next_discord = now;
                        next_current_user = now;
                        next_group_instances = now;
                        next_overlay_activity_config = now;
                        next_social = now;
                        next_moderation = now;
                    }

                    if now >= next_current_user {
                        run_background_current_user_refresh(
                            &db,
                            &web,
                            &session_slot,
                            &realtime_runtime,
                            &runtime_context,
                            &backend_runtime,
                            &background_jobs,
                        )
                        .await;
                        next_current_user =
                            now + Duration::from_secs(BACKGROUND_CURRENT_USER_CADENCE_SECONDS);
                    }

                    if now >= next_group_instances {
                        run_background_group_instance_refresh(
                            &db,
                            &web,
                            &session_slot,
                            &runtime_context,
                            &backend_runtime,
                            &background_jobs,
                            &group_instances_refresh_running,
                        )
                        .await;
                        next_group_instances =
                            now + Duration::from_secs(BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS);
                    }

                    if now >= next_overlay_activity_config {
                        runtime_context.reload_overlay_activity_filters();
                        next_overlay_activity_config = now
                            + Duration::from_secs(
                                BACKGROUND_OVERLAY_ACTIVITY_CONFIG_CADENCE_SECONDS,
                            );
                    }

                    let tick_context = BackgroundTickContext {
                        db: &db,
                        web: &web,
                        session_slot: &session_slot,
                        realtime_runtime: &realtime_runtime,
                        runtime_context: &runtime_context,
                        backend_runtime: &backend_runtime,
                        background_jobs: &background_jobs,
                    };

                    if now >= next_social {
                        run_background_social_baseline_refresh(
                            &tick_context,
                            &mut favorite_friend_groups_by_key,
                        )
                        .await;
                        next_social =
                            now + Duration::from_secs(BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS);
                    }

                    if now >= next_moderation {
                        run_background_moderation_refresh(
                            &db,
                            &web,
                            &session_slot,
                            &runtime_context,
                            &backend_runtime,
                            &background_jobs,
                        )
                        .await;
                        next_moderation =
                            now + Duration::from_secs(BACKGROUND_MODERATION_CADENCE_SECONDS);
                    }

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
                            &mut discord_success_info,
                            &favorite_friend_groups_by_key,
                        )
                        .await;
                        next_discord =
                            now + Duration::from_secs(BACKGROUND_DISCORD_CADENCE_SECONDS);
                    }

                    tokio::time::sleep(sleep_chunk).await;
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
                background_jobs.mark_completed(
                    BACKGROUND_FACTS_REFRESH_JOB,
                    "Background facts refresh stopped.",
                );
                background_jobs.mark_completed(
                    BACKGROUND_MODERATION_REFRESH_JOB,
                    "Background moderation refresh stopped.",
                );
            });
    }

    fn emit_backend_runtime_telemetry(&self, kind: &str, detail: impl Into<String>) {
        self.emit_backend_runtime_telemetry_snapshot(kind, detail, self.backend_runtime.snapshot());
    }

    fn emit_backend_runtime_telemetry_snapshot(
        &self,
        kind: &str,
        detail: impl Into<String>,
        snapshot: BackendRuntimeSnapshot,
    ) {
        self.runtime_context.event_bus.emit(
            "backendRuntimeTelemetry",
            BackendRuntimeTelemetry {
                kind: kind.into(),
                detail: detail.into(),
                snapshot,
            },
        );
    }
}

fn is_background_registry_maintenance_active(runtime: &BackendRuntime) -> bool {
    let snapshot = runtime.snapshot();
    snapshot.mode == BackendRuntimeMode::Background
        && snapshot.phase == BackendRuntimePhase::Running
}

fn is_authenticated_gui_maintenance_active(
    runtime: &BackendRuntime,
    runtime_context: &Arc<RuntimeHostContext>,
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
) -> bool {
    let auth_scope = runtime_context.auth_scope.snapshot();
    if !is_authenticated_gui_maintenance_active_snapshot(&runtime.snapshot(), &auth_scope) {
        return false;
    }
    background_capability_session(session_slot)
        .map(|session| background_session_matches_auth(&session, &auth_scope))
        .unwrap_or(auth_scope.active)
}

fn is_authenticated_gui_maintenance_active_snapshot(
    snapshot: &BackendRuntimeSnapshot,
    auth_scope: &vrcx_0_application::RuntimeAuthScopeSnapshot,
) -> bool {
    snapshot.mode != BackendRuntimeMode::Headless
        && snapshot.phase == BackendRuntimePhase::Running
        && snapshot.auth_status == "authenticated"
        && !snapshot.auth_user_id.trim().is_empty()
        && auth_scope.active
        && auth_scope.current_user_id == snapshot.auth_user_id
}

fn background_session_scope_matches_auth(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    auth_scope: &vrcx_0_application::RuntimeAuthScopeSnapshot,
) -> bool {
    background_capability_session(session_slot)
        .map(|session| background_session_matches_auth(&session, auth_scope))
        .unwrap_or(false)
}

fn background_session_matches_auth(
    session: &BackgroundCapabilitySession,
    auth_scope: &vrcx_0_application::RuntimeAuthScopeSnapshot,
) -> bool {
    auth_scope.active
        && session.current_user_id == auth_scope.current_user_id
        && normalize_vrchat_api_endpoint(Some(&session.endpoint)) == auth_scope.endpoint
}

fn gui_maintenance_runtime_mode(backend_runtime: &BackendRuntime) -> &'static str {
    match backend_runtime.snapshot().mode {
        BackendRuntimeMode::Foreground => "normal GUI mode",
        BackendRuntimeMode::Background => "background GUI mode",
        BackendRuntimeMode::Headless => "headless mode",
    }
}

fn emit_background_info(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    detail: impl Into<String>,
) {
    emit_background_output(runtime_context, backend_runtime, "backgroundInfo", detail);
}

fn emit_background_error(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    detail: impl Into<String>,
) {
    emit_background_output(runtime_context, backend_runtime, "backgroundError", detail);
}

fn emit_background_info_if_changed(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    last_detail: &mut Option<String>,
    detail: impl Into<String>,
) {
    let detail = detail.into();
    if last_detail.as_deref() == Some(detail.as_str()) {
        return;
    }
    emit_background_info(runtime_context, backend_runtime, detail.clone());
    *last_detail = Some(detail);
}

fn emit_background_output(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    kind: &str,
    detail: impl Into<String>,
) {
    let snapshot = backend_runtime.snapshot();
    if snapshot.mode == BackendRuntimeMode::Headless
        || !matches!(snapshot.phase, BackendRuntimePhase::Running)
    {
        return;
    }
    runtime_context.event_bus.emit(
        "backendRuntimeTelemetry",
        BackendRuntimeTelemetry {
            kind: kind.into(),
            detail: detail.into(),
            snapshot,
        },
    );
}

fn background_capability_session(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
) -> Option<BackgroundCapabilitySession> {
    session_slot.lock().ok().and_then(|slot| {
        slot.as_ref().map(|session| BackgroundCapabilitySession {
            current_user_id: session.user_id.clone(),
            endpoint: session.endpoint.clone(),
            websocket: session.websocket.clone(),
            current_user_snapshot: session.current_user_snapshot.clone(),
        })
    })
}

fn background_capability_session_scope_key(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
) -> Option<String> {
    background_capability_session(session_slot).map(|session| {
        format!(
            "{}:{}",
            session.current_user_id,
            normalize_vrchat_api_endpoint(Some(&session.endpoint))
        )
    })
}

fn background_capability_session_matches(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    session: &BackgroundCapabilitySession,
) -> bool {
    session_slot_matches(session_slot.lock().ok().as_deref(), session)
}

fn read_group_order(user_id: &str) -> Value {
    if !is_host_capability_available(HostCapability::RegistryPrefs) {
        return json!([]);
    }
    let key = format!("VRC_GROUP_ORDER_{}", user_id.trim());
    let Ok(raw) = vrcx_0_host::vrchat_registry::get_registry_key_string(&key) else {
        return json!([]);
    };
    match serde_json::from_str::<Value>(&raw) {
        Ok(value) if value.is_array() => value,
        _ => json!([]),
    }
}

struct BackgroundTickContext<'a> {
    db: &'a Arc<DatabaseService>,
    web: &'a Arc<WebClient>,
    session_slot: &'a Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    realtime_runtime: &'a Arc<RealtimeHostRuntime>,
    runtime_context: &'a Arc<RuntimeHostContext>,
    backend_runtime: &'a BackendRuntime,
    background_jobs: &'a RuntimeBackgroundJobs,
}

async fn run_background_presence_tick(
    context: &BackgroundTickContext<'_>,
    presence_state: &mut BackgroundPresenceAutomationState,
    favorite_friend_groups_by_key: &HashMap<String, Vec<String>>,
) {
    context.background_jobs.mark_running(
        BACKGROUND_PRESENCE_AUTOMATION_JOB,
        "Running background presence automation.",
    );
    let Some(session) = background_capability_session(context.session_slot) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_PRESENCE_AUTOMATION_JOB,
            "Background presence automation is waiting for an authenticated session.",
            BACKGROUND_PRESENCE_CADENCE_SECONDS,
        );
        return;
    };
    let host_session = context.runtime_context.session.snapshot();
    let friends_by_id = context
        .realtime_runtime
        .friend_snapshot()
        .map(|snapshot| snapshot.friends_by_id)
        .unwrap_or_default();
    let facts = match build_background_presence_facts(
        context.db.as_ref(),
        BackgroundPresenceFactsInput {
            session: session.clone(),
            is_game_running: host_session.is_game_running,
            is_steamvr_running: host_session.is_steamvr_running,
            last_game_started_at: host_session.last_game_started_at,
            game_log_snapshot: context.runtime_context.game_log_snapshot(),
            now_playing: context.runtime_context.now_playing(),
            friends_by_id,
            favorite_friend_groups_by_key: favorite_friend_groups_by_key.clone(),
        },
    ) {
        Ok(facts) => facts,
        Err(error) => {
            tracing::warn!(error = %error, "background presence facts build failed");
            emit_background_error(
                context.runtime_context,
                context.backend_runtime,
                format!("presence automation facts failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_PRESENCE_AUTOMATION_JOB, error.to_string());
            return;
        }
    };
    let result = match run_background_presence_automation(
        context.runtime_context.config(),
        context.web.as_ref(),
        context.db.as_ref(),
        &facts,
        presence_state,
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            tracing::warn!(error = %error, "background presence automation failed");
            emit_background_error(
                context.runtime_context,
                context.backend_runtime,
                format!("presence automation failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_PRESENCE_AUTOMATION_JOB, error.to_string());
            return;
        }
    };
    if let Some(updated_user) = result.updated_user.clone() {
        let overlay_patch = result.patch.clone();
        let accepted = context
            .realtime_runtime
            .sync_current_user_snapshot(
                session.current_user_id.clone(),
                session.endpoint.clone(),
                session.websocket.clone(),
                None,
                updated_user.clone(),
                overlay_patch,
            )
            .unwrap_or(false);
        if !background_capability_session_matches(context.session_slot, &session) {
            tracing::warn!("ignored stale background presence automation user update");
        } else if accepted {
            if let Some(snapshot) = context.realtime_runtime.current_user_snapshot() {
                replace_backend_frontend_session_user_if_session_matches(
                    context.session_slot,
                    &session,
                    &snapshot,
                );
            } else {
                update_backend_frontend_session_user_if_session_matches(
                    context.session_slot,
                    &session,
                    &updated_user,
                );
            }
        } else {
            tracing::warn!("ignored background presence automation update rejected by realtime");
        }
    }
    if result.applied {
        tracing::info!(
            patch = %result.patch,
            rules = ?result.matched_rule_ids,
            "background presence automation applied"
        );
        emit_background_info(
            context.runtime_context,
            context.backend_runtime,
            background_presence_applied_detail(&result.patch, result.matched_rule_ids.len()),
        );
    }
    context.background_jobs.mark_completed(
        BACKGROUND_PRESENCE_AUTOMATION_JOB,
        format!("Background presence automation tick: {}.", result.reason),
    );
    context.background_jobs.mark_scheduled(
        BACKGROUND_PRESENCE_AUTOMATION_JOB,
        "Next background presence automation tick is waiting.",
        BACKGROUND_PRESENCE_CADENCE_SECONDS,
    );
}

async fn run_background_discord_tick(
    context: &BackgroundTickContext<'_>,
    discord_rpc: &Arc<DiscordRpc>,
    discord_state: &mut BackgroundDiscordPresenceState,
    discord_success_info: &mut Option<String>,
    favorite_friend_groups_by_key: &HashMap<String, Vec<String>>,
) {
    context.background_jobs.mark_running(
        BACKGROUND_DISCORD_PRESENCE_JOB,
        "Running background Discord presence.",
    );
    let Some(session) = background_capability_session(context.session_slot) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_DISCORD_PRESENCE_JOB,
            "Background Discord presence is waiting for an authenticated session.",
            BACKGROUND_DISCORD_CADENCE_SECONDS,
        );
        return;
    };
    let host_session = context.runtime_context.session.snapshot();
    let friends_by_id = context
        .realtime_runtime
        .friend_snapshot()
        .map(|snapshot| snapshot.friends_by_id)
        .unwrap_or_default();
    let facts = match build_background_presence_facts(
        context.db.as_ref(),
        BackgroundPresenceFactsInput {
            session,
            is_game_running: host_session.is_game_running,
            is_steamvr_running: host_session.is_steamvr_running,
            last_game_started_at: host_session.last_game_started_at,
            game_log_snapshot: context.runtime_context.game_log_snapshot(),
            now_playing: context.runtime_context.now_playing(),
            friends_by_id,
            favorite_friend_groups_by_key: favorite_friend_groups_by_key.clone(),
        },
    ) {
        Ok(facts) => facts,
        Err(error) => {
            tracing::warn!(error = %error, "background Discord facts build failed");
            *discord_success_info = None;
            emit_background_error(
                context.runtime_context,
                context.backend_runtime,
                format!("Discord presence facts failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
            return;
        }
    };
    let command = match build_background_discord_presence_command(
        context.runtime_context.config(),
        context.web.as_ref(),
        context.db.as_ref(),
        &facts,
        discord_state,
        false,
    )
    .await
    {
        Ok(command) => command,
        Err(error) => {
            tracing::warn!(error = %error, "background Discord presence compose failed");
            *discord_success_info = None;
            emit_background_error(
                context.runtime_context,
                context.backend_runtime,
                format!("Discord presence compose failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
            return;
        }
    };

    let detail = match command {
        BackgroundDiscordPresenceCommand::Noop { detail } => detail,
        BackgroundDiscordPresenceCommand::SetActive { active, detail, .. } => {
            let rpc = Arc::clone(discord_rpc);
            match tokio::task::spawn_blocking(move || rpc.set_active(active)).await {
                Ok(Ok(result)) => {
                    discord_state.apply_set_active_result(result);
                    emit_background_info_if_changed(
                        context.runtime_context,
                        context.backend_runtime,
                        discord_success_info,
                        format!(
                            "Discord presence {}: {detail}",
                            if active { "connected" } else { "cleared" }
                        ),
                    );
                    detail
                }
                Ok(Err(error)) => {
                    discord_state.apply_set_active_result(false);
                    tracing::warn!(error = %error, "background Discord SetActive failed");
                    *discord_success_info = None;
                    emit_background_error(
                        context.runtime_context,
                        context.backend_runtime,
                        format!("Discord SetActive failed: {error}."),
                    );
                    context
                        .background_jobs
                        .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
                    return;
                }
                Err(error) => {
                    discord_state.apply_set_active_result(false);
                    tracing::warn!(error = %error, "background Discord SetActive task failed");
                    *discord_success_info = None;
                    emit_background_error(
                        context.runtime_context,
                        context.backend_runtime,
                        format!("Discord SetActive task failed: {error}."),
                    );
                    context
                        .background_jobs
                        .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
                    return;
                }
            }
        }
        BackgroundDiscordPresenceCommand::SetAssets { payload } => {
            let detail = payload.detail.clone();
            let rpc = Arc::clone(discord_rpc);
            let payload = json!({
                "appId": payload.app_id,
                "activity": payload.activity,
            });
            match tokio::task::spawn_blocking(move || rpc.set_assets(payload)).await {
                Ok(Ok(result)) => {
                    discord_state.apply_set_assets_result(result);
                    emit_background_info_if_changed(
                        context.runtime_context,
                        context.backend_runtime,
                        discord_success_info,
                        format!("Discord activity sent: {detail}"),
                    );
                    detail
                }
                Ok(Err(error)) => {
                    discord_state.apply_set_assets_result(false);
                    tracing::warn!(error = %error, "background Discord SetAssets failed");
                    *discord_success_info = None;
                    emit_background_error(
                        context.runtime_context,
                        context.backend_runtime,
                        format!("Discord SetAssets failed: {error}."),
                    );
                    context
                        .background_jobs
                        .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
                    return;
                }
                Err(error) => {
                    discord_state.apply_set_assets_result(false);
                    tracing::warn!(error = %error, "background Discord SetAssets task failed");
                    *discord_success_info = None;
                    emit_background_error(
                        context.runtime_context,
                        context.backend_runtime,
                        format!("Discord SetAssets task failed: {error}."),
                    );
                    context
                        .background_jobs
                        .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
                    return;
                }
            }
        }
    };
    context
        .background_jobs
        .mark_completed(BACKGROUND_DISCORD_PRESENCE_JOB, detail);
    context.background_jobs.mark_scheduled(
        BACKGROUND_DISCORD_PRESENCE_JOB,
        "Next background Discord presence tick is waiting.",
        BACKGROUND_DISCORD_CADENCE_SECONDS,
    );
}

async fn run_background_current_user_refresh(
    db: &Arc<DatabaseService>,
    web: &Arc<WebClient>,
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    realtime_runtime: &Arc<RealtimeHostRuntime>,
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    background_jobs: &RuntimeBackgroundJobs,
) {
    background_jobs.mark_running(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Refreshing background current user facts.",
    );
    let Some(session) = background_capability_session(session_slot) else {
        background_jobs.mark_scheduled(
            BACKGROUND_FACTS_REFRESH_JOB,
            "Background facts refresh is waiting for an authenticated session.",
            BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
        );
        return;
    };
    match refresh_background_current_user(web.as_ref(), db.as_ref(), &session).await {
        Ok(updated_user) => {
            let accepted = realtime_runtime
                .sync_current_user_snapshot(
                    session.current_user_id.clone(),
                    session.endpoint.clone(),
                    session.websocket.clone(),
                    None,
                    updated_user.clone(),
                    Value::Null,
                )
                .unwrap_or(false);
            if !background_capability_session_matches(session_slot, &session) {
                tracing::warn!("ignored stale background current user refresh");
            } else if accepted {
                if let Some(snapshot) = realtime_runtime.current_user_snapshot() {
                    replace_backend_frontend_session_user_if_session_matches(
                        session_slot,
                        &session,
                        &snapshot,
                    );
                } else {
                    update_backend_frontend_session_user_filtered_if_session_matches(
                        session_slot,
                        &session,
                        &updated_user,
                    );
                }
            } else {
                tracing::warn!("ignored background current user refresh rejected by realtime");
            }
            let detail = "current user facts refreshed.";
            emit_background_info(runtime_context, backend_runtime, detail);
            background_jobs.mark_completed(BACKGROUND_FACTS_REFRESH_JOB, detail);
        }
        Err(error) => {
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(backend_runtime),
                error = %error,
                "GUI maintenance current user network request failed"
            );
            emit_background_error(
                runtime_context,
                backend_runtime,
                format!("current user refresh failed: {error}."),
            );
            background_jobs.mark_failed(BACKGROUND_FACTS_REFRESH_JOB, error.to_string());
        }
    }
    background_jobs.mark_scheduled(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Next background current user facts refresh is waiting.",
        BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
    );
}

async fn run_background_group_instance_refresh(
    db: &Arc<DatabaseService>,
    web: &Arc<WebClient>,
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    background_jobs: &RuntimeBackgroundJobs,
    refresh_running: &Arc<AtomicBool>,
) {
    let Some(_refresh_guard) = AtomicFlagGuard::try_acquire(refresh_running) else {
        background_jobs.mark_scheduled(
            BACKGROUND_FACTS_REFRESH_JOB,
            "Background group instance refresh is already running.",
            BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
        );
        return;
    };
    background_jobs.mark_running(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Refreshing background group instance facts.",
    );
    let Some(session) = background_capability_session(session_slot) else {
        background_jobs.mark_scheduled(
            BACKGROUND_FACTS_REFRESH_JOB,
            "Background group instance refresh is waiting for an authenticated session.",
            BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
        );
        return;
    };
    runtime_context
        .event_bus
        .emit_runtime_group_instances_projection(json!({
            "status": "running",
            "userId": &session.current_user_id,
            "endpoint": &session.endpoint,
        }));
    match refresh_background_group_instances(web.as_ref(), db.as_ref(), &session).await {
        Ok(refresh) => {
            if !background_capability_session_matches(session_slot, &session) {
                tracing::warn!("ignored stale background group instance refresh");
                emit_stale_group_instance_refresh_idle(session_slot, runtime_context, &session);
                background_jobs.mark_scheduled(
                    BACKGROUND_FACTS_REFRESH_JOB,
                    "Stale background group instance refresh ignored.",
                    BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
                );
                return;
            }
            let count = refresh.instances.len();
            runtime_context
                .event_bus
                .emit_runtime_group_instances_projection(json!({
                    "status": "ready",
                    "userId": &session.current_user_id,
                    "endpoint": &session.endpoint,
                    "instances": refresh.instances,
                    "groupOrder": read_group_order(&session.current_user_id),
                    "fetchedAt": refresh.fetched_at,
                }));
            let detail = format!("group instance facts refreshed: {count} rows.");
            emit_background_info(runtime_context, backend_runtime, detail.clone());
            background_jobs.mark_completed(BACKGROUND_FACTS_REFRESH_JOB, detail);
        }
        Err(error) => {
            if !background_capability_session_matches(session_slot, &session) {
                tracing::warn!("ignored stale background group instance refresh error");
                emit_stale_group_instance_refresh_idle(session_slot, runtime_context, &session);
                background_jobs.mark_scheduled(
                    BACKGROUND_FACTS_REFRESH_JOB,
                    "Stale background group instance refresh error ignored.",
                    BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
                );
                return;
            }
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(backend_runtime),
                error = %error,
                "GUI maintenance group instance network request failed"
            );
            runtime_context
                .event_bus
                .emit_runtime_group_instances_projection(json!({
                    "status": "error",
                    "userId": &session.current_user_id,
                    "endpoint": &session.endpoint,
                    "error": error.to_string(),
                }));
            emit_background_error(
                runtime_context,
                backend_runtime,
                format!("group instance refresh failed: {error}."),
            );
            background_jobs.mark_failed(BACKGROUND_FACTS_REFRESH_JOB, error.to_string());
        }
    }
    background_jobs.mark_scheduled(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Next background group instance facts refresh is waiting.",
        BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
    );
}

fn emit_stale_group_instance_refresh_idle(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    runtime_context: &Arc<RuntimeHostContext>,
    session: &BackgroundCapabilitySession,
) {
    let same_scope = background_capability_session(session_slot)
        .map(|current| {
            current.current_user_id == session.current_user_id
                && current.endpoint == session.endpoint
        })
        .unwrap_or(false);
    if same_scope {
        runtime_context
            .event_bus
            .emit_runtime_group_instances_projection(json!({
                "status": "idle",
                "userId": &session.current_user_id,
                "endpoint": &session.endpoint,
            }));
        return;
    }
    runtime_context
        .event_bus
        .emit_runtime_group_instances_projection(json!({
            "status": "idle",
            "userId": &session.current_user_id,
            "endpoint": &session.endpoint,
            "instances": [],
            "groupOrder": [],
        }));
}

async fn run_background_social_baseline_refresh(
    context: &BackgroundTickContext<'_>,
    favorite_friend_groups_by_key: &mut HashMap<String, Vec<String>>,
) {
    context.background_jobs.mark_running(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Refreshing background friend and favorite facts.",
    );
    let Some(session) = background_capability_session(context.session_slot) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_FACTS_REFRESH_JOB,
            "Background social baseline refresh is waiting for an authenticated session.",
            BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
        );
        return;
    };
    let deps = SocialBaselineDeps {
        db: Arc::clone(context.db),
        web: Arc::clone(context.web),
        auth_scope: context.runtime_context.auth_scope.clone(),
        session: context.runtime_context.session.clone(),
    };
    let friend_output = build_friend_roster_baseline(
        deps.clone(),
        SocialFriendRosterBaselineInput {
            user_id: session.current_user_id.clone(),
            endpoint: session.endpoint.clone(),
            current_user_snapshot: RawJson::from(session.current_user_snapshot.clone()),
            explicit_add_intent_user_ids: Vec::new(),
        },
    )
    .await;
    let friend_count = match friend_output {
        Ok(output) => {
            if let Some(snapshot) = output.snapshot {
                let value = snapshot.into_value();
                let friends_value = value
                    .get("friendsById")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                if let Ok(friends_by_id) =
                    serde_json::from_value::<HashMap<String, FriendRecord>>(friends_value.clone())
                {
                    let count = friends_by_id.len();
                    context
                        .runtime_context
                        .overlay_activity
                        .set_friend_user_ids(friends_by_id.keys().cloned());
                    let _ = context.realtime_runtime.sync_friend_snapshot(
                        session.current_user_id.clone(),
                        session.endpoint.clone(),
                        session.websocket.clone(),
                        None,
                        friends_by_id,
                    );
                    if let Ok(favorites_output) = build_favorites_baseline(
                        deps,
                        SocialFavoritesBaselineInput {
                            user_id: session.current_user_id.clone(),
                            endpoint: session.endpoint.clone(),
                            current_user_snapshot: RawJson::from(
                                session.current_user_snapshot.clone(),
                            ),
                            friend_roster_by_id: RawJson::from(friends_value),
                        },
                    )
                    .await
                    {
                        if let Some(snapshot) = favorites_output.snapshot {
                            let groups =
                                favorite_group_membership_from_snapshot(snapshot.into_value());
                            context
                                .runtime_context
                                .overlay_activity
                                .set_favorite_groups(OverlayFavoriteGroups::from_map(
                                    groups.clone(),
                                ));
                            *favorite_friend_groups_by_key = groups;
                        }
                    }
                    count
                } else {
                    output.count
                }
            } else {
                output.count
            }
        }
        Err(error) => {
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(context.backend_runtime),
                error = %error,
                "GUI maintenance social baseline network request failed"
            );
            emit_background_error(
                context.runtime_context,
                context.backend_runtime,
                format!("social baseline refresh failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_FACTS_REFRESH_JOB, error.to_string());
            return;
        }
    };
    let detail = format!("friend and favorite facts refreshed: {friend_count} friends.");
    emit_background_info(
        context.runtime_context,
        context.backend_runtime,
        detail.clone(),
    );
    context
        .background_jobs
        .mark_completed(BACKGROUND_FACTS_REFRESH_JOB, detail);
    context.background_jobs.mark_scheduled(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Next background friend and favorite facts refresh is waiting.",
        BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
    );
}

async fn run_background_moderation_refresh(
    db: &Arc<DatabaseService>,
    web: &Arc<WebClient>,
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    background_jobs: &RuntimeBackgroundJobs,
) {
    background_jobs.mark_running(
        BACKGROUND_MODERATION_REFRESH_JOB,
        "Refreshing background moderation facts.",
    );
    let Some(session) = background_capability_session(session_slot) else {
        background_jobs.mark_scheduled(
            BACKGROUND_MODERATION_REFRESH_JOB,
            "Background moderation refresh is waiting for an authenticated session.",
            BACKGROUND_MODERATION_CADENCE_SECONDS,
        );
        return;
    };
    let deps = ModerationSyncDeps {
        db: db.as_ref(),
        web: web.as_ref(),
        session: &runtime_context.session,
        auth_scope: &runtime_context.auth_scope,
    };
    match refresh_player_moderations(
        deps,
        ModerationSyncRefreshInput {
            user_id: session.current_user_id,
            endpoint: session.endpoint,
        },
    )
    .await
    {
        Ok(output) => {
            let detail = format!(
                "moderation facts refreshed: {} local rows.",
                output.local_count
            );
            emit_background_info(runtime_context, backend_runtime, detail.clone());
            background_jobs.mark_completed(BACKGROUND_MODERATION_REFRESH_JOB, detail);
        }
        Err(error) => {
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(backend_runtime),
                error = %error,
                "GUI maintenance moderation network request failed"
            );
            emit_background_error(
                runtime_context,
                backend_runtime,
                format!("moderation refresh failed: {error}."),
            );
            background_jobs.mark_failed(BACKGROUND_MODERATION_REFRESH_JOB, error.to_string());
        }
    }
    background_jobs.mark_scheduled(
        BACKGROUND_MODERATION_REFRESH_JOB,
        "Next background moderation refresh is waiting.",
        BACKGROUND_MODERATION_CADENCE_SECONDS,
    );
}

fn background_presence_applied_detail(patch: &Value, matched_rule_count: usize) -> String {
    let fields = patch
        .as_object()
        .map(|object| {
            let mut fields = object.keys().cloned().collect::<Vec<_>>();
            fields.sort();
            fields.join(", ")
        })
        .filter(|fields| !fields.is_empty())
        .unwrap_or_else(|| "none".into());
    format!("presence automation applied: fields {fields}; matched rules {matched_rule_count}.")
}

fn update_backend_frontend_session_user_if_session_matches(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    expected: &BackgroundCapabilitySession,
    updated_user: &Value,
) -> bool {
    let Ok(mut slot) = session_slot.lock() else {
        return false;
    };
    if !session_slot_matches(Some(&slot), expected) {
        return false;
    }
    let Some(session) = slot.as_mut() else {
        return false;
    };
    let mut merged = session.current_user_snapshot.clone();
    if let (Some(target), Some(source)) = (merged.as_object_mut(), updated_user.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    } else {
        merged = updated_user.clone();
    }
    session.current_user_snapshot = merged;
    if let Some(display_name) =
        string_field(updated_user, "displayName").or_else(|| string_field(updated_user, "username"))
    {
        session.display_name = display_name;
    }
    true
}

fn update_backend_frontend_session_user_filtered_if_session_matches(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    expected: &BackgroundCapabilitySession,
    updated_user: &Value,
) -> bool {
    let mut filtered = updated_user.clone();
    remove_current_user_refresh_local_authority_fields(&mut filtered);
    update_backend_frontend_session_user_if_session_matches(session_slot, expected, &filtered)
}

fn replace_backend_frontend_session_user_if_session_matches(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    expected: &BackgroundCapabilitySession,
    snapshot: &Value,
) -> bool {
    let Ok(mut slot) = session_slot.lock() else {
        return false;
    };
    if !session_slot_matches(Some(&slot), expected) {
        return false;
    }
    let Some(session) = slot.as_mut() else {
        return false;
    };
    session.current_user_snapshot = snapshot.clone();
    if let Some(display_name) =
        string_field(snapshot, "displayName").or_else(|| string_field(snapshot, "username"))
    {
        session.display_name = display_name;
    }
    true
}

fn session_slot_matches(
    slot: Option<&Option<BackendRuntimeFrontendSessionSnapshot>>,
    expected: &BackgroundCapabilitySession,
) -> bool {
    slot.and_then(Option::as_ref)
        .map(|current| {
            current.user_id == expected.current_user_id
                && current.endpoint == expected.endpoint
                && current.websocket == expected.websocket
        })
        .unwrap_or(false)
}

fn remove_current_user_refresh_local_authority_fields(value: &mut Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    for field in CURRENT_USER_REFRESH_LOCAL_AUTHORITY_FIELDS {
        object.remove(*field);
    }
}

fn favorite_group_membership_from_snapshot(snapshot: Value) -> HashMap<String, Vec<String>> {
    let mut groups = HashMap::new();
    append_favorite_group_membership(
        &mut groups,
        snapshot.get("groupedFavoriteFriendIdsByGroupKey"),
        "",
    );
    append_favorite_group_membership(&mut groups, snapshot.get("localFriendFavorites"), "local:");
    groups
}

fn append_favorite_group_membership(
    groups: &mut HashMap<String, Vec<String>>,
    value: Option<&Value>,
    key_prefix: &str,
) {
    let Some(object) = value.and_then(Value::as_object) else {
        return;
    };
    for (group_key, user_ids) in object {
        let key = format!("{key_prefix}{group_key}");
        let user_ids: Vec<String> = user_ids
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|value| value.as_str().map(str::trim).map(str::to_string))
            .filter(|value| !value.is_empty())
            .collect();
        if !user_ids.is_empty() {
            groups.insert(key, user_ids);
        }
    }
}

struct ProfileLock {
    inner: Mutex<Option<ProfileLockGuard>>,
}

struct BackendStartGuard<'a> {
    flag: &'a AtomicBool,
}

impl<'a> BackendStartGuard<'a> {
    fn try_acquire(flag: &'a AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self { flag })
    }
}

impl Drop for BackendStartGuard<'_> {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Release);
    }
}

struct AtomicFlagGuard {
    flag: Arc<AtomicBool>,
}

impl AtomicFlagGuard {
    fn try_acquire(flag: &Arc<AtomicBool>) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self {
                flag: Arc::clone(flag),
            })
    }
}

impl Drop for AtomicFlagGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Release);
    }
}

struct ProfileLockGuard {
    path: PathBuf,
    _file: File,
}

impl ProfileLock {
    fn acquire(app_data: &Path) -> Result<Self> {
        std::fs::create_dir_all(app_data)?;
        let path = app_data.join(PROFILE_LOCK_FILE);
        let mut file = open_profile_lock_file(&path)?;
        let _ = file.set_len(0);
        let _ = writeln!(file, "{}", std::process::id());
        Ok(Self {
            inner: Mutex::new(Some(ProfileLockGuard { path, _file: file })),
        })
    }

    fn release(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.take();
        }
    }
}

impl Drop for ProfileLockGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(target_os = "windows")]
fn open_profile_lock_file(path: &Path) -> Result<File> {
    use std::os::windows::fs::OpenOptionsExt as _;

    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .share_mode(0)
        .open(path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::PermissionDenied {
                crate::Error::Custom(format!(
                    "VRCX-0 profile is already in use: {}",
                    path.display()
                ))
            } else {
                crate::Error::Io(error)
            }
        })
}

#[cfg(not(target_os = "windows"))]
fn open_profile_lock_file(path: &Path) -> Result<File> {
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(file) => Ok(file),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            if profile_lock_pid_is_stale(path) {
                let _ = std::fs::remove_file(path);
                return OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(path)
                    .map_err(crate::Error::Io);
            }
            Err(crate::Error::Custom(format!(
                "VRCX-0 profile is already in use: {}",
                path.display()
            )))
        }
        Err(error) => Err(crate::Error::Io(error)),
    }
}

#[cfg(not(target_os = "windows"))]
fn profile_lock_pid_is_stale(path: &Path) -> bool {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(pid) = contents.trim().parse::<u32>() else {
        return false;
    };
    if pid == std::process::id() {
        return false;
    }
    !vrcx_0_host::process_status::is_process_running(pid)
}

struct AuthenticatedRuntimeSession {
    user_id: String,
    display_name: String,
    endpoint: String,
    websocket: String,
    current_user: serde_json::Value,
}

#[derive(Default)]
struct BackendSocialBaseline {
    friends_by_id: HashMap<String, FriendRecord>,
    favorite_groups: HashMap<String, Vec<String>>,
}

impl AuthenticatedRuntimeSession {
    fn from_user(user: serde_json::Value, endpoint: String, websocket: String) -> Self {
        let user_id = string_field(&user, "id").unwrap_or_default();
        let display_name = string_field(&user, "displayName")
            .or_else(|| string_field(&user, "username"))
            .unwrap_or_else(|| user_id.clone());
        Self {
            user_id,
            display_name,
            endpoint: normalize_vrchat_api_endpoint(Some(&endpoint)),
            websocket: normalize_websocket_domain(&websocket),
            current_user: user,
        }
    }
}

enum NonInteractiveAuthError {
    InteractionRequired(String),
    SessionInvalidated { user_id: String, reason: String },
    Failed(String),
}

enum CookieSessionProbe {
    Authenticated(AuthenticatedRuntimeSession),
    Fallback,
}

fn response_allows_saved_credential_fallback(response: &HttpApiExecuteResponse) -> bool {
    response.status == 401
        && auth_response_error_message(response, String::new()).contains("Missing Credentials")
}

fn response_requires_two_factor(response: &HttpApiExecuteResponse) -> bool {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&response.data) else {
        return false;
    };
    json.get("requiresTwoFactorAuth")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|methods| !methods.is_empty())
}

fn auth_response_error_message(response: &HttpApiExecuteResponse, fallback: String) -> String {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&response.data) else {
        return fallback;
    };
    json.as_str()
        .map(ToOwned::to_owned)
        .or_else(|| string_field(&json, "message"))
        .or_else(|| {
            json.get("error").and_then(|error| {
                if let Some(message) = string_field(error, "message") {
                    Some(message)
                } else {
                    error.as_str().map(ToOwned::to_owned)
                }
            })
        })
        .unwrap_or(fallback)
}

fn parse_current_user_response(
    response: HttpApiExecuteResponse,
) -> std::result::Result<serde_json::Value, NonInteractiveAuthError> {
    let json = serde_json::from_str::<serde_json::Value>(&response.data)
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
    if json
        .get("requiresTwoFactorAuth")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|methods| !methods.is_empty())
    {
        return Err(NonInteractiveAuthError::InteractionRequired(
            "Re-authentication in the GUI is required because this account requires 2FA/OTP."
                .into(),
        ));
    }
    if !(200..=399).contains(&response.status) {
        let message = string_field(&json, "message")
            .or_else(|| {
                json.get("error")
                    .and_then(|value| value.as_str())
                    .map(ToOwned::to_owned)
            })
            .unwrap_or_else(|| {
                format!("VRChat auth request failed with HTTP {}.", response.status)
            });
        return Err(NonInteractiveAuthError::Failed(message));
    }
    if string_field(&json, "id").unwrap_or_default().is_empty() {
        return Err(NonInteractiveAuthError::Failed(
            "The auth request did not return a current user payload.".into(),
        ));
    }
    Ok(json)
}

fn string_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(|value| match value {
            serde_json::Value::String(value) => Some(value.trim().to_string()),
            serde_json::Value::Number(value) => Some(value.to_string()),
            serde_json::Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty())
}
