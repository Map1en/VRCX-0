#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_runtime_host_desktop::notification::{
    NotificationDoNotDisturbMode, NotificationDoNotDisturbSnapshot,
};
use vrcx_0_runtime_host_desktop::{AncillaryRuntimeSnapshot, RuntimeJobRecordInput};

#[tauri::command]
#[specta::specta]
pub async fn app__ancillary_runtime_snapshot_get(
    state: State<'_, AppState>,
) -> Result<AncillaryRuntimeSnapshot, AppError> {
    Ok(state.runtime_host().ancillary_runtime_snapshot().await)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__notification_do_not_disturb_mode_set(
    state: State<'_, AppState>,
    mode: NotificationDoNotDisturbMode,
) -> Result<NotificationDoNotDisturbSnapshot, AppError> {
    Ok(state
        .runtime_host()
        .set_notification_do_not_disturb_mode(mode)?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__runtime_group_instances_refresh(
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.runtime_host().refresh_runtime_group_instances().await;
    Ok(())
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__runtime_discord_reconcile_request(state: State<'_, AppState>) -> u64 {
    state.runtime_host().request_discord_reconcile()
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__runtime_background_job_record(
    state: State<'_, AppState>,
    input: RuntimeJobRecordInput,
) {
    state.runtime_host().record_runtime_job(input);
}
