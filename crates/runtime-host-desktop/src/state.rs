use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use vrcx_0_application_core::RuntimeOperationStatus;

use crate::app_launcher::start_app_launcher_snapshot_events;
use crate::avatar::DesktopAvatarRuntime;
use crate::context::DesktopRuntimeServicesDeps;
use crate::data_dir::DesktopDataDirRuntime;
use crate::external_api::ExternalApiRuntime;
use crate::group::DesktopGroupRuntime;
use crate::integration_api::DesktopIntegrationApiRuntime;
use crate::legacy_migration::cleanup_legacy_updater_files;
use crate::local_data::LocalDataRuntime;
use crate::media::DesktopMediaRuntime;
use crate::privacy_lock::PrivacyLockRuntime;
use crate::profile_backup::DesktopProfileBackupRuntime;
use crate::screenshot::DesktopScreenshotRuntime;
use crate::social::DesktopSocialRuntime;
use crate::vr_overlay::DesktopVrOverlayRuntime;
use crate::{
    DesktopDatabaseUpgradeRuntime, DesktopLegacyMigrationRuntime, DesktopRuntimeServices,
    GameClientHostRuntime, GameLogHostRuntime, HostFileAccess, HostGameProcessMonitorActions,
    HostRegistryBackupActions, LogWatcher,
};
use vrcx_0_application::auth::VrchatConfigRuntime;
use vrcx_0_application::game::InstanceLaunchRuntime;
use vrcx_0_application::profile::{
    AppUpdateBuildInfo, AppUpdateRuntime, BackgroundImageService, CommunityThemeService,
};
use vrcx_0_application::remote::{VrchatRemoteFacade, WorldRemoteRuntime};
use vrcx_0_application::social::CurrentUserMutationRuntime;
use vrcx_0_application::telemetry::TelemetryRuntime;
use vrcx_0_application_core::{
    BackendRuntimeMode, BackendRuntimePhase, BackendRuntimeStatusPublisher,
    BackendRuntimeTelemetryKind, ConfigStore, GameProcessEvent, GameProcessEventSink,
    RuntimeTaskExecutor, SessionHostRuntime, TaskStopToken,
};
use vrcx_0_application_game::{
    ProcessMonitor, RegistryBackupMaintenanceMode, RegistryBackupMaintenanceResult,
};
use vrcx_0_composition::{
    Result, RuntimeHostDesktopAssemblyDeps, RuntimeHostOptions, RuntimeHostProfile,
    RuntimeHostProfileExtension, RuntimeHostState, RuntimeHostStateBuilder,
};
use vrcx_0_contracts::InstanceRosterObserver;
use vrcx_0_host_desktop::auto_launch::AutoAppLaunchManager;
use vrcx_0_host_desktop::discord_rpc::DiscordRpc;
use vrcx_0_host_desktop::host_capabilities::{
    current_host_capabilities, is_host_capability_available, HostCapability,
};
use vrcx_0_persistence::screenshot_cache::MetadataCacheDb;
use vrcx_0_platform::app_paths::AppDataDirResolution;

mod app_update;
mod appearance;
mod assembly;
mod auth;
mod automation;
mod background_ticks;
mod collections;
mod config;
mod favorites;
mod friends;
mod game;
mod host_files;
mod lifecycle;
mod notifications;
mod registry_backup;
mod social_ops;
mod telemetry;

use background_ticks::{
    run_background_discord_tick, run_background_presence_tick, BackgroundTickContext,
    DiscordPresenceLabelCache, BACKGROUND_DISCORD_CADENCE_SECONDS, BACKGROUND_DISCORD_PRESENCE_JOB,
    BACKGROUND_PRESENCE_AUTOMATION_JOB, BACKGROUND_PRESENCE_CADENCE_SECONDS,
};

const USER_GENERATED_CONTENT_PATH_CONFIG_KEY: &str = "userGeneratedContentPath";
const REGISTRY_BACKUP_MAINTENANCE_JOB: &str = "registryBackupMaintenance";
const REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS: u64 = 3 * 60 * 60;
const REGISTRY_BACKUP_FOREGROUND_REUSE_WINDOW: Duration = Duration::from_secs(60);
const DESKTOP_MAINTENANCE_STOP_POLL_INTERVAL: Duration = Duration::from_millis(50);
const SHARE_EDITOR_ORIGIN: &str = "https://worlds.vrcx-0.dev";

pub(crate) fn build_desktop_runtime_services_deps(
    context: &RuntimeHostDesktopAssemblyDeps,
) -> DesktopRuntimeServicesDeps {
    DesktopRuntimeServicesDeps {
        db: Arc::clone(context.database()),
        web: Arc::clone(context.web_client()),
        image_cache: Arc::clone(context.image_cache()),
        config: context.config_store(),
        notification_resolver: context.notification_resolver(),
        auth_credentials: context.auth_credentials_shared(),
        auth_scope: context.auth_scope().clone(),
        session: context.session().clone(),
        world_cache: Arc::clone(context.world_cache()),
        tasks: context.tasks().clone(),
        event_bus: context.event_bus().clone(),
        activity_router: context.activity_router(),
        activity_sinks: context.activity_sink_registry(),
        notification_projection_observers: context
            .realtime_notification_projection_observer_registry(),
        notification_do_not_disturb_slot: context.notification_do_not_disturb_slot(),
    }
}

#[derive(Clone, Debug, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeJobRecordInput {
    pub name: String,
    #[serde(default = "default_frontend_owner")]
    pub owner: String,
    #[serde(default)]
    pub cadence_seconds: Option<u64>,
    pub status: RuntimeOperationStatus,
    #[serde(default)]
    pub detail: String,
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CurrentUserRefreshOutcome {
    pub applied: bool,
}

