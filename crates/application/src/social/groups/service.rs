use super::types::{
    VrchatGroupGalleryCreateInput, VrchatGroupGalleryDeleteInput, VrchatGroupGalleryEditInput,
    VrchatGroupGalleryImageAddInput, VrchatGroupGalleryImageDeleteInput, VrchatGroupGalleryInput,
    VrchatGroupIdInput, VrchatGroupJoinRequestRespondInput, VrchatGroupJoinRequestsInput,
    VrchatGroupLogsInput, VrchatGroupMemberPropsInput, VrchatGroupMemberRoleInput,
    VrchatGroupMembersInput, VrchatGroupMembersSearchInput, VrchatGroupMembershipListInput,
    VrchatGroupPagedInput, VrchatGroupPostCreateInput, VrchatGroupPostDeleteInput,
    VrchatGroupPostEditInput, VrchatGroupProfileInput, VrchatGroupRepresentationInput,
    VrchatGroupRoleCreateInput, VrchatGroupRoleInput, VrchatGroupRoleUpdateInput,
    VrchatGroupUpdateInput, VrchatGroupUserGroupsInput, VrchatGroupUserInput,
};
use crate::remote::VrchatRequestPort;
use std::{sync::Arc, time::Duration};
use vrcx_0_application_core::RuntimeOperationStatus;
use vrcx_0_application_core::RuntimeSyncEngine;
use vrcx_0_application_core::{
    is_remote_mutation_request, AuthenticatedMutationContext, RemoteMutationGate, Result,
};
use vrcx_0_application_core::{RuntimeAuthScope, RuntimeDiagnostics};
use vrcx_0_contracts::vrchat_api::{VrchatRequest, VrchatResponse, VrchatScope};

pub enum GroupRemoteRequest {
    GetGroup(VrchatGroupProfileInput),
    GetUserGroups(VrchatGroupUserGroupsInput),
    GetMembershipList(VrchatGroupMembershipListInput),
    GetPosts(VrchatGroupPagedInput),
    GetMembers(VrchatGroupMembersInput),
    GetMember(VrchatGroupUserInput),
    SearchMembers(VrchatGroupMembersSearchInput),
    GetGallery(VrchatGroupGalleryInput),
    CreateGallery(VrchatGroupGalleryCreateInput),
    EditGallery(VrchatGroupGalleryEditInput),
    DeleteGallery(VrchatGroupGalleryDeleteInput),
    AddGalleryImage(VrchatGroupGalleryImageAddInput),
    DeleteGalleryImage(VrchatGroupGalleryImageDeleteInput),
    GetBans(VrchatGroupPagedInput),
    GetInvites(VrchatGroupPagedInput),
    GetJoinRequests(VrchatGroupJoinRequestsInput),
    GetAuditLogTypes(VrchatGroupIdInput),
    GetLogs(VrchatGroupLogsInput),
    GetUserInstances(VrchatGroupUserGroupsInput),
    Update(VrchatGroupUpdateInput),
    Delete(VrchatGroupIdInput),
    CreatePost(VrchatGroupPostCreateInput),
    EditPost(VrchatGroupPostEditInput),
    DeletePost(VrchatGroupPostDeleteInput),
    Join(VrchatGroupIdInput),
    Leave(VrchatGroupIdInput),
    CancelRequest(VrchatGroupIdInput),
    SendInvite(VrchatGroupUserInput),
    Kick(VrchatGroupUserInput),
    Ban(VrchatGroupUserInput),
    Unban(VrchatGroupUserInput),
    AddRole(VrchatGroupMemberRoleInput),
    RemoveRole(VrchatGroupMemberRoleInput),
    DeleteInvite(VrchatGroupUserInput),
    RespondJoinRequest(VrchatGroupJoinRequestRespondInput),
    SetRepresentation(VrchatGroupRepresentationInput),
    SetMemberProps(VrchatGroupMemberPropsInput),
    Block(VrchatGroupIdInput),
    Unblock(VrchatGroupUserInput),
    DeclineInvite(VrchatGroupUserInput),
    GetRoles(VrchatGroupIdInput),
    GetPermissions(VrchatGroupIdInput),
    CreateRole(VrchatGroupRoleCreateInput),
    UpdateRole(VrchatGroupRoleUpdateInput),
    DeleteRole(VrchatGroupRoleInput),
}

