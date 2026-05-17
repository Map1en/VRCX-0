use std::sync::Arc;

use crate::backend::context::BackendContext;
use crate::backend::game_client::GameClientBackend;
use crate::backend::game_log::GameLogBackend;
use crate::backend::realtime::RealtimeBackend;
use crate::backend::session::SessionBackend;
use crate::domain::ipc::{IpcEventSink, IpcServer};
use crate::domain::log_watcher::{GameLogEventSink, LogWatcher};
use crate::domain::process_monitor::ProcessMonitor;
use crate::error::AppError;
use vrcx_0_host::app_paths::AppPaths;
use vrcx_0_host::auto_launch::AutoAppLaunchManager;
use vrcx_0_host::discord_rpc::DiscordRpc;
use vrcx_0_runtime::image_cache::ImageCache;
use vrcx_0_runtime::web_client::WebClient;
use vrcx_0_store::database::DatabaseService;
use vrcx_0_store::legacy_migration::{
    cleanup_legacy_updater_files, consume_pending_legacy_migration, LegacyMigrationPaths,
};
use vrcx_0_store::legacy_vrcx::{LegacyVrcxMigrationStatus, LegacyVrcxSource};
use vrcx_0_store::screenshot_cache::MetadataCacheDb;
use vrcx_0_store::storage::StorageService;

pub struct AppState {
    pub paths: AppPaths,
    pub storage: StorageService,
    pub db: Arc<DatabaseService>,
    pub discord_rpc: DiscordRpc,
    pub process_monitor: ProcessMonitor,
    pub log_watcher: LogWatcher,
    pub backend_context: Arc<BackendContext>,
    pub game_log_backend: Arc<GameLogBackend>,
    pub game_client_backend: Arc<GameClientBackend>,
    pub realtime_backend: Arc<RealtimeBackend>,
    pub session_backend: Arc<SessionBackend>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub ipc: IpcServer,
    pub screenshot_cache: MetadataCacheDb,

    pub auto_launch: AutoAppLaunchManager,
    pub legacy_vrcx_available: bool,
    pub legacy_vrcx_source: Option<LegacyVrcxSource>,
    pub legacy_vrcx_migration_status: LegacyVrcxMigrationStatus,
    pub launched_from_autostart: bool,
}

impl AppState {
    pub fn new() -> Result<Self, AppError> {
        let paths = AppPaths::resolve()?;
        cleanup_legacy_updater_files(&paths.app_data);
        let launched_from_autostart = std::env::args().any(|arg| arg == "--autostart");

        let migration_paths = LegacyMigrationPaths::from_app_data(paths.app_data.clone());
        consume_pending_legacy_migration(&migration_paths)?;

        let (legacy_vrcx_source, legacy_vrcx_migration_status) =
            vrcx_0_store::legacy_vrcx::discover_legacy_vrcx_migration(
                &paths.db_file,
                &paths.config_file,
            );
        let legacy_vrcx_available = legacy_vrcx_migration_status.available;

        let storage = StorageService::new(&paths.config_file)?;

        let db = Arc::new(DatabaseService::new(&paths.db_file)?);
        let discord_rpc = DiscordRpc::new();
        let process_monitor = ProcessMonitor::new();
        let web = Arc::new(WebClient::new(&storage, &db)?);
        let image_cache = Arc::new(ImageCache::new(
            paths.image_cache.clone(),
            web.cookie_jar(),
            web.proxy_url(),
        )?);
        let backend_context = Arc::new(BackendContext::new(
            Arc::clone(&db),
            Arc::clone(&web),
            Arc::clone(&image_cache),
        ));
        let game_log_backend = Arc::new(GameLogBackend::new(Arc::clone(&backend_context)));
        let game_log_sink: Arc<dyn GameLogEventSink> = game_log_backend.clone();
        let log_watcher = LogWatcher::new(Some(game_log_sink));
        let game_client_backend = Arc::new(GameClientBackend::new(
            Arc::clone(&backend_context),
            log_watcher.clone(),
        ));
        let realtime_backend = Arc::new(RealtimeBackend::new(Arc::clone(&backend_context)));
        let session_backend = Arc::new(SessionBackend::new(Arc::clone(&backend_context)));
        let ipc_sink: Arc<dyn IpcEventSink> = game_client_backend.clone();
        let ipc = IpcServer::new(Some(ipc_sink));
        let screenshot_cache = MetadataCacheDb::new(&paths.app_data.join("metadataCache.db"))?;

        let auto_launch = AutoAppLaunchManager::new(&paths.app_data);

        Ok(Self {
            paths,
            storage,
            db,
            discord_rpc,
            process_monitor,
            log_watcher,
            backend_context,
            game_log_backend,
            game_client_backend,
            realtime_backend,
            session_backend,
            web,
            image_cache,
            ipc,
            screenshot_cache,
            auto_launch,
            legacy_vrcx_available,
            legacy_vrcx_source,
            legacy_vrcx_migration_status,
            launched_from_autostart,
        })
    }
}
