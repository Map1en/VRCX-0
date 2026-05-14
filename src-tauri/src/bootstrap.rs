use std::borrow::Cow;
use std::time::Duration;

use tauri::http::{header::CONTENT_TYPE, Request, Response, StatusCode};
use tauri::menu::{Menu, MenuItem};
use tauri::{Manager, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt as _;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;

use crate::domain::host_capabilities::{
    current_host_capabilities, is_host_capability_available, HostCapability,
};
use crate::state::AppState;

pub fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(false);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn init_error_logging() {
    let Some(app_data) = crate::domain::error_log::default_app_data_dir() else {
        return;
    };

    let default_panic_hook = std::panic::take_hook();
    let panic_app_data = app_data.clone();
    std::panic::set_hook(Box::new(move |panic_info| {
        crate::domain::error_log::append_error_log(
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
                    crate::domain::error_log::ErrorLogWriter::new(tracing_app_data.clone())
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

pub fn screenshot_protocol_response(request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
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

    let Ok(paths) = crate::domain::app_paths::AppPaths::resolve() else {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Vec::new().into())
            .unwrap();
    };

    let path_buf = std::path::PathBuf::from(&path);
    let is_webp = path_buf
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("webp"));

    if !is_webp
        || !path_buf.is_file()
        || !crate::domain::screenshot::is_path_inside_directory(&path_buf, &paths.screenshot_thumbs)
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

pub fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_state = AppState::new().expect("failed to initialize app state");
    app.manage(app_state);

    let state = app.state::<AppState>();
    create_main_window(app, state.web.proxy_url())?;

    disable_windows_default_context_menu(app);

    let state = app.state::<AppState>();
    configure_tray(app)?;
    sync_autostart_from_db(app, &state);
    hide_autostart_window_if_needed(app, &state);
    start_host_services(app, &state);
    open_devtools_if_enabled(app);

    Ok(())
}

fn create_main_window(
    app: &tauri::App,
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

    let mut builder = WebviewWindowBuilder::from_config(app.handle(), window_config)?;
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
    state.backend_context.config().get_bool(key, false).ok()
}

fn disable_windows_default_context_menu(app: &tauri::App) {
    #[cfg(target_os = "windows")]
    if let Some(webview) = app.get_webview_window("main") {
        if let Err(error) = webview.with_webview(|platform_webview| {
            // Disable WebView2's browser-provided menu while preserving DOM contextmenu events.
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

fn configure_tray(app: &tauri::App) -> Result<(), tauri::Error> {
    if let Some(tray) = app.tray_by_id("main") {
        let exit_item = MenuItem::with_id(app, "tray-exit", "Exit", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&exit_item])?;
        let _ = tray.set_menu(Some(menu));
        let _ = tray.set_show_menu_on_left_click(false);
    }
    Ok(())
}

fn sync_autostart_from_db(app: &tauri::App, state: &AppState) {
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        if db_config_bool(state, "config:vrcx_startatwindowsstartup") == Some(true)
            && !app.autolaunch().is_enabled().unwrap_or(false)
        {
            let _ = app.autolaunch().enable();
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let _ = (app, state);
}

fn hide_autostart_window_if_needed(app: &tauri::App, state: &AppState) {
    if state.launched_from_autostart
        && state.storage.get("VRCX_StartAsMinimizedState").as_deref() == Some("true")
    {
        if let Some(window) = app.get_webview_window("main") {
            let window = window.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(100)).await;
                let _ = window.hide();
                let _ = window.set_skip_taskbar(true);
            });
        }
    }
}

fn start_host_services(app: &tauri::App, state: &AppState) {
    let host_capabilities = current_host_capabilities();
    tracing::info!(
        platform = %host_capabilities.platform,
        "host capabilities resolved"
    );
    state
        .backend_context
        .event_bus
        .set_app_handle(app.handle().clone());

    if is_host_capability_available(HostCapability::GameProcessMonitor) {
        state.process_monitor.start(
            app.handle().clone(),
            state.auto_launch.clone(),
            state.log_watcher.clone(),
            vec![
                state.game_log_backend.clone(),
                state.game_client_backend.clone(),
            ],
        );
    }

    if is_host_capability_available(HostCapability::Ipc) {
        state.ipc.start(app.handle().clone());
    }

    #[cfg(target_os = "windows")]
    if is_host_capability_available(HostCapability::GameLogWatcher) {
        let local_low = std::env::var("LOCALAPPDATA")
            .map(|p| std::path::PathBuf::from(p).join("..\\LocalLow\\VRChat\\VRChat"))
            .unwrap_or_default();
        if let Err(error) = state.game_log_backend.prime_log_watcher(&state.log_watcher) {
            tracing::warn!("failed to prime GameLog watcher from backend DB: {error}");
        }
        state.log_watcher.start(local_low, app.handle().clone());
    }

    #[cfg(target_os = "linux")]
    if is_host_capability_available(HostCapability::VrchatPathDiscovery) {
        match crate::domain::vrchat_paths::discover_linux_vrchat_paths() {
            Ok(paths) => {
                let latest_log = paths
                    .latest_log
                    .as_ref()
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|| "pending".to_string());
                tracing::info!(
                    log_dir = %paths.app_data.display(),
                    latest_log,
                    "starting Linux GameLog watcher"
                );
                if let Err(error) = state.game_log_backend.prime_log_watcher(&state.log_watcher) {
                    tracing::warn!("failed to prime GameLog watcher from backend DB: {error}");
                }
                state
                    .log_watcher
                    .start_without_process_monitor(paths.app_data, app.handle().clone());
            }
            Err(reason) => {
                tracing::warn!(reason, "Linux GameLog watcher is unavailable");
            }
        }
    }
}

fn open_devtools_if_enabled(app: &tauri::App) {
    #[cfg(all(debug_assertions, feature = "devtools"))]
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
    }

    #[cfg(not(all(debug_assertions, feature = "devtools")))]
    let _ = app;
}
