#![allow(non_snake_case)]

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_host::shell_actions;

use vrcx_0_host::host_capabilities::{require_host_capability, HostCapability};

#[tauri::command]
pub fn app__open_link(url: String) -> Result<(), AppError> {
    Ok(shell_actions::open_link(&url)?)
}

#[tauri::command]
pub fn app__open_discord_profile(discord_id: String) -> Result<(), AppError> {
    Ok(shell_actions::open_discord_profile(&discord_id)?)
}

#[tauri::command]
pub fn app__get_file_base64(path: String) -> Result<String, AppError> {
    Ok(shell_actions::file_base64(&path)?)
}

#[tauri::command]
pub fn app__get_file_bytes(path: String) -> Result<Vec<u8>, AppError> {
    Ok(shell_actions::file_bytes(&path)?)
}

#[tauri::command]
pub fn app__read_config_file() -> Result<String, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(shell_actions::read_config_file()?)
}

#[tauri::command]
pub fn app__read_config_file_safe() -> Result<String, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(shell_actions::read_config_file_safe()?)
}

#[tauri::command]
pub fn app__write_config_file(json: String) -> Result<(), AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(shell_actions::write_config_file(&json)?)
}

#[tauri::command]
pub fn app__open_vrcx_app_data_folder(state: State<'_, AppState>) -> Result<bool, AppError> {
    Ok(shell_actions::open_existing_folder(&state.paths.app_data)?)
}

#[tauri::command]
pub fn app__open_vrc_app_data_folder() -> Result<bool, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(shell_actions::open_vrc_app_data_folder()?)
}

#[tauri::command]
pub fn app__open_vrc_photos_folder() -> Result<bool, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(shell_actions::open_vrc_photos_folder()?)
}

#[tauri::command]
pub fn app__open_ugc_photos_folder(ugc_path: Option<String>) -> Result<bool, AppError> {
    if ugc_path.as_deref().is_none_or(|p| p.is_empty()) {
        require_host_capability(HostCapability::VrchatPathDiscovery)?;
    }
    Ok(shell_actions::open_ugc_photos_folder(ugc_path)?)
}

#[tauri::command]
pub fn app__open_vrc_screenshots_folder() -> Result<bool, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(shell_actions::open_vrc_screenshots_folder()?)
}

#[tauri::command]
pub fn app__open_crash_vrc_crash_dumps() -> Result<bool, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(shell_actions::open_crash_dumps_folder()?)
}

#[tauri::command]
pub fn app__open_shortcut_folder(state: State<'_, AppState>) -> Result<(), AppError> {
    Ok(shell_actions::open_shortcut_folder(&state.paths.app_data)?)
}

#[tauri::command]
pub fn app__open_folder_and_select_item(
    path: String,
    is_folder: Option<bool>,
) -> Result<(), AppError> {
    Ok(shell_actions::open_folder_and_select_item(
        &path,
        is_folder.unwrap_or(false),
    )?)
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

            shell_actions::write_string_file(&path, &json)?;
            Ok(path.to_string_lossy().to_string())
        }
        None => Ok(String::new()),
    }
}
