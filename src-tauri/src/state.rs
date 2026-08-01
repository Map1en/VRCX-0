use std::ops::Deref;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::adapters::log_watcher::LogWatcherCompatBridge;
use crate::deep_link::PendingDeepLinks;
use crate::error::AppError;
use vrcx_0_application::{
    DatabaseUpgradeRuntime, FriendLogNameResolutionCoordinator, GroupModerationBatchCoordinator,
    RemoteMutationGate,
};
use vrcx_0_application_core::UpdaterPort;
use vrcx_0_harness::AssistantController;
use vrcx_0_host::app_paths::AppDataDirResolution;
use vrcx_0_mcp::{McpRuntime, McpServerController};
use vrcx_0_runtime_host_desktop::{DesktopRuntimeHostOptions, DesktopRuntimeHostState};

pub const BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY: &str = "VRCX_BackgroundModeResumeRoute";

pub struct AppState {
    pub runtime: DesktopRuntimeHostState,
    pub mcp_controller: McpServerController,
    pub log_watcher_compat_bridge: LogWatcherCompatBridge,
    pub pending_deep_links: PendingDeepLinks,
    pub database_upgrade: DatabaseUpgradeRuntime,
    pub group_moderation_batches: GroupModerationBatchCoordinator,
    pub friend_log_name_resolutions: FriendLogNameResolutionCoordinator,
    pub remote_mutations: RemoteMutationGate,
    assistant: tokio::sync::OnceCell<AssistantController>,
    background_resume_route: Mutex<Option<String>>,
    pub(crate) background_delay_generation: AtomicU64,
    main_window_rebuild_in_progress: AtomicBool,
    auth_failure_notification: Mutex<Option<AuthFailureNotificationRecord>>,
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
    pub fn new(
        app_data_dir: AppDataDirResolution,
        updater_port: Arc<dyn UpdaterPort>,
    ) -> Result<Self, AppError> {
        let launched_from_autostart = std::env::args().any(|arg| arg == "--autostart");
        let runtime = DesktopRuntimeHostState::new(DesktopRuntimeHostOptions {
            realtime_origin: realtime_origin(),
            launched_from_autostart,
            app_data_dir,
            app_version: env!("CARGO_PKG_VERSION").into(),
            app_update_build_label: crate::bootstrap::app_update_build_label(),
            app_update_build_badge: crate::bootstrap::app_update_build_badge(),
            updater_port,
        })?;
        let database_upgrade = DatabaseUpgradeRuntime::new(
            runtime.db.clone(),
            runtime.runtime_context.diagnostics.clone(),
            runtime.runtime_context.background_jobs.clone(),
        );
        let mcp_controller = McpServerController::new(McpRuntime::from_host(&runtime));
        let log_watcher_compat_bridge = LogWatcherCompatBridge::new();

        Ok(Self {
            runtime,
            mcp_controller,
            log_watcher_compat_bridge,
            pending_deep_links: PendingDeepLinks::default(),
            database_upgrade,
            group_moderation_batches: GroupModerationBatchCoordinator::default(),
            friend_log_name_resolutions: FriendLogNameResolutionCoordinator::default(),
            remote_mutations: RemoteMutationGate::default(),
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
    type Target = DesktopRuntimeHostState;

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
