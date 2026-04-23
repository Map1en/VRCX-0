#![allow(non_snake_case)]

use std::path::PathBuf;

use crate::error::AppError;

#[tauri::command]
pub fn app__get_clipboard() -> Result<String, AppError> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| AppError::Custom(format!("clipboard: {e}")))?;
    Ok(clipboard.get_text().unwrap_or_default())
}

#[tauri::command]
pub async fn app__copy_image_to_clipboard(path: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let ext = PathBuf::from(&path)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        if !matches!(
            ext.as_str(),
            "png" | "jpg" | "jpeg" | "bmp" | "gif" | "webp"
        ) {
            return Err(AppError::Custom("unsupported image format".into()));
        }

        let data = std::fs::read(&path)?;
        let img = image::load_from_memory(&data)
            .map_err(|e| AppError::Custom(format!("load image: {e}")))?;
        let rgba = img.to_rgba8();

        let mut clipboard =
            arboard::Clipboard::new().map_err(|e| AppError::Custom(format!("clipboard: {e}")))?;
        clipboard
            .set_image(arboard::ImageData {
                width: rgba.width() as usize,
                height: rgba.height() as usize,
                bytes: std::borrow::Cow::Owned(rgba.into_raw()),
            })
            .map_err(|e| AppError::Custom(format!("set clipboard image: {e}")))?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Custom(format!("copy image task: {e}")))?
}
