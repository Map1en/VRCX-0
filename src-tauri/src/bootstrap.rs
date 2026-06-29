use std::borrow::Cow;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::http::{header::CONTENT_TYPE, Request, Response, StatusCode};
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::{Emitter, Manager, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_notification::NotificationExt;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;

use crate::error::AppError;
use crate::localization::shell_locale::{
    self, AuthFailureNotificationLabels, BackgroundModeNotificationLabels, TrayLabels,
};
use crate::state::{AppState, BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY};
use vrcx_0_application::RuntimeEventSink;
use vrcx_0_application::{format_runtime_output_event, RuntimeOutputLevel, RuntimeOutputMode};
use vrcx_0_application::{BackendRuntimeMode, BackendRuntimePhase, BackendRuntimeSnapshot};
use vrcx_0_application::{RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle};
use vrcx_0_host::host_capabilities::{is_host_capability_available, HostCapability};
use vrcx_0_runtime_host::notification::DesktopNotifier;
use vrcx_0_runtime_host::RuntimeHostActions;

const AUTH_FAILURE_NOTIFICATION_COOLDOWN: Duration = Duration::from_secs(5);
const MAIN_WINDOW_REBUILD_DESTROY_TIMEOUT: Duration = Duration::from_secs(2);
const MAIN_WINDOW_REBUILD_DESTROY_POLL_INTERVAL: Duration = Duration::from_millis(50);

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
        handle_runtime_auth_failure_notification(&self.app_handle, event, &payload);
        let frontend_event = match event {
            "runtimeGameLogEvent" => "addGameLogEvent",
            event => event,
        };
        emit_to_main_window_if_visible(&self.app_handle, frontend_event, payload);
    }
}

#[derive(Clone)]
struct TauriDesktopNotifier {
    app_handle: tauri::AppHandle,
}

impl TauriDesktopNotifier {
    fn new(app_handle: tauri::AppHandle) -> Self {
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

fn handle_runtime_auth_failure_notification(
    app_handle: &tauri::AppHandle,
    event: &str,
    payload: &serde_json::Value,
) {
    if event != "realtimeWsStatus" || json_string_field(payload, "status") != "authFailure" {
        return;
    }
    let Some(state) = app_handle.try_state::<AppState>() else {
        return;
    };
    let snapshot = state.snapshot_backend_runtime();
    if snapshot.phase != BackendRuntimePhase::Running
        || snapshot.auth_status != "authenticated"
        || snapshot.ws_status != "authFailure"
        || snapshot.auth_user_id.trim().is_empty()
    {
        return;
    }

    let user_id = snapshot.auth_user_id.trim().to_string();
    let reason = json_string_field(payload, "reason");
    let notification_key = format!("{user_id}\n{reason}");
    show_auth_failure_notification_once(app_handle, &state, &notification_key);
}

pub(crate) fn show_auth_failure_notification_once(
    app_handle: &tauri::AppHandle,
    state: &AppState,
    key: &str,
) {
    let key = key.trim();
    let notification_key = if key.is_empty() {
        "auth-failure".to_string()
    } else {
        format!("auth-failure\n{key}")
    };
    if !state.should_emit_auth_failure_notification(
        &notification_key,
        AUTH_FAILURE_NOTIFICATION_COOLDOWN,
    ) {
        return;
    }

    let labels = auth_failure_notification_labels(state);
    if let Err(error) = app_handle
        .notification()
        .builder()
        .title(labels.title)
        .body(labels.body)
        .show()
    {
        tracing::warn!(error = %error, "failed to show auth failure notification");
    }
}

pub(crate) fn show_auth_failure_notification_after_backend_start_error(
    app_handle: &tauri::AppHandle,
    state: &AppState,
    reason: &str,
) {
    let snapshot = state.snapshot_backend_runtime();
    if snapshot.phase != BackendRuntimePhase::Idle || snapshot.auth_status != "signedOut" {
        return;
    }

    show_auth_failure_notification_once(app_handle, state, reason);
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

fn json_string_field(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
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

pub fn ensure_main_window(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if app.get_webview_window("main").is_none() {
        let state = app.state::<AppState>();
        create_main_window(app, state.web.proxy_url())?;
        disable_windows_default_context_menu(app);
    }
    let state = app.state::<AppState>();
    start_host_services(app, &state);
    present_main_window(app);
    let _ = refresh_tray_menu(app, &state);
    Ok(())
}

pub(crate) async fn rebuild_main_window(
    app: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error>> {
    let state = app.state::<AppState>();
    let _rebuild_guard = state.try_begin_main_window_rebuild().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "main window rebuild is already in progress",
        )
    })?;
    capture_background_resume_route(app, &state);

    if let Some(window) = app.get_webview_window("main") {
        window.destroy()?;
        wait_for_main_window_destroyed(app).await?;
    }

    create_main_window(app, state.web.proxy_url())?;
    disable_windows_default_context_menu(app);
    start_host_services(app, &state);
    present_main_window(app);
    let _ = refresh_tray_menu(app, &state);
    Ok(())
}

async fn wait_for_main_window_destroyed(
    app: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error>> {
    let wait_until_destroyed = async {
        while app.get_webview_window("main").is_some() {
            tokio::time::sleep(MAIN_WINDOW_REBUILD_DESTROY_POLL_INTERVAL).await;
        }
    };

    tokio::time::timeout(MAIN_WINDOW_REBUILD_DESTROY_TIMEOUT, wait_until_destroyed)
        .await
        .map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "main window label was not released before rebuild timeout",
            )
        })?;
    Ok(())
}

