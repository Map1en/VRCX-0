use std::ops::Deref;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::adapters::ipc::{IpcEventSink, IpcServer};
use crate::adapters::log_watcher::LogWatcherCompatBridge;
use crate::app::APP_VERSION;
use crate::deep_link::PendingDeepLinks;
use crate::error::AppError;
use serde::Serialize;
use tauri_plugin_updater::Update;
use vrcx_0_harness::AssistantController;
use vrcx_0_host::app_paths::AppDataDirResolution;
use vrcx_0_mcp::{McpRuntime, McpServerController};
use vrcx_0_runtime_host::{RuntimeHostOptions, RuntimeHostState};

pub const BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY: &str = "VRCX_BackgroundModeResumeRoute";

pub struct AppState {
    pub runtime: RuntimeHostState,
    pub mcp_controller: McpServerController,
    pub log_watcher_compat_bridge: LogWatcherCompatBridge,
    pub ipc: IpcServer,
    pub pending_deep_links: PendingDeepLinks,
    pub pending_tauri_update: tokio::sync::Mutex<Option<PendingTauriUpdate>>,
    assistant: tokio::sync::OnceCell<AssistantController>,
    background_resume_route: Mutex<Option<String>>,
    pub(crate) background_delay_generation: AtomicU64,
    main_window_rebuild_in_progress: AtomicBool,
    auth_failure_notification: Mutex<Option<AuthFailureNotificationRecord>>,
}

pub struct PendingTauriUpdate {
    pub version: String,
    pub update: Update,
    pub bytes: Vec<u8>,
    pub metadata: TauriUpdateMetadata,
}

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TauriUpdateMetadata {
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

impl From<&Update> for TauriUpdateMetadata {
    fn from(update: &Update) -> Self {
        Self {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            date: update
                .raw_json
                .get("pub_date")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
            body: update.body.clone(),
            raw_json: update.raw_json.clone(),
        }
    }
}

struct AuthFailureNotificationRecord {
    sent_at: Instant,
}

pub(crate) struct MainWindowRebuildGuard<'a> {
    state: &'a AppState,
}

impl Drop for MainWindowRebuildGuard<'_> {
    fn drop(&mut self) {
        self.state
            .main_window_rebuild_in_progress
            .store(false, Ordering::SeqCst);
    }
}

impl AppState {
    pub fn new(app_data_dir: AppDataDirResolution) -> Result<Self, AppError> {
        let launched_from_autostart = std::env::args().any(|arg| arg == "--autostart");
        let runtime = RuntimeHostState::new(RuntimeHostOptions {
            realtime_origin: realtime_origin(),
            launched_from_autostart,
            app_data_dir,
            app_version: APP_VERSION.into(),
            is_headless: false,
        })?;
        let mcp_controller = McpServerController::new(McpRuntime::from_host(&runtime));
        let ipc_sink: Arc<dyn IpcEventSink> = runtime.game_client_runtime.clone();
        let ipc = IpcServer::new(Some(ipc_sink));
        let log_watcher_compat_bridge = LogWatcherCompatBridge::new();

        Ok(Self {
            runtime,
            mcp_controller,
            log_watcher_compat_bridge,
            ipc,
            pending_deep_links: PendingDeepLinks::default(),
            pending_tauri_update: tokio::sync::Mutex::new(None),
            assistant: tokio::sync::OnceCell::new(),
            background_resume_route: Mutex::new(None),
            background_delay_generation: AtomicU64::new(0),
            main_window_rebuild_in_progress: AtomicBool::new(false),
            auth_failure_notification: Mutex::new(None),
        })
    }

    pub async fn assistant(&self) -> Result<&AssistantController, AppError> {
        self.assistant
            .get_or_try_init(|| AssistantController::from_host(&self.runtime))
            .await
            .map_err(AppError::from)
    }

    pub fn set_background_resume_route(&self, route: Option<String>) {
        if let Ok(mut slot) = self.background_resume_route.lock() {
            *slot = route;
        }
    }

    pub fn take_background_resume_route(&self) -> Option<String> {
        self.background_resume_route.lock().ok()?.take()
    }

    pub(crate) fn try_begin_main_window_rebuild(&self) -> Option<MainWindowRebuildGuard<'_>> {
        self.main_window_rebuild_in_progress
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()?;
        Some(MainWindowRebuildGuard { state: self })
    }

    pub(crate) fn is_main_window_rebuild_in_progress(&self) -> bool {
        self.main_window_rebuild_in_progress.load(Ordering::SeqCst)
    }

    pub fn should_emit_auth_failure_notification(&self, _key: &str, cooldown: Duration) -> bool {
        let now = Instant::now();
        let Ok(mut slot) = self.auth_failure_notification.lock() else {
            return true;
        };
        if let Some(record) = slot.as_ref() {
            if now.duration_since(record.sent_at) < cooldown {
                return false;
            }
        }
        *slot = Some(AuthFailureNotificationRecord { sent_at: now });
        true
    }
}

impl Deref for AppState {
    type Target = RuntimeHostState;

    fn deref(&self) -> &Self::Target {
        &self.runtime
    }
}

fn realtime_origin() -> String {
    if cfg!(debug_assertions) {
        "http://localhost:9000".into()
    } else {
        "http://tauri.localhost".into()
    }
}
