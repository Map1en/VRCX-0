#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use super::types::VrchatFriendUserInput;

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_friend_status_get(
    state: State<'_, AppState>,
    input: VrchatFriendUserInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .friend_status(input.user_id)
        .await
        .map_err(AppError::from)
}
