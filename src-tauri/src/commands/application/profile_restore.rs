#![allow(non_snake_case)]

use std::path::PathBuf;

#[cfg(not(debug_assertions))]
use tauri::Manager;
use tauri::{AppHandle, State};
use vrcx_0_application::{ProfileBackupJobState, ProfileRestoreRequestResult, ProfileRestoreState};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__profile_restore_request(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    archive_path: String,
) -> Result<ProfileRestoreRequestResult, AppError> {
    let archive_path = PathBuf::from(archive_path.trim());
    if archive_path.as_os_str().is_empty() {
        return Err(AppError::Custom("Profile backup path is empty.".into()));
    }
    state
        .host_file_access
        .ensure_read_allowed(&archive_path, &state.paths)?;
    reject_conflicting_runtime_state(&state)?;

    let app_data = state.paths.app_data.clone();
    let restore_state = tauri::async_runtime::spawn_blocking(move || {
        vrcx_0_application::prepare_profile_restore(&archive_path, &app_data)
    })
    .await
    .map_err(|error| AppError::Custom(format!("Profile restore worker failed: {error}")))??;
    restart_after_restore_request(&app_handle, &state, restore_state)
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_restore_state_get(
    state: State<'_, AppState>,
) -> Result<ProfileRestoreState, AppError> {
    let app_data = state.paths.app_data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        vrcx_0_application::profile_restore_state(&app_data)
    })
    .await
    .map_err(|error| AppError::Custom(format!("Profile restore state worker failed: {error}")))?
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_restore_confirm(
    state: State<'_, AppState>,
) -> Result<ProfileRestoreState, AppError> {
    let app_data = state.paths.app_data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        vrcx_0_application::confirm_profile_restore(&app_data)
    })
    .await
    .map_err(|error| AppError::Custom(format!("Profile restore cleanup worker failed: {error}")))?
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_restore_rollback_request(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<ProfileRestoreRequestResult, AppError> {
    let app_data = state.paths.app_data.clone();
    let restore_state = tauri::async_runtime::spawn_blocking(move || {
        vrcx_0_application::request_profile_rollback(&app_data)
    })
    .await
    .map_err(|error| AppError::Custom(format!("Profile rollback worker failed: {error}")))??;
    restart_after_restore_request(&app_handle, &state, restore_state)
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_restore_result_acknowledge(
    state: State<'_, AppState>,
) -> Result<ProfileRestoreState, AppError> {
    let app_data = state.paths.app_data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        vrcx_0_application::acknowledge_profile_restore_result(&app_data)
    })
    .await
    .map_err(|error| {
        AppError::Custom(format!(
            "Profile restore acknowledgement worker failed: {error}"
        ))
    })?
    .map_err(AppError::from)
}

fn reject_conflicting_runtime_state(state: &AppState) -> Result<(), AppError> {
    if matches!(
        state.runtime_context.profile_backup.status().state,
        ProfileBackupJobState::Running | ProfileBackupJobState::Cancelling
    ) {
        return Err(AppError::Custom(
            "Wait for the active profile backup to finish before restoring.".into(),
        ));
    }
    if state.db.get_failed_upgrade()?.is_some() {
        return Err(AppError::Custom(
            "Resolve the active or failed database upgrade before restoring a profile backup."
                .into(),
        ));
    }
    Ok(())
}

fn restart_after_restore_request(
    app_handle: &AppHandle,
    state: &AppState,
    restore_state: ProfileRestoreState,
) -> Result<ProfileRestoreRequestResult, AppError> {
    #[cfg(debug_assertions)]
    {
        let _ = (app_handle, state);
        tracing::warn!(
            "profile restore was staged in a debug build; restart VRCX-0 manually to continue"
        );
        Ok(ProfileRestoreRequestResult {
            state: restore_state,
            restart_requested: false,
        })
    }

    #[cfg(not(debug_assertions))]
    {
        super::super::host::window::stop_runtime_services(app_handle);
        state.storage.save()?;
        state.release_profile_lock();
        app_handle.request_restart();
        Ok(ProfileRestoreRequestResult {
            state: restore_state,
            restart_requested: true,
        })
    }
}
