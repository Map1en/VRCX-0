use std::path::PathBuf;
use std::sync::Arc;
use vrcx_0_application_core::RuntimeOperationStatus;

use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tracing::Level;
use tracing_subscriber::filter::filter_fn;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;

use crate::deep_link::{parse_deep_link, queue_deep_link_action, DEEP_LINK_ARRIVED_EVENT};
use crate::error::AppError;
use crate::state::{AppState, BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY};

use super::adapters::{
    start_host_services, start_mcp_server_if_enabled, TauriDesktopNotifier, TauriUpdaterPort,
};
use super::autostart::{apply_autostart_window_state_if_needed, sync_autostart_from_db};
use super::shared::app_language;
use super::window::{configure_tray, configure_windows_webview_settings, create_main_window};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
#[cfg(target_os = "windows")]
const WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: &str = "--disable-back-forward-cache --disable-domain-reliability --disable-features=AutofillServerCommunication,BackgroundFetch,MediaRouter --disable-file-system --disable-notifications --disable-presentation-api --disable-remote-playback-api --disable-shared-workers --disable-speech-api";

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

fn initialize_app_state(
    app: &tauri::App,
    app_data_dir: vrcx_0_platform::app_paths::AppDataDirResolution,
    updater_port: Arc<TauriUpdaterPort>,
) -> AppState {
    let database_maintenance_cache_dir = match app.path().app_cache_dir() {
        Ok(path) => Some(path),
        Err(error) => {
            tracing::warn!(
                error = %error,
                "failed to resolve Tauri cache directory for database maintenance"
            );
            None
        }
    };
    let error = match AppState::new(
        app_data_dir.clone(),
        database_maintenance_cache_dir.clone(),
        updater_port.clone(),
    ) {
        Ok(state) => return state,
        Err(error) => error,
    };

    if is_database_corruption_error(&error) {
        match quarantine_corrupt_database(&app_data_dir.current_dir) {
            Ok(quarantined) => {
                tracing::error!(
                    error = %error,
                    quarantined = %quarantined.display(),
                    "local database is corrupted; quarantined it to recreate a fresh database"
                );
                match AppState::new(app_data_dir, database_maintenance_cache_dir, updater_port) {
                    Ok(state) => {
                        show_blocking_dialog(
                            app,
                            MessageDialogKind::Warning,
                            &format!(
                                "The local database was corrupted and could not be opened.\n\n\
                                 It was moved to:\n{}\n\n\
                                 VRCX-0 created a fresh database; please sign in again.",
                                quarantined.display()
                            ),
                        );
                        return state;
                    }
                    Err(retry_error) => exit_with_startup_error(app, &retry_error),
                }
            }
            Err(quarantine_error) => {
                tracing::error!(
                    error = %quarantine_error,
                    "failed to quarantine the corrupted local database"
                );
            }
        }
    }

    exit_with_startup_error(app, &error)
}

fn is_database_corruption_error(error: &AppError) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("malformed") || message.contains("not a database")
}

fn quarantine_corrupt_database(app_data: &std::path::Path) -> std::io::Result<PathBuf> {
    let db_file =
        vrcx_0_platform::app_paths::AppPaths::from_app_data(app_data.to_path_buf()).db_file;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);
    let quarantined = appended_path(&db_file, &format!(".corrupt-{timestamp}"));
    std::fs::rename(&db_file, &quarantined)?;
    for suffix in ["-wal", "-shm"] {
        let sidecar = appended_path(&db_file, suffix);
        if sidecar.exists() {
            let _ = std::fs::rename(&sidecar, appended_path(&quarantined, suffix));
        }
    }
    Ok(quarantined)
}

fn appended_path(path: &std::path::Path, suffix: &str) -> PathBuf {
    let mut appended = path.as_os_str().to_os_string();
    appended.push(suffix);
    PathBuf::from(appended)
}

fn exit_with_startup_error(app: &tauri::App, error: &AppError) -> ! {
    tracing::error!(error = %error, "failed to initialize app state");
    show_blocking_dialog(
        app,
        MessageDialogKind::Error,
        &format!("VRCX-0 failed to start.\n\n{error}"),
    );
    std::process::exit(1);
}

fn show_blocking_dialog(app: &tauri::App, kind: MessageDialogKind, message: &str) {
    app.dialog()
        .message(message)
        .kind(kind)
        .title("VRCX-0")
        .blocking_show();
}

pub fn setup_app_with_data_dir(
    app: &mut tauri::App,
    app_data_dir: vrcx_0_platform::app_paths::AppDataDirResolution,
) -> Result<(), Box<dyn std::error::Error>> {
    let updater_port = Arc::new(TauriUpdaterPort::new(app.handle().clone()));
    let app_state = initialize_app_state(app, app_data_dir, updater_port);
    let language = app_language(&app_state);
    app.manage(app_state);

    let state = app.state::<AppState>();
    state
        .runtime_host()
        .set_notification_desktop_notifier(Arc::new(TauriDesktopNotifier::new(
            app.handle().clone(),
        )));
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
    create_main_window(app.handle(), state.runtime_host().proxy_url())?;
    super::linux_rendering::start_fallback(app.handle());
    state.runtime_host().record_lifecycle_phase(
        "mainWindow",
        RuntimeOperationStatus::Completed,
        "Main webview window created.",
    );

    configure_windows_webview_settings(app.handle());

    let state = app.state::<AppState>();
    configure_tray(app, &state)?;
    super::tray_shortcut::setup(app.handle(), &state);
    state.runtime_host().record_lifecycle_phase(
        "tray",
        RuntimeOperationStatus::Completed,
        "System tray configured.",
    );
    #[cfg(target_os = "macos")]
    crate::macos_menu::configure_macos_app_menu(app.handle(), &language)?;
    #[cfg(not(target_os = "macos"))]
    let _ = language;
    sync_autostart_from_db(app, &state);
    apply_autostart_window_state_if_needed(app, &state);
    start_host_services(app.handle(), &state);
    start_mcp_server_if_enabled(app.handle());
    wire_deep_links(app.handle());
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
    if let Err(error) = app.emit(DEEP_LINK_ARRIVED_EVENT, serde_json::json!({})) {
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
