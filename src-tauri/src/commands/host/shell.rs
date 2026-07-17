#![allow(non_snake_case)]

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_host::shell_actions;

use vrcx_0_host::host_capabilities::{require_host_capability, HostCapability};

const BACKGROUND_IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];

fn with_fixed_extension(mut path: PathBuf, extension: Option<&str>) -> PathBuf {
    let Some(extension) = extension
        .map(|value| value.trim_start_matches('.'))
        .filter(|value| !value.is_empty())
    else {
        return path;
    };
    if path.extension().and_then(|value| value.to_str()) != Some(extension) {
        path.set_extension(extension);
    }
    path
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundImageFilesResolveInput {
    paths: Option<Vec<String>>,
    folder_path: Option<String>,
}

fn is_background_image_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    BACKGROUND_IMAGE_EXTENSIONS
        .iter()
        .any(|allowed| extension.eq_ignore_ascii_case(allowed))
}

fn background_image_files_in_folder(folder: &Path) -> Result<Vec<String>, AppError> {
    if !folder.is_dir() {
        return Err(AppError::Custom(
            "Background image folder is not available.".into(),
        ));
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        let path = entry.path();
        if is_background_image_file(&path) {
            files.push(path.to_string_lossy().to_string());
        }
    }
    files.sort_by_key(|path| path.to_ascii_lowercase());
    Ok(files)
}

fn background_image_files_from_paths(paths: Vec<String>) -> Vec<String> {
    let mut files: Vec<String> = paths
        .into_iter()
        .map(PathBuf::from)
        .filter(|path| is_background_image_file(path))
        .map(|path| path.to_string_lossy().to_string())
        .collect();
    files.sort_by_key(|path| path.to_ascii_lowercase());
    files.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    files
}