pub fn destroy_main_window_for_background_mode(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.destroy() {
            tracing::warn!(error = %error, "failed to destroy main window for background mode");
            let _ = window.hide();
            let _ = window.set_skip_taskbar(true);
        }
    }
}

pub fn capture_background_resume_route(app: &tauri::AppHandle, state: &AppState) {
    let route = app
        .get_webview_window("main")
        .and_then(|window| window.url().ok())
        .and_then(|url| normalize_background_resume_route(url.fragment().unwrap_or_default()));
    match route {
        Some(route) => {
            state.storage.set(
                BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY.to_string(),
                route.clone(),
            );
            state.set_background_resume_route(Some(route));
        }
        None => {
            let _ = state
                .storage
                .remove(BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY);
            state.set_background_resume_route(None);
        }
    }
}

pub async fn start_background_mode_for_current_session(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<BackendRuntimeSnapshot, AppError> {
    capture_background_resume_route(app, state);
    let snapshot = match state
        .start_backend_runtime(BackendRuntimeMode::Background)
        .await
    {
        Ok(snapshot) => snapshot,
        Err(error) => {
            show_auth_failure_notification_after_backend_start_error(
                app,
                state,
                &error.to_string(),
            );
            let _ = refresh_tray_menu(app, state);
            return Err(error.into());
        }
    };
    let current = state.snapshot_backend_runtime();
    if snapshot.mode == BackendRuntimeMode::Background
        && current.mode == BackendRuntimeMode::Background
        && current.phase == BackendRuntimePhase::Running
    {
        show_background_mode_started_notification(app, state);
        destroy_main_window_for_background_mode(app);
    }
    let _ = refresh_tray_menu(app, state);
    Ok(snapshot)
}

pub fn restore_foreground_window_from_background_mode(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<vrcx_0_application::BackendRuntimeSnapshot, Box<dyn std::error::Error>> {
    let current = state.snapshot_backend_runtime();
    if current.mode != BackendRuntimeMode::Background {
        ensure_main_window(app)?;
        let _ = refresh_tray_menu(app, state);
        return Ok(current);
    }
    let snapshot = state.set_gui_backend_runtime_mode(BackendRuntimeMode::Foreground);
    defer_frontend_maintenance_after_background_restore(state);
    ensure_main_window(app)?;
    let _ = refresh_tray_menu(app, state);
    Ok(snapshot)
}

fn defer_frontend_maintenance_after_background_restore(state: &AppState) {
    for (name, delay_seconds) in [("appUpdateCheck", 180), ("clearVRCXCacheCheck", 300)] {
        state
            .runtime_context
            .background_jobs
            .defer_frontend_job(name, delay_seconds);
    }
}

fn normalize_background_resume_route(raw: &str) -> Option<String> {
    let route = raw.trim().trim_start_matches('#').trim();
    if route.is_empty()
        || route == "/"
        || route.starts_with("/login")
        || !route.starts_with('/')
        || route.starts_with("//")
        || route.len() > 2048
        || route.chars().any(char::is_control)
        || route.contains('\\')
    {
        return None;
    }
    Some(route.to_string())
}

fn present_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(false);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn init_error_logging(app_data: Option<PathBuf>) {
    let Some(app_data) = app_data.or_else(vrcx_0_host::error_log::default_app_data_dir) else {
        return;
    };

    let default_panic_hook = std::panic::take_hook();
    let panic_app_data = app_data.clone();
    std::panic::set_hook(Box::new(move |panic_info| {
        vrcx_0_host::error_log::append_error_log(
            &panic_app_data,
            "rust:panic",
            &panic_info.to_string(),
        );
        default_panic_hook(panic_info);
    }));

    let tracing_app_data = app_data;
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer().with_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| "vrcx_0=info".into()),
            ),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(move || {
                    vrcx_0_host::error_log::ErrorLogWriter::new(tracing_app_data.clone())
                })
                .with_filter(LevelFilter::ERROR),
        )
        .init();
}

