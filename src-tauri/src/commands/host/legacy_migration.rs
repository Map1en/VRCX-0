#![allow(non_snake_case)]

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_runtime_host_desktop::legacy_migration::LegacyVrcxMigrationStatus;
use vrcx_0_runtime_host_desktop::{LegacyMigrationLifecycle, LegacyMigrationRequestMode};

struct TauriLegacyMigrationLifecycle(AppHandle);

impl LegacyMigrationLifecycle for TauriLegacyMigrationLifecycle {
    fn stop_runtime_services(&self) {
        super::window::stop_runtime_services(&self.0);
    }

    fn request_restart(&self) {
        self.0.request_restart();
    }
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__check_legacy_vrcx_available(state: State<'_, AppState>) -> bool {
    state.runtime_host().legacy_migration().available()
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__get_legacy_vrcx_migration_status(
    state: State<'_, AppState>,
) -> LegacyVrcxMigrationStatus {
    state.runtime_host().legacy_migration().status()
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__is_legacy_vrcx_running(state: State<'_, AppState>) -> bool {
    state
        .runtime_host()
        .legacy_migration()
        .is_legacy_vrcx_running()
}

#[tauri::command]
#[specta::specta]
pub async fn app__get_legacy_vrcx_force_migration_status(
    state: State<'_, AppState>,
) -> Result<LegacyVrcxMigrationStatus, AppError> {
    Ok(state
        .runtime_host()
        .legacy_migration()
        .force_status()
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__request_legacy_migration(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    allow_running_legacy_vrcx: bool,
) -> Result<bool, AppError> {
    Ok(state
        .runtime_host()
        .legacy_migration()
        .request(
            LegacyMigrationRequestMode::Configured,
            allow_running_legacy_vrcx,
            Arc::new(TauriLegacyMigrationLifecycle(app_handle)),
        )
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__request_legacy_vrcx_force_migration(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    allow_running_legacy_vrcx: bool,
) -> Result<bool, AppError> {
    Ok(state
        .runtime_host()
        .legacy_migration()
        .request(
            LegacyMigrationRequestMode::Force,
            allow_running_legacy_vrcx,
            Arc::new(TauriLegacyMigrationLifecycle(app_handle)),
        )
        .await?)
}
