#![allow(non_snake_case)]

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, State};
use vrcx_0_application::ProfileBackupJobStatus;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn app__profile_backup_job_status_get(state: State<'_, AppState>) -> ProfileBackupJobStatus {
    state.runtime_context.profile_backup.status()
}

#[tauri::command]
#[specta::specta]
pub fn app__profile_backup_job_cancel(
    state: State<'_, AppState>,
    job_id: u64,
) -> Result<ProfileBackupJobStatus, AppError> {
    state
        .runtime_context
        .profile_backup
        .cancel(job_id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__profile_backup_manual_start(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    target_directory: String,
) -> Result<ProfileBackupJobStatus, AppError> {
    let target_directory = PathBuf::from(target_directory.trim());
    if target_directory.as_os_str().is_empty() {
        return Err(AppError::Custom("Backup directory is empty.".into()));
    }
    state
        .host_file_access
        .ensure_write_allowed(&target_directory, &state.paths)?;

    state
        .runtime_context
        .profile_backup
        .start_manual(
            target_directory,
            Arc::clone(&state.db),
            state.storage.get_all(),
            app_handle.package_info().version.to_string(),
            state.runtime_context.tasks.clone(),
        )
        .map_err(AppError::from)
}
