#![allow(non_snake_case)]

use std::collections::HashMap;

use crate::error::AppError;
use vrcx_0_host::vrchat_registry;

use vrcx_0_host::host_capabilities::{require_host_capability, HostCapability};

#[tauri::command]
pub fn app__get_vrchat_registry_key(key: String) -> Result<serde_json::Value, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(vrchat_registry::get_registry_key(&key)?)
}

#[tauri::command]
pub fn app__get_vrchat_registry_key_string(key: String) -> Result<String, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(vrchat_registry::get_registry_key_string(&key)?)
}

#[tauri::command]
pub fn app__has_vrchat_registry_folder() -> Result<bool, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(vrchat_registry::has_registry_folder()?)
}

#[tauri::command]
pub fn app__delete_vrchat_registry_folder() -> Result<(), AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(vrchat_registry::delete_registry_folder()?)
}

#[tauri::command]
pub fn app__set_vrchat_registry_key(
    key: String,
    value: serde_json::Value,
    type_int: i32,
) -> Result<bool, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
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
    Ok(vrchat_registry::set_registry(&json)?)
}

#[tauri::command]
pub fn app__read_vrc_reg_json_file(filepath: String) -> Result<String, AppError> {
    Ok(vrchat_registry::read_reg_json_file(&filepath)?)
}
