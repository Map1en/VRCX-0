#![allow(non_snake_case)]

use std::collections::HashMap;

use serde_json::Value;
use tauri::State;
use vrcx_0_core::friends::FriendRecord;

use crate::error::AppError;
use crate::state::AppState;

use crate::backend::realtime::RealtimeStopRequest;
use vrcx_0_runtime::realtime::types::{FriendBaselineResult, RealtimeTransportStartResult};

#[tauri::command]
pub fn app__start_realtime_transport(
    state: State<'_, AppState>,
    user_id: String,
    endpoint: String,
    websocket: String,
    client_run_id: u64,
    current_user_snapshot: Value,
    friends_by_id: HashMap<String, FriendRecord>,
) -> Result<RealtimeTransportStartResult, AppError> {
    Ok(state.realtime_backend.start(
        user_id,
        endpoint,
        websocket,
        client_run_id,
        current_user_snapshot,
        friends_by_id,
    )?)
}

#[tauri::command]
pub fn app__sync_realtime_friend_snapshot(
    state: State<'_, AppState>,
    user_id: String,
    endpoint: String,
    websocket: String,
    generation: Option<u64>,
    friends_by_id: HashMap<String, FriendRecord>,
) -> Result<FriendBaselineResult, AppError> {
    Ok(state.realtime_backend.sync_friend_snapshot(
        user_id,
        endpoint,
        websocket,
        generation,
        friends_by_id,
    )?)
}

#[tauri::command]
pub fn app__sync_realtime_current_user_snapshot(
    state: State<'_, AppState>,
    user_id: String,
    endpoint: String,
    websocket: String,
    generation: Option<u64>,
    snapshot: Value,
    overlay_patch: Value,
) -> Result<bool, AppError> {
    Ok(state.realtime_backend.sync_current_user_snapshot(
        user_id,
        endpoint,
        websocket,
        generation,
        snapshot,
        overlay_patch,
    )?)
}

#[tauri::command]
pub fn app__expire_realtime_notification(
    state: State<'_, AppState>,
    user_id: String,
    notification_id: String,
) -> Result<(), AppError> {
    Ok(state
        .realtime_backend
        .expire_notification(user_id, notification_id)?)
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
