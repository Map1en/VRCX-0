use std::sync::Arc;

use serde_json::Value;
use vrcx_0_persistence::DatabaseService;

use crate::diagnostics::RuntimeDiagnostics;
use crate::sync::RuntimeSyncEngine;
use crate::vrchat_api::groups::{
    current_user_group_instances_get_input, gallery_get_input, group_block_input,
    group_get_no_params_input, group_paged_get_input, invite_delete_input, invite_send_input,
    join_input, join_request_respond_input, join_requests_get_input, leave_input, logs_get_input,
    member_ban_input, member_kick_input, member_props_set_input, member_unban_input,
    members_get_input, members_search_input, post_create_input, post_delete_input, post_edit_input,
    profile_get_input, representation_set_input, request_cancel_input, unblock_input,
    user_group_instances_get_input, user_groups_get_input,
};
use crate::vrchat_api::{VrchatApiRequest, VrchatApiResponse, VrchatScope};
use crate::web_client::WebClient;
use crate::Result;

use super::types::{
    VrchatGroupGalleryInput, VrchatGroupIdInput, VrchatGroupJoinRequestRespondInput,
    VrchatGroupJoinRequestsInput, VrchatGroupLogsInput, VrchatGroupMemberPropsInput,
    VrchatGroupMembersInput, VrchatGroupMembersSearchInput, VrchatGroupPagedInput,
    VrchatGroupPostCreateInput, VrchatGroupPostDeleteInput, VrchatGroupPostEditInput,
    VrchatGroupProfileInput, VrchatGroupRepresentationInput, VrchatGroupUserGroupsInput,
    VrchatGroupUserInput,
};

#[derive(Clone)]
pub struct GroupApiDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub diagnostics: RuntimeDiagnostics,
    pub sync: RuntimeSyncEngine,
}

pub(crate) async fn execute_group_api_raw(
    deps: &GroupApiDeps,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse> {
    deps.web
        .execute_api(input, VrchatScope::Vrchat, deps.db.as_ref())
        .await
}

async fn execute_group_api(
    deps: &GroupApiDeps,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse> {
    deps.diagnostics
        .record_command(command, "running", detail.into());
    let result = execute_group_api_raw(deps, input).await;
    match &result {
        Ok(response) => {
            deps.diagnostics
                .record_command(command, "ok", format!("status={}", response.status));
            let policy_class = response
                .raw
                .get("policy")
                .and_then(|policy| policy.get("class"))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            deps.sync.record(
                "api",
                "ready",
                format!(
                    "{command} completed with status {}, class={policy_class}.",
                    response.status
                ),
                0,
            );
        }
        Err(error) => {
            deps.diagnostics
                .record_command(command, "error", error.to_string());
            deps.sync.record_failure("api", error.to_string());
        }
    }
    result
}

pub async fn get_group(
    deps: GroupApiDeps,
    input: VrchatGroupProfileInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) =
        profile_get_input(input.endpoint, input.group_id, input.include_roles)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_get",
        format!("Getting group {group_id}."),
        request,
    )
    .await
}

pub async fn get_user_groups(
    deps: GroupApiDeps,
    input: VrchatGroupUserGroupsInput,
) -> Result<VrchatApiResponse> {
    let (user_id, request) = user_groups_get_input(input.endpoint, input.user_id)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_user_groups_get",
        format!("Getting groups for user {user_id}."),
        request,
    )
    .await
}

pub async fn get_posts(
    deps: GroupApiDeps,
    input: VrchatGroupPagedInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) = group_paged_get_input(
        input.endpoint,
        input.group_id,
        "posts",
        input.n,
        input.offset,
        "VrchatGroupPostsGet requires groupId.",
    )?;
    execute_group_api(
        &deps,
        "app__vrchat_group_posts_get",
        format!("Getting posts for group {group_id}."),
        request,
    )
    .await
}

pub async fn get_members(
    deps: GroupApiDeps,
    input: VrchatGroupMembersInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) = members_get_input(
        input.endpoint,
        input.group_id,
        input.n,
        input.offset,
        input.sort,
        input.role_id,
    )?;
    execute_group_api(
        &deps,
        "app__vrchat_group_members_get",
        format!("Getting members for group {group_id}."),
        request,
    )
    .await
}

