use super::types::{
    VrchatGroupGalleryInput, VrchatGroupIdInput, VrchatGroupJoinRequestRespondInput,
    VrchatGroupJoinRequestsInput, VrchatGroupLogsInput, VrchatGroupMemberPropsInput,
    VrchatGroupMemberRoleInput, VrchatGroupMembersInput, VrchatGroupMembersSearchInput,
    VrchatGroupPagedInput, VrchatGroupPostCreateInput, VrchatGroupPostDeleteInput,
    VrchatGroupPostEditInput, VrchatGroupProfileInput, VrchatGroupRepresentationInput,
    VrchatGroupUserGroupsInput, VrchatGroupUserInput,
};
use crate::remote::VrchatRequestPort;
use std::{sync::Arc, time::Duration};
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse, VrchatScope};
use vrcx_0_application_core::RuntimeOperationStatus;
use vrcx_0_application_core::RuntimeSyncEngine;
use vrcx_0_application_core::{
    is_remote_mutation_request, AuthenticatedMutationContext, RemoteMutationGate, Result,
};
use vrcx_0_application_core::{RuntimeAuthScope, RuntimeDiagnostics};

pub enum GroupRemoteRequest {
    GetGroup(VrchatGroupProfileInput),
    GetUserGroups(VrchatGroupUserGroupsInput),
    GetPosts(VrchatGroupPagedInput),
    GetMembers(VrchatGroupMembersInput),
    SearchMembers(VrchatGroupMembersSearchInput),
    GetGallery(VrchatGroupGalleryInput),
    GetBans(VrchatGroupPagedInput),
    GetInvites(VrchatGroupPagedInput),
    GetJoinRequests(VrchatGroupJoinRequestsInput),
    GetAuditLogTypes(VrchatGroupIdInput),
    GetLogs(VrchatGroupLogsInput),
    GetUserInstances(VrchatGroupUserGroupsInput),
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
}

pub struct GroupBuiltRequest {
    pub primary_id: String,
    pub secondary_id: Option<String>,
    pub tertiary_id: Option<String>,
    pub request: VrchatApiRequest,
}

pub trait GroupRemoteRequests: Send + Sync {
    fn build(&self, request: GroupRemoteRequest) -> Result<GroupBuiltRequest>;
}

pub trait GroupMembershipRemoteRequests: Send + Sync {
    fn user_groups(&self, endpoint: String, user_id: String) -> Result<VrchatApiRequest>;
    fn user_permissions(&self, endpoint: String, user_id: String) -> Result<VrchatApiRequest>;
    fn member(
        &self,
        endpoint: String,
        group_id: String,
        user_id: String,
    ) -> Result<VrchatApiRequest>;
    fn kick(&self, endpoint: String, group_id: String, user_id: String)
        -> Result<VrchatApiRequest>;
    fn ban(&self, endpoint: String, group_id: String, user_id: String) -> Result<VrchatApiRequest>;
}

#[derive(Clone)]
pub struct GroupApiDeps {
    remote: Arc<dyn VrchatRequestPort>,
    remote_requests: Arc<dyn GroupRemoteRequests>,
    pub diagnostics: RuntimeDiagnostics,
    pub sync: RuntimeSyncEngine,
    pub auth_scope: RuntimeAuthScope,
    pub remote_mutations: Arc<RemoteMutationGate>,
}

impl GroupApiDeps {
    pub fn new(
        remote: Arc<dyn VrchatRequestPort>,
        remote_requests: Arc<dyn GroupRemoteRequests>,
        diagnostics: RuntimeDiagnostics,
        sync: RuntimeSyncEngine,
        auth_scope: RuntimeAuthScope,
        remote_mutations: Arc<RemoteMutationGate>,
    ) -> Self {
        Self {
            remote,
            remote_requests,
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
    mut input: VrchatApiRequest,
) -> Result<VrchatApiResponse> {
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

async fn execute_group_api(
    deps: &GroupApiDeps,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse> {
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
                vrcx_0_application_core::vrchat_api::classify_api_response(response.status).class;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::GetGroup(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::GetUserGroups(input))?;
    execute_group_api(
        &deps,
        "app__vrchat_group_user_groups_get",
        format!("Getting groups for user {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn get_posts(
    deps: GroupApiDeps,
    input: VrchatGroupPagedInput,
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::GetPosts(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::GetMembers(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::SearchMembers(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::GetGallery(input))?;
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

pub async fn get_bans(
    deps: GroupApiDeps,
    input: VrchatGroupPagedInput,
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::GetBans(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::GetInvites(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::GetJoinRequests(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::GetAuditLogTypes(input))?;
    execute_group_api(
        &deps,
        "app__vrchat_group_audit_log_types_get",
        format!("Getting audit log types for group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn get_logs(
    deps: GroupApiDeps,
    input: VrchatGroupLogsInput,
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::GetLogs(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::GetUserInstances(input))?;
    execute_group_api(
        &deps,
        "app__vrchat_group_user_instances_get",
        format!("Getting group instances for user {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn create_post(
    deps: GroupApiDeps,
    input: VrchatGroupPostCreateInput,
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::CreatePost(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::EditPost(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::DeletePost(input))?;
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

pub async fn join_group(
    deps: GroupApiDeps,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::Join(input))?;
    execute_group_api(
        &deps,
        "app__vrchat_group_join",
        format!("Joining group {}.", built.primary_id),
        built.request,
    )
    .await
}

pub async fn leave_group(
    deps: GroupApiDeps,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::Leave(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::CancelRequest(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::SendInvite(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::Kick(input))?;
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

pub async fn ban_member(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse> {
    let built = deps.remote_requests.build(GroupRemoteRequest::Ban(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::Unban(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::AddRole(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::RemoveRole(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::DeleteInvite(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::RespondJoinRequest(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::SetRepresentation(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::SetMemberProps(input))?;
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

pub async fn block_group(
    deps: GroupApiDeps,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::Block(input))?;
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
) -> Result<VrchatApiResponse> {
    let built = deps
        .remote_requests
        .build(GroupRemoteRequest::Unblock(input))?;
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
