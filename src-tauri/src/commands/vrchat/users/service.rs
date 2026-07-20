#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_core::vrchat_api::users::{
    current_user_badge_update_input, current_user_tags_add_input, current_user_tags_remove_input,
    current_user_update_input, user_groups_get_input, user_mutual_counts_get_input,
    user_mutual_friends_get_input, user_represented_group_get_input,
};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse, VrchatScope};

use super::types::{
    VrchatCurrentUserBadgeInput, VrchatCurrentUserTagsInput, VrchatCurrentUserUpdateInput,
    VrchatUserInput, VrchatUserMutualFriendsInput,
};

async fn execute_user_read_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse, AppError> {
    super::super::execute::execute_vrchat_api(state, command, detail, input, VrchatScope::Vrchat)
        .await
}

async fn execute_current_user_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse, AppError> {
    super::super::execute::execute_vrchat_api(state, command, detail, input, VrchatScope::Vrchat)
        .await
}

async fn execute_current_user_api_then_invalidate(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    user_id: String,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse, AppError> {
    let realtime_runtime = state.realtime_runtime.clone();
    let result = execute_current_user_api(state, command, detail, input).await;
    if let Ok(response) = &result {
        if (200..300).contains(&response.status) {
            realtime_runtime
                .invalidate_user_query_cache(VRCHAT_API_DEFAULT_ENDPOINT, &user_id)
                .await;
        }
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_user_get(
    state: State<'_, AppState>,
    input: VrchatUserInput,
) -> Result<VrchatApiResponse, AppError> {
    let diagnostics = state.runtime_context.diagnostics.clone();
    diagnostics.record_command(
        "app__vrchat_user_get",
        "running",
        format!("Getting user {}.", input.user_id),
    );
    let result = state
        .realtime_runtime
        .get_user_via_cache(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            input.user_id,
            input.force,
            input.dialog,
            input.is_friend,
        )
        .await;
    match &result {
        Ok(response) => diagnostics.record_command(
            "app__vrchat_user_get",
            "ok",
            format!("status={}", response.status),
        ),
        Err(error) => {
            diagnostics.record_command("app__vrchat_user_get", "error", error.to_string())
        }
    }
    Ok(result?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_user_mutual_counts_get(
    state: State<'_, AppState>,
    input: VrchatUserInput,
) -> Result<VrchatApiResponse, AppError> {
    let (user_id, request) =
        user_mutual_counts_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), input.user_id)?;
    execute_user_read_api(
        state,
        "app__vrchat_user_mutual_counts_get",
        format!("Getting mutual counts for {user_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_user_groups_get(
    state: State<'_, AppState>,
    input: VrchatUserInput,
) -> Result<VrchatApiResponse, AppError> {
    let (user_id, request) =
        user_groups_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), input.user_id)?;
    execute_user_read_api(
        state,
        "app__vrchat_user_groups_get",
        format!("Getting groups for user {user_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_user_represented_group_get(
    state: State<'_, AppState>,
    input: VrchatUserInput,
) -> Result<VrchatApiResponse, AppError> {
    let (user_id, request) =
        user_represented_group_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), input.user_id)?;
    execute_user_read_api(
        state,
        "app__vrchat_user_represented_group_get",
        format!("Getting represented group for user {user_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_user_mutual_friends_get(
    state: State<'_, AppState>,
    input: VrchatUserMutualFriendsInput,
) -> Result<VrchatApiResponse, AppError> {
    let (user_id, request) = user_mutual_friends_get_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.user_id,
        input.n,
        input.offset,
        input.include_user_id_param,
    )?;
    execute_user_read_api(
        state,
        "app__vrchat_user_mutual_friends_get",
        format!(
            "Getting mutual friends for {user_id} offset {}.",
            input.offset
        ),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_current_user_update(
    state: State<'_, AppState>,
    input: VrchatCurrentUserUpdateInput,
) -> Result<VrchatApiResponse, AppError> {
    let (user_id, request) = current_user_update_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.user_id,
        input.params,
    )?;
    execute_current_user_api_then_invalidate(
        state,
        "app__vrchat_current_user_update",
        format!("Updating current user {user_id}."),
        user_id,
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_current_user_badge_update(
    state: State<'_, AppState>,
    input: VrchatCurrentUserBadgeInput,
) -> Result<VrchatApiResponse, AppError> {
    let (user_id, badge_id, request) = current_user_badge_update_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.user_id,
        input.badge_id,
        input.hidden,
        input.showcased,
    )?;
    execute_current_user_api(
        state,
        "app__vrchat_current_user_badge_update",
        format!("Updating badge {badge_id} for current user {user_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_current_user_tags_add(
    state: State<'_, AppState>,
    input: VrchatCurrentUserTagsInput,
) -> Result<VrchatApiResponse, AppError> {
    let (user_id, request) = current_user_tags_add_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.user_id,
        input.tags,
    )?;
    execute_current_user_api_then_invalidate(
        state,
        "app__vrchat_current_user_tags_add",
        format!("Adding tags to current user {user_id}."),
        user_id,
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_current_user_tags_remove(
    state: State<'_, AppState>,
    input: VrchatCurrentUserTagsInput,
) -> Result<VrchatApiResponse, AppError> {
    let (user_id, request) = current_user_tags_remove_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.user_id,
        input.tags,
    )?;
    execute_current_user_api_then_invalidate(
        state,
        "app__vrchat_current_user_tags_remove",
        format!("Removing tags from current user {user_id}."),
        user_id,
        request,
    )
    .await
}
