#![allow(non_snake_case)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt as _;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_runtime_host_desktop::AutostartPlatform;

const TRAY_ICON_DEFAULT: &[u8] = include_bytes!("../../../icons/icon.png");

#[tauri::command]
#[specta::specta]
pub fn app__get_sidebar_auto_hide(
    app_handle: AppHandle,
) -> vrcx_0_runtime_host_desktop::sidebar_auto_hide::SidebarAutoHideSnapshot {
    crate::bootstrap::sidebar_auto_hide::snapshot(&app_handle)
}

#[tauri::command]
#[specta::specta]
pub async fn app__set_sidebar_auto_hide(
    app_handle: AppHandle,
    enabled: bool,
) -> Result<bool, AppError> {
    crate::bootstrap::sidebar_auto_hide::set_enabled(app_handle, enabled).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__set_sidebar_auto_hide_context(
    app_handle: AppHandle,
    context: vrcx_0_runtime_host_desktop::sidebar_auto_hide::SidebarAutoHideContext,
) -> Result<(), AppError> {
    crate::bootstrap::sidebar_auto_hide::set_context(app_handle, context).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__suspend_sidebar_auto_hide(
    app_handle: AppHandle,
    suspended: bool,
) -> Result<(), AppError> {
    crate::bootstrap::sidebar_auto_hide::set_suspended(app_handle, suspended).await
}
const TRAY_ICON_NOTIFY: &[u8] = include_bytes!("../../../icons/icon_notify.png");
static APPLICATION_EXIT_STARTED: AtomicBool = AtomicBool::new(false);
static TRAY_ICON_DEFAULT_IMAGE: OnceLock<Option<tauri::image::Image<'static>>> = OnceLock::new();
static TRAY_ICON_NOTIFY_IMAGE: OnceLock<Option<tauri::image::Image<'static>>> = OnceLock::new();

fn tray_icon_image(notify: bool) -> Option<&'static tauri::image::Image<'static>> {
    let (cache, bytes) = if notify {
        (&TRAY_ICON_NOTIFY_IMAGE, TRAY_ICON_NOTIFY)
    } else {
        (&TRAY_ICON_DEFAULT_IMAGE, TRAY_ICON_DEFAULT)
    };
    cache
        .get_or_init(|| tauri::image::Image::from_bytes(bytes).ok())
        .as_ref()
}

fn request_application_exit_with(
    exit_started: &AtomicBool,
    hide_main_window: impl FnOnce(),
    set_tray_visible: impl FnOnce(bool),
    start_shutdown: impl FnOnce(),
) -> bool {
    if exit_started.swap(true, Ordering::AcqRel) {
        return false;
    }

    hide_main_window();
    set_tray_visible(false);
    start_shutdown();
    true
}

pub(crate) fn request_application_exit(app_handle: &AppHandle) {
    use tauri::Manager;

    crate::bootstrap::sidebar_auto_hide::park(app_handle, true);

    request_application_exit_with(
        &APPLICATION_EXIT_STARTED,
        || {
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.hide();
                let _ = window.set_skip_taskbar(true);
            }
        },
        |visible| {
            if let Some(tray) = app_handle.tray_by_id("main") {
                let _ = tray.set_visible(visible);
            }
        },
        || {
            let shutdown_app = app_handle.clone();
            if let Err(error) = std::thread::Builder::new()
                .name("vrcx-0-shutdown".into())
                .spawn(move || {
                    finish_application_exit(&shutdown_app);
                })
            {
                tracing::warn!(error = %error, "failed to spawn shutdown worker; stopping inline");
                finish_application_exit(app_handle);
            }
        },
    );
}

fn finish_application_exit(app_handle: &AppHandle) {
    stop_runtime_services(app_handle);
    app_handle.exit(0);
}

pub(crate) fn stop_runtime_services(app_handle: &AppHandle) {
    use tauri::Manager;
    crate::bootstrap::sidebar_auto_hide::park(app_handle, true);
    if let Some(state) = app_handle.try_state::<AppState>() {
        state.log_watcher_compat_bridge().stop();
        state
            .runtime_host()
            .stop_for_application_exit("application-exit", || {
                flush_telemetry_before_task_shutdown(&state);
            });
    }
}

fn flush_telemetry_before_task_shutdown(state: &AppState) {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
            tokio::task::block_in_place(|| {
                handle.block_on(state.runtime_host().shutdown_telemetry_flush())
            });
        }
        Ok(_) => {}
        Err(_) => {
            tauri::async_runtime::block_on(state.runtime_host().shutdown_telemetry_flush());
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn app__language_changed(app_handle: AppHandle, language: String) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    let _ = crate::macos_menu::configure_macos_app_menu(&app_handle, &language);
    drop(app_handle);
    drop(language);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__set_tray_icon_notification(state: State<'_, AppState>, notify: Option<bool>) {
    state
        .runtime_host()
        .set_frontend_tray_notification(notify.unwrap_or(false));
}

pub(crate) fn set_tray_icon_notification(app_handle: &AppHandle, notify: bool) {
    if let Some(tray) = app_handle.tray_by_id("main") {
        if let Some(icon) = tray_icon_image(notify) {
            let _ = tray.set_icon(Some(tauri::image::Image::new(
                icon.rgba(),
                icon.width(),
                icon.height(),
            )));
        }
        let tooltip = if notify {
            "VRCX-0 (new notification)"
        } else {
            "VRCX-0"
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

#[cfg(windows)]
pub(crate) fn main_window_handle(app_handle: &AppHandle) -> Option<isize> {
    use tauri::Manager;

    app_handle
        .get_webview_window("main")
        .and_then(|window| window.hwnd().ok())
        .map(|hwnd| hwnd.0 as isize)
}

#[tauri::command]
#[specta::specta]
#[allow(unused_variables)]
pub fn app__set_taskbar_overlay_notification(app_handle: AppHandle, notify: Option<bool>) {
    #[cfg(windows)]
    if let Some(handle) = main_window_handle(&app_handle) {
        vrcx_0_host_desktop::taskbar_overlay::set_taskbar_overlay_notification(
            handle,
            notify.unwrap_or(false),
        );
    }
}

#[tauri::command]
#[specta::specta]
pub fn app__refresh_tray_menu(app_handle: AppHandle) -> Result<(), AppError> {
    use tauri::Manager;
    if let Some(state) = app_handle.try_state::<AppState>() {
        crate::bootstrap::refresh_tray_menu(&app_handle, &state)
            .map_err(|error| AppError::Custom(format!("refresh tray menu: {error}")))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__open_devtools(app_handle: AppHandle) -> Result<(), AppError> {
    #[cfg(feature = "devtools")]
    {
        use tauri::Manager;

        let Some(window) = app_handle.get_webview_window("main") else {
            return Err(AppError::Custom("main window is not available".into()));
        };
        window.open_devtools();
        Ok(())
    }

    #[cfg(not(feature = "devtools"))]
    {
        let _ = app_handle;
        Err(AppError::Custom(
            "DevTools are unavailable in this build.".into(),
        ))
    }
}

#[tauri::command]
#[specta::specta]
pub fn app__restart_application(app_handle: AppHandle) -> Result<(), AppError> {
    #[cfg(debug_assertions)]
    {
        tracing::warn!("app__restart_application ignored in dev build; restart VRCX-0 manually");
        let _ = app_handle;
        Ok(())
    }

    #[cfg(not(debug_assertions))]
    {
        use tauri::Manager;

        stop_runtime_services(&app_handle);
        if let Some(state) = app_handle.try_state::<AppState>() {
            state.runtime_host().release_profile_lock();
        }
        app_handle.request_restart();
        Ok(())
    }
}

#[tauri::command]
#[specta::specta]
pub fn app__exit_application(app_handle: AppHandle) -> Result<(), AppError> {
    request_application_exit(&app_handle);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__set_startup(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<bool, AppError> {
    struct TauriAutostartPlatform(AppHandle);

    impl AutostartPlatform for TauriAutostartPlatform {
        fn set_enabled(&self, enabled: bool) -> Result<(), String> {
            if !(cfg!(target_os = "windows")
                || cfg!(target_os = "linux")
                || cfg!(target_os = "macos"))
            {
                return Err(format!(
                    "Autostart is not supported on {}",
                    vrcx_0_platform::host_capabilities::current_platform()
                ));
            }
            let autolaunch = self.0.autolaunch();
            if enabled {
                autolaunch
                    .enable()
                    .map_err(|error| format!("enable autostart: {error}"))
            } else {
                autolaunch
                    .disable()
                    .map_err(|error| format!("disable autostart: {error}"))
            }
        }
    }

    Ok(state
        .runtime_host()
        .set_autostart_preference(&TauriAutostartPlatform(app_handle), enabled)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__desktop_notification(
    app_handle: AppHandle,
    bold_text: String,
    text: Option<String>,
    image: Option<String>,
    play_sound: Option<bool>,
) -> Result<(), AppError> {
    use tauri_plugin_notification::NotificationExt;
    let mut notification = app_handle.notification().builder();
    notification = notification.title(&bold_text);
    if let Some(ref body) = text {
        notification = notification.body(body);
    }
    if let Some(icon) = image.as_deref().filter(|s| !s.trim().is_empty()) {
        notification = notification.icon(icon);
    }
    if play_sound.unwrap_or(false) {
        notification = notification.sound(default_desktop_notification_sound());
    }
    notification
        .show()
        .map_err(|e| AppError::Custom(format!("notification: {e}")))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__auth_failure_notification_show(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    reason: Option<String>,
) -> Result<(), AppError> {
    crate::bootstrap::show_auth_failure_notification_once(
        &app_handle,
        &state,
        reason.as_deref().unwrap_or("auto-login"),
    );
    Ok(())
}

pub(crate) fn default_desktop_notification_sound() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "Default"
    }
    #[cfg(target_os = "macos")]
    {
        "NSUserNotificationDefaultSoundName"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "message-new-instant"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    {
        "Default"
    }
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::sync::atomic::AtomicBool;

    use super::{request_application_exit_with, tray_icon_image};

    #[test]
    fn tray_icon_images_are_decoded_once_and_reused() {
        let default_first = tray_icon_image(false).unwrap();
        let default_second = tray_icon_image(false).unwrap();
        let notify_first = tray_icon_image(true).unwrap();
        let notify_second = tray_icon_image(true).unwrap();

        assert!(std::ptr::eq(default_first, default_second));
        assert!(std::ptr::eq(notify_first, notify_second));
        assert!(!std::ptr::eq(default_first, notify_first));
    }

    #[test]
    fn request_application_exit_hides_window_and_tray_before_shutdown() {
        let exit_started = AtomicBool::new(false);
        let window_visible = Cell::new(true);
        let tray_visible = Cell::new(true);
        let shutdown_started = Cell::new(false);
        let events = RefCell::new(Vec::new());

        assert!(request_application_exit_with(
            &exit_started,
            || {
                window_visible.set(false);
                events.borrow_mut().push("window-hidden");
            },
            |visible| {
                tray_visible.set(visible);
                events.borrow_mut().push("tray-hidden");
            },
            || {
                shutdown_started.set(true);
                events.borrow_mut().push("shutdown-started");
            },
        ));

        assert!(!window_visible.get());
        assert!(!tray_visible.get());
        assert!(shutdown_started.get());
        assert_eq!(
            events.into_inner(),
            vec!["window-hidden", "tray-hidden", "shutdown-started"]
        );
    }

    #[test]
    fn request_application_exit_is_idempotent() {
        let exit_started = AtomicBool::new(false);
        let calls = Cell::new(0);

        assert!(request_application_exit_with(
            &exit_started,
            || calls.set(calls.get() + 1),
            |_| calls.set(calls.get() + 1),
            || calls.set(calls.get() + 1),
        ));
        assert!(!request_application_exit_with(
            &exit_started,
            || calls.set(calls.get() + 1),
            |_| calls.set(calls.get() + 1),
            || calls.set(calls.get() + 1),
        ));

        assert_eq!(calls.get(), 3);
    }
}
