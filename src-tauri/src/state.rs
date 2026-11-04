use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::desktop_notification_activation::PendingDesktopNotificationActivations;
use crate::error::AppError;
use vrcx_0_application::discovery::{
    complete_translation, OpenAiTranslationFuture, OpenAiTranslationPort, OpenAiTranslationRequest,
    TranslationCompletionError, TranslationResult, TranslationTranslateInput,
};
use vrcx_0_application_core::UpdaterPort;
use vrcx_0_assistant::{AssistantController, LlmTranslateInput};
use vrcx_0_mcp::{McpCaller, McpServerController};
use vrcx_0_platform::app_paths::AppDataDirResolution;
use vrcx_0_runtime_host_desktop::deep_link::PendingDeepLinks;
use vrcx_0_runtime_host_desktop::{DesktopRuntimeHostOptions, DesktopRuntimeHostState};

pub const BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY: &str = "VRCX_BackgroundModeResumeRoute";

pub struct AppState {
    runtime: DesktopRuntimeHostState,
    mcp_controller: McpServerController,
    pending_deep_links: PendingDeepLinks,
    pending_desktop_notification_activations: PendingDesktopNotificationActivations,
    assistant: tokio::sync::OnceCell<AssistantController>,
    background_resume_route: Mutex<Option<String>>,
    pub(crate) background_delay_generation: AtomicU64,
    pub(crate) background_delay_cancel: Mutex<Option<(u64, tokio::sync::oneshot::Sender<()>)>>,
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
    pub(crate) fn runtime_host(&self) -> &DesktopRuntimeHostState {
        &self.runtime
    }

    pub(crate) fn mcp_controller(&self) -> &McpServerController {
        &self.mcp_controller
    }

    pub(crate) fn pending_deep_links(&self) -> &PendingDeepLinks {
        &self.pending_deep_links
    }

    pub(crate) fn pending_desktop_notification_activations(
        &self,
    ) -> &PendingDesktopNotificationActivations {
        &self.pending_desktop_notification_activations
    }

    pub fn new(
        app_data_dir: AppDataDirResolution,
        database_maintenance_cache_dir: Option<std::path::PathBuf>,
        updater_port: Arc<dyn UpdaterPort>,
        task_executor: Arc<dyn vrcx_0_application_core::RuntimeTaskExecutor>,
    ) -> Result<Self, AppError> {
        let launched_from_autostart = std::env::args().any(|arg| arg == "--autostart");
        let runtime = DesktopRuntimeHostState::new(DesktopRuntimeHostOptions {
            realtime_origin: realtime_origin(),
            launched_from_autostart,
            app_data_dir,
            app_version: env!("CARGO_PKG_VERSION").into(),
            app_update_build_label: crate::bootstrap::app_update_build_label(),
            app_update_build_badge: crate::bootstrap::app_update_build_badge(),
            app_update_check_disabled: crate::bootstrap::app_update_check_disabled(),
            updater_port,
            database_maintenance_cache_dir,
            task_executor,
        })?;
        let mcp_controller =
            McpServerController::new(runtime.mcp_runtime(McpCaller::ExternalServer));

        Ok(Self {
            runtime,
            mcp_controller,
            pending_deep_links: PendingDeepLinks::default(),
            pending_desktop_notification_activations:
                PendingDesktopNotificationActivations::default(),
            assistant: tokio::sync::OnceCell::new(),
            background_resume_route: Mutex::new(None),
            background_delay_generation: AtomicU64::new(0),
            background_delay_cancel: Mutex::new(None),
            main_window_rebuild_in_progress: AtomicBool::new(false),
            auth_failure_notification: Mutex::new(None),
        })
    }

    pub async fn assistant(&self) -> Result<&AssistantController, AppError> {
        self.assistant
            .get_or_try_init(|| AssistantController::new(self.runtime.assistant_controller_deps()))
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

    pub async fn translate(
        &self,
        input: TranslationTranslateInput,
    ) -> Result<TranslationResult, AppError> {
        let dispatch = self.runtime.translate_dispatch(input).await?;
        complete_translation(dispatch, &TauriOpenAiTranslationPort { state: self })
            .await
            .map_err(|error| match error {
                TranslationCompletionError::Application(error) => AppError::from(error),
                TranslationCompletionError::Port(error) => error,
            })
    }
}

struct TauriOpenAiTranslationPort<'a> {
    state: &'a AppState,
}

impl OpenAiTranslationPort for TauriOpenAiTranslationPort<'_> {
    type Error = AppError;

    fn resolve_default_endpoint_id(&self) -> OpenAiTranslationFuture<'_, Self::Error> {
        Box::pin(async {
            self.state
                .assistant()
                .await?
                .endpoint_list()
                .map_err(AppError::from)?;
            self.state
                .runtime
                .resolved_openai_translation_endpoint_id()
                .map_err(AppError::from)
        })
    }

    fn translate(
        &self,
        request: OpenAiTranslationRequest,
    ) -> OpenAiTranslationFuture<'_, Self::Error> {
        Box::pin(async move {
            self.state
                .assistant()
                .await?
                .translate(LlmTranslateInput {
                    endpoint_id: request.endpoint_id,
                    model: request.model,
                    prompt: request.prompt,
                    target_lang: request.target_language,
                    text: request.text,
                    reasoning_effort: request.reasoning_effort,
                })
                .await
                .map_err(AppError::from)
        })
    }
}

fn realtime_origin() -> String {
    if cfg!(debug_assertions) {
        "http://localhost:9000".into()
    } else {
        "http://tauri.localhost".into()
    }
}
