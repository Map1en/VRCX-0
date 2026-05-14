use std::sync::Arc;

use crate::backend::game_log::GameLogBackend;
use crate::domain::app_paths::AppPaths;
use crate::domain::auto_launch::AutoAppLaunchManager;
use crate::domain::database::DatabaseService;
use crate::domain::discord_rpc::DiscordRpc;
use crate::domain::image_cache::ImageCache;
use crate::domain::ipc::IpcServer;
use crate::domain::legacy_migration::{
    cleanup_legacy_updater_files, consume_pending_legacy_migration,
};
use crate::domain::legacy_vrcx::{LegacyVrcxMigrationStatus, LegacyVrcxSource};
use crate::domain::log_watcher::{GameLogEventSink, LogWatcher};
use crate::domain::process_monitor::ProcessMonitor;
use crate::domain::screenshot::MetadataCacheDb;
use crate::domain::storage::StorageService;
use crate::domain::web_client::WebClient;
use crate::error::AppError;

pub struct AppState {
    pub paths: AppPaths,
    pub storage: StorageService,
    pub db: Arc<DatabaseService>,
    pub discord_rpc: DiscordRpc,
    pub process_monitor: ProcessMonitor,
    pub log_watcher: LogWatcher,
    pub game_log_backend: Arc<GameLogBackend>,
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

        consume_pending_legacy_migration(&paths)?;

        let (legacy_vrcx_source, legacy_vrcx_migration_status) =
            crate::domain::legacy_vrcx::discover_legacy_vrcx_migration(
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
        let game_log_backend = Arc::new(GameLogBackend::new(
            Arc::clone(&db),
            Arc::clone(&web),
            Arc::clone(&image_cache),
        ));
        let game_log_sink: Arc<dyn GameLogEventSink> = game_log_backend.clone();
        let log_watcher = LogWatcher::new(Some(game_log_sink));
        let ipc = IpcServer::new();
        let screenshot_cache = MetadataCacheDb::new(&paths.app_data.join("metadataCache.db"))
            .map_err(|e| AppError::Custom(format!("screenshot cache: {e}")))?;

        let auto_launch = AutoAppLaunchManager::new(&paths.app_data);

        Ok(Self {
            paths,
            storage,
            db,
            discord_rpc,
            process_monitor,
            log_watcher,
            game_log_backend,
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
