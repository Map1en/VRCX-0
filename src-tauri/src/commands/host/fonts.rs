#![allow(non_snake_case)]

use crate::error::AppError;

#[tauri::command]
#[specta::specta]
pub async fn app__list_system_fonts() -> Result<Vec<String>, AppError> {
    tauri::async_runtime::spawn_blocking(vrcx_0_host::system_fonts::list_installed_font_families)
        .await
        .map_err(|error| AppError::Custom(format!("system font task failed: {error}")))
}
