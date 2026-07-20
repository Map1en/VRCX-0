#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_core::vrchat_api::friends::{friend_status_get_input, friends_get_input};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse, VrchatScope};

use super::types::{VrchatFriendUserInput, VrchatFriendsGetInput};

async fn execute_friend_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse, AppError> {
    super::super::execute::execute_vrchat_api(state, command, detail, input, VrchatScope::Vrchat)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_friends_get(
    state: State<'_, AppState>,
    input: VrchatFriendsGetInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_friend_api(
        state,
        "app__vrchat_friends_get",
        format!("Getting friends offset {}.", input.offset),
        friends_get_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            input.offline,
            input.n,
            input.offset,
        ),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_friend_status_get(
    state: State<'_, AppState>,
    input: VrchatFriendUserInput,
) -> Result<VrchatApiResponse, AppError> {
    let (user_id, request) =
        friend_status_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), input.user_id)?;
    execute_friend_api(
        state,
        "app__vrchat_friend_status_get",
        format!("Getting friend status for {user_id}."),
        request,
    )
    .await
}
