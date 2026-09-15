#![allow(non_snake_case)]

use std::path::PathBuf;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use vrcx_0_application_game::{
    RegistryBackupMaintenanceMode, RegistryBackupMaintenanceResult, RegistryBackupSnapshot,
};
use vrcx_0_host_desktop::host_capabilities::{require_host_capability, HostCapability};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn app__registry_backup_list(
    state: State<'_, AppState>,
) -> Result<Vec<RegistryBackupSnapshot>, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(state.runtime_host().registry_backup_list()?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__registry_backup_create(
    state: State<'_, AppState>,
    name: String,
) -> Result<Vec<RegistryBackupSnapshot>, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(state.runtime_host().registry_backup_create(&name)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__registry_backup_restore(
    state: State<'_, AppState>,
    key: String,
) -> Result<RegistryBackupSnapshot, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(state.runtime_host().registry_backup_restore(&key)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__registry_backup_delete(
    state: State<'_, AppState>,
    key: String,
) -> Result<Vec<RegistryBackupSnapshot>, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(state.runtime_host().registry_backup_delete(&key)?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__registry_backup_export_to_file(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    key: String,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    let export = state.runtime_host().registry_backup_prepare_export(&key)?;
    let file_path = crate::commands::host::dialog::save_file(
        app_handle
            .dialog()
            .file()
            .set_file_name(&export.file_name)
            .add_filter("JSON Files", &["json"]),
    )
    .await;
    let Some(file_path) = file_path else {
        return Ok(String::new());
    };
    let path = match file_path {
        tauri_plugin_dialog::FilePath::Path(path) => path,
        other => PathBuf::from(other.to_string()),
    };
    Ok(state
        .runtime_host()
        .registry_backup_write_export(&path, &export)?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__registry_backup_import_from_file(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<bool, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    let file_path = crate::commands::host::dialog::pick_file(
        app_handle
            .dialog()
            .file()
            .add_filter("JSON Files", &["json"]),
    )
    .await;
    let Some(file_path) = file_path else {
        return Ok(false);
    };
    let path = match file_path {
        tauri_plugin_dialog::FilePath::Path(path) => path,
        other => PathBuf::from(other.to_string()),
    };
    state
        .runtime_host()
        .registry_backup_import_from_file(&path)?;
    Ok(true)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__registry_backup_maintenance_run(
    state: State<'_, AppState>,
    reason: String,
) -> Result<RegistryBackupMaintenanceResult, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    Ok(state
        .runtime_host()
        .registry_backup_maintenance_run(&reason, RegistryBackupMaintenanceMode::Foreground)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__registry_backup_restore_prompt_acknowledge(
    state: State<'_, AppState>,
    backup_date: String,
) -> Result<String, AppError> {
    Ok(state
        .runtime_host()
        .acknowledge_registry_backup_restore_prompt(&backup_date)?)
}
