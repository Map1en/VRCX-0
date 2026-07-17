#![allow(non_snake_case)]

use serde_json::Value;
use tauri::State;
use vrcx_0_application::{AuthenticatedRuntimePhaseSnapshot, FriendProfileLoadStatusPayload};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn app__authenticated_runtime_session_start(
    state: State<'_, AppState>,
    user_id: String,
    endpoint: String,
    websocket: String,
    current_user_snapshot: Value,
) -> Result<AuthenticatedRuntimePhaseSnapshot, AppError> {
    Ok(state.start_frontend_authenticated_runtime(
        user_id,
        endpoint,
        websocket,
        current_user_snapshot,
    )?)
}

#[tauri::command]
#[specta::specta]
pub fn app__sync_realtime_current_user_snapshot(
    state: State<'_, AppState>,
    user_id: String,
    endpoint: String,
    websocket: String,
    generation: Option<u64>,
    snapshot: Value,
    overlay_patch: Value,
) -> Result<bool, AppError> {
    Ok(state.realtime_runtime.sync_current_user_snapshot(
        user_id,
        endpoint,
        websocket,
        generation,
        snapshot,
        overlay_patch,
    )?)
}

#[tauri::command]
#[specta::specta]
pub fn app__expire_realtime_notification(
    state: State<'_, AppState>,
    user_id: String,
    notification_id: String,
) -> Result<(), AppError> {
    Ok(state
        .realtime_runtime
        .expire_notification(user_id, notification_id)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__ingest_user_facts(
    state: State<'_, AppState>,
    entries: Vec<Value>,
) -> Result<(), AppError> {
    state.realtime_runtime.ingest_user_facts(entries);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__friend_profile_load_start(
    state: State<'_, AppState>,
) -> Result<FriendProfileLoadStatusPayload, AppError> {
    Ok(state.realtime_runtime.start_friend_profile_bulk_load()?)
}

#[tauri::command]
#[specta::specta]
pub fn app__friend_profile_load_cancel(
    state: State<'_, AppState>,
) -> Result<FriendProfileLoadStatusPayload, AppError> {
    Ok(state.realtime_runtime.cancel_friend_profile_bulk_load()?)
}
