#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{
    self as application, vrchat_api::VrchatApiResponse, GroupApiDeps, VrchatGroupGalleryInput,
    VrchatGroupIdInput, VrchatGroupJoinRequestRespondInput, VrchatGroupJoinRequestsInput,
    VrchatGroupLogsInput, VrchatGroupMemberPropsInput, VrchatGroupMembersInput,
    VrchatGroupMembersSearchInput, VrchatGroupPagedInput, VrchatGroupPostCreateInput,
    VrchatGroupPostDeleteInput, VrchatGroupPostEditInput, VrchatGroupProfileInput,
    VrchatGroupRepresentationInput, VrchatGroupUserGroupsInput, VrchatGroupUserInput,
};

use crate::error::AppError;
use crate::state::AppState;

fn deps(state: &State<'_, AppState>) -> GroupApiDeps {
    GroupApiDeps {
        db: state.db.clone(),
        web: state.web.clone(),
        diagnostics: state.runtime_context.diagnostics.clone(),
        sync: state.runtime_context.sync.clone(),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_get(
    state: State<'_, AppState>,
    input: VrchatGroupProfileInput,
) -> Result<VrchatApiResponse, AppError> {
    application::get_group(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_user_groups_get(
    state: State<'_, AppState>,
    input: VrchatGroupUserGroupsInput,
) -> Result<VrchatApiResponse, AppError> {
    application::get_user_groups(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_posts_get(
    state: State<'_, AppState>,
    input: VrchatGroupPagedInput,
) -> Result<VrchatApiResponse, AppError> {
    application::get_posts(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_members_get(
    state: State<'_, AppState>,
    input: VrchatGroupMembersInput,
) -> Result<VrchatApiResponse, AppError> {
    application::get_members(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_members_search(
    state: State<'_, AppState>,
    input: VrchatGroupMembersSearchInput,
) -> Result<VrchatApiResponse, AppError> {
    application::search_members(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_gallery_get(
    state: State<'_, AppState>,
    input: VrchatGroupGalleryInput,
) -> Result<VrchatApiResponse, AppError> {
    application::get_gallery(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_instances_get(
    state: State<'_, AppState>,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse, AppError> {
    application::get_group_instances(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_bans_get(
    state: State<'_, AppState>,
    input: VrchatGroupPagedInput,
) -> Result<VrchatApiResponse, AppError> {
    application::get_bans(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_invites_get(
    state: State<'_, AppState>,
    input: VrchatGroupPagedInput,
) -> Result<VrchatApiResponse, AppError> {
    application::get_invites(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_join_requests_get(
    state: State<'_, AppState>,
    input: VrchatGroupJoinRequestsInput,
) -> Result<VrchatApiResponse, AppError> {
    application::get_join_requests(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_audit_log_types_get(
    state: State<'_, AppState>,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse, AppError> {
    application::get_audit_log_types(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_logs_get(
    state: State<'_, AppState>,
    input: VrchatGroupLogsInput,
) -> Result<VrchatApiResponse, AppError> {
    application::get_logs(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_user_instances_get(
    state: State<'_, AppState>,
    input: VrchatGroupUserGroupsInput,
) -> Result<VrchatApiResponse, AppError> {
    application::get_user_instances(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_post_create(
    state: State<'_, AppState>,
    input: VrchatGroupPostCreateInput,
) -> Result<VrchatApiResponse, AppError> {
    application::create_post(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_post_edit(
    state: State<'_, AppState>,
    input: VrchatGroupPostEditInput,
) -> Result<VrchatApiResponse, AppError> {
    application::edit_post(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_post_delete(
    state: State<'_, AppState>,
    input: VrchatGroupPostDeleteInput,
) -> Result<VrchatApiResponse, AppError> {
    application::delete_post(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_join(
    state: State<'_, AppState>,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse, AppError> {
    application::join_group(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_leave(
    state: State<'_, AppState>,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse, AppError> {
    application::leave_group(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_request_cancel(
    state: State<'_, AppState>,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse, AppError> {
    application::cancel_request(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_invite_send(
    state: State<'_, AppState>,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse, AppError> {
    application::send_invite(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_member_kick(
    state: State<'_, AppState>,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse, AppError> {
    application::kick_member(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_member_ban(
    state: State<'_, AppState>,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse, AppError> {
    application::ban_member(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_member_unban(
    state: State<'_, AppState>,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse, AppError> {
    application::unban_member(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_invite_delete(
    state: State<'_, AppState>,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse, AppError> {
    application::delete_invite(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_join_request_respond(
    state: State<'_, AppState>,
    input: VrchatGroupJoinRequestRespondInput,
) -> Result<VrchatApiResponse, AppError> {
    application::respond_join_request(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_representation_set(
    state: State<'_, AppState>,
    input: VrchatGroupRepresentationInput,
) -> Result<VrchatApiResponse, AppError> {
    application::set_representation(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_member_props_set(
    state: State<'_, AppState>,
    input: VrchatGroupMemberPropsInput,
) -> Result<VrchatApiResponse, AppError> {
    application::set_member_props(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_block(
    state: State<'_, AppState>,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse, AppError> {
    application::block_group(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_unblock(
    state: State<'_, AppState>,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse, AppError> {
    application::unblock_group(deps(&state), input)
        .await
        .map_err(AppError::from)
}
