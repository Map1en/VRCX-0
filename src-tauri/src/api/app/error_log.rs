#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_host::error_log::append_error_log_entry;

#[tauri::command]
pub fn app__append_error_log(state: State<'_, AppState>, entry: String) -> Result<(), AppError> {
    append_error_log_entry(&state.paths.app_data, &entry);
    Ok(())
}
