#![allow(non_snake_case)]

use std::collections::HashMap;

use crate::error::AppError;
use crate::state::AppState;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use vrcx_0_host::vrchat_registry;

use vrcx_0_host::host_capabilities::{require_host_capability, HostCapability};

const ALLOWED_REGISTRY_TYPES: [i32; 3] = [3, 4, 100];
const ALLOWED_REGISTRY_KEYS: [&str; 2] = ["LOGGING_ENABLED", "VRC_DEBUG_LOGGING"];
const ALLOWED_REGISTRY_KEY_PREFIXES: [&str; 8] = [
    "VRC_",
    "VRChat_",
    "vrchat_",
    "Screenmanager ",
    "UnityGraphicsQuality",
    "UnitySelectMonitor",
    "unity.",
    "PlayerPrefs_",
];

#[tauri::command]
pub fn app__get_vrchat_registry_key(key: String) -> Result<serde_json::Value, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    validate_registry_key(&key)?;
    Ok(vrchat_registry::get_registry_key(&key)?)
}

#[tauri::command]
pub fn app__get_vrchat_registry_key_string(key: String) -> Result<String, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    validate_registry_key(&key)?;
    Ok(vrchat_registry::get_registry_key_string(&key)?)
}

#[tauri::command]
pub fn app__has_vrchat_registry_folder() -> Result<bool, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(vrchat_registry::has_registry_folder()?)
}

#[tauri::command]
pub fn app__delete_vrchat_registry_folder(app_handle: AppHandle) -> Result<(), AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    let confirmed = app_handle
        .dialog()
        .message("Delete the VRChat registry preferences folder? This cannot be undone.")
        .title("Delete VRChat registry preferences")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Delete".into(),
            "Cancel".into(),
        ))
        .blocking_show();
    if !confirmed {
        return Err(AppError::Custom(
            "VRChat registry folder delete was cancelled.".into(),
        ));
    }
    Ok(vrchat_registry::delete_registry_folder()?)
}

#[tauri::command]
pub fn app__set_vrchat_registry_key(
    key: String,
    value: serde_json::Value,
    type_int: i32,
) -> Result<bool, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    validate_registry_entry(&key, &value, type_int)?;
    Ok(vrchat_registry::set_registry_key(&key, &value, type_int)?)
}

#[tauri::command]
pub fn app__get_vrchat_registry(
) -> Result<HashMap<String, HashMap<String, serde_json::Value>>, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(vrchat_registry::get_registry()?)
}

#[tauri::command]
pub fn app__set_vrchat_registry(json: String) -> Result<(), AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    validate_registry_json(&json)?;
    Ok(vrchat_registry::set_registry(&json)?)
}

#[tauri::command]
pub fn app__read_vrc_reg_json_file(
    state: State<'_, AppState>,
    filepath: String,
) -> Result<String, AppError> {
    state
        .host_file_access
        .ensure_read_allowed(&filepath, &state.paths)?;
    Ok(vrchat_registry::read_reg_json_file(&filepath)?)
}

fn validate_registry_json(json: &str) -> Result<(), AppError> {
    let data: HashMap<String, HashMap<String, serde_json::Value>> = serde_json::from_str(json)?;
    for (key, props) in data {
        let type_int = props
            .get("type")
            .and_then(|value| value.as_i64())
            .ok_or_else(|| AppError::Custom(format!("Invalid registry type for {key}")))?;
        let type_int = i32::try_from(type_int)
            .map_err(|_| AppError::Custom(format!("Invalid registry type for {key}")))?;
        let value = props
            .get("data")
            .ok_or_else(|| AppError::Custom(format!("Missing registry data for {key}")))?;
        validate_registry_entry(&key, value, type_int)?;
    }
    Ok(())
}

fn validate_registry_entry(
    key: &str,
    value: &serde_json::Value,
    type_int: i32,
) -> Result<(), AppError> {
    validate_registry_key(key)?;
    if !ALLOWED_REGISTRY_TYPES.contains(&type_int) {
        return Err(AppError::Custom(format!(
            "Registry type {type_int} is not allowed for {key}."
        )));
    }

    match type_int {
        3 if value.is_string() => Ok(()),
        4 if value
            .as_i64()
            .and_then(|raw| i32::try_from(raw).ok())
            .is_some() =>
        {
            Ok(())
        }
        100 if value.as_f64().is_some() => Ok(()),
        3 | 4 | 100 => Err(AppError::Custom(format!(
            "Invalid registry value shape for {key}."
        ))),
        _ => unreachable!("registry type allow-list is checked before value validation"),
    }
}

fn validate_registry_key(key: &str) -> Result<(), AppError> {
    let key = key.trim();
    if key.is_empty() || key.len() > 128 {
        return Err(AppError::Custom("Invalid VRChat registry key.".into()));
    }

    let allowed = key.bytes().all(|byte| {
        (byte == b' ' || byte.is_ascii_graphic()) && !matches!(byte, b'\\' | b'/' | b'"' | b'\'')
    });
    if !allowed {
        return Err(AppError::Custom(format!(
            "VRChat registry key '{key}' contains unsupported characters."
        )));
    }

    if !is_allowed_registry_key(key) {
        return Err(AppError::Custom(format!(
            "VRChat registry key '{key}' is not in the allowed PlayerPrefs set."
        )));
    }

    Ok(())
}

fn is_allowed_registry_key(key: &str) -> bool {
    ALLOWED_REGISTRY_KEYS.contains(&key)
        || ALLOWED_REGISTRY_KEY_PREFIXES
            .iter()
            .any(|prefix| key.starts_with(prefix))
        || is_unity_player_prefs_name(key)
        || is_unity_player_prefs_key(key)
}

fn is_unity_player_prefs_key(key: &str) -> bool {
    let Some((name, hash)) = key.rsplit_once("_h") else {
        return false;
    };
    !name.is_empty()
        && !hash.is_empty()
        && hash.bytes().all(|byte| byte.is_ascii_digit())
        && name.bytes().all(is_unity_player_prefs_name_byte)
}

fn is_unity_player_prefs_name(key: &str) -> bool {
    !key.is_empty() && key.bytes().all(is_unity_player_prefs_name_byte)
}

fn is_unity_player_prefs_name_byte(byte: u8) -> bool {
    byte == b' ' || byte == b'.' || byte == b'_' || byte == b'-' || byte.is_ascii_alphanumeric()
}
