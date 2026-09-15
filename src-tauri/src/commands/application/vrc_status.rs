#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_core::VrcStatusSnapshot;

use crate::{error::AppError, state::AppState};

#[tauri::command(async)]
#[specta::specta]
pub fn app__vrc_status_get(state: State<'_, AppState>) -> VrcStatusSnapshot {
    state.runtime_host().vrc_status_snapshot()
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrc_status_refresh(
    state: State<'_, AppState>,
) -> Result<VrcStatusSnapshot, AppError> {
    state
        .runtime_host()
        .refresh_vrc_status()
        .await
        .map_err(AppError::from)
}