pub fn init_tls_crypto_provider() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}

pub fn updater_public_key() -> String {
    match option_env!("TAURI_UPDATER_PUBLIC_KEY") {
        Some(value) if !value.trim().is_empty() => value.to_string(),
        _ => "TAURI_UPDATER_PUBLIC_KEY_NOT_CONFIGURED".to_string(),
    }
}

pub fn screenshot_protocol_response(
    request: Request<Vec<u8>>,
    paths: &vrcx_0_host::app_paths::AppPaths,
) -> Response<Cow<'static, [u8]>> {
    let path = match percent_encoding::percent_decode_str(&request.uri().path()[1..]).decode_utf8()
    {
        Ok(path) => path.into_owned(),
        Err(_) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Vec::new().into())
                .unwrap();
        }
    };

    let path_buf = std::path::PathBuf::from(&path);
    let is_png = path_buf
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("png"));

    if !is_png || !path_buf.is_file() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new().into())
            .unwrap();
    }

    if !crate::adapters::host_file_access::is_known_root_path(&path_buf, paths) {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new().into())
            .unwrap();
    }

    match std::fs::read(&path_buf) {
        Ok(bytes) => Response::builder()
            .header(CONTENT_TYPE, "image/png")
            .body(bytes.into())
            .unwrap(),
        Err(_) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Vec::new().into())
            .unwrap(),
    }
}

pub fn screenshot_thumbnail_protocol_response(
    request: Request<Vec<u8>>,
    paths: &vrcx_0_host::app_paths::AppPaths,
) -> Response<Cow<'static, [u8]>> {
    let path = match percent_encoding::percent_decode_str(&request.uri().path()[1..]).decode_utf8()
    {
        Ok(path) => path.into_owned(),
        Err(_) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Vec::new().into())
                .unwrap();
        }
    };

    let path_buf = std::path::PathBuf::from(&path);
    let is_webp = path_buf
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("webp"));

    if !is_webp
        || !path_buf.is_file()
        || !vrcx_0_host::path_utils::is_path_inside_directory(&path_buf, &paths.screenshot_thumbs)
    {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new().into())
            .unwrap();
    }

    match std::fs::read(&path_buf) {
        Ok(bytes) => Response::builder()
            .header(CONTENT_TYPE, "image/webp")
            .body(bytes.into())
            .unwrap(),
        Err(_) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Vec::new().into())
            .unwrap(),
    }
}

fn background_image_content_type(path: &std::path::Path) -> Option<&'static str> {
    let extension = path.extension().and_then(|ext| ext.to_str())?;
    if extension.eq_ignore_ascii_case("jpg") || extension.eq_ignore_ascii_case("jpeg") {
        return Some("image/jpeg");
    }
    if extension.eq_ignore_ascii_case("png") {
        return Some("image/png");
    }
    if extension.eq_ignore_ascii_case("webp") {
        return Some("image/webp");
    }
    None
}

