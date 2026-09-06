#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::social::{
    VrchatGroupGalleryInput, VrchatGroupIdInput, VrchatGroupJoinRequestRespondInput,
    VrchatGroupJoinRequestsInput, VrchatGroupLogsInput, VrchatGroupMemberPropsInput,
    VrchatGroupMemberRoleInput, VrchatGroupMembersInput, VrchatGroupMembersSearchInput,
    VrchatGroupPagedInput, VrchatGroupPostCreateInput, VrchatGroupPostDeleteInput,
    VrchatGroupPostEditInput, VrchatGroupProfileInput, VrchatGroupRepresentationInput,
    VrchatGroupUserGroupsInput, VrchatGroupUserInput,
};
use vrcx_0_application_core::vrchat_api::VrchatApiResponse;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_get(
    state: State<'_, AppState>,
    input: VrchatGroupProfileInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .get(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_user_groups_get(
    state: State<'_, AppState>,
    input: VrchatGroupUserGroupsInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .user_groups(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_posts_get(
    state: State<'_, AppState>,
    input: VrchatGroupPagedInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .posts(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_members_get(
    state: State<'_, AppState>,
    input: VrchatGroupMembersInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .members(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_members_search(
    state: State<'_, AppState>,
    input: VrchatGroupMembersSearchInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .search_members(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_gallery_get(
    state: State<'_, AppState>,
    input: VrchatGroupGalleryInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .gallery(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_bans_get(
    state: State<'_, AppState>,
    input: VrchatGroupPagedInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .bans(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_invites_get(
    state: State<'_, AppState>,
    input: VrchatGroupPagedInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .invites(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_join_requests_get(
    state: State<'_, AppState>,
    input: VrchatGroupJoinRequestsInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .join_requests(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_audit_log_types_get(
    state: State<'_, AppState>,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .audit_log_types(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_logs_get(
    state: State<'_, AppState>,
    input: VrchatGroupLogsInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .logs(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_user_instances_get(
    state: State<'_, AppState>,
    input: VrchatGroupUserGroupsInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .user_instances(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_post_create(
    state: State<'_, AppState>,
    input: VrchatGroupPostCreateInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .create_post(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_post_edit(
    state: State<'_, AppState>,
    input: VrchatGroupPostEditInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .edit_post(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_post_delete(
    state: State<'_, AppState>,
    input: VrchatGroupPostDeleteInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .delete_post(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_join(
    state: State<'_, AppState>,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .join(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_leave(
    state: State<'_, AppState>,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .leave(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_request_cancel(
    state: State<'_, AppState>,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .cancel_request(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_invite_send(
    state: State<'_, AppState>,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .send_invite(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_member_kick(
    state: State<'_, AppState>,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .kick_member(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_member_ban(
    state: State<'_, AppState>,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .ban_member(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_member_unban(
    state: State<'_, AppState>,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .unban_member(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_member_role_add(
    state: State<'_, AppState>,
    input: VrchatGroupMemberRoleInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .add_member_role(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_member_role_remove(
    state: State<'_, AppState>,
    input: VrchatGroupMemberRoleInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .remove_member_role(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_invite_delete(
    state: State<'_, AppState>,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .delete_invite(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_join_request_respond(
    state: State<'_, AppState>,
    input: VrchatGroupJoinRequestRespondInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .respond_join_request(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_representation_set(
    state: State<'_, AppState>,
    input: VrchatGroupRepresentationInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .set_representation(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_member_props_set(
    state: State<'_, AppState>,
    input: VrchatGroupMemberPropsInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .set_member_props(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_block(
    state: State<'_, AppState>,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .block(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_unblock(
    state: State<'_, AppState>,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .groups()
        .unblock(input)
        .await
        .map_err(AppError::from)
}