pub async fn search_members(
    deps: GroupApiDeps,
    input: VrchatGroupMembersSearchInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) = members_search_input(
        input.endpoint,
        input.group_id,
        input.n,
        input.offset,
        input.query,
    )?;
    execute_group_api(
        &deps,
        "app__vrchat_group_members_search",
        format!("Searching members for group {group_id}."),
        request,
    )
    .await
}

pub async fn get_gallery(
    deps: GroupApiDeps,
    input: VrchatGroupGalleryInput,
) -> Result<VrchatApiResponse> {
    let (group_id, gallery_id, request) = gallery_get_input(
        input.endpoint,
        input.group_id,
        input.gallery_id,
        input.n,
        input.offset,
    )?;
    execute_group_api(
        &deps,
        "app__vrchat_group_gallery_get",
        format!("Getting gallery {gallery_id} for group {group_id}."),
        request,
    )
    .await
}

pub async fn get_group_instances(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse> {
    let (group_id, user_id, request) =
        user_group_instances_get_input(input.endpoint, input.group_id, input.user_id)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_instances_get",
        format!("Getting group {group_id} instances for user {user_id}."),
        request,
    )
    .await
}

pub async fn get_bans(
    deps: GroupApiDeps,
    input: VrchatGroupPagedInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) = group_paged_get_input(
        input.endpoint,
        input.group_id,
        "bans",
        input.n,
        input.offset,
        "VrchatGroupBansGet requires groupId.",
    )?;
    execute_group_api(
        &deps,
        "app__vrchat_group_bans_get",
        format!("Getting bans for group {group_id}."),
        request,
    )
    .await
}

pub async fn get_invites(
    deps: GroupApiDeps,
    input: VrchatGroupPagedInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) = group_paged_get_input(
        input.endpoint,
        input.group_id,
        "invites",
        input.n,
        input.offset,
        "VrchatGroupInvitesGet requires groupId.",
    )?;
    execute_group_api(
        &deps,
        "app__vrchat_group_invites_get",
        format!("Getting invites for group {group_id}."),
        request,
    )
    .await
}

pub async fn get_join_requests(
    deps: GroupApiDeps,
    input: VrchatGroupJoinRequestsInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) = join_requests_get_input(
        input.endpoint,
        input.group_id,
        input.n,
        input.offset,
        input.blocked,
    )?;
    execute_group_api(
        &deps,
        "app__vrchat_group_join_requests_get",
        format!("Getting join requests for group {group_id}."),
        request,
    )
    .await
}

pub async fn get_audit_log_types(
    deps: GroupApiDeps,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) = group_get_no_params_input(
        input.endpoint,
        input.group_id,
        "auditLogTypes",
        "VrchatGroupAuditLogTypesGet requires groupId.",
    )?;
    execute_group_api(
        &deps,
        "app__vrchat_group_audit_log_types_get",
        format!("Getting audit log types for group {group_id}."),
        request,
    )
    .await
}

pub async fn get_logs(
    deps: GroupApiDeps,
    input: VrchatGroupLogsInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) = logs_get_input(
        input.endpoint,
        input.group_id,
        input.n,
        input.offset,
        input.event_types,
    )?;
    execute_group_api(
        &deps,
        "app__vrchat_group_logs_get",
        format!("Getting logs for group {group_id}."),
        request,
    )
    .await
}

pub async fn get_user_instances(
    deps: GroupApiDeps,
    input: VrchatGroupUserGroupsInput,
) -> Result<VrchatApiResponse> {
    let (user_id, request) = current_user_group_instances_get_input(input.endpoint, input.user_id)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_user_instances_get",
        format!("Getting group instances for user {user_id}."),
        request,
    )
    .await
}

pub async fn create_post(
    deps: GroupApiDeps,
    input: VrchatGroupPostCreateInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) = post_create_input(input.endpoint, input.group_id, input.params)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_post_create",
        format!("Creating post in group {group_id}."),
        request,
    )
    .await
}

pub async fn edit_post(
    deps: GroupApiDeps,
    input: VrchatGroupPostEditInput,
) -> Result<VrchatApiResponse> {
    let (group_id, post_id, request) =
        post_edit_input(input.endpoint, input.group_id, input.post_id, input.params)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_post_edit",
        format!("Editing post {post_id} in group {group_id}."),
        request,
    )
    .await
}