pub fn background_image_protocol_response(
    request: Request<Vec<u8>>,
    state: &AppState,
) -> Response<Cow<'static, [u8]>> {
    let raw_path = request.uri().path().trim_start_matches('/');
    if raw_path.is_empty() {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Vec::new().into())
            .unwrap();
    }

    let path = match percent_encoding::percent_decode_str(raw_path).decode_utf8() {
        Ok(path) => path.into_owned(),
        Err(_) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Vec::new().into())
                .unwrap();
        }
    };

    let path_buf = std::path::PathBuf::from(&path);
    let Some(content_type) = background_image_content_type(&path_buf) else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new().into())
            .unwrap();
    };

    if !path_buf.is_file()
        || state
            .host_file_access
            .ensure_read_allowed(&path_buf, &state.paths)
            .is_err()
    {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new().into())
            .unwrap();
    }

    match std::fs::read(&path_buf) {
        Ok(bytes) => Response::builder()
            .header(CONTENT_TYPE, content_type)
            .body(bytes.into())
            .unwrap(),
        Err(_) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Vec::new().into())
            .unwrap(),
    }
}

pub fn apply_linux_webkit_workaround() {
    #[cfg(target_os = "linux")]
    {
        use webkit2gtk_nvidia_quirk::{apply_workaround_with_options, ApplyWorkaroundOptions};

        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            tracing::info!("disabling WebKitGTK DMABUF renderer on Linux");
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }

        apply_workaround_with_options(ApplyWorkaroundOptions::default());
    }
}

pub fn setup_app_with_data_dir(
    app: &mut tauri::App,
    app_data_dir: vrcx_0_host::app_paths::AppDataDirResolution,
) -> Result<(), Box<dyn std::error::Error>> {
    let app_state = AppState::new(app_data_dir).expect("failed to initialize app state");
    let language = app_language(&app_state);
    app.manage(app_state);

    let state = app.state::<AppState>();
    state
        .runtime_context
        .set_notification_desktop_notifier(Arc::new(TauriDesktopNotifier::new(
            app.handle().clone(),
        )));
    let _ = state
        .storage
        .remove(BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY);
    state.runtime_context.runtime.record_phase(
        "appState",
        "completed",
        "Backend AppState initialized.",
    );
    state.runtime_context.sync.record(
        "startup",
        "running",
        "Tauri setup is wiring runtime services.",
        0,
    );
    create_main_window(app.handle(), state.web.proxy_url())?;
    state.runtime_context.runtime.record_phase(
        "mainWindow",
        "completed",
        "Main webview window created.",
    );

    disable_windows_default_context_menu(app.handle());

    let state = app.state::<AppState>();
    configure_tray(app, &state)?;
    state
        .runtime_context
        .runtime
        .record_phase("tray", "completed", "System tray configured.");
    #[cfg(target_os = "macos")]
    crate::macos_menu::configure_macos_app_menu(app.handle(), &language)?;
    #[cfg(not(target_os = "macos"))]
    let _ = language;
    sync_autostart_from_db(app, &state);
    apply_autostart_window_state_if_needed(app, &state);
    start_host_services(app.handle(), &state);
    start_mcp_server_if_enabled(app.handle());
    state
        .runtime_context
        .sync
        .record("startup", "ready", "Backend host services are ready.", 0);

    Ok(())
}

fn create_main_window(
    app: &tauri::AppHandle,
    proxy_url: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }

    let window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "main")
        .ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "missing main window config")
        })?;

    let mut builder = WebviewWindowBuilder::from_config(app, window_config)?;
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .decorations(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 16.0));
    }
    let state = app.state::<AppState>();
    if let Some(route) = state.take_background_resume_route() {
        let route = serde_json::to_string(&route)?;
        builder = builder.initialization_script(format!(
            r#"
(() => {{
  const route = {route};
  if (typeof route === 'string' && route.startsWith('/')) {{
    window.__VRCX_BACKGROUND_ROUTE_RESUME_PENDING__ = true;
    window.location.hash = `#${{route}}`;
  }}
}})();
"#
        ));
    }
    if let Some(proxy_url) = proxy_url {
        let proxy_url = proxy_url
            .parse()
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?;
        builder = builder.proxy_url(proxy_url);
    }

    builder.build()?;
    Ok(())
}

