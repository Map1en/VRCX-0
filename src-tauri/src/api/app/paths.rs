#![allow(non_snake_case)]

use crate::error::AppError;
use vrcx_0_host::vrchat_paths;

use vrcx_0_host::host_capabilities::{require_host_capability, HostCapability};

#[tauri::command]
pub fn app__current_culture() -> String {
    normalize_locale(sys_locale::get_locale().unwrap_or_else(|| "en-US".into()))
}

#[tauri::command]
pub fn app__current_language() -> String {
    normalize_locale(sys_locale::get_locale().unwrap_or_else(|| "en".into()))
}

fn normalize_locale(locale: String) -> String {
    locale.replace('_', "-")
}

#[tauri::command]
pub fn app__get_vrchat_app_data_location() -> Result<String, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(vrchat_paths::vrchat_app_data()
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
pub fn app__get_vrchat_photos_location() -> Result<String, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(vrchat_paths::vrchat_photos_location())
}

#[tauri::command]
pub fn app__get_ugc_photo_location(path: Option<String>) -> Result<String, AppError> {
    if path.as_deref().is_none_or(|p| p.is_empty()) {
        require_host_capability(HostCapability::VrchatPathDiscovery)?;
    }
    Ok(vrchat_paths::ugc_photo_location(path))
}

#[tauri::command]
pub fn app__get_vrchat_cache_location() -> Result<String, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(vrchat_paths::vrchat_cache_location())
}

#[tauri::command]
pub fn app__get_vrchat_screenshots_location() -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(vrchat_paths::vrchat_screenshots_location())
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
