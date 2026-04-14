use std::path::PathBuf;

use crate::domain::auto_launch::AutoAppLaunchManager;
use crate::domain::database::DatabaseService;
use crate::domain::discord_rpc::DiscordRpc;
use crate::domain::image_cache::ImageCache;
use crate::domain::ipc::IpcServer;
use crate::domain::log_watcher::LogWatcher;
use crate::domain::process_monitor::ProcessMonitor;
use crate::domain::screenshot::MetadataCacheDb;
use crate::domain::storage::StorageService;
use crate::domain::update::UpdateManager;
use crate::domain::web_client::WebClient;
use crate::error::AppError;

pub struct AppPaths {
    pub app_data: PathBuf,
    pub db_file: PathBuf,
    pub config_file: PathBuf,
    pub image_cache: PathBuf,
}

pub struct AppState {
    pub paths: AppPaths,
    pub storage: StorageService,
    pub db: DatabaseService,
    pub discord_rpc: DiscordRpc,
    pub process_monitor: ProcessMonitor,
    pub log_watcher: LogWatcher,
    pub web: WebClient,
    pub image_cache: ImageCache,
    pub update_manager: UpdateManager,
    pub ipc: IpcServer,
    pub screenshot_cache: MetadataCacheDb,

    pub auto_launch: AutoAppLaunchManager,
    pub legacy_vrcx_available: bool,
    pub launched_from_autostart: bool,
}

impl AppState {
    pub fn new() -> Result<Self, AppError> {
        let app_data = dirs::config_dir()
            .ok_or_else(|| AppError::Custom("cannot resolve AppData".into()))?
            .join("VRCX-0");

        std::fs::create_dir_all(&app_data)?;

        let paths = AppPaths {
            db_file: app_data.join("VRCX-0.sqlite3"),
            config_file: app_data.join("VRCX-0.json"),
            image_cache: app_data.join("ImageCache"),
            app_data,
        };
        let launched_from_autostart = std::env::args().any(|arg| arg == "--autostart");

        let migration_flag = paths.app_data.join("pending_vrcx_migration");
        if migration_flag.exists() {
            copy_legacy_vrcx_data(&paths)?;
            let _ = std::fs::remove_file(&migration_flag);
            tracing::info!("Legacy VRCX data migration completed");
        }

        let legacy_vrcx_available = !paths.db_file.exists()
            && !paths.config_file.exists()
            && has_legacy_vrcx_data();

        let storage = StorageService::new(&paths.config_file)?;

        let db = DatabaseService::new(&paths.db_file)?;
        let discord_rpc = DiscordRpc::new();
        let process_monitor = ProcessMonitor::new();
        let log_watcher = LogWatcher::new();
        let web = WebClient::new(&storage, &db)?;
        let image_cache =
            ImageCache::new(paths.image_cache.clone(), web.cookie_jar(), web.proxy_url())?;
        let update_manager = UpdateManager::new(paths.app_data.clone(), web.proxy_url());
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
            web,
            image_cache,
            update_manager,
            ipc,
            screenshot_cache,
            auto_launch,
            legacy_vrcx_available,
            launched_from_autostart,
        })
    }
}

fn has_legacy_vrcx_data() -> bool {
    let Some(base_app_data) = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(dirs::config_dir)
    else {
        return false;
    };

    let legacy_dir = base_app_data.join("VRCX");
    resolve_legacy_database_path(&legacy_dir).is_some()
}

fn legacy_database_location() -> Option<PathBuf> {
    let base_app_data = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(dirs::config_dir)?;
    let legacy_config = base_app_data.join("VRCX").join("VRCX.json");
    let content = std::fs::read_to_string(legacy_config).ok()?;
    let data: std::collections::HashMap<String, String> = serde_json::from_str(&content).ok()?;
    data.get("VRCX_DatabaseLocation")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn copy_legacy_vrcx_data(paths: &AppPaths) -> Result<(), AppError> {
    let Some(base_app_data) = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(dirs::config_dir)
    else {
        return Ok(());
    };

    let legacy_dir = base_app_data.join("VRCX");
    if !legacy_dir.exists() {
        return Ok(());
    }

    if let Some(legacy_db) = resolve_legacy_database_path(&legacy_dir) {
        copy_replace(legacy_db.clone(), paths.db_file.clone())?;
        sync_sidecar(
            sidecar_path(&legacy_db, "shm"),
            paths.app_data.join("VRCX-0.sqlite3-shm"),
        )?;
        sync_sidecar(
            sidecar_path(&legacy_db, "wal"),
            paths.app_data.join("VRCX-0.sqlite3-wal"),
        )?;
    }
    copy_replace(legacy_dir.join("VRCX.json"), paths.config_file.clone())?;
    remove_database_location_from_config(&paths.config_file)?;

    Ok(())
}

fn resolve_legacy_database_path(legacy_dir: &std::path::Path) -> Option<PathBuf> {
    if let Some(config_db) = legacy_database_location().filter(|path| path.exists()) {
        return Some(config_db);
    }

    let default_db = legacy_dir.join("VRCX.sqlite3");
    default_db.exists().then_some(default_db)
}

fn copy_replace(from: PathBuf, to: PathBuf) -> Result<(), AppError> {
    if !from.exists() {
        return Ok(());
    }

    if to.exists() {
        std::fs::remove_file(&to)?;
    }
    std::fs::copy(&from, &to)?;
    Ok(())
}

fn sidecar_path(db_path: &std::path::Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}-{suffix}", db_path.to_string_lossy()))
}

fn sync_sidecar(from: PathBuf, to: PathBuf) -> Result<(), AppError> {
    if from.exists() {
        copy_replace(from, to)?;
    } else if to.exists() {
        std::fs::remove_file(to)?;
    }
    Ok(())
}

fn remove_database_location_from_config(config_path: &std::path::Path) -> Result<(), AppError> {
    if !config_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(config_path)?;
    let mut data: std::collections::HashMap<String, String> =
        serde_json::from_str(&content).unwrap_or_default();
    if data.remove("VRCX_DatabaseLocation").is_none() {
        return Ok(());
    }

    let json = serde_json::to_string_pretty(&data)?;
    std::fs::write(config_path, json)?;
    Ok(())
}
