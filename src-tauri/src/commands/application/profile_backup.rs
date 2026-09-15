#![allow(non_snake_case)]

use tauri::{AppHandle, State};
use vrcx_0_application::profile::{
    ProfileBackupActionOutcome, ProfileBackupSettings, ProfileBackupStatus, ProfileRestoreResult,
    ProfileRestoreRollbackCleanupOutcome, ProfileRestoreRollbackState,
    ProfileRestoreValidationOutcome,
};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn app__profile_backup_get_settings(
    state: State<'_, AppState>,
) -> Result<ProfileBackupSettings, AppError> {
    Ok(state.runtime_host().profile_backup().settings())
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_backup_set_settings(
    state: State<'_, AppState>,
    settings: ProfileBackupSettings,
) -> Result<ProfileBackupSettings, AppError> {
    let runtime = state.runtime_host().profile_backup().clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || runtime.set_settings(settings))
            .await
            .map_err(|error| {
                AppError::Custom(format!("profile backup settings task: {error}"))
            })??,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_backup_run_manual(
    state: State<'_, AppState>,
    target_path: String,
) -> Result<ProfileBackupActionOutcome, AppError> {
    let runtime = state.runtime_host().profile_backup().clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || runtime.run_manual(target_path))
            .await
            .map_err(|error| AppError::Custom(format!("manual profile backup task: {error}")))??,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_backup_retry_delivery(
    state: State<'_, AppState>,
) -> Result<ProfileBackupActionOutcome, AppError> {
    let runtime = state.runtime_host().profile_backup().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.retry_delivery())
        .await
        .map_err(|error| AppError::Custom(format!("profile backup retry task: {error}")))
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_backup_discard_pending(
    state: State<'_, AppState>,
) -> Result<ProfileBackupActionOutcome, AppError> {
    let runtime = state.runtime_host().profile_backup().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.discard_pending())
        .await
        .map_err(|error| AppError::Custom(format!("profile backup discard task: {error}")))
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__profile_backup_dismiss_error(
    state: State<'_, AppState>,
) -> Result<ProfileBackupStatus, AppError> {
    Ok(state.runtime_host().profile_backup().dismiss_error())
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__profile_backup_current_status(
    state: State<'_, AppState>,
) -> Result<ProfileBackupStatus, AppError> {
    Ok(state.runtime_host().profile_backup().current_status())
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_restore_validate(
    state: State<'_, AppState>,
    path: String,
) -> Result<ProfileRestoreValidationOutcome, AppError> {
    let runtime = state.runtime_host().profile_backup().clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || runtime.validate_restore(path))
            .await
            .map_err(|error| {
                AppError::Custom(format!("profile restore validation task: {error}"))
            })??,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_restore_request(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    expected_sha256: String,
) -> Result<ProfileRestoreValidationOutcome, AppError> {
    let runtime = state.runtime_host().profile_backup().clone();
    let request =
        tauri::async_runtime::spawn_blocking(move || runtime.request_restore(expected_sha256))
            .await
            .map_err(|error| AppError::Custom(format!("profile restore request task: {error}")))?;
    if request.restart_required {
        super::super::host::window::stop_runtime_services(&app_handle);
        app_handle.request_restart();
    }
    Ok(request.outcome)
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_restore_discard_staged(
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let runtime = state.runtime_host().profile_backup().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.discard_staged_restore())
        .await
        .map_err(|error| AppError::Custom(format!("profile restore discard task: {error}")))??;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_restore_take_last_result(
    state: State<'_, AppState>,
) -> Result<Option<ProfileRestoreResult>, AppError> {
    let runtime = state.runtime_host().profile_backup().clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || runtime.take_last_restore_result())
            .await
            .map_err(|error| AppError::Custom(format!("profile restore result task: {error}")))??,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_restore_rollback_state(
    state: State<'_, AppState>,
) -> Result<ProfileRestoreRollbackState, AppError> {
    let runtime = state.runtime_host().profile_backup().clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || runtime.restore_rollback_state())
            .await
            .map_err(|error| AppError::Custom(format!("profile rollback state task: {error}")))??,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_restore_clear_rollback(
    state: State<'_, AppState>,
) -> Result<ProfileRestoreRollbackCleanupOutcome, AppError> {
    let runtime = state.runtime_host().profile_backup().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.clear_restore_rollback())
        .await
        .map_err(|error| AppError::Custom(format!("profile rollback cleanup task: {error}")))
}
