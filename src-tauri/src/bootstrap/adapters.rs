use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use vrcx_0_application::RuntimeEventSink;
use vrcx_0_application::{format_runtime_output_event, RuntimeOutputLevel, RuntimeOutputMode};
use vrcx_0_application::{BackendRuntimeMode, BackendRuntimePhase};
use vrcx_0_application::{RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle};
use vrcx_0_host::host_capabilities::{is_host_capability_available, HostCapability};
use vrcx_0_runtime_host::notification::DesktopNotifier;
use vrcx_0_runtime_host::RuntimeHostActions;

use crate::state::AppState;

use super::notification::{
    handle_runtime_auth_failure_notification, handle_runtime_auth_failure_recovery,
};
use super::shared::json_string_field;

#[derive(Clone)]
struct TauriRuntimeEventSink {
    app_handle: tauri::AppHandle,
}

impl TauriRuntimeEventSink {
    fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl RuntimeEventSink for TauriRuntimeEventSink {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        log_gui_background_runtime_info(&self.app_handle, event, &payload);
        handle_runtime_auth_failure_recovery(&self.app_handle, event, &payload);
        handle_runtime_auth_failure_notification(&self.app_handle, event, &payload);
        let frontend_event = match event {
            "runtimeGameLogEvent" => "addGameLogEvent",
            event => event,
        };
        emit_to_main_window_if_visible(&self.app_handle, frontend_event, payload);
    }
}

#[derive(Clone)]
pub(super) struct TauriDesktopNotifier {
    app_handle: tauri::AppHandle,
}

impl TauriDesktopNotifier {
    pub(super) fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl DesktopNotifier for TauriDesktopNotifier {
    fn show(
        &self,
        title: &str,
        body: Option<&str>,
        image: Option<&str>,
        play_sound: bool,
    ) -> Result<(), String> {
        let mut notification = self.app_handle.notification().builder();
        notification = notification.title(title);
        if let Some(body) = body {
            notification = notification.body(body);
        }
        if let Some(icon) = image.filter(|value| !value.trim().is_empty()) {
            notification = notification.icon(icon);
        }
        if play_sound {
            notification = notification
                .sound(crate::commands::host::window::default_desktop_notification_sound());
        }
        notification
            .show()
            .map_err(|error| format!("notification: {error}"))
    }
}

pub fn emit_to_main_window_if_visible<S>(
    app_handle: &tauri::AppHandle,
    event: &str,
    payload: S,
) -> bool
where
    S: Serialize + Clone,
{
    if is_gui_background_runtime_hidden(app_handle) {
        return false;
    }
    let Some(window) = app_handle.get_webview_window("main") else {
        return false;
    };
    if window.is_visible().is_err() {
        return false;
    }
    match window.emit(event, payload.clone()) {
        Ok(()) => true,
        Err(error) => {
            tracing::debug!(error = %error, event, "skipped frontend event emit");
            false
        }
    }
}

fn is_gui_background_runtime_hidden(app_handle: &tauri::AppHandle) -> bool {
    let Some(state) = app_handle.try_state::<AppState>() else {
        return false;
    };
    let snapshot = state.snapshot_backend_runtime();
    snapshot.mode == BackendRuntimeMode::Background
        && snapshot.phase == BackendRuntimePhase::Running
}

fn log_gui_background_runtime_info(
    app_handle: &tauri::AppHandle,
    event: &str,
    payload: &serde_json::Value,
) {
    if event == "realtimeWsStatus" {
        let Some(state) = app_handle.try_state::<AppState>() else {
            return;
        };
        let snapshot = state.snapshot_backend_runtime();
        if snapshot.mode != BackendRuntimeMode::Background
            || snapshot.phase != BackendRuntimePhase::Running
        {
            return;
        }
        log_runtime_output_event(RuntimeOutputMode::Background, event, payload);
        return;
    }

    if event != "backendRuntimeTelemetry" {
        return;
    }

    let snapshot = payload.get("snapshot").unwrap_or(&serde_json::Value::Null);
    let kind = json_string_field(payload, "kind");
    if kind == "runtimeStopped" {
        if json_string_field(snapshot, "mode") == "background" {
            log_runtime_output_event(RuntimeOutputMode::Background, event, payload);
        }
        return;
    }
    let Some(state) = app_handle.try_state::<AppState>() else {
        return;
    };
    let current_snapshot = state.snapshot_backend_runtime();
    if current_snapshot.mode != BackendRuntimeMode::Background
        || !matches!(
            current_snapshot.phase,
            BackendRuntimePhase::Starting
                | BackendRuntimePhase::Authenticating
                | BackendRuntimePhase::Running
        )
    {
        return;
    }
    if json_string_field(snapshot, "mode") != "background"
        || !is_background_runtime_info_phase(snapshot)
    {
        return;
    }

    log_runtime_output_event(RuntimeOutputMode::Background, event, payload);
}

fn is_background_runtime_info_phase(snapshot: &serde_json::Value) -> bool {
    matches!(
        json_string_field(snapshot, "phase").as_str(),
        "starting" | "authenticating" | "running"
    )
}

fn log_runtime_output_event(mode: RuntimeOutputMode, event: &str, payload: &serde_json::Value) {
    let Some(line) = format_runtime_output_event(mode, event, payload) else {
        return;
    };
    match line.level {
        RuntimeOutputLevel::Info => tracing::info!("{}", line.message),
        RuntimeOutputLevel::Error => tracing::error!("{}", line.message),
    }
}

#[derive(Clone)]
struct TauriRuntimeHostActions {
    app_handle: tauri::AppHandle,
}

impl TauriRuntimeHostActions {
    fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl RuntimeHostActions for TauriRuntimeHostActions {
    fn focus_main_window(&self) {
        if let Some(window) = self.app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
    }
}

#[derive(Clone)]
struct TauriRuntimeTaskExecutor;

struct TauriRuntimeTaskHandle(tauri::async_runtime::JoinHandle<()>);

impl RuntimeTaskHandle for TauriRuntimeTaskHandle {
    fn abort(&self) {
        self.0.abort();
    }

