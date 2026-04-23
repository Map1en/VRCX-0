#![allow(non_snake_case)]

use std::path::PathBuf;

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

pub(super) fn vrchat_config_path() -> PathBuf {
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    PathBuf::from(local_app_data).join("..\\LocalLow\\VRChat\\VRChat\\config.json")
}

pub(super) fn vrchat_app_data() -> PathBuf {
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    PathBuf::from(local_app_data).join("..\\LocalLow\\VRChat\\VRChat")
}

#[tauri::command]
pub fn app__get_vrchat_app_data_location() -> String {
    vrchat_app_data().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn app__get_vrchat_photos_location() -> String {
    if let Ok(content) = std::fs::read_to_string(vrchat_config_path()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(folder) = v.get("picture_output_folder").and_then(|v| v.as_str()) {
                if !folder.is_empty() {
                    return folder.to_string();
                }
            }
        }
    }

    dirs::picture_dir()
        .unwrap_or_default()
        .join("VRChat")
        .to_string_lossy()
        .into_owned()
}

#[tauri::command]
pub fn app__get_ugc_photo_location(path: Option<String>) -> String {
    match path {
        Some(p) if !p.is_empty() => p,
        _ => app__get_vrchat_photos_location(),
    }
}

#[tauri::command]
pub fn app__get_vrchat_cache_location() -> String {
    if let Ok(content) = std::fs::read_to_string(vrchat_config_path()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(folder) = v.get("cache_directory").and_then(|v| v.as_str()) {
                if !folder.is_empty() {
                    return folder.to_string();
                }
            }
        }
    }
    vrchat_app_data()
        .join("Cache-WindowsPlayer")
        .to_string_lossy()
        .into_owned()
}

#[tauri::command]
pub fn app__get_vrchat_screenshots_location() -> String {
    let steam_path = get_steam_path();
    if steam_path.is_empty() {
        return String::new();
    }
    let userdata = PathBuf::from(&steam_path).join("userdata");
    if !userdata.exists() {
        return String::new();
    }

    let mut best_path = String::new();
    let mut best_time = std::time::SystemTime::UNIX_EPOCH;

    if let Ok(entries) = std::fs::read_dir(&userdata) {
        for entry in entries.flatten() {
            let screenshots_dir = entry.path().join("760\\remote\\438100\\screenshots");
            if screenshots_dir.exists() {
                if let Ok(meta) = std::fs::metadata(&screenshots_dir) {
                    if let Ok(modified) = meta.modified() {
                        if modified > best_time {
                            best_time = modified;
                            best_path = screenshots_dir.to_string_lossy().into_owned();
                        }
                    }
                }
            }
        }
    }
    best_path
}

pub(super) fn get_steam_path() -> String {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(key) = hklm.open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam") {
            if let Ok(val) = key.get_value::<String, _>("InstallPath") {
                return val;
            }
        }
        String::new()
    }
    #[cfg(not(target_os = "windows"))]
    {
        String::new()
    }
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
