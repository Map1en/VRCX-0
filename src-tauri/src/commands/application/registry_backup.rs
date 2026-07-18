#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_game::{
    RegistryBackupMaintenanceMode, RegistryBackupMaintenanceResult, RegistryBackupSnapshot,
};
use vrcx_0_host_desktop::host_capabilities::{require_host_capability, HostCapability};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn app__registry_backup_list(
    state: State<'_, AppState>,
) -> Result<Vec<RegistryBackupSnapshot>, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(state.registry_backup_list()?)
}

#[tauri::command]
#[specta::specta]
pub fn app__registry_backup_create(
    state: State<'_, AppState>,
    name: String,
) -> Result<Vec<RegistryBackupSnapshot>, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(state.registry_backup_create(&name)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__registry_backup_restore(
    state: State<'_, AppState>,
    key: String,
) -> Result<RegistryBackupSnapshot, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(state.registry_backup_restore(&key)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__registry_backup_delete(
    state: State<'_, AppState>,
    key: String,
) -> Result<Vec<RegistryBackupSnapshot>, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(state.registry_backup_delete(&key)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__registry_backup_export_json(
    state: State<'_, AppState>,
    key: String,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(state.registry_backup_export_json(&key)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__registry_backup_import_json(
    state: State<'_, AppState>,
    json: String,
) -> Result<(), AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(state.registry_backup_import_json(&json)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__registry_backup_maintenance_run(
    state: State<'_, AppState>,
    reason: String,
) -> Result<RegistryBackupMaintenanceResult, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(
        state
            .registry_backup_maintenance_run(&reason, RegistryBackupMaintenanceMode::Foreground)?,
    )
}
