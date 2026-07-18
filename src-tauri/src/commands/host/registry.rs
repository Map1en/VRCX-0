#![allow(non_snake_case)]

use std::collections::HashMap;

use crate::error::AppError;
use crate::state::AppState;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use vrcx_0_host_desktop::vrchat_registry;

use vrcx_0_host_desktop::host_capabilities::{require_host_capability, HostCapability};

#[tauri::command]
#[specta::specta]
pub fn app__get_vrchat_registry_key(key: String) -> Result<serde_json::Value, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    vrchat_registry::validate_registry_key(&key)?;
    Ok(vrchat_registry::get_registry_key(&key)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__get_vrchat_registry_key_string(key: String) -> Result<String, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    vrchat_registry::validate_registry_key(&key)?;
    Ok(vrchat_registry::get_registry_key_string(&key)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__has_vrchat_registry_folder() -> Result<bool, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(vrchat_registry::has_registry_folder()?)
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub fn app__set_vrchat_registry_key(
    key: String,
    value: serde_json::Value,
    type_int: i32,
) -> Result<bool, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    vrchat_registry::validate_registry_entry(&key, &value, type_int)?;
    Ok(vrchat_registry::set_registry_key(&key, &value, type_int)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__get_vrchat_registry(
) -> Result<HashMap<String, HashMap<String, serde_json::Value>>, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(vrchat_registry::get_registry()?)
}

#[tauri::command]
#[specta::specta]
pub fn app__set_vrchat_registry(json: String) -> Result<(), AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    vrchat_registry::validate_registry_json(&json)?;
    Ok(vrchat_registry::set_registry(&json)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__read_vrc_reg_json_file(
    state: State<'_, AppState>,
    filepath: String,
) -> Result<String, AppError> {
    state
        .desktop
        .host_file_access
        .ensure_read_allowed(&filepath, &state.paths)?;
    Ok(vrchat_registry::read_reg_json_file(&filepath)?)
}
