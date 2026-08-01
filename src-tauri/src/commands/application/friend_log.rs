#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{
    resolve_friend_log_names, FriendLogNameResolutionDeps, FriendLogNameResolutionInput,
    ResolvedFriendLogName,
};

use crate::{error::AppError, state::AppState};

#[tauri::command]
#[specta::specta]
pub async fn app__friend_log_names_resolve(
    state: State<'_, AppState>,
    input: FriendLogNameResolutionInput,
) -> Result<Vec<ResolvedFriendLogName>, AppError> {
    resolve_friend_log_names(
        &state.friend_log_name_resolutions,
        FriendLogNameResolutionDeps {
            db: state.db.as_ref(),
            auth_scope: &state.runtime_context.auth_scope,
            realtime: &state.realtime_runtime,
        },
        input,
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__friend_log_names_cancel(state: State<'_, AppState>, request_id: String) -> bool {
    state.friend_log_name_resolutions.cancel(&request_id)
}
