use vrcx_0_application::social::{
    GroupBuiltRequest, GroupMemberPatch, GroupMemberSort, GroupMemberVisibility, GroupPostMutation,
    GroupPostVisibility, GroupRemoteRequest, GroupRemoteRequests,
};
use vrcx_0_application_core::{vrchat_api::VrchatApiRequest, Result};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_vrchat_client::groups::{
    current_user_group_instances_get_input, gallery_get_input, group_block_input,
    group_get_no_params_input, group_paged_get_input, invite_delete_input, invite_send_input,
    join_input, join_request_respond_input, join_requests_get_input, leave_input, logs_get_input,
    member_ban_input, member_kick_input, member_props_set_input, member_role_add_input,
    member_role_remove_input, member_unban_input, members_get_input, members_search_input,
    post_create_input, post_delete_input, post_edit_input, profile_get_input,
    representation_set_input, request_cancel_input, unblock_input, user_groups_get_input,
};

pub struct VrchatGroupRemoteRequests;

impl GroupRemoteRequests for VrchatGroupRemoteRequests {
    fn build(&self, action: GroupRemoteRequest) -> Result<GroupBuiltRequest> {
        match action {
            GroupRemoteRequest::GetGroup(input) => {
                let (group_id, request) = profile_get_input(
                    VRCHAT_API_DEFAULT_ENDPOINT.into(),
                    input.group_id,
                    input.include_roles,
                )?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::GetUserGroups(input) => {
                let (user_id, request) =
                    user_groups_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), input.user_id)?;
                Ok(built1(user_id, request))
            }
            GroupRemoteRequest::GetPosts(input) => {
                let (group_id, request) = group_paged_get_input(
                    input.group_id,
                    "posts",
                    input.n,
                    input.offset,
                    "VrchatGroupPostsGet requires groupId.",
                )?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::GetMembers(input) => {
                let sort = match input.sort {
                    GroupMemberSort::JoinedAtAsc => {
                        vrcx_0_vrchat_client::groups::GroupMemberSort::JoinedAtAsc
                    }
                    GroupMemberSort::JoinedAtDesc => {
                        vrcx_0_vrchat_client::groups::GroupMemberSort::JoinedAtDesc
                    }
                };
                let (group_id, request) =
                    members_get_input(input.group_id, input.n, input.offset, sort, input.role_id)?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::SearchMembers(input) => {
                let (group_id, request) =
                    members_search_input(input.group_id, input.n, input.offset, input.query)?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::GetGallery(input) => {
                let (group_id, gallery_id, request) =
                    gallery_get_input(input.group_id, input.gallery_id, input.n, input.offset)?;
                Ok(built2(group_id, gallery_id, request))
            }
            GroupRemoteRequest::GetBans(input) => {
                let (group_id, request) = group_paged_get_input(
                    input.group_id,
                    "bans",
                    input.n,
                    input.offset,
                    "VrchatGroupBansGet requires groupId.",
                )?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::GetInvites(input) => {
                let (group_id, request) = group_paged_get_input(
                    input.group_id,
                    "invites",
                    input.n,
                    input.offset,
                    "VrchatGroupInvitesGet requires groupId.",
                )?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::GetJoinRequests(input) => {
                let (group_id, request) =
                    join_requests_get_input(input.group_id, input.n, input.offset, input.blocked)?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::GetAuditLogTypes(input) => {
                let (group_id, request) = group_get_no_params_input(
                    input.group_id,
                    "auditLogTypes",
                    "VrchatGroupAuditLogTypesGet requires groupId.",
                )?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::GetLogs(input) => {
                let (group_id, request) =
                    logs_get_input(input.group_id, input.n, input.offset, input.event_types)?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::GetUserInstances(input) => {
                let (user_id, request) = current_user_group_instances_get_input(
                    VRCHAT_API_DEFAULT_ENDPOINT.into(),
                    input.user_id,
                )?;
                Ok(built1(user_id, request))
            }
            GroupRemoteRequest::CreatePost(input) => {
                let (group_id, request) = post_create_input(input.group_id, post(input.params))?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::EditPost(input) => {
                let (group_id, post_id, request) =
                    post_edit_input(input.group_id, input.post_id, post(input.params))?;
                Ok(built2(group_id, post_id, request))
            }
            GroupRemoteRequest::DeletePost(input) => {
                let (group_id, post_id, request) =
                    post_delete_input(input.group_id, input.post_id)?;
                Ok(built2(group_id, post_id, request))
            }
            GroupRemoteRequest::Join(input) => {
                let (group_id, request) = join_input(input.group_id)?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::Leave(input) => {
                let (group_id, request) =
                    leave_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), input.group_id)?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::CancelRequest(input) => {
                let (group_id, request) = request_cancel_input(input.group_id)?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::SendInvite(input) => {
                let (group_id, user_id, request) =
                    invite_send_input(input.group_id, input.user_id)?;
                Ok(built2(group_id, user_id, request))
            }
            GroupRemoteRequest::Kick(input) => {
                let (group_id, user_id, request) = member_kick_input(
                    VRCHAT_API_DEFAULT_ENDPOINT.into(),
                    input.group_id,
                    input.user_id,
                )?;
                Ok(built2(group_id, user_id, request))
            }
            GroupRemoteRequest::Ban(input) => {
                let (group_id, user_id, request) = member_ban_input(
                    VRCHAT_API_DEFAULT_ENDPOINT.into(),
                    input.group_id,
                    input.user_id,
                )?;
                Ok(built2(group_id, user_id, request))
            }
            GroupRemoteRequest::Unban(input) => {
                let (group_id, user_id, request) =
                    member_unban_input(input.group_id, input.user_id)?;
                Ok(built2(group_id, user_id, request))
            }
            GroupRemoteRequest::AddRole(input) => {
                let (group_id, user_id, role_id, request) =
                    member_role_add_input(input.group_id, input.user_id, input.role_id)?;
                Ok(built3(group_id, user_id, role_id, request))
            }
            GroupRemoteRequest::RemoveRole(input) => {
                let (group_id, user_id, role_id, request) =
                    member_role_remove_input(input.group_id, input.user_id, input.role_id)?;
                Ok(built3(group_id, user_id, role_id, request))
            }
            GroupRemoteRequest::DeleteInvite(input) => {
                let (group_id, user_id, request) =
                    invite_delete_input(input.group_id, input.user_id)?;
                Ok(built2(group_id, user_id, request))
            }
            GroupRemoteRequest::RespondJoinRequest(input) => {
                let (group_id, user_id, request) = join_request_respond_input(
                    input.group_id,
                    input.user_id,
                    input.action,
                    input.block,
                )?;
                Ok(built2(group_id, user_id, request))
            }
            GroupRemoteRequest::SetRepresentation(input) => {
                let (group_id, request) =
                    representation_set_input(input.group_id, input.is_representing)?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::SetMemberProps(input) => {
                let (group_id, user_id, request) = member_props_set_input(
                    VRCHAT_API_DEFAULT_ENDPOINT.into(),
                    input.group_id,
                    input.user_id,
                    member_patch(input.params),
                )?;
                Ok(built2(group_id, user_id, request))
            }
            GroupRemoteRequest::Block(input) => {
                let (group_id, request) = group_block_input(input.group_id)?;
                Ok(built1(group_id, request))
            }
            GroupRemoteRequest::Unblock(input) => {
                let (group_id, user_id, request) = unblock_input(input.group_id, input.user_id)?;
                Ok(built2(group_id, user_id, request))
            }
        }
    }
}

fn post(input: GroupPostMutation) -> vrcx_0_vrchat_client::groups::GroupPostMutation {
    vrcx_0_vrchat_client::groups::GroupPostMutation {
        title: input.title,
        text: input.text,
        send_notification: input.send_notification,
        visibility: match input.visibility {
            GroupPostVisibility::Group => vrcx_0_vrchat_client::groups::GroupPostVisibility::Group,
            GroupPostVisibility::Public => {
                vrcx_0_vrchat_client::groups::GroupPostVisibility::Public
            }
        },
        role_ids: input.role_ids,
        image_id: input.image_id,
    }
}

fn member_patch(input: GroupMemberPatch) -> vrcx_0_vrchat_client::groups::GroupMemberPatch {
    vrcx_0_vrchat_client::groups::GroupMemberPatch {
        is_subscribed_to_announcements: input.is_subscribed_to_announcements,
        is_subscribed_to_event_announcements: input.is_subscribed_to_event_announcements,
        manager_notes: input.manager_notes,
        visibility: input.visibility.map(|visibility| match visibility {
            GroupMemberVisibility::Friends => {
                vrcx_0_vrchat_client::groups::GroupMemberVisibility::Friends
            }
            GroupMemberVisibility::Hidden => {
                vrcx_0_vrchat_client::groups::GroupMemberVisibility::Hidden
            }
            GroupMemberVisibility::Visible => {
                vrcx_0_vrchat_client::groups::GroupMemberVisibility::Visible
            }
        }),
    }
}

fn built1(primary_id: String, request: VrchatApiRequest) -> GroupBuiltRequest {
    GroupBuiltRequest {
        primary_id,
        secondary_id: None,
        tertiary_id: None,
        request,
    }
}

fn built2(
    primary_id: String,
    secondary_id: String,
    request: VrchatApiRequest,
) -> GroupBuiltRequest {
    GroupBuiltRequest {
        primary_id,
        secondary_id: Some(secondary_id),
        tertiary_id: None,
        request,
    }
}

fn built3(
    primary_id: String,
    secondary_id: String,
    tertiary_id: String,
    request: VrchatApiRequest,
) -> GroupBuiltRequest {
    GroupBuiltRequest {
        primary_id,
        secondary_id: Some(secondary_id),
        tertiary_id: Some(tertiary_id),
        request,
    }
}
