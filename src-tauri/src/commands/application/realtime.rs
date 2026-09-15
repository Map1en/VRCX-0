#![allow(non_snake_case)]

use serde_json::Value;
use tauri::State;
use vrcx_0_application_core::FriendProfileLoadStatusPayload;

use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_runtime_host_desktop::CurrentUserRefreshOutcome;

#[tauri::command]
#[specta::specta]
pub async fn app__current_user_refresh(
    state: State<'_, AppState>,
) -> Result<CurrentUserRefreshOutcome, AppError> {
    Ok(state.runtime_host().refresh_current_user().await?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__ingest_user_facts(
    state: State<'_, AppState>,
    entries: Vec<Value>,
) -> Result<(), AppError> {
    state.runtime_host().ingest_user_facts(entries);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__friend_profile_load_start(
    state: State<'_, AppState>,
) -> Result<FriendProfileLoadStatusPayload, AppError> {
    Ok(state.runtime_host().start_friend_profile_bulk_load()?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__friend_profile_load_cancel(
    state: State<'_, AppState>,
) -> Result<FriendProfileLoadStatusPayload, AppError> {
    Ok(state.runtime_host().cancel_friend_profile_bulk_load()?)
}
