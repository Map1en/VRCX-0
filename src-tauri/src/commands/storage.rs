#![allow(non_snake_case)]

use std::collections::HashMap;

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn storage__set(
    key: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.runtime_host().storage_set(key, value);
    Ok(())
}

#[tauri::command(async)]
#[specta::specta]
pub fn storage__flush(state: State<'_, AppState>) -> Result<(), AppError> {
    Ok(state.runtime_host().storage_flush()?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn storage__remove(
    key: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    Ok(state.runtime_host().storage_remove(&key))
}

#[tauri::command(async)]
#[specta::specta]
pub fn storage__get_all(state: State<'_, AppState>) -> Result<HashMap<String, String>, AppError> {
    Ok(state.runtime_host().storage_snapshot())
}
