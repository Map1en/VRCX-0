#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::VrcStatusSnapshot;

use crate::{error::AppError, state::AppState};

#[tauri::command]
#[specta::specta]
pub fn app__vrc_status_get(state: State<'_, AppState>) -> VrcStatusSnapshot {
    state.runtime_context.vrc_status.snapshot()
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrc_status_refresh(
    state: State<'_, AppState>,
) -> Result<VrcStatusSnapshot, AppError> {
    state
        .runtime_context
        .vrc_status
        .refresh()
        .await
        .map_err(AppError::from)
}
