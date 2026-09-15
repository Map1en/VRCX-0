#![allow(non_snake_case)]

use crate::error::AppError;
use tauri::AppHandle;
use vrcx_0_runtime_host_desktop::tray_shortcut::{
    TrayShortcutBinding, TrayShortcutError, TrayShortcutSnapshot, TrayShortcutUpdate,
};

#[tauri::command]
#[specta::specta]
pub async fn app__get_tray_shortcut(
    app_handle: AppHandle,
) -> Result<TrayShortcutSnapshot, AppError> {
    crate::bootstrap::tray_shortcut::snapshot(&app_handle).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__set_tray_shortcut(
    app_handle: AppHandle,
    binding: Option<TrayShortcutBinding>,
) -> Result<TrayShortcutUpdate, AppError> {
    crate::bootstrap::tray_shortcut::configure(&app_handle, binding).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__set_tray_shortcut_recording(
    app_handle: AppHandle,
    recording: bool,
) -> Result<bool, AppError> {
    crate::bootstrap::tray_shortcut::set_recording(&app_handle, recording).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__check_tray_shortcut(
    app_handle: AppHandle,
    binding: TrayShortcutBinding,
) -> Result<Option<TrayShortcutError>, AppError> {
    crate::bootstrap::tray_shortcut::check(&app_handle, binding).await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__take_tray_shortcut_startup_failure(app_handle: AppHandle) -> bool {
    crate::bootstrap::tray_shortcut::take_startup_failure(&app_handle)
}
