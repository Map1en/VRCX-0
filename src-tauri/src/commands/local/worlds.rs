#![allow(non_snake_case)]

use tauri::State;

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_contracts::feed::{WorldFriendVisitsOutput, WorldRecentFriendCountRow};
use vrcx_0_contracts::vrchat_api::VrchatResponse;
use vrcx_0_runtime_host_desktop::local_data::WorldGetInput;

#[tauri::command]
#[specta::specta]
pub async fn app__world_get(
    state: State<'_, AppState>,
    input: WorldGetInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .local_data()
        .world_get(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__world_friend_visits(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<WorldFriendVisitsOutput, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("world friend visits", move || {
        local_data.world_friend_visits(world_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__world_recent_friend_counts(
    state: State<'_, AppState>,
    world_ids: Vec<String>,
) -> Result<Vec<WorldRecentFriendCountRow>, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("world recent friend counts", move || {
        local_data.world_recent_friend_counts(world_ids)
    })
    .await
}