fn db_config_bool(state: &AppState, key: &str) -> Option<bool> {
    state.runtime_context.config().get_bool(key, false).ok()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AutostartWindowAction {
    None,
    Minimize,
    HideToTray { start_background: bool },
}

fn autostart_window_action(
    launched_from_autostart: bool,
    start_minimized: bool,
    close_to_tray: bool,
    background_mode_enabled: bool,
) -> AutostartWindowAction {
    if !launched_from_autostart || !start_minimized {
        return AutostartWindowAction::None;
    }
    if close_to_tray {
        return AutostartWindowAction::HideToTray {
            start_background: background_mode_enabled,
        };
    }
    AutostartWindowAction::Minimize
}

fn disable_windows_default_context_menu(app: &tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    if let Some(webview) = app.get_webview_window("main") {
        if let Err(error) = webview.with_webview(|platform_webview| {
            let result = unsafe {
                platform_webview
                    .controller()
                    .CoreWebView2()
                    .and_then(|webview| webview.Settings())
                    .and_then(|settings| settings.SetAreDefaultContextMenusEnabled(false))
            };

            if let Err(error) = result {
                tracing::warn!(?error, "failed to disable WebView2 default context menu");
            }
        }) {
            tracing::warn!(?error, "failed to access WebView2 instance");
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

fn configure_tray(app: &tauri::App, state: &AppState) -> Result<(), tauri::Error> {
    refresh_tray_menu(app.handle(), state)
}

pub fn refresh_tray_menu(app: &tauri::AppHandle, state: &AppState) -> Result<(), tauri::Error> {
    if let Some(tray) = app.tray_by_id("main") {
        let labels = tray_labels(state);
        let background_mode_active = is_background_mode_active(state);
        let community_theme_enabled = is_community_theme_enabled(state);
        let open_item = MenuItem::with_id(app, "tray-open", labels.open, true, None::<&str>)?;
        let background_item = CheckMenuItem::with_id(
            app,
            "tray-toggle-background-mode",
            labels.background_mode,
            true,
            background_mode_active,
            None::<&str>,
        )?;
        #[cfg(target_os = "linux")]
        let rebuild_ui_item = MenuItem::with_id(
            app,
            "tray-rebuild-ui",
            labels.rebuild_ui,
            !background_mode_active,
            None::<&str>,
        )?;
        let disable_theme_item = MenuItem::with_id(
            app,
            "tray-disable-theme",
            labels.disable_theme,
            true,
            None::<&str>,
        )?;
        let exit_item = MenuItem::with_id(app, "tray-exit", labels.exit, true, None::<&str>)?;
        let menu = Menu::new(app)?;
        menu.append(&open_item)?;
        menu.append(&background_item)?;
        #[cfg(target_os = "linux")]
        menu.append(&rebuild_ui_item)?;
        if community_theme_enabled {
            menu.append(&disable_theme_item)?;
        }
        menu.append(&exit_item)?;
        let _ = tray.set_menu(Some(menu));
        let _ = tray.set_show_menu_on_left_click(false);
    }
    Ok(())
}

pub(crate) fn show_background_mode_started_notification(app: &tauri::AppHandle, state: &AppState) {
    let labels = background_mode_notification_labels(state);
    if let Err(error) = app
        .notification()
        .builder()
        .title(labels.title)
        .body(labels.body)
        .show()
    {
        tracing::warn!(error = %error, "failed to show background mode notification");
    }
}

fn is_background_mode_active(state: &AppState) -> bool {
    let snapshot = state.snapshot_backend_runtime();
    snapshot.mode == BackendRuntimeMode::Background
        && snapshot.phase == BackendRuntimePhase::Running
}

fn is_community_theme_enabled(state: &AppState) -> bool {
    db_config_bool(state, "config:vrcx_communitythemeenabled") == Some(true)
}

fn app_language(state: &AppState) -> String {
    state
        .runtime_context
        .config()
        .get_string("appLanguage", "en")
        .unwrap_or_else(|_| "en".into())
        .to_ascii_lowercase()
}

fn background_mode_notification_labels(state: &AppState) -> BackgroundModeNotificationLabels {
    shell_locale::background_mode_notification_labels_for_language(&app_language(state))
}

fn auth_failure_notification_labels(state: &AppState) -> AuthFailureNotificationLabels {
    auth_failure_notification_labels_for_language(&app_language(state))
}

fn auth_failure_notification_labels_for_language(language: &str) -> AuthFailureNotificationLabels {
    shell_locale::auth_failure_notification_labels_for_language(language)
}

fn tray_labels(state: &AppState) -> TrayLabels {
    shell_locale::tray_labels_for_language(&app_language(state))
}

fn sync_autostart_from_db(app: &tauri::App, state: &AppState) {
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        if db_config_bool(state, "config:vrcx_startatwindowsstartup") == Some(true) {
            if let Err(error) = app.autolaunch().enable() {
                tracing::warn!(error = %error, "failed to synchronize autostart preference");
            }
        }
        state.runtime_context.runtime.record_phase(
            "autostart",
            "completed",
            "Autostart preference synchronized.",
        );
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = app;
        state.runtime_context.runtime.record_phase(
            "autostart",
            "skipped",
            "Autostart synchronization is unavailable on this platform.",
        );
    }
}

fn apply_autostart_window_state_if_needed(app: &tauri::App, state: &AppState) {
    let action = autostart_window_action(
        state.launched_from_autostart,
        state.storage.get("VRCX_StartAsMinimizedState").as_deref() == Some("true"),
        state.storage.get("VRCX_CloseToTray").as_deref() == Some("true"),
        db_config_bool(state, "backgroundModeEnabled") == Some(true),
    );
    if action == AutostartWindowAction::None {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let window = window.clone();
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        match action {
            AutostartWindowAction::HideToTray { start_background } => {
                let _ = window.hide();
                let _ = window.set_skip_taskbar(true);
                if start_background {
                    let Some(state) = app_handle.try_state::<AppState>() else {
                        return;
                    };
                    if let Err(error) =
                        start_background_mode_for_current_session(&app_handle, &state).await
                    {
                        tracing::warn!(
                            error = %error,
                            "failed to start background mode from autostart"
                        );
                    }
                }
            }
            AutostartWindowAction::Minimize => {
                let _ = window.set_skip_taskbar(false);
                let _ = window.minimize();
            }
            AutostartWindowAction::None => {}
        }
    });
}

fn start_host_services(app: &tauri::AppHandle, state: &AppState) {
    state.set_event_sink(TauriRuntimeEventSink::new(app.clone()));
    state
        .runtime_context
        .host
        .set_actions(TauriRuntimeHostActions::new(app.clone()));
    state
        .runtime_context
        .tasks
        .set_executor(TauriRuntimeTaskExecutor);
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

fn start_mcp_server_if_enabled(app: &tauri::AppHandle) {
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
mod tests {
    use super::*;

    #[test]
    fn auth_failure_notification_label_language_prefixes_are_localized() {
        assert_eq!(
            auth_failure_notification_labels_for_language("zh-CN").title,
            "VRChat 登录已失效"
        );
        assert_eq!(
            auth_failure_notification_labels_for_language("zh-TW").title,
            "VRChat 登入已過期"
        );
        assert_eq!(
            auth_failure_notification_labels_for_language("ja").title,
            "VRChat ログインの有効期限が切れました"
        );
    }

    #[test]
    fn autostart_minimized_to_tray_starts_background_when_enabled() {
        assert_eq!(
            autostart_window_action(true, true, true, true),
            AutostartWindowAction::HideToTray {
                start_background: true
            }
        );
    }

    #[test]
    fn autostart_minimized_to_tray_does_not_start_background_when_disabled() {
        assert_eq!(
            autostart_window_action(true, true, true, false),
            AutostartWindowAction::HideToTray {
                start_background: false
            }
        );
    }
}