fn default_frontend_owner() -> String {
    "frontend".into()
}

pub struct DesktopRuntimeHostOptions {
    pub realtime_origin: String,
    pub launched_from_autostart: bool,
    pub app_data_dir: AppDataDirResolution,
    pub app_version: String,
    pub app_update_build_label: String,
    pub app_update_build_badge: String,
    pub app_update_check_disabled: bool,
    pub updater_port: Arc<dyn vrcx_0_application_core::UpdaterPort>,
    pub database_maintenance_cache_dir: Option<PathBuf>,
    pub task_executor: Arc<dyn RuntimeTaskExecutor>,
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
    pub desktop_widget: Arc<crate::desktop_widget::DesktopWidget>,
    pub app_update: AppUpdateRuntime,
    pub telemetry: TelemetryRuntime,
    pub feed_logger: Arc<crate::feed_logger::DesktopFeedLoggerRuntime>,
    pub background_image: BackgroundImageService,
    pub community_theme: CommunityThemeService,
    pub integration_api: Arc<DesktopIntegrationApiRuntime>,
    pub integration_api_observer: Arc<dyn InstanceRosterObserver>,
}

pub struct DesktopRuntimeHostState {
    runtime: RuntimeHostState,
    game: Arc<GameRuntimeBundle>,
    desktop: Arc<DesktopRuntimeBundle>,
    extension: Arc<DesktopRuntimeProfileExtension>,
    current_user_mutations: CurrentUserMutationRuntime,
    avatars: DesktopAvatarRuntime,
    instance_launch: InstanceLaunchRuntime,
    local_data: LocalDataRuntime,
    data_dir: DesktopDataDirRuntime,
    profile_backup: DesktopProfileBackupRuntime,
    external_api: ExternalApiRuntime,
    groups: DesktopGroupRuntime,
    social: DesktopSocialRuntime,
    media: DesktopMediaRuntime,
    screenshots: DesktopScreenshotRuntime,
    vrchat_remote: VrchatRemoteFacade,
    worlds: WorldRemoteRuntime,
    vrchat_config: VrchatConfigRuntime,
    database_upgrade: DesktopDatabaseUpgradeRuntime,
    legacy_migration: DesktopLegacyMigrationRuntime,
    world_collections: vrcx_0_outbound_adapters::LocalWorldCollectionAdapter,
    friend_log_name_store: vrcx_0_outbound_adapters::LocalFriendLogNameStore,
    notification_sync: vrcx_0_outbound_adapters::LocalNotificationSyncAdapter,
    favorite_details: vrcx_0_application::favorites::FavoriteDetailsRuntime,
    quick_search: vrcx_0_application::social::QuickSearchRuntime,
    group_membership_batches: vrcx_0_application::social::GroupMembershipBatchCoordinator,
    group_moderation_batches: vrcx_0_application::social::GroupModerationBatchCoordinator,
    friend_log_name_resolutions: vrcx_0_application::social::FriendLogNameResolutionCoordinator,
    user_dialog_tab_counts: vrcx_0_application::social::UserDialogTabCountsRuntime,
    user_dialog_tab_counts_source: Arc<vrcx_0_outbound_adapters::LocalUserDialogTabCountsSource>,
    vrchat_requests: vrcx_0_outbound_adapters::VrchatRequestAdapter,
    world_names: vrcx_0_outbound_adapters::CachedWorldNameResolver,
    translation: vrcx_0_outbound_adapters::LocalTranslationAdapter,
    webhook_transport: vrcx_0_outbound_adapters::LocalNotificationWebhookTransport,
}

struct DesktopRuntimeProfileExtension {
    game: Arc<GameRuntimeBundle>,
    desktop: Arc<DesktopRuntimeBundle>,
    registry_backup_maintenance_running: Arc<AtomicBool>,
    desktop_maintenance_running: Arc<AtomicBool>,
    background_image_started: AtomicBool,
    app_launcher_events_started: AtomicBool,
    discord_reconcile_generation: Arc<AtomicU64>,
    registry_backup_state: Arc<Mutex<RegistryBackupMaintenanceState>>,
    presence_state_path: PathBuf,
}

#[derive(Default)]
struct RegistryBackupMaintenanceState {
    last_completed: Option<CompletedRegistryBackupMaintenance>,
}

struct CompletedRegistryBackupMaintenance {
    completed_at: Instant,
    mode: RegistryBackupMaintenanceMode,
    result: RegistryBackupMaintenanceResult,
}

struct VrOverlayProcessSink {
    runtime: Arc<DesktopVrOverlayRuntime>,
}

impl GameProcessEventSink for VrOverlayProcessSink {
    fn on_game_process_event(
        &self,
        event: GameProcessEvent,
    ) -> vrcx_0_application_core::Result<()> {
        self.runtime.on_game_process_event(event)
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
            app_update_check_disabled,
            updater_port,
            database_maintenance_cache_dir,
            task_executor,
        } = options;
        let builder = RuntimeHostStateBuilder::new(RuntimeHostOptions {
            realtime_origin,
            launched_from_autostart,
            app_data_dir,
            app_version: app_version.clone(),
            profile: RuntimeHostProfile::Desktop,
            database_maintenance_cache_dir,
            task_executor: Some(task_executor),
        })?;
        cleanup_legacy_updater_files(&builder.paths().app_data);
        let wiring = assembly::desktop::build_desktop_wiring(&builder, &app_version)?;
        let game_log_runtime = assembly::game::build_game_log_runtime(&builder, &wiring);
        let vr_overlay_runtime =
            Arc::new(DesktopVrOverlayRuntime::new(Arc::clone(&wiring.services))?);
        let desktop_widget = Arc::new(crate::desktop_widget::DesktopWidget::new(&wiring.services));
        let game = assembly::game::build_game_runtime(&builder, &wiring, game_log_runtime)?;
        let desktop = assembly::desktop::build_desktop_runtime(
            &builder,
            &wiring,
            vr_overlay_runtime,
            desktop_widget,
            AppUpdateBuildInfo {
                app_version,
                build_label: app_update_build_label,
                build_badge: app_update_build_badge,
                update_check_disabled: app_update_check_disabled,
            },
            updater_port,
        );
        let extension = assembly::build_profile_extension(&builder, &game, &desktop);
        let composition =
            assembly::build_runtime_composition(&builder, &wiring, Arc::clone(&extension));
        let runtime = builder.finish(composition)?;
        assembly::bind_realtime_runtime(&runtime, &wiring);
        let remote = assembly::remote::build_remote_runtimes(
            &runtime,
            &desktop.host_file_access,
            &desktop.telemetry,
        );
        let local = assembly::local::build_local_runtimes(
            &runtime,
            &game,
            &desktop,
            &wiring.profile_config,
        );
        assembly::desktop::attach_desktop_realtime(
            &runtime,
            &desktop,
            wiring.integration_api_input,
        );