pub async fn delete_post(
    deps: GroupApiDeps,
    input: VrchatGroupPostDeleteInput,
) -> Result<VrchatApiResponse> {
    let (group_id, post_id, request) =
        post_delete_input(input.endpoint, input.group_id, input.post_id)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_post_delete",
        format!("Deleting post {post_id} in group {group_id}."),
        request,
    )
    .await
}

pub async fn join_group(
    deps: GroupApiDeps,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) = join_input(input.endpoint, input.group_id)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_join",
        format!("Joining group {group_id}."),
        request,
    )
    .await
}

pub async fn leave_group(
    deps: GroupApiDeps,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) = leave_input(input.endpoint, input.group_id)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_leave",
        format!("Leaving group {group_id}."),
        request,
    )
    .await
}

pub async fn cancel_request(
    deps: GroupApiDeps,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) = request_cancel_input(input.endpoint, input.group_id)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_request_cancel",
        format!("Canceling group request for {group_id}."),
        request,
    )
    .await
}

pub async fn send_invite(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse> {
    let (group_id, user_id, request) =
        invite_send_input(input.endpoint, input.group_id, input.user_id)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_invite_send",
        format!("Sending group {group_id} invite to {user_id}."),
        request,
    )
    .await
}

pub async fn kick_member(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse> {
    let (group_id, user_id, request) =
        member_kick_input(input.endpoint, input.group_id, input.user_id)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_member_kick",
        format!("Kicking {user_id} from group {group_id}."),
        request,
    )
    .await
}

pub async fn ban_member(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse> {
    let (group_id, user_id, request) =
        member_ban_input(input.endpoint, input.group_id, input.user_id)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_member_ban",
        format!("Banning {user_id} from group {group_id}."),
        request,
    )
    .await
}

pub async fn unban_member(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse> {
    let (group_id, user_id, request) =
        member_unban_input(input.endpoint, input.group_id, input.user_id)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_member_unban",
        format!("Unbanning {user_id} from group {group_id}."),
        request,
    )
    .await
}

pub async fn delete_invite(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse> {
    let (group_id, user_id, request) =
        invite_delete_input(input.endpoint, input.group_id, input.user_id)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_invite_delete",
        format!("Deleting group {group_id} invite for {user_id}."),
        request,
    )
    .await
}

pub async fn respond_join_request(
    deps: GroupApiDeps,
    input: VrchatGroupJoinRequestRespondInput,
) -> Result<VrchatApiResponse> {
    let (group_id, user_id, request) = join_request_respond_input(
        input.endpoint,
        input.group_id,
        input.user_id,
        input.action,
        input.block,
    )?;
    execute_group_api(
        &deps,
        "app__vrchat_group_join_request_respond",
        format!("Responding to group {group_id} join request from {user_id}."),
        request,
    )
    .await
}

pub async fn set_representation(
    deps: GroupApiDeps,
    input: VrchatGroupRepresentationInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) =
        representation_set_input(input.endpoint, input.group_id, input.is_representing)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_representation_set",
        format!("Setting group {group_id} representation."),
        request,
    )
    .await
}

pub async fn set_member_props(
    deps: GroupApiDeps,
    input: VrchatGroupMemberPropsInput,
) -> Result<VrchatApiResponse> {
    let (group_id, user_id, request) =
        member_props_set_input(input.endpoint, input.group_id, input.user_id, input.params)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_member_props_set",
        format!("Setting group {group_id} member props for {user_id}."),
        request,
    )
    .await
}

pub async fn block_group(
    deps: GroupApiDeps,
    input: VrchatGroupIdInput,
) -> Result<VrchatApiResponse> {
    let (group_id, request) = group_block_input(input.endpoint, input.group_id)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_block",
        format!("Blocking group {group_id}."),
        request,
    )
    .await
}

pub async fn unblock_group(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<VrchatApiResponse> {
    let (group_id, user_id, request) =
        unblock_input(input.endpoint, input.group_id, input.user_id)?;
    execute_group_api(
        &deps,
        "app__vrchat_group_unblock",
        format!("Unblocking group {group_id} for {user_id}."),
        request,
    )
    .await
}
