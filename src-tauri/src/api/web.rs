#![allow(non_snake_case)]

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Serialize)]
pub struct ExecuteResponse {
    #[serde(rename = "Item1")]
    pub status: i32,
    #[serde(rename = "Item2")]
    pub body: String,
}

#[tauri::command]
pub async fn web__clear_cookies(state: State<'_, AppState>) -> Result<(), AppError> {
    state.web.clear_cookies();
    state.web.save_cookies(&state.db);
    Ok(())
}

#[tauri::command]
pub async fn web__get_cookies(state: State<'_, AppState>) -> Result<String, AppError> {
    let b64 = state.web.get_cookies();
    state.web.save_cookies(&state.db);
    Ok(b64)
}

#[tauri::command]
pub async fn web__set_cookies(state: State<'_, AppState>, cookies: String) -> Result<(), AppError> {
    state.web.set_cookies(&cookies);
    state.web.save_cookies(&state.db);
    Ok(())
}

#[tauri::command]
pub async fn web__execute(
    state: State<'_, AppState>,
    options: HashMap<String, Value>,
) -> Result<ExecuteResponse, AppError> {
    let (status, body) = state.web.execute(options).await?;
    state.web.save_cookies(&state.db);
    Ok(ExecuteResponse { status, body })
}
