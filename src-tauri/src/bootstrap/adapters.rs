use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::Duration;

use async_trait::async_trait;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, Url};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::{Update, UpdaterExt};
use vrcx_0_application_core::RuntimeEventSink;
use vrcx_0_application_core::{format_runtime_output_event, RuntimeOutputLevel, RuntimeOutputMode};
use vrcx_0_application_core::{BackendRuntimeMode, BackendRuntimePhase};
use vrcx_0_application_core::{
    Error as ApplicationError, Result as ApplicationResult, UpdaterCheckRequest,
    UpdaterDownloadOutcome, UpdaterDownloadProgress, UpdaterInstallHandle, UpdaterMetadata,
    UpdaterPort, UpdaterProgressCallback,
};
use vrcx_0_application_core::{RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle};
use vrcx_0_host_desktop::host_capabilities::{is_host_capability_available, HostCapability};
use vrcx_0_runtime_host_desktop::notification::DesktopNotifier;
use vrcx_0_runtime_host_desktop::RuntimeHostActions;

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
        RuntimeOutputLevel::Warn => tracing::warn!("{}", line.message),
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
        .desktop
        .services
        .host
        .set_actions(TauriRuntimeHostActions::new(app.clone()));
    state
        .runtime_context
        .tasks
        .set_executor(TauriRuntimeTaskExecutor);
    state.start_telemetry_runtime();
    state.start_data_services();
    state.start_game_services();
    state.start_desktop_services();

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    if is_host_capability_available(HostCapability::GameLogWatcher) {
        let game = &state.game;
        state
            .log_watcher_compat_bridge
            .start(app.clone(), game.log_watcher.clone());
    }
}

#[derive(Clone)]
pub struct TauriUpdaterPort {
    app_handle: tauri::AppHandle,
}

impl TauriUpdaterPort {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        match update_cache_dir(&app_handle) {
            Ok(cache_dir) => cleanup_update_cache_dir(&cache_dir),
            Err(error) => tracing::warn!(
                error = %error,
                "failed to resolve update cache directory during startup cleanup"
            ),
        }
        Self { app_handle }
    }
}

struct TauriPendingUpdate {
    update: Update,
    artifact_path: PathBuf,
    sha256: [u8; 32],
}

impl Drop for TauriPendingUpdate {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_file(&self.artifact_path) {
            if error.kind() != ErrorKind::NotFound {
                tracing::warn!(
                    path = %self.artifact_path.display(),
                    error = %error,
                    "failed to remove cached update artifact"
                );
            }
        }
    }
}

fn update_cache_dir(app_handle: &tauri::AppHandle) -> ApplicationResult<PathBuf> {
    app_handle
        .path()
        .app_cache_dir()
        .map(|path| path.join("updates"))
        .map_err(|error| {
            ApplicationError::Custom(format!("Failed to resolve update cache directory: {error}"))
        })
}

fn update_artifact_path(cache_dir: &Path, version: &str) -> PathBuf {
    let safe_version: String = version
        .chars()
        .take(128)
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    let safe_version = if safe_version.is_empty() {
        "unknown"
    } else {
        &safe_version
    };
    cache_dir.join(format!("vrcx-update-{safe_version}.bin"))
}

fn cleanup_update_cache_dir(cache_dir: &Path) {
    if let Err(error) = fs::remove_dir_all(cache_dir) {
        if error.kind() != ErrorKind::NotFound {
            tracing::warn!(
                path = %cache_dir.display(),
                error = %error,
                "failed to clean cached update artifacts during startup"
            );
        }
    }
}

async fn read_verified_update_artifact(
    artifact_path: &Path,
    expected_sha256: &[u8; 32],
) -> ApplicationResult<Vec<u8>> {
    let bytes = tokio::fs::read(artifact_path).await.map_err(|error| {
        ApplicationError::UpdateArtifactInvalid(format!(
            "cached update file could not be read: {error}"
        ))
    })?;
    let actual_sha256: [u8; 32] = Sha256::digest(&bytes).into();
    if &actual_sha256 != expected_sha256 {
        return Err(ApplicationError::UpdateArtifactInvalid(
            "cached update file checksum did not match the downloaded artifact".into(),
        ));
    }
    Ok(bytes)
}

fn updater_metadata_from(update: &Update) -> UpdaterMetadata {
    UpdaterMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update
            .raw_json
            .get("pub_date")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        body: update.body.clone(),
    }
}

async fn find_update(
    app_handle: &tauri::AppHandle,
    request: &UpdaterCheckRequest,
) -> ApplicationResult<Option<Update>> {
    let endpoint = vrcx_0_host_desktop::updater_policy::validate_update_request(
        &request.manifest_url,
        &request.target,
        request.allow_downgrades,
    )
    .map_err(|error| ApplicationError::Custom(error.to_string()))?;
    let mut builder = app_handle
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| {
            ApplicationError::Custom(format!("Failed to configure update endpoint: {error}"))
        })?
        .target(request.target.clone());

    if let Some(proxy_url) = request
        .proxy
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let proxy: Url = proxy_url.parse().map_err(|error| {
            ApplicationError::Custom(format!("Invalid update proxy URL: {error}"))
        })?;
        builder = builder.proxy(proxy);
    }

    let updater = builder.build().map_err(|error| {
        ApplicationError::Custom(format!("Failed to initialize updater: {error}"))
    })?;
    updater
        .check()
        .await
        .map_err(|error| ApplicationError::Custom(format!("Failed to check for updates: {error}")))
}

