#![allow(non_snake_case)]

use tauri::AppHandle;
#[cfg(target_os = "windows")]
use tauri_plugin_autostart::ManagerExt as _;

use crate::error::AppError;

const TRAY_ICON_DEFAULT: &[u8] = include_bytes!("../../../icons/icon.png");
const TRAY_ICON_NOTIFY: &[u8] = include_bytes!("../../../icons/icon_notify.png");

#[cfg(not(debug_assertions))]
fn spawn_current_exe(args: &[&str]) -> Result<(), AppError> {
    let exe = std::env::current_exe().map_err(|e| AppError::Custom(format!("current exe: {e}")))?;
    let mut cmd = std::process::Command::new(&exe);
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    for arg in args {
        cmd.arg(arg);
    }
    cmd.spawn()
        .map_err(|e| AppError::Custom(format!("restart: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn app__set_user_agent() {}

#[tauri::command]
pub fn app__focus_window(app_handle: AppHandle) -> Result<(), AppError> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn app__flash_window(app_handle: AppHandle) -> Result<(), AppError> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }
    Ok(())
}

#[tauri::command]
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
pub fn app__do_funny() {}

#[tauri::command]
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
pub fn app__restart_application(
    app_handle: AppHandle,
    is_upgrade: Option<bool>,
) -> Result<(), AppError> {
    #[cfg(debug_assertions)]
    {
        tracing::warn!(
            is_upgrade = is_upgrade.unwrap_or(false),
            "app__restart_application ignored in dev build; restart VRCX manually"
        );
        let _ = app_handle;
        Ok(())
    }

    #[cfg(not(debug_assertions))]
    {
        if is_upgrade.unwrap_or(false) {
            spawn_current_exe(&["--upgrade"])?;
            app_handle.exit(0);
        } else {
            app_handle.request_restart();
        }
        Ok(())
    }
}

#[tauri::command]
pub fn app__set_startup(app_handle: AppHandle, _enabled: bool) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
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
    }
    Ok(())
}

#[tauri::command]
pub fn app__desktop_notification(
    app_handle: AppHandle,
    bold_text: String,
    text: Option<String>,
    image: Option<String>,
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
    notification
        .show()
        .map_err(|e| AppError::Custom(format!("notification: {e}")))?;
    Ok(())
}
