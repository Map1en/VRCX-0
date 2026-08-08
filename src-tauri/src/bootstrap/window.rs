use std::time::Duration;

use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::{Manager, WebviewWindowBuilder};

use crate::error::AppError;
use crate::state::{AppState, BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY};
use vrcx_0_application_core::{BackendRuntimeMode, BackendRuntimePhase, BackendRuntimeSnapshot};

use super::adapters::start_host_services;
use super::notification::{is_background_mode_active, is_community_theme_enabled, tray_labels};
use super::{
    cancel_background_delay, show_auth_failure_notification_after_backend_start_error,
    show_background_mode_started_notification,
};

const MAIN_WINDOW_REBUILD_DESTROY_TIMEOUT: Duration = Duration::from_secs(2);
const MAIN_WINDOW_REBUILD_DESTROY_POLL_INTERVAL: Duration = Duration::from_millis(50);

#[cfg(target_os = "windows")]
const WINDOW_CHROME_STATE_EVENT: &str = "windowChromeState";
#[cfg(target_os = "windows")]
const WINDOW_EDGE_TOLERANCE: i32 = 2;
#[cfg(target_os = "windows")]
const WINDOW_DOCKED_EDGE_COUNT: usize = 2;

#[cfg(target_os = "windows")]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowChromeState {
    maximized: bool,
    docked: bool,
    focused: bool,
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
    super::capture_background_resume_route(app, &state);

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
    cancel_background_delay(state);
    super::capture_background_resume_route(app, state);
    let snapshot = match state
        .start_backend_runtime(BackendRuntimeMode::Background, None)
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
        super::destroy_main_window_for_background_mode(app);
    }
    let _ = refresh_tray_menu(app, state);
    Ok(snapshot)
}

pub fn restore_foreground_window_from_background_mode(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<BackendRuntimeSnapshot, Box<dyn std::error::Error>> {
    let current = state.snapshot_backend_runtime();
    if current.mode != BackendRuntimeMode::Background {
        ensure_main_window(app)?;
        let _ = refresh_tray_menu(app, state);
        return Ok(current);
    }
    let snapshot = state.set_gui_backend_runtime_mode(BackendRuntimeMode::Foreground);
    ensure_main_window(app)?;
    let _ = refresh_tray_menu(app, state);
    Ok(snapshot)
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
    if let Some(state) = app.try_state::<AppState>() {
        cancel_background_delay(&state);
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(false);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub(super) fn create_main_window(
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
    let state = app.state::<AppState>();
    #[cfg(target_os = "windows")]
    {
        let system_frame = state.storage.get("VRCX_SystemWindowFrame").as_deref() == Some("true");
        if !system_frame {
            builder = builder.transparent(true).shadow(false);
        }
        builder = builder.initialization_script(format!(
            "window.__VRCX_SYSTEM_WINDOW_FRAME__ = {system_frame};"
        ));
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .decorations(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 16.0));
    }
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

    let main_window = builder.build()?;
    #[cfg(target_os = "windows")]
    attach_window_chrome_state_events(&main_window);
    #[cfg(not(target_os = "windows"))]
    let _ = main_window;
    Ok(())
}

#[cfg(target_os = "windows")]
fn attach_window_chrome_state_events(window: &tauri::WebviewWindow) {
    let chrome_window = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
            let focused = chrome_window.is_focused().unwrap_or(true);
            emit_window_chrome_state(&chrome_window, focused);
        }
        tauri::WindowEvent::Focused(focused) => {
            emit_window_chrome_state(&chrome_window, *focused);
        }
        _ => {}
    });
}

#[cfg(target_os = "windows")]
fn emit_window_chrome_state(window: &tauri::WebviewWindow, focused: bool) {
    use tauri::Emitter;

    let maximized = window.is_maximized().unwrap_or(false);
    let state = WindowChromeState {
        maximized,
        docked: maximized || is_window_docked(window),
        focused,
    };
    let _ = window.emit(WINDOW_CHROME_STATE_EVENT, state);
}

#[cfg(target_os = "windows")]
fn is_window_docked(window: &tauri::WebviewWindow) -> bool {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return false;
    };
    let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return false;
    };
    let area = monitor.work_area();
    let area_right = area.position.x + area.size.width as i32;
    let area_bottom = area.position.y + area.size.height as i32;
    let edges = [
        (position.x - area.position.x).abs() <= WINDOW_EDGE_TOLERANCE,
        (position.y - area.position.y).abs() <= WINDOW_EDGE_TOLERANCE,
        (position.x + size.width as i32 - area_right).abs() <= WINDOW_EDGE_TOLERANCE,
        (position.y + size.height as i32 - area_bottom).abs() <= WINDOW_EDGE_TOLERANCE,
    ];
    edges.iter().filter(|edge| **edge).count() >= WINDOW_DOCKED_EDGE_COUNT
}

pub(super) fn disable_windows_default_context_menu(app: &tauri::AppHandle) {
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

pub(super) fn configure_tray(app: &tauri::App, state: &AppState) -> Result<(), tauri::Error> {
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
