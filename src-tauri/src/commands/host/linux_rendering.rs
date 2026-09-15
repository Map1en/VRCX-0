#![allow(non_snake_case)]

use tauri::AppHandle;

use crate::bootstrap::linux_rendering::{self, LinuxRenderingSnapshot};
use crate::error::AppError;

#[tauri::command]
#[specta::specta]
pub fn app__get_linux_rendering(app: AppHandle) -> Option<LinuxRenderingSnapshot> {
    linux_rendering::snapshot(&app)
}

#[tauri::command]
#[specta::specta]
pub fn app__set_linux_rendering(
    app: AppHandle,
    enabled: bool,
) -> Result<LinuxRenderingSnapshot, AppError> {
    linux_rendering::configure(&app, enabled).map_err(AppError::Custom)
}

#[tauri::command]
#[specta::specta]
pub fn app__confirm_linux_rendering(app: AppHandle) -> Result<LinuxRenderingSnapshot, AppError> {
    linux_rendering::confirm(&app).map_err(AppError::Custom)
}
