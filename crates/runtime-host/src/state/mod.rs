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
    telemetry::{TelemetryRuntime, TelemetryRuntimeDeps},
    vr_overlay::{
        start_preview_bridge_if_enabled, VrOverlayActivitySink, VrOverlayRuntime,
        VrOverlayRuntimeSnapshot, VR_OVERLAY_ENABLED_CONFIG_KEY,
    },
    GameClientHostRuntime, GameLogEventSink, GameLogHostRuntime, HostFileAccess,
    HostGameLogEventFanout, HostLogLocationSnapshotScanner, HostRegistryBackupActions, LogWatcher,
    Result, RuntimeHostContext, RuntimeHostEventSink,
};
use vrcx_0_application::{
    auth_response_error_message, build_background_discord_presence_command,
    build_background_presence_facts, build_favorites_baseline, build_friend_roster_baseline,
    current_user_from_cookie, parse_current_user_response, probe_current_user_from_cookie,
    record_login_success, record_logout, refresh_background_current_user,
    refresh_background_group_instances, refresh_player_moderations,
    run_background_presence_automation, saved_credential_login_start, saved_snapshot,
    AuthenticatedRuntimeSession, BackendRuntime, BackendRuntimeMode, BackendRuntimePhase,
    BackendRuntimeSnapshot, BackendRuntimeTelemetry, BackgroundCapabilitySession,
    BackgroundDiscordPresenceCommand, BackgroundDiscordPresenceState,
    BackgroundPresenceAutomationState, BackgroundPresenceFactsInput, CookieSessionProbe,
    FriendProjection, GameProcessEvent, GameProcessEventSink, ImageCache, LoginSuccessRecordInput,
    LogoutRecordInput, ModerationSyncDeps, ModerationSyncRefreshInput, NonInteractiveAuthError,
    OverlayActivitySnapshot, OverlayFavoriteGroups, PrintCleanupDeps, PrintCleanupTrigger,
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
use vrcx_0_vrchat_client::http_api::normalize_vrchat_api_endpoint;

mod auth_session;
mod background;
mod background_ticks;
mod capabilities;
mod frontend_session;
mod profile_lock;
mod services;
mod startup;

use auth_session::{string_field, BackendSocialBaseline};
use background::{
    background_capability_session, background_capability_session_matches, emit_background_error,
    emit_background_info, emit_background_info_if_changed, gui_maintenance_runtime_mode,
    read_group_order,
};
use background_ticks::{
    run_background_current_user_refresh, run_background_discord_tick,
    run_background_group_instance_refresh, run_background_moderation_refresh,
    run_background_presence_tick, run_background_print_cleanup,
    run_background_social_baseline_refresh, BackgroundTickContext,
};
use frontend_session::{
    favorite_group_membership_from_snapshot,
    replace_backend_frontend_session_user_if_session_matches, session_slot_matches,
    update_backend_frontend_session_user_filtered_if_session_matches,
    update_backend_frontend_session_user_if_session_matches,
};
use profile_lock::{AtomicFlagGuard, BackendStartGuard, ProfileLock};
const SAVED_CREDENTIALS_KEY: &str = "savedCredentials";
const PROFILE_LOCK_FILE: &str = "runtime.lock";
const REGISTRY_BACKUP_MAINTENANCE_JOB: &str = "registryBackupMaintenance";
const REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS: u64 = 3 * 60 * 60;
const BACKGROUND_PRESENCE_AUTOMATION_JOB: &str = "backgroundPresenceAutomation";
const BACKGROUND_DISCORD_PRESENCE_JOB: &str = "backgroundDiscordPresence";
const BACKGROUND_FACTS_REFRESH_JOB: &str = "backgroundFactsRefresh";
const BACKGROUND_MODERATION_REFRESH_JOB: &str = "backgroundModerationRefresh";
const BACKGROUND_PRINT_CLEANUP_JOB: &str = "printAutoCleanup";
const BACKGROUND_PRESENCE_CADENCE_SECONDS: u64 = 3;
const BACKGROUND_DISCORD_CADENCE_SECONDS: u64 = 3;
const BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS: u64 = 300;
const BACKGROUND_CURRENT_USER_CADENCE_SECONDS: u64 = 300;
const BACKGROUND_OVERLAY_ACTIVITY_CONFIG_CADENCE_SECONDS: u64 = 5;
const BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS: u64 = 3_600;
const BACKGROUND_MODERATION_CADENCE_SECONDS: u64 = 3_600;
const BACKGROUND_PRINT_CLEANUP_CADENCE_SECONDS: u64 = 30 * 60;
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
    pub app_version: String,
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
            app_version,
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
        let web = Arc::new(WebClient::new(
            &storage,
            &db,
            realtime_origin,
            &app_version,
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
