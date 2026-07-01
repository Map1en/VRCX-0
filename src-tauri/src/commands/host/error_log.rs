#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_host::error_log::{append_error_log_entry, drain_client_error_log, ClientErrorLogEntry};

#[tauri::command]
#[specta::specta]
pub fn app__append_error_log(state: State<'_, AppState>, entry: String) -> Result<(), AppError> {
    append_error_log_entry(&state.paths.app_data, &entry);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__drain_client_error_log(
    state: State<'_, AppState>,
    since_iso: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ClientErrorLogEntry>, AppError> {
    Ok(drain_client_error_log(
        &state.paths.app_data,
        since_iso.as_deref(),
        limit.unwrap_or(100) as usize,
    ))
}
