#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn app__append_error_log(state: State<'_, AppState>, entry: String) -> Result<(), AppError> {
    state.runtime_host().append_error_log(&entry);
    Ok(())
}
