#![allow(non_snake_case)]
#![allow(unused_imports)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_store::config::{ConfigReadEntry, ConfigWriteEntry};

#[tauri::command]
pub fn app__config_list_values(
    state: State<'_, AppState>,
) -> Result<Vec<ConfigReadEntry>, AppError> {
    vrcx_0_store::config::app__config_list_values(state.db.as_ref()).map_err(AppError::from)
}

#[tauri::command]
pub fn app__config_remove_value(state: State<'_, AppState>, key: String) -> Result<i64, AppError> {
    vrcx_0_store::config::app__config_remove_value(state.db.as_ref(), key).map_err(AppError::from)
}

#[tauri::command]
pub fn app__config_set_values(
    state: State<'_, AppState>,
    entries: Vec<ConfigWriteEntry>,
) -> Result<(), AppError> {
    vrcx_0_store::config::app__config_set_values(state.db.as_ref(), entries).map_err(AppError::from)
}
