#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_application_core::vrchat_api::VrchatApiResponse;
use vrcx_0_contracts::feed::WorldFriendVisitsOutput;
use vrcx_0_runtime_host_desktop::local_data::WorldGetInput;

#[tauri::command]
#[specta::specta]
pub async fn app__world_get(
    state: State<'_, AppState>,
    input: WorldGetInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .local_data()
        .world_get(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__world_friend_visits(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<WorldFriendVisitsOutput, AppError> {
    state
        .runtime_host()
        .local_data()
        .world_friend_visits(world_id)
        .map_err(AppError::from)
}