pub struct GroupBuiltRequest {
    pub primary_id: String,
    pub secondary_id: Option<String>,
    pub tertiary_id: Option<String>,
    pub request: VrchatRequest,
}

#[derive(Clone)]
pub struct GroupApiDeps {
    remote: Arc<dyn VrchatRequestPort>,
    pub diagnostics: RuntimeDiagnostics,
    pub sync: RuntimeSyncEngine,
    pub auth_scope: RuntimeAuthScope,
    pub remote_mutations: Arc<RemoteMutationGate>,
}

impl GroupApiDeps {
    pub fn new(
        remote: Arc<dyn VrchatRequestPort>,
        diagnostics: RuntimeDiagnostics,
        sync: RuntimeSyncEngine,
        auth_scope: RuntimeAuthScope,
        remote_mutations: Arc<RemoteMutationGate>,
    ) -> Self {
        Self {
            remote,
            diagnostics,
            sync,
            auth_scope,
            remote_mutations,
        }
    }
}

const GROUP_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

pub(super) async fn execute_group_api_raw(
    deps: &GroupApiDeps,
    mut input: VrchatRequest,
) -> Result<VrchatResponse> {
    if is_remote_mutation_request(&input) {
        let mutation = AuthenticatedMutationContext::capture(
            &deps.auth_scope,
            &deps.remote_mutations,
            "Group mutation",
        )?;
        mutation.apply_scope_to_request(&mut input);
        return mutation
            .run_after_wait(GROUP_REMOTE_MUTATION_INTERVAL, || async move {
                deps.remote.send(input, VrchatScope::Vrchat).await
            })
            .await;
    }
    deps.remote.send(input, VrchatScope::Vrchat).await
}

pub(super) async fn execute_group_api(
    deps: &GroupApiDeps,
    command: &str,
    detail: impl Into<String>,
    input: VrchatRequest,
) -> Result<VrchatResponse> {
    deps.diagnostics
        .record_command(command, RuntimeOperationStatus::Running, detail.into());
    let result = execute_group_api_raw(deps, input).await;
    match &result {
        Ok(response) => {
            deps.diagnostics.record_command(
                command,
                RuntimeOperationStatus::Ok,
                format!("status={}", response.status),
            );
            let policy_class =
                vrcx_0_contracts::vrchat_api::classify_vrchat_response(response.status).class;
            deps.sync.record(
                "api",
                RuntimeOperationStatus::Ready,
                format!(
                    "{command} completed with status {}, class={policy_class}.",
                    response.status
                ),
                0,
            );
        }
        Err(error) => {
            deps.diagnostics.record_command(
                command,
                RuntimeOperationStatus::Error,
                error.to_string(),
            );
            deps.sync.record_failure("api", error.to_string());
        }
    }
    result
}

