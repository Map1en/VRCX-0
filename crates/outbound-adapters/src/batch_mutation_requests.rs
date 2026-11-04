use vrcx_0_application::social::{BatchMutationRemoteRequests, GroupVisibility};
use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::VrchatRequest;
use vrcx_0_vrchat_protocol::{
    avatars::{avatar_get_input, avatar_save_input, AvatarUpdateRequest},
    groups::{leave_input, member_props_set_input, GroupMemberPatch, GroupMemberVisibility},
    users::user_groups_get_input,
};

pub struct VrchatBatchMutationRemoteRequests;

impl BatchMutationRemoteRequests for VrchatBatchMutationRemoteRequests {
    fn avatar(&self, endpoint: String, avatar_id: String) -> Result<VrchatRequest> {
        Ok(avatar_get_input(endpoint, avatar_id)?.1)
    }

    fn save_avatar_tags(
        &self,
        endpoint: String,
        avatar_id: String,
        tags: Vec<String>,
    ) -> Result<VrchatRequest> {
        Ok(avatar_save_input(
            endpoint,
            avatar_id.clone(),
            AvatarUpdateRequest {
                id: avatar_id,
                tags: Some(tags),
                name: None,
                description: None,
                primary_style: None,
                secondary_style: None,
                release_status: None,
            },
        )?
        .1)
    }

    fn user_groups(&self, endpoint: String, user_id: String) -> Result<VrchatRequest> {
        Ok(user_groups_get_input(endpoint, user_id)?.1)
    }

    fn set_group_visibility(
        &self,
        endpoint: String,
        group_id: String,
        user_id: String,
        visibility: GroupVisibility,
    ) -> Result<VrchatRequest> {
        let visibility = match visibility {
            GroupVisibility::Visible => GroupMemberVisibility::Visible,
            GroupVisibility::Friends => GroupMemberVisibility::Friends,
            GroupVisibility::Hidden => GroupMemberVisibility::Hidden,
        };
        Ok(member_props_set_input(
            endpoint,
            group_id,
            user_id,
            GroupMemberPatch {
                visibility: Some(visibility),
                ..GroupMemberPatch::default()
            },
        )?
        .2)
    }

    fn leave_group(&self, endpoint: String, group_id: String) -> Result<VrchatRequest> {
        Ok(leave_input(endpoint, group_id)?.1)
    }
}