#[async_trait]
impl UpdaterPort for TauriUpdaterPort {
    async fn check(
        &self,
        request: UpdaterCheckRequest,
    ) -> ApplicationResult<Option<UpdaterMetadata>> {
        Ok(find_update(&self.app_handle, &request)
            .await?
            .as_ref()
            .map(updater_metadata_from))
    }

    async fn download(
        &self,
        request: UpdaterCheckRequest,
        on_progress: UpdaterProgressCallback,
    ) -> ApplicationResult<UpdaterDownloadOutcome> {
        let Some(update) = find_update(&self.app_handle, &request).await? else {
            return Err(ApplicationError::Custom(
                "No installable update was found.".into(),
            ));
        };
        let metadata = updater_metadata_from(&update);
        let mut first_chunk = true;
        let progress_started = on_progress.clone();
        let progress_finished = on_progress;
        let bytes = update
            .download(
                move |chunk_length, content_length| {
                    if first_chunk {
                        first_chunk = false;
                        progress_started(UpdaterDownloadProgress::Started { content_length });
                    }
                    progress_started(UpdaterDownloadProgress::Progress { chunk_length });
                },
                move || {
                    progress_finished(UpdaterDownloadProgress::Finished);
                },
            )
            .await
            .map_err(|error| {
                ApplicationError::Custom(format!("Failed to download update: {error}"))
            })?;
        let sha256: [u8; 32] = Sha256::digest(&bytes).into();
        let cache_dir = update_cache_dir(&self.app_handle)?;
        tokio::fs::create_dir_all(&cache_dir)
            .await
            .map_err(|error| {
                ApplicationError::Custom(format!(
                    "Failed to create update cache directory: {error}"
                ))
            })?;
        let artifact_path = update_artifact_path(&cache_dir, &update.version);
        if let Err(error) = tokio::fs::write(&artifact_path, &bytes).await {
            let _ = tokio::fs::remove_file(&artifact_path).await;
            return Err(ApplicationError::Custom(format!(
                "Failed to persist downloaded update artifact: {error}"
            )));
        }
        drop(bytes);

        Ok(UpdaterDownloadOutcome {
            metadata,
            handle: UpdaterInstallHandle(Box::new(TauriPendingUpdate {
                update,
                artifact_path,
                sha256,
            })),
        })
    }

    async fn install(&self, handle: UpdaterInstallHandle) -> ApplicationResult<()> {
        let pending = handle
            .0
            .downcast::<TauriPendingUpdate>()
            .map_err(|_| ApplicationError::Custom("Invalid pending update handle.".into()))?;
        let bytes = read_verified_update_artifact(&pending.artifact_path, &pending.sha256).await?;
        pending.update.install(bytes).map_err(|error| {
            ApplicationError::Custom(format!("Failed to install pending update: {error}"))
        })
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

#[cfg(test)]
mod updater_artifact_tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-updater-{name}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create updater test directory");
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn update_artifact_path_stays_inside_cache_directory() {
        let cache_dir = PathBuf::from("update-cache");
        let path = update_artifact_path(&cache_dir, "../../2.15.0\\payload");

        assert_eq!(path.parent(), Some(cache_dir.as_path()));
        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some("vrcx-update-.._.._2.15.0_payload.bin")
        );
    }

    #[tokio::test]
    async fn update_artifact_is_revalidated_before_install() {
        let dir = TestDir::new("verify");
        let artifact_path = dir.0.join("update.bin");
        let original = b"verified update";
        let sha256: [u8; 32] = Sha256::digest(original).into();
        tokio::fs::write(&artifact_path, original)
            .await
            .expect("write original artifact");

        assert_eq!(
            read_verified_update_artifact(&artifact_path, &sha256)
                .await
                .expect("original artifact verifies"),
            original
        );

        tokio::fs::write(&artifact_path, b"tampered update")
            .await
            .expect("tamper artifact");
        assert!(matches!(
            read_verified_update_artifact(&artifact_path, &sha256).await,
            Err(ApplicationError::UpdateArtifactInvalid(_))
        ));

        tokio::fs::remove_file(&artifact_path)
            .await
            .expect("remove artifact");
        assert!(matches!(
            read_verified_update_artifact(&artifact_path, &sha256).await,
            Err(ApplicationError::UpdateArtifactInvalid(_))
        ));
    }

    #[test]
    fn startup_cleanup_removes_stale_update_artifacts() {
        let dir = TestDir::new("cleanup");
        let cache_dir = dir.0.join("updates");
        fs::create_dir_all(&cache_dir).expect("create update cache");
        fs::write(cache_dir.join("stale.bin"), b"stale").expect("write stale artifact");

        cleanup_update_cache_dir(&cache_dir);

        assert!(!cache_dir.exists());
        assert!(dir.0.exists());
    }
}