        Ok(Self {
            runtime,
            game,
            desktop,
            extension,
            current_user_mutations: remote.current_user_mutations,
            avatars: remote.avatars,
            instance_launch: remote.instance_launch,
            local_data: local.local_data,
            data_dir: local.data_dir,
            profile_backup: local.profile_backup,
            external_api: remote.external_api,
            groups: remote.groups,
            social: remote.social,
            media: remote.media,
            screenshots: local.screenshots,
            vrchat_remote: remote.vrchat_remote,
            worlds: remote.worlds,
            vrchat_config: remote.vrchat_config,
            database_upgrade: local.database_upgrade,
            legacy_migration: local.legacy_migration,
            world_collections: local.world_collections,
            friend_log_name_store: local.friend_log_name_store,
            notification_sync: local.notification_sync,
            favorite_details: remote.favorite_details,
            quick_search: remote.quick_search,
            group_membership_batches: remote.group_membership_batches,
            group_moderation_batches: remote.group_moderation_batches,
            friend_log_name_resolutions: local.friend_log_name_resolutions,
            user_dialog_tab_counts: local.user_dialog_tab_counts,
            user_dialog_tab_counts_source: local.user_dialog_tab_counts_source,
            vrchat_requests: remote.vrchat_requests,
            world_names: remote.world_names,
            translation: local.translation,
            webhook_transport: remote.webhook_transport,
        })
    }

    pub fn tts_engine(&self) -> Arc<dyn vrcx_0_host_desktop::tts::TtsEngine> {
        self.desktop.services.tts()
    }

    pub async fn leave_feed_logger(&self) {
        self.desktop.feed_logger.leave().await;
    }

    pub fn feed_logger(&self) -> &Arc<crate::feed_logger::DesktopFeedLoggerRuntime> {
        &self.desktop.feed_logger
    }

    pub fn integration_api(&self) -> &DesktopIntegrationApiRuntime {
        &self.desktop.integration_api
    }

    pub fn instance_launch(&self) -> &InstanceLaunchRuntime {
        &self.instance_launch
    }

    pub fn current_user_mutations(&self) -> &CurrentUserMutationRuntime {
        &self.current_user_mutations
    }

    pub fn avatars(&self) -> &DesktopAvatarRuntime {
        &self.avatars
    }

    pub fn worlds(&self) -> &WorldRemoteRuntime {
        &self.worlds
    }

    pub fn vrchat_remote(&self) -> &VrchatRemoteFacade {
        &self.vrchat_remote
    }

    pub fn local_data(&self) -> &LocalDataRuntime {
        &self.local_data
    }

    pub fn data_dir(&self) -> &DesktopDataDirRuntime {
        &self.data_dir
    }

    pub fn profile_backup(&self) -> &DesktopProfileBackupRuntime {
        &self.profile_backup
    }

    pub fn groups(&self) -> &DesktopGroupRuntime {
        &self.groups
    }

    pub fn social(&self) -> &DesktopSocialRuntime {
        &self.social
    }

    pub fn database_upgrade(&self) -> &DesktopDatabaseUpgradeRuntime {
        &self.database_upgrade
    }

    pub fn legacy_migration(&self) -> &DesktopLegacyMigrationRuntime {
        &self.legacy_migration
    }

    pub fn mcp_runtime(&self, caller: vrcx_0_mcp::McpCaller) -> vrcx_0_mcp::McpRuntime {
        mcp_runtime_for(&self.runtime, self.mcp_chatbox(), caller)
    }

    pub fn assistant_controller_deps(&self) -> vrcx_0_assistant::AssistantControllerDeps {
        assistant_controller_deps_for(&self.runtime, self.mcp_chatbox())
    }

    fn mcp_chatbox(&self) -> vrcx_0_mcp::McpChatbox {
        Arc::new(crate::mcp_adapters::DesktopMcpChatboxAdapter::new(
            self.chatbox(),
        ))
    }

    pub fn external_api(&self) -> &ExternalApiRuntime {
        &self.external_api
    }

    pub fn media(&self) -> &DesktopMediaRuntime {
        &self.media
    }

    pub fn screenshots(&self) -> &DesktopScreenshotRuntime {
        &self.screenshots
    }

    pub fn vrchat_config(&self) -> &VrchatConfigRuntime {
        &self.vrchat_config
    }

    pub fn chatbox(&self) -> Arc<crate::chatbox::ChatboxRuntime> {
        self.desktop.services.chatbox()
    }

    pub fn heart_rate(&self) -> Arc<crate::heart_rate::HeartRateRuntime> {
        self.desktop.services.heart_rate()
    }

    pub fn desktop_widget(&self) -> Arc<crate::desktop_widget::DesktopWidget> {
        Arc::clone(&self.desktop.desktop_widget)
    }

    pub fn privacy_lock(&self) -> Arc<PrivacyLockRuntime> {
        self.desktop.services.privacy_lock()
    }
}

