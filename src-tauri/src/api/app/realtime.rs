#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn app__start_realtime_transport(
    state: State<'_, AppState>,
    user_id: String,
    endpoint: String,
    websocket: String,
) -> Result<(), AppError> {
    state.realtime_backend.start(user_id, endpoint, websocket)
}

#[tauri::command]
pub fn app__stop_realtime_transport(state: State<'_, AppState>) {
    state.realtime_backend.stop();
}
