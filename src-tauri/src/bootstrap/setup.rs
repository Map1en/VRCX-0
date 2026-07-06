use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;

use crate::state::{AppState, BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY};

use super::adapters::{start_host_services, start_mcp_server_if_enabled, TauriDesktopNotifier};
use super::autostart::{apply_autostart_window_state_if_needed, sync_autostart_from_db};
use super::shared::app_language;
use super::window::{configure_tray, create_main_window, disable_windows_default_context_menu};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn init_error_logging(app_data: Option<PathBuf>) {
    let Some(app_data) = app_data.or_else(vrcx_0_host::error_log::default_app_data_dir) else {
        return;
    };

    let default_panic_hook = std::panic::take_hook();
    let panic_app_data = app_data.clone();
    std::panic::set_hook(Box::new(move |panic_info| {
        vrcx_0_host::error_log::append_error_log_with_version(
            &panic_app_data,
            "rust:panic",
            &panic_info.to_string(),
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
                    vrcx_0_host::error_log::ErrorLogWriter::new_with_version(
                        tracing_app_data.clone(),
                        APP_VERSION,
                    )
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
