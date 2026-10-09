#![allow(non_snake_case)]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use vrcx_0_application_core::RuntimeOperationStatus;

use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tracing::Level;
use tracing_subscriber::filter::filter_fn;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;
use vrcx_0_contracts::CollectorAuthStatus;

use crate::state::{AppState, BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY};
use vrcx_0_application_core::RuntimeTaskExecutor;
use vrcx_0_runtime_host_desktop::deep_link::{parse_deep_link, queue_deep_link_action};

use super::adapters::{
    start_host_services, start_mcp_server_if_enabled, TauriDesktopNotifier, TauriUpdaterPort,
};
use super::autostart::{apply_autostart_window_state_if_needed, sync_autostart_from_db};
use super::shared::app_language;
use super::window::{configure_tray, configure_windows_webview_settings, create_main_window};

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStatus {
    pub connected: bool,
    pub has_saved_choice: bool,
    pub is_remote: bool,
    pub server_url: Option<String>,
    pub connecting: bool,
    pub error: Option<String>,
}

pub struct BootstrapState {
    app_data_dir: vrcx_0_platform::app_paths::AppDataDirResolution,
    maintenance_cache_dir: Option<PathBuf>,
    updater_port: Arc<TauriUpdaterPort>,
    task_executor: Arc<dyn RuntimeTaskExecutor>,
    status: Mutex<BootstrapStatus>,
    connect_lock: tokio::sync::Mutex<()>,
    explicit_choice_requested: AtomicBool,
}

#[tauri::command(async)]
#[specta::specta]
pub async fn app__collector_auth_status_get(
    app: tauri::AppHandle,
) -> Result<CollectorAuthStatus, String> {
    collector_auth_request(&app, "GET", "/api/auth/status", None).await
}

#[tauri::command(async)]
#[specta::specta]
pub async fn app__collector_auth_login(
    app: tauri::AppHandle,
    username: String,
    password: String,
) -> Result<CollectorAuthStatus, String> {
    collector_auth_request(
        &app,
        "POST",
        "/api/auth/login",
        Some(serde_json::json!({ "username": username, "password": password })),
    )
    .await
}

#[tauri::command(async)]
#[specta::specta]
pub async fn app__collector_auth_verify(
    app: tauri::AppHandle,
    attempt_id: String,
    method: String,
    code: String,
) -> Result<CollectorAuthStatus, String> {
    collector_auth_request(
        &app,
        "POST",
        "/api/auth/verify",
        Some(serde_json::json!({ "attemptId": attempt_id, "method": method, "code": code })),
    )
    .await
}

#[tauri::command(async)]
#[specta::specta]
pub async fn app__collector_auth_cancel(
    app: tauri::AppHandle,
    attempt_id: String,
) -> Result<CollectorAuthStatus, String> {
    collector_auth_request(
        &app,
        "POST",
        "/api/auth/cancel",
        Some(serde_json::json!({ "attemptId": attempt_id })),
    )
    .await
}

async fn collector_auth_request(
    app: &tauri::AppHandle,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<CollectorAuthStatus, String> {
    let bootstrap = app
        .try_state::<BootstrapState>()
        .ok_or_else(|| "Remote server settings are unavailable.".to_string())?;
    let connection =
        vrcx_0_composition::RemoteDatabaseConnection::load(&bootstrap.app_data_dir.current_dir)
            .map_err(|_| "Could not read remote server settings.".to_string())?
            .ok_or_else(|| "No remote server is configured.".to_string())?;
    let url = format!("{}{path}", connection.server_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .connect_timeout(std::time::Duration::from_secs(4))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not connect to the collector server.".to_string())?;
    let mut request = match method {
        "GET" => client.get(&url),
        _ => client.post(&url),
    }
    .bearer_auth(&connection.token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Could not reach the collector server. Check its connection.".to_string())?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "The remote server access token was rejected.".to_string(),
            404 => "Collector authentication is unavailable on this server version.".to_string(),
            _ => "The collector server could not complete the authentication request.".to_string(),
        });
    }
    response
        .json::<CollectorAuthStatus>()
        .await
        .map_err(|_| "The collector server returned an invalid authentication status.".to_string())
}

impl BootstrapState {
    fn new(
        app_data_dir: vrcx_0_platform::app_paths::AppDataDirResolution,
        maintenance_cache_dir: Option<PathBuf>,
        updater_port: Arc<TauriUpdaterPort>,
    ) -> Self {
        Self {
            app_data_dir,
            maintenance_cache_dir,
            updater_port,
            task_executor: Arc::new(super::adapters::TauriRuntimeTaskExecutor),
            status: Mutex::new(BootstrapStatus {
                connected: false,
                has_saved_choice: false,
                is_remote: false,
                server_url: None,
                connecting: false,
                error: None,
            }),
            connect_lock: tokio::sync::Mutex::new(()),
            explicit_choice_requested: AtomicBool::new(false),
        }
    }

