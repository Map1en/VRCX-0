#![allow(non_snake_case)]

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_contracts::UgcCategory;

#[tauri::command]
#[specta::specta]
pub async fn app__save_image_file(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    default_name: String,
    base64_data: String,
) -> Result<String, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let (file_name, bytes) = state
        .runtime_host()
        .media()
        .decode_image_file(&default_name, &base64_data)?;

    let result = super::dialog::save_file(
        app_handle
            .dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("Image Files", &["png", "jpg", "jpeg", "gif", "webp", "bmp"]),
    )
    .await;

    match result {
        Some(file_path) => {
            let path = match file_path {
                tauri_plugin_dialog::FilePath::Path(p) => p,
                other => PathBuf::from(other.to_string()),
            };

            Ok(state
                .runtime_host()
                .media()
                .write_image_file(path, &file_name, &bytes)?)
        }
        None => Ok(String::new()),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app__resize_image_to_fit_limits(
    state: State<'_, AppState>,
    base64data: String,
) -> Result<String, AppError> {
    let media = state.runtime_host().media().clone();
    tauri::async_runtime::spawn_blocking(move || media.resize_image_to_fit_limits(&base64data))
        .await
        .map_err(|error| AppError::Custom(format!("image resize task failed: {error}")))?
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__crop_all_prints(
    state: State<'_, AppState>,
    ugc_folder_path: String,
) -> Result<(), AppError> {
    let media = state.runtime_host().media().clone();
    tauri::async_runtime::spawn_blocking(move || media.crop_all_prints(&ugc_folder_path))
        .await
        .map_err(|error| AppError::Custom(format!("crop all prints task failed: {error}")))?
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__crop_print_image(
    state: State<'_, AppState>,
    path: String,
) -> Result<bool, AppError> {
    let media = state.runtime_host().media().clone();
    tauri::async_runtime::spawn_blocking(move || media.crop_print_image(&path))
        .await
        .map_err(|error| AppError::Custom(format!("crop print task failed: {error}")))?
        .map_err(AppError::from)
}

async fn save_ugc_category_to_file(
    state: &AppState,
    category: UgcCategory,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    Ok(state
        .runtime_host()
        .media()
        .save_ugc_category(category, url, ugc_folder_path, month_folder, file_name)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__save_print_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    save_ugc_category_to_file(
        &state,
        UgcCategory::Prints,
        url,
        ugc_folder_path,
        month_folder,
        file_name,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__save_sticker_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    save_ugc_category_to_file(
        &state,
        UgcCategory::Stickers,
        url,
        ugc_folder_path,
        month_folder,
        file_name,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__save_emoji_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    save_ugc_category_to_file(
        &state,
        UgcCategory::Emoji,
        url,
        ugc_folder_path,
        month_folder,
        file_name,
    )
    .await
}
