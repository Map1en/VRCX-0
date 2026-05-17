#![allow(non_snake_case)]

use crate::error::AppError;
use vrcx_0_host::clipboard;

#[tauri::command]
pub fn app__get_clipboard() -> Result<String, AppError> {
    Ok(clipboard::get_clipboard_text()?)
}

#[tauri::command]
pub async fn app__copy_image_to_clipboard(path: String) -> Result<(), AppError> {
    Ok(
        tauri::async_runtime::spawn_blocking(move || clipboard::copy_image_to_clipboard(&path))
            .await
            .map_err(|e| AppError::Custom(format!("copy image task: {e}")))??,
    )
}