    fn status(&self) -> BootstrapStatus {
        self.status
            .lock()
            .expect("bootstrap status poisoned")
            .clone()
    }
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__bootstrap_status_get(
    _app: tauri::AppHandle,
    state: tauri::State<'_, BootstrapState>,
) -> BootstrapStatus {
    state.status()
}

#[tauri::command(async)]
#[specta::specta]
pub async fn app__bootstrap_connect(
    app: tauri::AppHandle,
    state: tauri::State<'_, BootstrapState>,
    server_url: String,
    token: String,
) -> Result<BootstrapStatus, String> {
    state
        .explicit_choice_requested
        .store(true, Ordering::Release);
    connect_remote_database(&app, state.inner(), server_url, token).await
}

#[tauri::command(async)]
#[specta::specta]
pub async fn app__bootstrap_retry_saved(app: tauri::AppHandle) -> Result<BootstrapStatus, String> {
    let bootstrap = app
        .try_state::<BootstrapState>()
        .ok_or_else(|| "Bootstrap is unavailable".to_string())?;
    bootstrap
        .explicit_choice_requested
        .store(true, Ordering::Release);
    let connection =
        vrcx_0_composition::RemoteDatabaseConnection::load(&bootstrap.app_data_dir.current_dir)
            .map_err(|error| format!("Could not read remote server settings: {error}"))?
            .ok_or_else(|| "No saved remote server settings".to_string())?;
    connect_remote_database(&app, &bootstrap, connection.server_url, connection.token).await
}

#[tauri::command(async)]
#[specta::specta]
pub async fn app__bootstrap_choose_local(app: tauri::AppHandle) -> Result<BootstrapStatus, String> {
    let bootstrap = app
        .try_state::<BootstrapState>()
        .ok_or_else(|| "Bootstrap is unavailable".to_string())?;
    bootstrap
        .explicit_choice_requested
        .store(true, Ordering::Release);
    connect_local_database(&app, &bootstrap, true).await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__bootstrap_save_storage(
    app: tauri::AppHandle,
    use_remote: bool,
    server_url: String,
    token: String,
) -> Result<(), String> {
    if app.try_state::<AppState>().is_none() {
        return Err("Connect to a storage profile before changing it.".into());
    }
    let bootstrap = app
        .try_state::<BootstrapState>()
        .ok_or_else(|| "Bootstrap is unavailable".to_string())?;
    let app_data_dir = &bootstrap.app_data_dir.current_dir;
    if use_remote {
        let server_url = server_url.trim().trim_end_matches('/').to_string();
        let token = if token.trim().is_empty() {
            let current = vrcx_0_composition::RemoteDatabaseConnection::load(app_data_dir)
                .map_err(|error| error.to_string())?;
            current
                .filter(|connection| connection.server_url.trim_end_matches('/') == server_url)
                .map(|connection| connection.token)
                .ok_or_else(|| "Enter an access token for this server.".to_string())?
        } else {
            token.trim().to_string()
        };
        vrcx_0_composition::RemoteDatabaseConnection { server_url, token }
            .save(app_data_dir)
            .map_err(|error| error.to_string())?;
    } else {
        vrcx_0_composition::RemoteDatabaseConnection::choose_local(app_data_dir)
            .map_err(|error| error.to_string())?;
    }
    crate::commands::host::window::restart_now(&app);
    Ok(())
}

async fn connect_remote_database(
    app: &tauri::AppHandle,
    bootstrap: &BootstrapState,
    server_url: String,
    token: String,
) -> Result<BootstrapStatus, String> {
    let _guard = bootstrap.connect_lock.lock().await;
    if app.try_state::<AppState>().is_some() {
        return Ok(bootstrap.status());
    }
    {
        let mut status = bootstrap
            .status
            .lock()
            .map_err(|_| "Connection status unavailable".to_string())?;
        status.connecting = true;
        status.error = None;
        status.has_saved_choice = true;
        status.is_remote = true;
        status.server_url = Some(server_url.clone());
    }
    let result = async {
        let connection = vrcx_0_composition::RemoteDatabaseConnection {
            server_url: server_url.clone(),
            token: token.clone(),
        };
        connection
            .save(&bootstrap.app_data_dir.current_dir)
            .map_err(|error| safe_connection_error(error.to_string(), &token))?;

        let app_data_dir = bootstrap.app_data_dir.clone();
        let cache_dir = bootstrap.maintenance_cache_dir.clone();
        let updater_port = bootstrap.updater_port.clone();
        let task_executor = bootstrap.task_executor.clone();
        let app_state = tauri::async_runtime::spawn_blocking(move || {
            AppState::new(app_data_dir, cache_dir, updater_port, task_executor)
        })
        .await
        .map_err(|error| format!("Could not start the application: {error}"))?
        .map_err(|error| safe_connection_error(error.to_string(), &token))?;

        app.manage(app_state);
        let state = app.state::<AppState>();
        finish_connected_setup(app, &state)
            .map_err(|error| safe_connection_error(error.to_string(), &token))?;
        Ok::<_, String>(())
    }
    .await;

    let mut status = bootstrap
        .status
        .lock()
        .map_err(|_| "Connection status unavailable".to_string())?;
    status.connecting = false;
    match result {
        Ok(()) => {
            status.connected = true;
            status.server_url = Some(server_url);
            status.error = None;
            Ok(status.clone())
        }
        Err(error) => {
            status.connected = app.try_state::<AppState>().is_some();
            status.error = Some(error.clone());
            Err(error)
        }
    }
}

async fn connect_local_database(
    app: &tauri::AppHandle,
    bootstrap: &BootstrapState,
    persist_choice: bool,
) -> Result<BootstrapStatus, String> {
    let _guard = bootstrap.connect_lock.lock().await;
    let has_saved_choice = persist_choice
        || vrcx_0_composition::RemoteDatabaseConnection::is_local_configured(
            &bootstrap.app_data_dir.current_dir,
        );
    if !persist_choice && bootstrap.explicit_choice_requested.load(Ordering::Acquire) {
        return Ok(bootstrap.status());
    }
    if app.try_state::<AppState>().is_some() {
        return Ok(bootstrap.status());
    }
    if persist_choice {
        vrcx_0_composition::RemoteDatabaseConnection::choose_local(
            &bootstrap.app_data_dir.current_dir,
        )
        .map_err(|error| format!("Could not save local storage settings: {error}"))?;
    }
    {
        let mut status = bootstrap
            .status
            .lock()
            .map_err(|_| "Connection status unavailable".to_string())?;
        status.connecting = true;
        status.error = None;
        status.has_saved_choice = has_saved_choice;
        status.is_remote = false;
        status.server_url = None;
    }
    let app_data_dir = bootstrap.app_data_dir.clone();
    let cache_dir = bootstrap.maintenance_cache_dir.clone();
    let updater_port = bootstrap.updater_port.clone();
    let task_executor = bootstrap.task_executor.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        AppState::new(app_data_dir, cache_dir, updater_port, task_executor)
    })
    .await
    .map_err(|error| format!("Could not start the application: {error}"))
    .and_then(|result| result.map_err(|error| error.to_string()))
    .and_then(|app_state| {
        if !persist_choice && bootstrap.explicit_choice_requested.load(Ordering::Acquire) {
            return Ok(());
        }
        app.manage(app_state);
        let state = app.state::<AppState>();
        finish_connected_setup(app, &state).map_err(|error| error.to_string())
    });