impl RuntimeHostProfileExtension for DesktopRuntimeProfileExtension {
    fn start_profile_services(&self, state: &RuntimeHostState) {
        self.start_desktop_services(state);
        self.start_game_services(state);
    }

    fn stop_profile_services(&self) {
        if let Err(error) = self.desktop.discord_rpc.clear() {
            tracing::warn!(error = %error, "Discord presence cleanup failed while stopping desktop services");
        }
        self.desktop.vr_overlay_runtime.stop_detached();
        self.game.game_log_runtime.stop();
        self.game.process_monitor.stop();
        self.game.log_watcher.stop();
        self.game.game_client_runtime.stop();
        self.desktop.integration_api_observer.on_game_running(false);
    }

    fn start_profile_maintenance(&self, state: &RuntimeHostState) {
        self.start_registry_backup_loop(state);
        self.start_desktop_maintenance_loops(state);
        let feed_logger = &self.desktop.feed_logger;
        let check = Arc::clone(feed_logger);
        state
            .realtime_runtime()
            .set_reconnect_backfill_check(Arc::new(move || check.recorder_may_be_recording()));
        feed_logger.start_presence_loop(
            state.backend_runtime().clone(),
            state.desktop_assembly().auth_scope().clone(),
            state.desktop_assembly().tasks().clone(),
        );
    }
}

impl DesktopRuntimeProfileExtension {
    fn start_desktop_services(&self, state: &RuntimeHostState) {
        self.desktop
            .app_update
            .start_loop(state.desktop_assembly().tasks().clone());
        self.desktop
            .services
            .heart_rate()
            .start(state.desktop_assembly().tasks());
        if !self
            .app_launcher_events_started
            .swap(true, Ordering::AcqRel)
        {
            start_app_launcher_snapshot_events(
                self.game.auto_launch.clone(),
                state.desktop_assembly().event_bus().clone(),
                state.desktop_assembly().tasks().clone(),
            );
        }
        if self.background_image_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let background_image = self.desktop.background_image.clone();
        let community_theme = self.desktop.community_theme.clone();
        state
            .desktop_assembly()
            .tasks()
            .spawn_cancellable(move |stop_token| async move {
                if let Err(error) = community_theme.initialize().await {
                    tracing::warn!(error = %error, "failed to initialize community theme runtime");
                }
                let background_image_runtime = async {
                    if let Err(error) = background_image.initialize().await {
                        tracing::warn!(error = %error, "failed to initialize background image runtime");
                    }
                    background_image.run_rotation_loop(stop_token).await;
                };
                tokio::join!(community_theme.check_for_updates(), background_image_runtime);
            });
    }