pub async fn get_group(
    deps: GroupApiDeps,
    input: VrchatGroupProfileInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::GetGroup(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_get",
        format!("Getting group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn get_user_groups(
    deps: GroupApiDeps,
    input: VrchatGroupUserGroupsInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::GetUserGroups(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_user_groups_get",
        format!("Getting groups for user {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn get_membership_list(
    deps: GroupApiDeps,
    input: VrchatGroupMembershipListInput,
) -> Result<VrchatResponse> {
    let status = input.status;
    let built = GroupRemoteRequest::GetMembershipList(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_membership_list_get",
        format!(
            "Getting {} groups for user {}.",
            status.as_str(),
            built.primary_id
        ),
        built.request,
    )
    .await
}

pub async fn get_posts(deps: GroupApiDeps, input: VrchatGroupPagedInput) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::GetPosts(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_posts_get",
        format!("Getting posts for group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn get_members(
    deps: GroupApiDeps,
    input: VrchatGroupMembersInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::GetMembers(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_members_get",
        format!("Getting members for group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn search_members(
    deps: GroupApiDeps,
    input: VrchatGroupMembersSearchInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::SearchMembers(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_members_search",
        format!("Searching members for group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn get_gallery(
    deps: GroupApiDeps,
    input: VrchatGroupGalleryInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::GetGallery(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_gallery_get",
        format!(
            "Getting gallery {} for group {}.",
            built.secondary_id.as_deref().unwrap_or_default(),
            built.primary_id
        ),
        built.request,
    )
    .await
}

pub async fn create_gallery(
    deps: GroupApiDeps,
    input: VrchatGroupGalleryCreateInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::CreateGallery(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_gallery_create",
        format!("Creating gallery in group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn edit_gallery(
    deps: GroupApiDeps,
    input: VrchatGroupGalleryEditInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::EditGallery(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_gallery_edit",
        format!(
            "Editing gallery {} in group {}.",
            built.secondary_id.as_deref().unwrap_or_default(),
            built.primary_id
        ),
        built.request,
    )
    .await
}

pub async fn delete_gallery(
    deps: GroupApiDeps,
    input: VrchatGroupGalleryDeleteInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::DeleteGallery(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_gallery_delete",
        format!(
            "Deleting gallery {} in group {}.",
            built.secondary_id.as_deref().unwrap_or_default(),
            built.primary_id
        ),
        built.request,
    )
    .await
}

pub async fn add_gallery_image(
    deps: GroupApiDeps,
    input: VrchatGroupGalleryImageAddInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::AddGalleryImage(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_gallery_image_add",
        format!(
            "Adding image to gallery {} in group {}.",
            built.secondary_id.as_deref().unwrap_or_default(),
            built.primary_id
        ),
        built.request,
    )
    .await
}

pub async fn delete_gallery_image(
    deps: GroupApiDeps,
    input: VrchatGroupGalleryImageDeleteInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::DeleteGalleryImage(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_gallery_image_delete",
        format!(
            "Deleting image {} from gallery {} in group {}.",
            built.tertiary_id.as_deref().unwrap_or_default(),
            built.secondary_id.as_deref().unwrap_or_default(),
            built.primary_id
        ),
        built.request,
    )
    .await
}

pub async fn get_bans(deps: GroupApiDeps, input: VrchatGroupPagedInput) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::GetBans(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_bans_get",
        format!("Getting bans for group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn get_invites(
    deps: GroupApiDeps,
    input: VrchatGroupPagedInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::GetInvites(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_invites_get",
        format!("Getting invites for group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn get_join_requests(
    deps: GroupApiDeps,
    input: VrchatGroupJoinRequestsInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::GetJoinRequests(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_join_requests_get",
        format!("Getting join requests for group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn get_audit_log_types(
    deps: GroupApiDeps,
    input: VrchatGroupIdInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::GetAuditLogTypes(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_audit_log_types_get",
        format!("Getting audit log types for group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn get_logs(deps: GroupApiDeps, input: VrchatGroupLogsInput) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::GetLogs(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_logs_get",
        format!("Getting logs for group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn get_user_instances(
    deps: GroupApiDeps,
    input: VrchatGroupUserGroupsInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::GetUserInstances(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_user_instances_get",
        format!("Getting group instances for user {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn update_group(
    deps: GroupApiDeps,
    input: VrchatGroupUpdateInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::Update(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_update",
        format!("Updating group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn delete_group(deps: GroupApiDeps, input: VrchatGroupIdInput) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::Delete(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_delete",
        format!("Deleting group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn create_post(
    deps: GroupApiDeps,
    input: VrchatGroupPostCreateInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::CreatePost(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_post_create",
        format!("Creating post in group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn edit_post(
    deps: GroupApiDeps,
    input: VrchatGroupPostEditInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::EditPost(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_post_edit",
        format!(
            "Editing post {} in group {}.",
            built.secondary_id.as_deref().unwrap_or_default(),
            built.primary_id
        ),
        built.request,
    )
    .await
}

pub async fn delete_post(
    deps: GroupApiDeps,
    input: VrchatGroupPostDeleteInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::DeletePost(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_post_delete",
        format!(
            "Deleting post {} in group {}.",
            built.secondary_id.as_deref().unwrap_or_default(),
            built.primary_id
        ),
        built.request,
    )
    .await
}

pub async fn join_group(deps: GroupApiDeps, input: VrchatGroupIdInput) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::Join(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_join",
        format!("Joining group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn leave_group(deps: GroupApiDeps, input: VrchatGroupIdInput) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::Leave(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_leave",
        format!("Leaving group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn cancel_request(
    deps: GroupApiDeps,
    input: VrchatGroupIdInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::CancelRequest(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_request_cancel",
        format!("Canceling group request for {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn send_invite(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::SendInvite(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_invite_send",
        format!(
            "Sending group {} invite to {}.",
            built.primary_id,
            built.secondary_id.as_deref().unwrap_or_default()
        ),
        built.request,
    )
    .await
}

pub async fn kick_member(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::Kick(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_member_kick",
        format!(
            "Kicking {} from group {}.",
            built.secondary_id.as_deref().unwrap_or_default(),
            built.primary_id
        ),
        built.request,
    )
    .await
}

pub async fn ban_member(deps: GroupApiDeps, input: VrchatGroupUserInput) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::Ban(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_member_ban",
        format!(
            "Banning {} from group {}.",
            built.secondary_id.as_deref().unwrap_or_default(),
            built.primary_id
        ),
        built.request,
    )
    .await
}

pub async fn unban_member(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::Unban(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_member_unban",
        format!(
            "Unbanning {} from group {}.",
            built.secondary_id.as_deref().unwrap_or_default(),
            built.primary_id
        ),
        built.request,
    )
    .await
}

pub async fn add_member_role(
    deps: GroupApiDeps,
    input: VrchatGroupMemberRoleInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::AddRole(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_member_role_add",
        format!(
            "Adding role {} to {} in group {}.",
            built.tertiary_id.as_deref().unwrap_or_default(),
            built.secondary_id.as_deref().unwrap_or_default(),
            built.primary_id
        ),
        built.request,
    )
    .await
}

pub async fn remove_member_role(
    deps: GroupApiDeps,
    input: VrchatGroupMemberRoleInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::RemoveRole(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_member_role_remove",
        format!(
            "Removing role {} from {} in group {}.",
            built.tertiary_id.as_deref().unwrap_or_default(),
            built.secondary_id.as_deref().unwrap_or_default(),
            built.primary_id
        ),
        built.request,
    )
    .await
}

pub async fn delete_invite(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::DeleteInvite(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_invite_delete",
        format!(
            "Deleting group {} invite for {}.",
            built.primary_id,
            built.secondary_id.as_deref().unwrap_or_default()
        ),
        built.request,
    )
    .await
}

pub async fn respond_join_request(
    deps: GroupApiDeps,
    input: VrchatGroupJoinRequestRespondInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::RespondJoinRequest(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_join_request_respond",
        format!(
            "Responding to group {} join request from {}.",
            built.primary_id,
            built.secondary_id.as_deref().unwrap_or_default()
        ),
        built.request,
    )
    .await
}

pub async fn set_representation(
    deps: GroupApiDeps,
    input: VrchatGroupRepresentationInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::SetRepresentation(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_representation_set",
        format!("Setting group {} representation.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn set_member_props(
    deps: GroupApiDeps,
    input: VrchatGroupMemberPropsInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::SetMemberProps(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_member_props_set",
        format!(
            "Setting group {} member props for {}.",
            built.primary_id,
            built.secondary_id.as_deref().unwrap_or_default()
        ),
        built.request,
    )
    .await
}

pub async fn block_group(deps: GroupApiDeps, input: VrchatGroupIdInput) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::Block(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_block",
        format!("Blocking group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn unblock_group(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::Unblock(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_unblock",
        format!(
            "Unblocking group {} for {}.",
            built.primary_id,
            built.secondary_id.as_deref().unwrap_or_default()
        ),
        built.request,
    )
    .await
}

pub async fn decline_invite(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::DeclineInvite(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_invite_decline",
        format!("Declining invite to group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn get_roles(deps: GroupApiDeps, input: VrchatGroupIdInput) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::GetRoles(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_roles_get",
        format!("Getting roles for group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn get_permissions(
    deps: GroupApiDeps,
    input: VrchatGroupIdInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::GetPermissions(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_permissions_get",
        format!("Getting permissions for group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn create_role(
    deps: GroupApiDeps,
    input: VrchatGroupRoleCreateInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::CreateRole(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_role_create",
        format!("Creating a role in group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn update_role(
    deps: GroupApiDeps,
    input: VrchatGroupRoleUpdateInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::UpdateRole(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_role_update",
        format!(
            "Updating role {} in group {}.",
            built.secondary_id.as_deref().unwrap_or_default(),
            built.primary_id
        ),
        built.request,
    )
    .await
}

pub async fn delete_role(
    deps: GroupApiDeps,
    input: VrchatGroupRoleInput,
) -> Result<VrchatResponse> {
    let built = GroupRemoteRequest::DeleteRole(input).build()?;
    execute_group_api(
        &deps,
        "app__vrchat_group_role_delete",
        format!(
            "Deleting role {} in group {}.",
            built.secondary_id.as_deref().unwrap_or_default(),
            built.primary_id
        ),
        built.request,
    )
    .await
}