    let mut status = bootstrap
        .status
        .lock()
        .map_err(|_| "Connection status unavailable".to_string())?;
    status.connecting = false;
    match result {
        Ok(()) => {
            status.connected = app.try_state::<AppState>().is_some();
            status.error = None;
            Ok(status.clone())
        }
        Err(error) => {
            status.connected = false;
            status.error = Some(error.clone());
            Err(error)
        }
    }
}

fn safe_connection_error(error: String, token: &str) -> String {
    let token = token.trim();
    if token.is_empty() {
        error
    } else {
        error.replace(token, "[redacted]")
    }
}

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
#[cfg(target_os = "windows")]
const WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: &str = "--disable-back-forward-cache --disable-domain-reliability --disable-features=AutofillServerCommunication,BackgroundFetch,MediaRouter --disable-file-system --disable-notifications --disable-presentation-api --disable-remote-playback-api --disable-shared-workers --disable-speech-api --force-prefers-no-reduced-motion";

fn should_capture_gui_error(level: &Level, target: &str) -> bool {
    level == &Level::ERROR
        && (target == "vrcx_0" || target.starts_with("vrcx_0::") || target.starts_with("vrcx_0_"))
}

pub fn init_error_logging(app_data: Option<PathBuf>) {
    let Some(app_data) = app_data.or_else(vrcx_0_platform::error_log::default_app_data_dir) else {
        return;
    };

    let default_panic_hook = std::panic::take_hook();
    let panic_app_data = app_data.clone();
    std::panic::set_hook(Box::new(move |panic_info| {
        vrcx_0_platform::error_log::append_panic_error_log_with_version(
            &panic_app_data,
            panic_info,
            APP_VERSION,
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
                    vrcx_0_platform::error_log::ErrorLogWriter::new_with_version(
                        tracing_app_data.clone(),
                        APP_VERSION,
                    )
                })
                .with_filter(filter_fn(|metadata| {
                    should_capture_gui_error(metadata.level(), metadata.target())
                })),
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

pub fn app_update_build_label() -> String {
    option_env!("VRCX_0_BUILD_LABEL")
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

pub fn app_update_build_badge() -> String {
    option_env!("VRCX_0_BUILD_BADGE")
        .unwrap_or("")
        .trim()
        .to_string()
}

pub fn app_update_check_disabled() -> bool {
    option_env!("VRCX_0_DISABLE_UPDATE_CHECK") == Some("1")
}

pub fn configure_webview2_environment() {
    #[cfg(target_os = "windows")]
    {
        const KEY: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
        let arguments = append_browser_arguments(
            std::env::var_os(KEY).as_deref(),
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
        );
        std::env::set_var(KEY, arguments);
    }
}

#[cfg(target_os = "windows")]
fn append_browser_arguments(
    existing: Option<&std::ffi::OsStr>,
    additional: &str,
) -> std::ffi::OsString {
    let mut arguments = existing.unwrap_or_default().to_os_string();
    if !arguments.is_empty() {
        arguments.push(" ");
    }
    arguments.push(additional);
    arguments
}

pub fn setup_app_with_data_dir(
    app: &mut tauri::App,
    app_data_dir: vrcx_0_platform::app_paths::AppDataDirResolution,
) -> Result<(), Box<dyn std::error::Error>> {
    let updater_port = Arc::new(TauriUpdaterPort::new(app.handle().clone()));
    let cache_dir = match app.path().app_cache_dir() {
        Ok(path) => Some(path),
        Err(error) => {
            tracing::warn!(error = %error, "failed to resolve Tauri cache directory for database maintenance");
            None
        }
    };
    app.manage(BootstrapState::new(
        app_data_dir.clone(),
        cache_dir,
        updater_port,
    ));
    create_main_window(app.handle(), None)?;
    configure_windows_webview_settings(app.handle());

    match vrcx_0_composition::RemoteDatabaseConnection::load(&app_data_dir.current_dir) {
        Ok(Some(connection)) => {
            if let Some(bootstrap) = app.try_state::<BootstrapState>() {
                if let Ok(mut status) = bootstrap.status.lock() {
                    status.has_saved_choice = true;
                    status.is_remote = true;
                    status.server_url = Some(connection.server_url.clone());
                }
            }
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = connect_remote_database(
                    &app_handle,
                    &app_handle.state::<BootstrapState>(),
                    connection.server_url,
                    connection.token,
                )
                .await;
            });
        }
        Ok(None) => {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let bootstrap = app_handle.state::<BootstrapState>();
                let _ = connect_local_database(&app_handle, &bootstrap, false).await;
            });
        }
        Err(error) => {
            if let Some(bootstrap) = app.try_state::<BootstrapState>() {
                if let Ok(mut status) = bootstrap.status.lock() {
                    status.error = Some(format!("Could not read remote server settings: {error}"));
                }
            }
        }
    }

    Ok(())
}

