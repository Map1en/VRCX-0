#![allow(non_snake_case)]

use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::state::AppState;

use super::paths::{
    app__get_ugc_photo_location, app__get_vrchat_photos_location,
    app__get_vrchat_screenshots_location, vrchat_app_data, vrchat_config_path,
};

#[tauri::command]
pub fn app__open_link(url: String) -> Result<(), AppError> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::Custom("Invalid URL scheme".into()));
    }
    open::that(&url).map_err(|e| AppError::Custom(format!("open link: {e}")))
}

#[tauri::command]
pub fn app__open_discord_profile(discord_id: String) -> Result<(), AppError> {
    let url = format!("discord://-/users/{discord_id}");
    open::that(&url).map_err(|e| AppError::Custom(format!("open discord: {e}")))
}

#[tauri::command]
pub fn app__get_file_base64(path: String) -> Result<String, AppError> {
    let bytes = std::fs::read(&path)?;
    Ok(B64.encode(&bytes))
}

#[tauri::command]
pub fn app__get_file_bytes(path: String) -> Result<Vec<u8>, AppError> {
    Ok(std::fs::read(&path)?)
}

#[tauri::command]
pub fn app__read_config_file() -> Result<String, AppError> {
    let path = vrchat_config_path();
    if !path.exists() {
        return Ok(String::new());
    }
    Ok(std::fs::read_to_string(&path)?)
}

#[tauri::command]
pub fn app__read_config_file_safe() -> Result<String, AppError> {
    let path = vrchat_config_path();
    if !path.exists() {
        return Ok(String::new());
    }
    let content = std::fs::read_to_string(&path)?;

    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(v) => Ok(serde_json::to_string_pretty(&v).unwrap_or_default()),
        Err(_) => Ok(String::new()),
    }
}

#[tauri::command]
pub fn app__write_config_file(json: String) -> Result<(), AppError> {
    let path = vrchat_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, json)?;
    Ok(())
}

fn open_folder(path: &str) -> Result<bool, AppError> {
    let p = PathBuf::from(path);
    if !p.exists() {
        return Ok(false);
    }
    open::that(path).map_err(|e| AppError::Custom(format!("open folder: {e}")))?;
    Ok(true)
}

#[tauri::command]
pub fn app__open_vrcx_app_data_folder(state: State<'_, AppState>) -> Result<bool, AppError> {
    open_folder(&state.paths.app_data.to_string_lossy())
}

#[tauri::command]
pub fn app__open_vrc_app_data_folder() -> Result<bool, AppError> {
    open_folder(&vrchat_app_data().to_string_lossy())
}

#[tauri::command]
pub fn app__open_vrc_photos_folder() -> Result<bool, AppError> {
    let path = app__get_vrchat_photos_location();
    open_folder(&path)
}

#[tauri::command]
pub fn app__open_ugc_photos_folder(ugc_path: Option<String>) -> Result<bool, AppError> {
    let path = app__get_ugc_photo_location(ugc_path);
    open_folder(&path)
}

#[tauri::command]
pub fn app__open_vrc_screenshots_folder() -> Result<bool, AppError> {
    let path = app__get_vrchat_screenshots_location();
    if path.is_empty() {
        return Ok(false);
    }
    open_folder(&path)
}

#[tauri::command]
pub fn app__open_crash_vrc_crash_dumps() -> Result<bool, AppError> {
    let temp = std::env::temp_dir();
    let path = temp.join("VRChat\\VRChat\\Crashes");
    open_folder(&path.to_string_lossy())
}

#[tauri::command]
pub fn app__open_shortcut_folder(state: State<'_, AppState>) -> Result<(), AppError> {
    let shortcut_dir = state.paths.app_data.join("Shortcuts");
    std::fs::create_dir_all(&shortcut_dir)?;
    open::that(shortcut_dir.to_string_lossy().as_ref())
        .map_err(|e| AppError::Custom(format!("open shortcut folder: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn app__open_folder_and_select_item(
    path: String,
    _is_folder: Option<bool>,
) -> Result<(), AppError> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(AppError::Custom(format!("path not found: {path}")));
    }

    std::process::Command::new("explorer.exe")
        .arg("/select,")
        .arg(&path)
        .spawn()
        .map_err(|e| AppError::Custom(format!("explorer: {e}")))?;

    Ok(())
}

#[tauri::command]
pub async fn app__open_file_selector_dialog(
    app_handle: AppHandle,
    default_path: Option<String>,
    default_ext: Option<String>,
    default_filter: Option<String>,
) -> Result<String, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app_handle.dialog().file();

    if let Some(ref path) = default_path {
        let p = PathBuf::from(path);
        if p.is_dir() {
            builder = builder.set_directory(p);
        } else if let Some(parent) = p.parent() {
            if parent.is_dir() {
                builder = builder.set_directory(parent);
            }
        }
    }

    if let Some(ref filter) = default_filter {
        for pair in filter.split('|').collect::<Vec<_>>().chunks(2) {
            if pair.len() == 2 {
                let name = pair[0].trim();
                let exts: Vec<&str> = pair[1]
                    .split(';')
                    .map(|e| e.trim().trim_start_matches("*."))
                    .collect();
                builder = builder.add_filter(name, &exts);
            }
        }
    } else if let Some(ref ext) = default_ext {
        let ext_clean = ext.trim_start_matches('.');
        builder = builder.add_filter(ext_clean, &[ext_clean]);
    }

    let result = builder.blocking_pick_file();

    match result {
        Some(file_path) => {
            let path_str = match file_path {
                tauri_plugin_dialog::FilePath::Path(p) => p.to_string_lossy().to_string(),
                other => other.to_string(),
            };
            Ok(path_str)
        }
        None => Ok(String::new()),
    }
}

#[tauri::command]
pub async fn app__open_folder_selector_dialog(
    app_handle: AppHandle,
    default_path: Option<String>,
) -> Result<String, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app_handle.dialog().file();

    if let Some(ref path) = default_path {
        let p = PathBuf::from(path);
        if p.is_dir() {
            builder = builder.set_directory(p);
        } else if let Some(parent) = p.parent() {
            if parent.is_dir() {
                builder = builder.set_directory(parent);
            }
        }
    }

    let result = builder.blocking_pick_folder();

    match result {
        Some(folder_path) => Ok(match folder_path {
            tauri_plugin_dialog::FilePath::Path(p) => p.to_string_lossy().to_string(),
            other => other.to_string(),
        }),
        None => Ok(String::new()),
    }
}

#[tauri::command]
pub async fn app__save_vrc_reg_json_file(
    app_handle: AppHandle,
    default_path: Option<String>,
    default_name: String,
    json: String,
) -> Result<String, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app_handle.dialog().file();

    if let Some(ref path) = default_path {
        let p = PathBuf::from(path);
        if p.is_dir() {
            builder = builder.set_directory(p);
        } else if let Some(parent) = p.parent() {
            if parent.is_dir() {
                builder = builder.set_directory(parent);
            }
        }
    }

    if !default_name.trim().is_empty() {
        builder = builder.set_file_name(&default_name);
    }

    builder = builder.add_filter("JSON Files", &["json"]);

    let result = builder.blocking_save_file();

    match result {
        Some(file_path) => {
            let path = match file_path {
                tauri_plugin_dialog::FilePath::Path(p) => p,
                other => PathBuf::from(other.to_string()),
            };

            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }

            std::fs::write(&path, json)?;
            Ok(path.to_string_lossy().to_string())
        }
        None => Ok(String::new()),
    }
}
