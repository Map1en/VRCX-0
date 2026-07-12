#![allow(non_snake_case)]

use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};
use vrcx_0_application::{
    BackupSummary, CloudBackupProgress, CloudBackupRestorePrepareInput, CloudBackupRestoreProbe,
    CloudBackupSettings, CloudBackupSettingsInput, CloudBackupUploadInput, RemoteBackupStatus,
    RestorePreview, CLOUD_BACKUP_PROGRESS_EVENT,
};
use vrcx_0_runtime_host::CloudBackupProgressReporter;

use crate::error::AppError;
use crate::state::AppState;

fn progress_reporter(app_handle: &AppHandle) -> CloudBackupProgressReporter {
    let app_handle = app_handle.clone();
    Arc::new(move |payload: CloudBackupProgress| {
        if let Err(error) = app_handle.emit(CLOUD_BACKUP_PROGRESS_EVENT, payload) {
            tracing::warn!(error = %error, "failed to emit cloud backup progress");
        }
    })
}

#[tauri::command]
#[specta::specta]
pub fn app__cloud_backup_settings_get(
    state: State<'_, AppState>,
) -> Result<CloudBackupSettings, AppError> {
    Ok(state.cloud_backup_settings_get()?)
}

#[tauri::command]
#[specta::specta]
pub fn app__cloud_backup_settings_save(
    input: CloudBackupSettingsInput,
    state: State<'_, AppState>,
) -> Result<CloudBackupSettings, AppError> {
    Ok(state.cloud_backup_settings_save(input)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__cloud_backup_credential_clear(
    state: State<'_, AppState>,
) -> Result<CloudBackupSettings, AppError> {
    Ok(state.cloud_backup_credential_clear()?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__cloud_backup_connection_test(state: State<'_, AppState>) -> Result<(), AppError> {
    Ok(state.cloud_backup_connection_test().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__cloud_backup_remote_status(
    state: State<'_, AppState>,
) -> Result<RemoteBackupStatus, AppError> {
    Ok(state.cloud_backup_remote_status().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__cloud_backup_upload(
    input: CloudBackupUploadInput,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<BackupSummary, AppError> {
    Ok(state
        .cloud_backup_upload(input, progress_reporter(&app_handle))
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__cloud_backup_restore_probe(
    state: State<'_, AppState>,
) -> Result<CloudBackupRestoreProbe, AppError> {
    Ok(state.cloud_backup_restore_probe().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__cloud_backup_restore_prepare(
    input: CloudBackupRestorePrepareInput,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<RestorePreview, AppError> {
    Ok(state
        .cloud_backup_restore_prepare(input, progress_reporter(&app_handle))
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__cloud_backup_restore_commit(
    restore_id: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .cloud_backup_restore_commit(restore_id, progress_reporter(&app_handle))
        .await?;
    crate::commands::host::window::app__restart_application(app_handle)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__cloud_backup_restore_discard(
    restore_id: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    Ok(state.cloud_backup_restore_discard(&restore_id)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__cloud_backup_restore_finalize(state: State<'_, AppState>) -> Result<bool, AppError> {
    Ok(state.cloud_backup_restore_finalize()?)
}

#[tauri::command]
#[specta::specta]
pub fn app__cloud_backup_restore_rollback(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let requested = state.cloud_backup_restore_rollback_request()?;
    if requested {
        crate::commands::host::window::app__restart_application(app_handle)?;
    }
    Ok(requested)
}
