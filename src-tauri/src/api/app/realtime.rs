#![allow(non_snake_case)]

use std::collections::HashMap;

use tauri::State;
use vrcx_0_domain::friends::FriendRecord;
use vrcx_0_runtime::realtime::friends::FriendBaselineResult;

use crate::error::AppError;
use crate::state::AppState;

use crate::backend::realtime::types::RealtimeTransportStartResult;
use crate::backend::realtime::RealtimeStopRequest;

#[tauri::command]
pub fn app__start_realtime_transport(
    state: State<'_, AppState>,
    user_id: String,
    endpoint: String,
    websocket: String,
    client_run_id: u64,
) -> Result<RealtimeTransportStartResult, AppError> {
    state
        .realtime_backend
        .start(user_id, endpoint, websocket, client_run_id)
}

#[tauri::command]
pub fn app__stop_realtime_transport(
    state: State<'_, AppState>,
    user_id: Option<String>,
    endpoint: Option<String>,
    websocket: Option<String>,
    client_run_id: Option<u64>,
    generation: Option<u64>,
) {
    state.realtime_backend.stop(RealtimeStopRequest {
        user_id,
        endpoint,
        websocket,
        client_run_id,
        generation,
    });
}

#[tauri::command]
pub fn app__set_realtime_friend_baseline(
    state: State<'_, AppState>,
    current_user_id: String,
    endpoint: String,
    websocket: String,
    client_run_id: u64,
    generation: u64,
    friends_by_id: HashMap<String, FriendRecord>,
) -> Result<FriendBaselineResult, AppError> {
    state.realtime_backend.set_friend_baseline(
        current_user_id,
        endpoint,
        websocket,
        client_run_id,
        generation,
        friends_by_id,
    )
}
