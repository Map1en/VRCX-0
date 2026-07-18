#![allow(non_snake_case)]

use crate::error::AppError;
use crate::state::AppState;
use tauri::State;
use vrcx_0_host::app_paths::{self, AppDataDirSource};
use vrcx_0_host_desktop::vrchat_paths;

use vrcx_0_host_desktop::host_capabilities::{require_host_capability, HostCapability};

#[tauri::command]
#[specta::specta]
pub fn app__system_culture() -> String {
    normalize_locale(sys_locale::get_locale().unwrap_or_else(|| "en-US".into()))
}

#[tauri::command]
#[specta::specta]
pub fn app__system_language() -> String {
    normalize_locale(sys_locale::get_locale().unwrap_or_else(|| "en".into()))
}

fn normalize_locale(locale: String) -> String {
    locale.replace('_', "-")
}

#[tauri::command]
#[specta::specta]
pub fn app__get_vrchat_app_data_location() -> Result<String, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(vrchat_paths::vrchat_app_data()
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
#[specta::specta]
pub fn app__get_vrchat_photos_location() -> Result<String, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(vrchat_paths::vrchat_photos_location())
}

#[tauri::command]
#[specta::specta]
pub fn app__get_ugc_photo_location(path: Option<String>) -> Result<String, AppError> {
    if path.as_deref().is_none_or(|p| p.is_empty()) {
        require_host_capability(HostCapability::VrchatPathDiscovery)?;
    }
    Ok(vrchat_paths::ugc_photo_location(path))
}

#[tauri::command]
#[specta::specta]
pub fn app__get_vrchat_cache_location() -> Result<String, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(vrchat_paths::vrchat_cache_location())
}

#[tauri::command]
#[specta::specta]
pub fn app__get_vrchat_screenshots_location() -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(vrchat_paths::vrchat_screenshots_location())
}

#[tauri::command]
#[specta::specta]
pub fn app__get_app_data_dir_state(
    state: State<'_, AppState>,
) -> Result<app_paths::AppDataDirState, AppError> {
    Ok(app_paths::app_data_dir_state(&state.runtime.app_data_dir)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__validate_app_data_dir(
    path: String,
) -> Result<app_paths::AppDataDirValidation, AppError> {
    Ok(app_paths::validate_app_data_dir_selection(path)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__set_app_data_dir(
    state: State<'_, AppState>,
    path: String,
) -> Result<app_paths::AppDataDirState, AppError> {
    ensure_data_dir_settings_available(&state)?;
    app_paths::persist_app_data_dir(path)?;
    Ok(app_paths::app_data_dir_state(&state.runtime.app_data_dir)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__clear_app_data_dir(
    state: State<'_, AppState>,
) -> Result<app_paths::AppDataDirState, AppError> {
    ensure_data_dir_settings_available(&state)?;
    app_paths::clear_persisted_app_data_dir()?;
    Ok(app_paths::app_data_dir_state(&state.runtime.app_data_dir)?)
}

fn ensure_data_dir_settings_available(state: &AppState) -> Result<(), AppError> {
    if state.runtime.app_data_dir.source == AppDataDirSource::Cli {
        return Err(AppError::Custom(
            "Data directory settings are disabled while --data-dir is active.".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_locale_separator() {
        assert_eq!(normalize_locale("en_US".into()), "en-US");
        assert_eq!(normalize_locale("zh-Hans_CN".into()), "zh-Hans-CN");
    }
}
