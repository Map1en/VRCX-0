#![allow(non_snake_case)]

use std::collections::HashMap;

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn storage__get(key: String, state: State<'_, AppState>) -> Result<Option<String>, AppError> {
    Ok(state.storage.get(&key))
}

#[tauri::command]
pub fn storage__set(
    key: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.storage.set(key, value);
    Ok(())
}

#[tauri::command]
pub fn storage__flush(state: State<'_, AppState>) -> Result<(), AppError> {
    state.storage.save()
}

#[tauri::command]
pub fn storage__remove(
    key: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    Ok(state.storage.remove(&key))
}

#[tauri::command]
pub fn storage__get_all(state: State<'_, AppState>) -> Result<HashMap<String, String>, AppError> {
    Ok(state.storage.get_all())
}
