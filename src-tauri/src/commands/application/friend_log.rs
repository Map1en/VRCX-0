#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::social::{FriendLogNameResolutionInput, ResolvedFriendLogName};

use crate::{error::AppError, state::AppState};

#[tauri::command]
#[specta::specta]
pub async fn app__friend_log_names_resolve(
    state: State<'_, AppState>,
    input: FriendLogNameResolutionInput,
) -> Result<Vec<ResolvedFriendLogName>, AppError> {
    state.resolve_friend_log_names(input).await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__friend_log_names_cancel(state: State<'_, AppState>, request_id: String) -> bool {
    state.cancel_friend_log_name_resolution(&request_id)
}