fn finish_connected_setup(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<(), Box<dyn std::error::Error>> {
    super::sidebar_auto_hide::load_saved_preference(app, state);
    let language = app_language(state);
    state
        .runtime_host()
        .set_notification_desktop_notifier(Arc::new(TauriDesktopNotifier::new(app.clone())));
    let _ = state
        .runtime_host()
        .storage_remove(BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY);
    state.runtime_host().record_lifecycle_phase(
        "appState",
        RuntimeOperationStatus::Completed,
        "Backend AppState initialized.",
    );
    state.runtime_host().record_sync(
        "startup",
        RuntimeOperationStatus::Running,
        "Tauri setup is wiring runtime services.",
        0,
    );
    super::linux_rendering::resolve(app, state);
    super::linux_rendering::start_fallback(app);
    state.runtime_host().record_lifecycle_phase(
        "mainWindow",
        RuntimeOperationStatus::Completed,
        "Main webview window created.",
    );
    configure_tray(app, state)?;
    super::tray_shortcut::setup(app, state);
    state.runtime_host().record_lifecycle_phase(
        "tray",
        RuntimeOperationStatus::Completed,
        "System tray configured.",
    );
    #[cfg(target_os = "macos")]
    crate::macos_menu::configure_macos_app_menu(app, &language)?;
    #[cfg(not(target_os = "macos"))]
    let _ = language;
    sync_autostart_from_db(app, state);
    apply_autostart_window_state_if_needed(app, state);
    start_host_services(app, state);
    start_mcp_server_if_enabled(app);
    wire_deep_links(app);
    state.runtime_host().record_sync(
        "startup",
        RuntimeOperationStatus::Ready,
        "Backend host services are ready.",
        0,
    );
    Ok(())
}

fn wire_deep_links(app: &tauri::AppHandle) {
    #[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
    if let Err(error) = app.deep_link().register_all() {
        tracing::warn!(error = %error, "failed to register development deep link schemes");
    }

    match app.deep_link().get_current() {
        Ok(Some(urls)) => {
            for url in urls {
                queue_deep_link_url(app, url.as_str());
            }
        }
        Ok(None) => {}
        Err(error) => {
            tracing::warn!(error = %error, "failed to read launch deep links");
        }
    }

    let app_handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            queue_deep_link_url(&app_handle, url.as_str());
        }
    });
}

