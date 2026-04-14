#![allow(non_snake_case)]

use serde_json::Value;
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn discord__set_active(state: State<'_, AppState>, active: bool) -> Result<bool, AppError> {
    state.discord_rpc.set_active(active)
}

#[tauri::command]
pub fn discord__set_assets(state: State<'_, AppState>, payload: Value) -> Result<bool, AppError> {
    state.discord_rpc.set_assets(payload)
}