    fn is_finished(&self) -> bool {
        self.0.inner().is_finished()
    }

    fn join_or_abort(&mut self, timeout: Duration) {
        if self.is_finished() {
            let _ = block_on_runtime_task(&mut self.0);
            return;
        }

        let Some(joined) =
            block_on_runtime_task(async { tokio::time::timeout(timeout, &mut self.0).await })
        else {
            self.0.abort();
            return;
        };
        if joined.is_ok() {
            return;
        }

        self.0.abort();
        let _ = block_on_runtime_task(async {
            tokio::time::timeout(Duration::from_millis(50), &mut self.0).await
        });
    }
}

fn block_on_runtime_task<F>(future: F) -> Option<F::Output>
where
    F: std::future::Future,
{
    match tokio::runtime::Handle::try_current() {
        Ok(handle) if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
            Some(tokio::task::block_in_place(|| handle.block_on(future)))
        }
        Ok(_) => None,
        Err(_) => Some(tauri::async_runtime::block_on(future)),
    }
}

impl RuntimeTaskExecutor for TauriRuntimeTaskExecutor {
    fn spawn(&self, task: RuntimeTask) -> Box<dyn RuntimeTaskHandle> {
        Box::new(TauriRuntimeTaskHandle(tauri::async_runtime::spawn(task)))
    }
}

pub(super) fn start_host_services(app: &tauri::AppHandle, state: &AppState) {
    state.set_event_sink(TauriRuntimeEventSink::new(app.clone()));
    state
        .runtime_context
        .host
        .set_actions(TauriRuntimeHostActions::new(app.clone()));
    state
        .runtime_context
        .tasks
        .set_executor(TauriRuntimeTaskExecutor);
    state.start_telemetry_runtime();
    state.start_shell_neutral_services();

    if is_host_capability_available(HostCapability::Ipc) {
        state.ipc.start(app.clone());
        state
            .runtime_context
            .background_jobs
            .mark_running("ipcServer", "Local IPC server is active.");
    } else {
        state.runtime_context.background_jobs.register_job(
            "ipcServer",
            "rust-host",
            None,
            "unavailable",
            "IPC capability is unavailable.",
        );
    }

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    if is_host_capability_available(HostCapability::GameLogWatcher) {
        state
            .log_watcher_compat_bridge
            .start(app.clone(), state.log_watcher.clone());
    }
}

pub(super) fn start_mcp_server_if_enabled(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        match state.mcp_controller.start_from_config().await {
            Ok(status) => {
                if matches!(status.state, vrcx_0_mcp::McpServerState::Running) {
                    state.runtime_context.sync.record(
                        "mcpServer",
                        "running",
                        format!(
                            "MCP server listening on port {}.",
                            status.port.unwrap_or_default()
                        ),
                        0,
                    );
                }
            }
            Err(error) => {
                state
                    .runtime_context
                    .sync
                    .record_failure("mcpServer", error.to_string());
            }
        }
    });
}