fn queue_deep_link_url(app: &tauri::AppHandle, value: &str) {
    let Some(action) = parse_deep_link(value) else {
        tracing::warn!(url = %value, "ignored unsupported deep link");
        return;
    };
    let Some(state) = app.try_state::<AppState>() else {
        tracing::warn!(url = %value, "ignored deep link before app state was ready");
        return;
    };
    if state.runtime_host().privacy_lock().is_locked() {
        tracing::info!("dropped deep link while the privacy lock is engaged");
        return;
    }
    queue_deep_link_action(state.pending_deep_links(), action, || {
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let main_thread_handle = app_handle.clone();
            if let Err(error) = app_handle.run_on_main_thread(move || {
                show_main_window_for_deep_link(&main_thread_handle);
                emit_deep_link_arrived(&main_thread_handle);
            }) {
                tracing::warn!(error = %error, "failed to schedule deep link window restore");
            }
        });
    });
}

fn show_main_window_for_deep_link(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Err(error) =
            super::window::restore_foreground_window_from_background_mode(app, &state)
        {
            tracing::warn!(error = %error, "failed to show main window from deep link");
        }
        return;
    }

    if let Err(error) = super::window::ensure_main_window(app) {
        tracing::warn!(error = %error, "failed to show main window from deep link");
    }
}

fn emit_deep_link_arrived(app: &tauri::AppHandle) {
    if let Err(error) = app.emit("deepLinkArrived", serde_json::json!({})) {
        tracing::warn!(error = %error, "failed to emit deep link wake event");
    }
}

#[cfg(test)]
mod tests {
    use super::should_capture_gui_error;
    #[cfg(target_os = "windows")]
    use super::{append_browser_arguments, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS};
    use tracing::Level;

    #[test]
    fn gui_error_log_captures_only_own_error_targets() {
        for target in [
            "vrcx_0",
            "vrcx_0::bootstrap::adapters",
            "vrcx_0_application",
            "vrcx_0_application::auth",
        ] {
            assert!(should_capture_gui_error(&Level::ERROR, target), "{target}");
        }

        for target in [
            "rustls_platform_verifier::verification::windows",
            "tauri_plugin_updater::updater",
            "tauri_runtime_wry",
            "vrcx_0x",
            "vrcx",
        ] {
            assert!(!should_capture_gui_error(&Level::ERROR, target), "{target}");
        }

        for level in [Level::WARN, Level::INFO, Level::DEBUG, Level::TRACE] {
            assert!(!should_capture_gui_error(
                &level,
                "vrcx_0::bootstrap::adapters"
            ));
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn webview2_browser_arguments_preserve_existing_overrides() {
        let arguments = append_browser_arguments(
            Some(std::ffi::OsStr::new("--remote-debugging-port=9222")),
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
        );

        assert_eq!(
            arguments,
            std::ffi::OsString::from(format!(
                "--remote-debugging-port=9222 {WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS}"
            ))
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn webview2_browser_arguments_do_not_add_a_leading_separator() {
        assert_eq!(
            append_browser_arguments(None, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS),
            std::ffi::OsString::from(WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS)
        );
    }
}