#[tauri::command]
#[specta::specta]
pub fn app__open_link(url: String) -> Result<(), AppError> {
    Ok(shell_actions::open_link(&url)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__open_discord_profile(discord_id: String) -> Result<(), AppError> {
    Ok(shell_actions::open_discord_profile(&discord_id)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__get_file_base64(state: State<'_, AppState>, path: String) -> Result<String, AppError> {
    state
        .host_file_access
        .ensure_read_allowed(&path, &state.paths)?;
    Ok(shell_actions::file_base64(&path)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__get_file_bytes(state: State<'_, AppState>, path: String) -> Result<Vec<u8>, AppError> {
    state
        .host_file_access
        .ensure_read_allowed(&path, &state.paths)?;
    Ok(shell_actions::file_bytes(&path)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__read_config_file() -> Result<String, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(shell_actions::read_config_file()?)
}

#[tauri::command]
#[specta::specta]
pub fn app__read_config_file_safe() -> Result<String, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(shell_actions::read_config_file_safe()?)
}

#[tauri::command]
#[specta::specta]
pub fn app__write_config_file(json: String) -> Result<(), AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    let normalized_json = shell_actions::normalize_config_file_json(&json)?;
    Ok(shell_actions::write_config_file(&normalized_json)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__open_vrcx_app_data_folder(state: State<'_, AppState>) -> Result<bool, AppError> {
    Ok(shell_actions::open_existing_folder(&state.paths.app_data)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__open_vrc_app_data_folder() -> Result<bool, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(shell_actions::open_vrc_app_data_folder()?)
}

#[tauri::command]
#[specta::specta]
pub fn app__open_vrc_photos_folder() -> Result<bool, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(shell_actions::open_vrc_photos_folder()?)
}

#[tauri::command]
#[specta::specta]
pub fn app__open_ugc_photos_folder(
    state: State<'_, AppState>,
    ugc_path: Option<String>,
) -> Result<bool, AppError> {
    if let Some(path) = ugc_path.as_deref().filter(|path| !path.is_empty()) {
        state
            .host_file_access
            .ensure_read_allowed(path, &state.paths)?;
    } else {
        require_host_capability(HostCapability::VrchatPathDiscovery)?;
    }
    Ok(shell_actions::open_ugc_photos_folder(ugc_path)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__open_vrc_screenshots_folder() -> Result<bool, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(shell_actions::open_vrc_screenshots_folder()?)
}

#[tauri::command]
#[specta::specta]
pub fn app__open_crash_vrc_crash_dumps() -> Result<bool, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(shell_actions::open_crash_dumps_folder()?)
}

#[tauri::command]
#[specta::specta]
pub fn app__open_folder_and_select_item(
    state: State<'_, AppState>,
    path: String,
    is_folder: Option<bool>,
) -> Result<(), AppError> {
    state
        .host_file_access
        .ensure_read_allowed(&path, &state.paths)?;
    Ok(shell_actions::open_folder_and_select_item(
        &path,
        is_folder.unwrap_or(false),
    )?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__open_file_selector_dialog(
    state: State<'_, AppState>,
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
            state.host_file_access.register_path(&path_str);
            Ok(path_str)
        }
        None => Ok(String::new()),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app__save_file_selector_dialog(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    default_path: Option<String>,
    default_name: Option<String>,
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

    if let Some(ref name) = default_name {
        if !name.trim().is_empty() {
            builder = builder.set_file_name(name);
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

    let result = builder.blocking_save_file();

    match result {
        Some(file_path) => {
            let path = match file_path {
                tauri_plugin_dialog::FilePath::Path(p) => p,
                other => PathBuf::from(other.to_string()),
            };
            let path = with_fixed_extension(path, default_ext.as_deref());
            let path_str = path.to_string_lossy().to_string();
            state.host_file_access.register_path(&path_str);
            Ok(path_str)
        }
        None => Ok(String::new()),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app__open_background_image_files_selector_dialog(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    default_path: Option<String>,
) -> Result<Vec<String>, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app_handle
        .dialog()
        .file()
        .add_filter("Images", BACKGROUND_IMAGE_EXTENSIONS);

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

    let result = builder.blocking_pick_files();
    let Some(file_paths) = result else {
        return Ok(Vec::new());
    };

    let files = background_image_files_from_paths(
        file_paths
            .into_iter()
            .map(|file_path| match file_path {
                tauri_plugin_dialog::FilePath::Path(path) => path.to_string_lossy().to_string(),
                other => other.to_string(),
            })
            .collect(),
    );
    for file in &files {
        state.host_file_access.register_path(file);
    }
    Ok(files)
}

#[tauri::command]
#[specta::specta]
pub fn app__background_image_files_resolve(
    state: State<'_, AppState>,
    input: BackgroundImageFilesResolveInput,
) -> Result<Vec<String>, AppError> {
    let files = if let Some(folder_path) = input.folder_path.filter(|path| !path.trim().is_empty())
    {
        let folder = PathBuf::from(folder_path);
        state.host_file_access.register_path(&folder);
        background_image_files_in_folder(&folder)?
    } else {
        background_image_files_from_paths(input.paths.unwrap_or_default())
    };

    for file in &files {
        state.host_file_access.register_path(file);
    }
    Ok(files)
}

#[tauri::command]
#[specta::specta]
pub async fn app__open_folder_selector_dialog(
    state: State<'_, AppState>,
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
        Some(folder_path) => {
            let path_str = match folder_path {
                tauri_plugin_dialog::FilePath::Path(p) => p.to_string_lossy().to_string(),
                other => other.to_string(),
            };
            state.host_file_access.register_path(&path_str);
            Ok(path_str)
        }
        None => Ok(String::new()),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app__save_vrc_reg_json_file(
    state: State<'_, AppState>,
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
            state.host_file_access.register_path(&path);
            Ok(path.to_string_lossy().to_string())
        }
        None => Ok(String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::with_fixed_extension;
    use std::path::PathBuf;

    #[test]
    fn save_path_keeps_the_name_and_forces_the_selected_extension() {
        assert_eq!(
            with_fixed_extension(PathBuf::from("Custom name.zip"), Some(".vrcx0backup")),
            PathBuf::from("Custom name.vrcx0backup")
        );
        assert_eq!(
            with_fixed_extension(
                PathBuf::from("Custom name.vrcx0backup"),
                Some(".vrcx0backup")
            ),
            PathBuf::from("Custom name.vrcx0backup")
        );
    }
}