    fn start_game_services(&self, state: &RuntimeHostState) {
        let capabilities = current_host_capabilities();
        tracing::info!(platform = %capabilities.platform, "host capabilities resolved");
        self.start_log_watcher_for_current_platform(state, &capabilities);
        if is_host_capability_available(HostCapability::GameProcessMonitor) {
            let vr_overlay_process_sink: Arc<dyn GameProcessEventSink> =
                Arc::new(VrOverlayProcessSink {
                    runtime: Arc::clone(&self.desktop.vr_overlay_runtime),
                });
            let do_not_disturb_process_sink: Arc<dyn GameProcessEventSink> =
                Arc::new(self.desktop.services.notification_do_not_disturb());
            let game_process_sinks: Vec<Arc<dyn GameProcessEventSink>> = vec![
                self.game.session_runtime.clone(),
                self.game.game_log_runtime.clone(),
                self.game.game_client_runtime.clone(),
                state.realtime_runtime().clone(),
                vr_overlay_process_sink,
                do_not_disturb_process_sink,
            ];
            self.game.process_monitor.start(
                HostGameProcessMonitorActions::new(self.game.auto_launch.clone()),
                self.game.log_watcher.clone(),
                game_process_sinks,
            );
            state
                .desktop_assembly()
                .background_jobs()
                .mark_running("gameProcessMonitor", "Game process monitor is active.");
        } else {
            state.desktop_assembly().background_jobs().register_job(
                "gameProcessMonitor",
                "rust-host",
                None,
                RuntimeOperationStatus::Unavailable,
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
            let Some(local_low) = vrcx_0_host_desktop::vrchat_paths::windows_vrchat_app_data()
            else {
                state.desktop_assembly().background_jobs().register_job(
                    "gameLogWatcher",
                    "rust-host",
                    None,
                    RuntimeOperationStatus::Unavailable,
                    "LOCALAPPDATA is not set, so the VRChat log folder cannot be located.",
                );
                emit_game_log_watcher_status(
                    state,
                    vrcx_0_application_core::BackendRuntimeGameLogStatus::Unavailable,
                );
                return;
            };
            if let Err(error) = self
                .game
                .game_log_runtime
                .prime_log_watcher(&self.game.log_watcher)
            {
                tracing::warn!("failed to prime GameLog watcher from runtime DB: {error}");
            }
            self.game.log_watcher.start(local_low);
            state
                .desktop_assembly()
                .background_jobs()
                .mark_running("gameLogWatcher", "Windows GameLog watcher is active.");
            emit_game_log_watcher_status(
                state,
                vrcx_0_application_core::BackendRuntimeGameLogStatus::Running,
            );
        }
        #[cfg(target_os = "windows")]
        if !is_host_capability_available(HostCapability::GameLogWatcher) {
            state.desktop_assembly().background_jobs().register_job(
                "gameLogWatcher",
                "rust-host",
                None,
                RuntimeOperationStatus::Unavailable,
                "GameLog watcher capability is unavailable.",
            );
            emit_game_log_watcher_status(
                state,
                vrcx_0_application_core::BackendRuntimeGameLogStatus::Unavailable,
            );
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
                        .desktop_assembly()
                        .background_jobs()
                        .mark_running("gameLogWatcher", "Linux GameLog watcher is active.");
                    emit_game_log_watcher_status(
                        state,
                        vrcx_0_application_core::BackendRuntimeGameLogStatus::Running,
                    );
                }
                Err(reason) => {
                    state.desktop_assembly().background_jobs().register_job(
                        "gameLogWatcher",
                        "rust-host",
                        None,
                        RuntimeOperationStatus::Unavailable,
                        reason,
                    );
                    emit_game_log_watcher_status(
                        state,
                        vrcx_0_application_core::BackendRuntimeGameLogStatus::Unavailable,
                    );
                }
            }
        }
        #[cfg(target_os = "linux")]
        if !is_host_capability_available(HostCapability::GameLogWatcher) {
            state.desktop_assembly().background_jobs().register_job(
                "gameLogWatcher",
                "rust-host",
                None,
                RuntimeOperationStatus::Unavailable,
                _capabilities
                    .game_log_watcher
                    .reason
                    .clone()
                    .unwrap_or_else(|| "GameLog watcher capability is unavailable.".into()),
            );
            emit_game_log_watcher_status(
                state,
                vrcx_0_application_core::BackendRuntimeGameLogStatus::Unavailable,
            );
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            let _ = _capabilities;
            state.desktop_assembly().background_jobs().register_job(
                "gameLogWatcher",
                "rust-host",
                None,
                RuntimeOperationStatus::Unavailable,
                "GameLog watcher is unavailable on this platform.",
            );
            emit_game_log_watcher_status(
                state,
                vrcx_0_application_core::BackendRuntimeGameLogStatus::Unavailable,
            );
        }
    }

    fn start_registry_backup_loop(&self, state: &RuntimeHostState) {
        let current = state.backend_runtime().snapshot();
        if current.mode != BackendRuntimeMode::Background
            || current.phase != BackendRuntimePhase::Running
        {
            return;
        }
        if !is_host_capability_available(HostCapability::RegistryPrefs) {
            state.desktop_assembly().background_jobs().register_job(
                REGISTRY_BACKUP_MAINTENANCE_JOB,
                "rust-host",
                Some(REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS),
                RuntimeOperationStatus::Unavailable,
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
        state.desktop_assembly().background_jobs().register_job(
            REGISTRY_BACKUP_MAINTENANCE_JOB,
            "rust-host",
            Some(REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS),
            RuntimeOperationStatus::Scheduled,
            "Registry backup maintenance is scheduled for background mode.",
        );
        let backend_runtime = state.backend_runtime().clone();
        let desktop_assembly = state.desktop_assembly().clone();
        let background_jobs = state.desktop_assembly().background_jobs().clone();
        let running = Arc::clone(&self.registry_backup_maintenance_running);
        let registry_backup_state = Arc::clone(&self.registry_backup_state);
        let store = state.desktop_assembly().config_store();
        state.desktop_assembly().tasks().spawn_cancellable_thread(
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
                    let result = match registry_backup_state.lock() {
                        Ok(mut state) => run_coordinated_registry_backup_maintenance(
                            &mut state,
                            Instant::now(),
                            RegistryBackupMaintenanceMode::Silent,
                            || {
                                vrcx_0_application_game::registry_backup_maintenance_run(
                                    store.as_ref(),
                                    &HostRegistryBackupActions,
                                    RegistryBackupMaintenanceMode::Silent,
                                    "background-mode",
                                )
                            },
                            || {
                                vrcx_0_application_game::registry_backup_foreground_followup(
                                    store.as_ref(),
                                    &HostRegistryBackupActions,
                                )
                            },
                        ),
                        Err(error) => Err(vrcx_0_application_core::Error::Custom(format!(
                            "registry backup lock poisoned: {error}"
                        ))),
                    };
                    match result {
                        Ok(result) => {
                            if result.auto_backup_created {
                                emit_profile_background_info(
                                    &desktop_assembly,
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
                                &desktop_assembly,
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
        let session_slot = state.authenticated_session_projection_handle();
        if !is_authenticated_maintenance_active(state, &session_slot) {
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
            state.desktop_assembly().background_jobs().register_job(
                name,
                "rust-host",
                Some(cadence),
                RuntimeOperationStatus::Scheduled,
                detail,
            );
        }
        let db = Arc::clone(state.database());
        let web = Arc::clone(state.web_client());
        let world_cache = Arc::clone(state.desktop_assembly().world_cache());
        let backend_runtime = state.backend_runtime().clone();
        let background_jobs = state.desktop_assembly().background_jobs().clone();
        let running = Arc::clone(&self.desktop_maintenance_running);
        let realtime_runtime = Arc::clone(state.realtime_runtime());
        let authenticated_runtime = state.authenticated_runtime().clone();
        let host_session = state.desktop_assembly().session().clone();
        let config_store = state.desktop_assembly().config_store();
        let auth_scope = state.desktop_assembly().auth_scope().clone();
        let remote_mutations = Arc::clone(state.desktop_assembly().remote_mutations());
        let event_bus = state.desktop_assembly().event_bus().clone();
        let desktop_services = Arc::clone(&self.desktop.services);
        let discord_rpc = Arc::clone(&self.desktop.discord_rpc);
        let discord_reconcile_generation = Arc::clone(&self.discord_reconcile_generation);
        let presence_state_path = self.presence_state_path.clone();
        state.desktop_assembly()
            .tasks()
            .spawn_cancellable(move |stop_token| async move {
                let mut presence_state =
                    vrcx_0_application_game::BackgroundPresenceAutomationState::load_cached(
                        &presence_state_path,
                    );
                let mut presence_state_serialized =
                    serde_json::to_string(&presence_state).unwrap_or_default();
                let mut discord_state =
                    vrcx_0_application_game::BackgroundDiscordPresenceState::default();
                let mut discord_label_cache = DiscordPresenceLabelCache::default();
                let mut last_discord_output: Option<String> = None;
                let mut next_presence = Instant::now();
                let mut next_discord = Instant::now();
                let mut overlay_activity_config_generation = None;
                let mut observed_discord_reconcile_generation =
                    discord_reconcile_generation.load(Ordering::Acquire);
                let mut active_scope_key =
                    vrcx_0_application::auth::background_capability_session_scope_key(&session_slot).unwrap_or_default();
                loop {
                    if stop_token.is_stop_requested()
                        || !is_authenticated_maintenance_active_parts(
                            &backend_runtime,
                            &auth_scope,
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
                        vrcx_0_application::auth::background_capability_session_scope_key(&session_slot).unwrap_or_default();
                    if scope_key != active_scope_key {
                        active_scope_key = scope_key;
                        presence_state =
                            vrcx_0_application_game::BackgroundPresenceAutomationState::default();
                        discord_state =
                            vrcx_0_application_game::BackgroundDiscordPresenceState::default();
                        last_discord_output = None;
                        next_presence = now;
                        next_discord = now;
                        overlay_activity_config_generation = None;
                    }
                    let config_generation = config_store.write_generation();
                    if overlay_activity_config_generation != Some(config_generation) {
                        desktop_services.reload_overlay_activity_filters();
                        overlay_activity_config_generation = Some(config_generation);
                    }
                    let tick_context = BackgroundTickContext {
                        db: &db,
                        web: &web,
                        world_cache: &world_cache,
                        session_slot: &session_slot,
                        realtime_runtime: &realtime_runtime,
                        host_session: &host_session,
                        config_store: &config_store,
                        auth_scope: &auth_scope,
                        remote_mutations: &remote_mutations,
                        event_bus: &event_bus,
                        desktop_services: &desktop_services,
                        backend_runtime: &backend_runtime,
                        background_jobs: &background_jobs,
                    };
                    let run_presence = now >= next_presence;
                    let run_discord = now >= next_discord;
                    if run_presence || run_discord {
                        let favorite_group_memberships = authenticated_runtime
                            .favorite_group_memberships()
                            .unwrap_or_default();
                        let friend_user_ids = realtime_runtime.friend_user_ids_snapshot();
                        if run_presence {
                            run_background_presence_tick(
                                &tick_context,
                                &mut presence_state,
                                &friend_user_ids,
                                &favorite_group_memberships.friend_groups_by_key,
                                &favorite_group_memberships.world_groups_by_key,
                            )
                            .await;
                            presence_state.persist_cached(
                                &presence_state_path,
                                &mut presence_state_serialized,
                            );
                            next_presence =
                                now + Duration::from_secs(BACKGROUND_PRESENCE_CADENCE_SECONDS);
                        }
                        if run_discord {
                            let labels = discord_label_cache.get(config_store.as_ref());
                            run_background_discord_tick(
                                &tick_context,
                                &discord_rpc,
                                &mut discord_state,
                                &mut last_discord_output,
                                labels.as_ref(),
                                &friend_user_ids,
                                &favorite_group_memberships.friend_groups_by_key,
                            )
                            .await;
                            next_discord =
                                now + Duration::from_secs(BACKGROUND_DISCORD_CADENCE_SECONDS);
                        }
                    }
                    let chatbox = desktop_services.chatbox();
                    if let Err(error) = tokio::task::spawn_blocking(move || {
                        chatbox.tick();
                    })
                    .await
                    {
                        tracing::warn!(error = %error, "chatbox tick task failed");
                    }
                    if wait_for_desktop_maintenance_tick(&stop_token).await {
                        break;
                    }
                }
                let cleanup_rpc = Arc::clone(&discord_rpc);
                let discord_cleanup_result = match tokio::task::spawn_blocking(move || {
                    cleanup_rpc.clear()
                })
                .await
                {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(error)) => Err(error.to_string()),
                    Err(error) => Err(error.to_string()),
                };
                running.store(false, Ordering::Release);
                background_jobs.mark_completed(
                    BACKGROUND_PRESENCE_AUTOMATION_JOB,
                    "Background presence automation stopped.",
                );
                match discord_cleanup_result {
                    Ok(()) => background_jobs.mark_completed(
                        BACKGROUND_DISCORD_PRESENCE_JOB,
                        "Background Discord presence stopped and cleared.",
                    ),
                    Err(error) => {
                        tracing::warn!(error = %error, "background Discord shutdown cleanup failed");
                        background_jobs.mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error);
                    }
                }
            });
    }
}

async fn wait_for_desktop_maintenance_tick(stop_token: &TaskStopToken) -> bool {
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        if stop_token.is_stop_requested() {
            return true;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return false;
        }
        tokio::time::sleep(remaining.min(DESKTOP_MAINTENANCE_STOP_POLL_INTERVAL)).await;
    }
}

fn emit_game_log_watcher_status(
    state: &RuntimeHostState,
    status: vrcx_0_application_core::BackendRuntimeGameLogStatus,
) {
    let snapshot = state.backend_runtime().set_game_log_status(status);
    BackendRuntimeStatusPublisher::new(
        state.backend_runtime().clone(),
        state.desktop_assembly().event_bus().clone(),
    )
    .publish_telemetry(
        BackendRuntimeTelemetryKind::GameLogWatcher,
        status.as_str(),
        snapshot,
    );
}

fn register_desktop_file_access_grants(
    file_access: &HostFileAccess,
    profile_backup: &vrcx_0_application::profile::ProfileBackupRuntime,
    config: &dyn ConfigStore,
) -> Result<()> {
    let profile_backup_target = profile_backup.settings().auto_target_dir;
    if !profile_backup_target.is_empty() {
        file_access.register_path(profile_backup_target);
    }
    register_persisted_user_generated_content_path_grant(file_access, config)
}

fn register_persisted_user_generated_content_path_grant(
    file_access: &HostFileAccess,
    config: &dyn ConfigStore,
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

fn run_coordinated_registry_backup_maintenance(
    state: &mut RegistryBackupMaintenanceState,
    now: Instant,
    mode: RegistryBackupMaintenanceMode,
    run_full: impl FnOnce() -> vrcx_0_application_core::Result<RegistryBackupMaintenanceResult>,
    run_foreground_followup: impl FnOnce() -> vrcx_0_application_core::Result<
        RegistryBackupMaintenanceResult,
    >,
) -> vrcx_0_application_core::Result<RegistryBackupMaintenanceResult> {
    if mode == RegistryBackupMaintenanceMode::Foreground {
        if let Some(completed) = state.last_completed.as_ref().filter(|completed| {
            completed.mode == RegistryBackupMaintenanceMode::Silent
                && now
                    .checked_duration_since(completed.completed_at)
                    .is_some_and(|elapsed| elapsed <= REGISTRY_BACKUP_FOREGROUND_REUSE_WINDOW)
        }) {
            if !completed.result.restore_prompt_check_deferred {
                return Ok(completed.result.clone());
            }
            let result = run_foreground_followup()?;
            state.last_completed = Some(CompletedRegistryBackupMaintenance {
                completed_at: now,
                mode,
                result: result.clone(),
            });
            return Ok(result);
        }
    }

    let result = run_full()?;
    state.last_completed = Some(CompletedRegistryBackupMaintenance {
        completed_at: now,
        mode,
        result: result.clone(),
    });
    Ok(result)
}

fn is_authenticated_maintenance_active(
    state: &RuntimeHostState,
    session_slot: &Arc<Mutex<vrcx_0_application::auth::AuthenticatedSessionProjection>>,
) -> bool {
    is_authenticated_maintenance_active_parts(
        state.backend_runtime(),
        state.desktop_assembly().auth_scope(),
        session_slot,
    )
}

fn is_authenticated_maintenance_active_parts(
    runtime: &vrcx_0_application_core::BackendRuntime,
    auth_scope: &vrcx_0_application_core::RuntimeAuthScope,
    session_slot: &Arc<Mutex<vrcx_0_application::auth::AuthenticatedSessionProjection>>,
) -> bool {
    let snapshot = runtime.snapshot();
    let auth_scope = auth_scope.snapshot();
    if snapshot.phase != BackendRuntimePhase::Running
        || snapshot.auth_status != vrcx_0_application_core::BackendRuntimeAuthStatus::Authenticated
    {
        return false;
    }
    background_ticks::background_capability_session_identity(session_slot)
        .is_some_and(|session| session.matches_auth_scope(&auth_scope))
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
    desktop_assembly: &vrcx_0_composition::RuntimeHostDesktopAssemblyDeps,
    backend_runtime: &vrcx_0_application_core::BackendRuntime,
    detail: impl Into<String>,
) {
    emit_profile_background_output(
        desktop_assembly,
        backend_runtime,
        BackendRuntimeTelemetryKind::BackgroundInfo,
        detail,
    );
}

fn emit_profile_background_error(
    desktop_assembly: &vrcx_0_composition::RuntimeHostDesktopAssemblyDeps,
    backend_runtime: &vrcx_0_application_core::BackendRuntime,
    detail: impl Into<String>,
) {
    emit_profile_background_output(
        desktop_assembly,
        backend_runtime,
        BackendRuntimeTelemetryKind::BackgroundError,
        detail,
    );
}

fn emit_profile_background_output(
    desktop_assembly: &vrcx_0_composition::RuntimeHostDesktopAssemblyDeps,
    backend_runtime: &vrcx_0_application_core::BackendRuntime,
    kind: BackendRuntimeTelemetryKind,
    detail: impl Into<String>,
) {
    let snapshot = backend_runtime.snapshot();
    if snapshot.phase != BackendRuntimePhase::Running {
        return;
    }
    BackendRuntimeStatusPublisher::new(
        backend_runtime.clone(),
        desktop_assembly.event_bus().clone(),
    )
    .publish_telemetry(kind, detail, snapshot);
}

pub(crate) fn mcp_runtime_for(
    runtime: &RuntimeHostState,
    chatbox: vrcx_0_mcp::McpChatbox,
    caller: vrcx_0_mcp::McpCaller,
) -> vrcx_0_mcp::McpRuntime {
    let db = runtime.database();
    let assembly = runtime.desktop_assembly();
    vrcx_0_mcp::McpRuntime::new(
        vrcx_0_mcp::McpRuntimeDeps {
            realtime_runtime: Arc::clone(runtime.realtime_runtime()),
            auth_scope: assembly.auth_scope().clone(),
            config: assembly.config_store(),
            activity_queries: Arc::new(crate::mcp_adapters::DesktopMcpActivityQueryAdapter::new(
                Arc::clone(db),
            )),
            social_history_queries: Arc::new(
                crate::mcp_adapters::DesktopMcpSocialHistoryQueryAdapter::new(Arc::clone(db)),
            ),
            friend_local_data: Arc::new(
                crate::mcp_adapters::DesktopMcpFriendLocalDataAdapter::new(Arc::clone(db)),
            ),
            favorites_queries: Arc::new(crate::mcp_adapters::DesktopMcpFavoritesQueryAdapter::new(
                Arc::clone(db),
            )),
            feed_queries: Arc::new(crate::mcp_adapters::DesktopMcpFeedQueryAdapter::new(
                Arc::clone(db),
            )),
            mutual_graph: Arc::new(crate::mcp_adapters::DesktopMcpMutualGraphAdapter::new(
                assembly.mutual_graph_fetch().clone(),
                Arc::clone(db),
                Arc::clone(runtime.web_client()),
                assembly.auth_scope().clone(),
                assembly.tasks().clone(),
            )),
            world_lookup: Arc::new(crate::mcp_adapters::DesktopMcpWorldLookupAdapter::new(
                Arc::clone(assembly.world_cache()),
                assembly.auth_scope().clone(),
            )),
            screenshots: Arc::new(crate::mcp_adapters::DesktopMcpScreenshotAdapter::new(
                runtime.paths().app_data.join("metadataCache.db"),
                vrcx_0_host_desktop::vrchat_paths::vrchat_photos_location(),
            )),
            chatbox,
            favorite_mutations: assembly.favorite_mutations().clone(),
            tasks: assembly.tasks().clone(),
        },
        caller,
    )
}

pub(crate) fn assistant_controller_deps_for(
    runtime: &RuntimeHostState,
    chatbox: vrcx_0_mcp::McpChatbox,
) -> vrcx_0_assistant::AssistantControllerDeps {
    let assembly = runtime.desktop_assembly();
    vrcx_0_assistant::AssistantControllerDeps {
        config: Arc::new(
            crate::assistant_adapters::DesktopAssistantConfigAdapter::new(assembly.config_store()),
        ),
        llm_factory: Arc::new(crate::assistant_adapters::DesktopAssistantLlmClientFactory),
        proxy_url: runtime.web_client().proxy_url().map(str::to_string),
        bus: assembly.event_bus().clone(),
        tasks: assembly.tasks().clone(),
        mcp_runtime: mcp_runtime_for(runtime, chatbox, vrcx_0_mcp::McpCaller::Assistant),
        session_persistence: Arc::new(
            crate::assistant_adapters::DesktopAssistantSessionPersistenceAdapter::new(Arc::clone(
                runtime.database(),
            )),
        ),
        auth_scope: assembly.auth_scope().clone(),
    }
}

#[cfg(test)]
mod background {
    mod registry_backup_maintenance_tests {
        use super::super::*;
        use std::cell::Cell;

        fn result(
            restore_prompt_check_deferred: bool,
            detail: &str,
        ) -> RegistryBackupMaintenanceResult {
            RegistryBackupMaintenanceResult {
                auto_backup_created: false,
                restore_prompt_needed: false,
                restore_prompt_backup_date: None,
                restore_prompt_check_deferred,
                detail: detail.into(),
            }
        }

        #[test]
        fn foreground_reuses_a_just_completed_background_maintenance_result() {
            let started_at = Instant::now();
            let mut state = RegistryBackupMaintenanceState::default();
            let full_runs = Cell::new(0);
            let followup_runs = Cell::new(0);

            run_coordinated_registry_backup_maintenance(
                &mut state,
                started_at,
                RegistryBackupMaintenanceMode::Silent,
                || {
                    full_runs.set(full_runs.get() + 1);
                    Ok(result(false, "background"))
                },
                || {
                    followup_runs.set(followup_runs.get() + 1);
                    Ok(result(false, "followup"))
                },
            )
            .unwrap();
            let foreground = run_coordinated_registry_backup_maintenance(
                &mut state,
                started_at + Duration::from_secs(1),
                RegistryBackupMaintenanceMode::Foreground,
                || {
                    full_runs.set(full_runs.get() + 1);
                    Ok(result(false, "foreground"))
                },
                || {
                    followup_runs.set(followup_runs.get() + 1);
                    Ok(result(false, "followup"))
                },
            )
            .unwrap();

            assert_eq!(full_runs.get(), 1);
            assert_eq!(followup_runs.get(), 0);
            assert_eq!(foreground.detail, "background");
        }

        #[test]
        fn foreground_runs_only_the_deferred_restore_prompt_check() {
            let started_at = Instant::now();
            let mut state = RegistryBackupMaintenanceState::default();
            let full_runs = Cell::new(0);
            let followup_runs = Cell::new(0);

            run_coordinated_registry_backup_maintenance(
                &mut state,
                started_at,
                RegistryBackupMaintenanceMode::Silent,
                || {
                    full_runs.set(full_runs.get() + 1);
                    Ok(result(true, "background-deferred"))
                },
                || {
                    followup_runs.set(followup_runs.get() + 1);
                    Ok(result(false, "unexpected"))
                },
            )
            .unwrap();
            let foreground = run_coordinated_registry_backup_maintenance(
                &mut state,
                started_at + Duration::from_secs(1),
                RegistryBackupMaintenanceMode::Foreground,
                || {
                    full_runs.set(full_runs.get() + 1);
                    Ok(result(false, "foreground-full"))
                },
                || {
                    followup_runs.set(followup_runs.get() + 1);
                    Ok(result(false, "foreground-followup"))
                },
            )
            .unwrap();

            assert_eq!(full_runs.get(), 1);
            assert_eq!(followup_runs.get(), 1);
            assert_eq!(foreground.detail, "foreground-followup");
        }
    }

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
        use vrcx_0_application_core::{ConfigStore, MemoryConfigStore};
        use vrcx_0_platform::app_paths::AppPaths;

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
            let config = MemoryConfigStore::default();
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
