#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

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
