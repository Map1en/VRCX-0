#![allow(non_snake_case)]

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_media::{image_processing, media_files};
use vrcx_0_runtime::image_cache;

#[tauri::command]
pub async fn app__save_image_file(
    app_handle: AppHandle,
    default_name: String,
    base64_data: String,
) -> Result<String, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let (file_name, bytes) = media_files::decode_image_file(&default_name, &base64_data)?;

    let result = app_handle
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("Image Files", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
        .blocking_save_file();

    match result {
        Some(file_path) => {
            let path = match file_path {
                tauri_plugin_dialog::FilePath::Path(p) => p,
                other => PathBuf::from(other.to_string()),
            };

            Ok(media_files::write_image_file(path, &file_name, &bytes)?)
        }
        None => Ok(String::new()),
    }
}

#[tauri::command]
pub async fn app__get_image(
    state: State<'_, AppState>,
    url: String,
    file_id: String,
    version: String,
) -> Result<String, AppError> {
    Ok(state
        .image_cache
        .get_image(&url, &file_id, &version)
        .await?)
}

#[tauri::command]
pub fn app__resize_image_to_fit_limits(base64data: String) -> Result<String, AppError> {
    Ok(image_processing::resize_image_to_fit_limits_base64(
        &base64data,
    )?)
}

#[tauri::command]
pub fn app__sign_file(blob: String) -> Result<String, AppError> {
    Ok(media_files::sign_file_base64(&blob)?)
}

#[tauri::command]
pub fn app__crop_all_prints(ugc_folder_path: String) -> Result<(), AppError> {
    Ok(image_processing::crop_all_prints(&ugc_folder_path)?)
}

#[tauri::command]
pub fn app__crop_print_image(path: String) -> Result<bool, AppError> {
    image_processing::crop_print_file(std::path::Path::new(&path))
        .map_err(|e| AppError::Custom(format!("{path}: {e}")))
}

#[tauri::command]
pub async fn app__save_print_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    Ok(image_cache::save_ugc_image_to_file(
        &state.image_cache,
        &url,
        &ugc_folder_path,
        &month_folder,
        &file_name,
    )
    .await?)
}

#[tauri::command]
pub async fn app__save_sticker_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    Ok(image_cache::save_ugc_image_to_file(
        &state.image_cache,
        &url,
        &ugc_folder_path,
        &month_folder,
        &file_name,
    )
    .await?)
}

#[tauri::command]
pub async fn app__save_emoji_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    Ok(image_cache::save_ugc_image_to_file(
        &state.image_cache,
        &url,
        &ugc_folder_path,
        &month_folder,
        &file_name,
    )
    .await?)
}
