use std::path::PathBuf;
use std::sync::Mutex;

use crate::domain::auto_launch::AutoAppLaunchManager;
use crate::domain::database::DatabaseService;
use crate::domain::image_cache::ImageCache;
use crate::domain::ipc::IpcServer;
use crate::domain::log_watcher::LogWatcher;
use crate::domain::ovrtoolkit::OvrToolkit;
use crate::domain::process_monitor::ProcessMonitor;
use crate::domain::storage::StorageService;
use crate::domain::screenshot::MetadataCacheDb;
use crate::domain::update::UpdateManager;
use crate::domain::web_client::WebClient;
use crate::error::AppError;

/// Shared paths used across the application.
pub struct AppPaths {
    pub app_data: PathBuf,
    pub db_file: PathBuf,
    pub config_file: PathBuf,
    pub image_cache: PathBuf,
}

/// Holds pending launch command from CLI args (matches C# StartupArgs).
pub struct StartupArgs {
    launch_command: Mutex<Option<String>>,
}

impl StartupArgs {
    pub fn new() -> Self {
        let cmd = std::env::args().nth(1);
        Self {
            launch_command: Mutex::new(cmd),
        }
    }

    /// Returns and clears the pending launch command.
    pub fn take_launch_command(&self) -> String {
        self.launch_command.lock().unwrap().take().unwrap_or_default()
    }
}

/// Central application state — replaces all C# `*.Instance` singletons.
///
/// Held by Tauri via `app.manage(AppState)`.
/// Commands access it through `State<'_, AppState>`.
pub struct AppState {
    pub paths: AppPaths,
    pub storage: StorageService,
    pub db: DatabaseService,
    pub process_monitor: ProcessMonitor,
    pub log_watcher: LogWatcher,
    pub web: WebClient,
    pub image_cache: ImageCache,
    pub update_manager: UpdateManager,
    pub ovrtoolkit: OvrToolkit,
    pub ipc: IpcServer,
    pub screenshot_cache: MetadataCacheDb,
    pub startup_args: StartupArgs,
    pub auto_launch: AutoAppLaunchManager,
    pub zoom_level: Mutex<f64>,
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

        // Init order matters: storage first (C# SQLite reads db path from VRCXStorage)
        let storage = StorageService::new(&paths.config_file)?;

        // Check if user overrode DB location in storage (matching C# behavior)
        let db_path = storage
            .get("VRCX-0_DatabaseLocation")
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| paths.db_file.clone());

        let db = DatabaseService::new(&db_path)?;
        let process_monitor = ProcessMonitor::new();
        let log_watcher = LogWatcher::new();
        let web = WebClient::new(&storage, &db)?;
        let image_cache = ImageCache::new(paths.image_cache.clone(), web.cookie_jar(), web.proxy_url())?;
        let update_manager = UpdateManager::new(paths.app_data.clone(), web.proxy_url());
        let ovrtoolkit = OvrToolkit::new();
        let ipc = IpcServer::new();
        let screenshot_cache = MetadataCacheDb::new(&paths.app_data.join("metadataCache.db"))
            .map_err(|e| AppError::Custom(format!("screenshot cache: {e}")))?;
        let startup_args = StartupArgs::new();
        let auto_launch = AutoAppLaunchManager::new(&paths.app_data);

        Ok(Self { paths, storage, db, process_monitor, log_watcher, web, image_cache, update_manager, ovrtoolkit, ipc, screenshot_cache, startup_args, auto_launch, zoom_level: Mutex::new(0.0) })
    }
}
