#![allow(non_snake_case)]

use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt as _;

use crate::error::AppError;
use crate::state::AppState;

const TRAY_ICON_DEFAULT: &[u8] = include_bytes!("../../../icons/icon.png");
const TRAY_ICON_NOTIFY: &[u8] = include_bytes!("../../../icons/icon_notify.png");

pub(crate) fn stop_runtime_services(app_handle: &AppHandle) {
    use tauri::Manager;
    if let Some(state) = app_handle.try_state::<AppState>() {
        state.log_watcher_compat_bridge.stop();
        state.ipc.stop();
        state.stop_backend_runtime("application-exit");
        flush_telemetry_before_task_shutdown(&state);
        state.runtime_context.tasks.stop_all();
    }
}

fn flush_telemetry_before_task_shutdown(state: &AppState) {
    let telemetry = state.telemetry.clone();
    match tokio::runtime::Handle::try_current() {
        Ok(handle) if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
            tokio::task::block_in_place(|| handle.block_on(telemetry.shutdown_flush()));
        }
        Ok(_) => {}
        Err(_) => {
            tauri::async_runtime::block_on(telemetry.shutdown_flush());
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn app__set_user_agent() {}

#[tauri::command]
#[specta::specta]
pub fn app__focus_window(app_handle: AppHandle) -> Result<(), AppError> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__flash_window(app_handle: AppHandle) -> Result<(), AppError> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__change_theme(app_handle: AppHandle, value: i32) -> Result<(), AppError> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("main") {
        let theme = match value {
            0 => Some(tauri::Theme::Light),
            1 => Some(tauri::Theme::Dark),
            _ => None,
        };
        let _ = window.set_theme(theme);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
#[allow(unused_variables)]
pub fn app__language_changed(app_handle: AppHandle, language: String) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    let _ = crate::macos_menu::configure_macos_app_menu(&app_handle, &language);
    drop(app_handle);
    drop(language);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__do_funny() {}

#[tauri::command]
#[specta::specta]
pub fn app__set_tray_icon_notification(app_handle: AppHandle, notify: Option<bool>) {
    let notify = notify.unwrap_or(false);
    if let Some(tray) = app_handle.tray_by_id("main") {
        let icon_result = tauri::image::Image::from_bytes(if notify {
            TRAY_ICON_NOTIFY
        } else {
            TRAY_ICON_DEFAULT
        });
        if let Ok(icon) = icon_result {
            let _ = tray.set_icon(Some(icon));
        }
        let tooltip = if notify {
            "VRCX-0 (new notification)"
        } else {
            "VRCX-0"
        };
        let _ = tray.set_tooltip(Some(tooltip));
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
            state.release_profile_lock();
        }
        app_handle.request_restart();
        Ok(())
    }
}

#[tauri::command]
#[specta::specta]
pub fn app__exit_application(app_handle: AppHandle) -> Result<(), AppError> {
    stop_runtime_services(&app_handle);
    app_handle.exit(0);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__set_startup(app_handle: AppHandle, _enabled: bool) -> Result<(), AppError> {
    if !(cfg!(target_os = "windows") || cfg!(target_os = "linux")) {
        return Err(AppError::Custom(format!(
            "Autostart is not supported on {}",
            vrcx_0_host::host_capabilities::current_platform()
        )));
    }

    let autolaunch = app_handle.autolaunch();
    if _enabled {
        autolaunch
            .enable()
            .map_err(|e| AppError::Custom(format!("enable autostart: {e}")))?;
    } else {
        autolaunch
            .disable()
            .map_err(|e| AppError::Custom(format!("disable autostart: {e}")))?;
    }
    Ok(())
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
