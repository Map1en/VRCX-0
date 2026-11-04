use vrcx_0_application::social::GroupModerationRemoteRequests;
use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::VrchatRequest;
use vrcx_0_vrchat_protocol::groups::{
    member_ban_input, member_kick_input, member_props_set_input, member_role_add_input,
    member_role_remove_input, member_unban_input, GroupMemberPatch,
};

pub struct VrchatGroupModerationRemoteRequests;

impl GroupModerationRemoteRequests for VrchatGroupModerationRemoteRequests {
    fn kick(&self, endpoint: String, group_id: String, user_id: String) -> Result<VrchatRequest> {
        Ok(member_kick_input(endpoint, group_id, user_id)?.2)
    }

    fn ban(&self, endpoint: String, group_id: String, user_id: String) -> Result<VrchatRequest> {
        Ok(member_ban_input(endpoint, group_id, user_id)?.2)
    }

    fn unban(&self, group_id: String, user_id: String) -> Result<VrchatRequest> {
        Ok(member_unban_input(group_id, user_id)?.2)
    }

    fn save_note(
        &self,
        endpoint: String,
        group_id: String,
        user_id: String,
        note: String,
    ) -> Result<VrchatRequest> {
        Ok(member_props_set_input(
            endpoint,
            group_id,
            user_id,
            GroupMemberPatch {
                manager_notes: Some(note),
                ..GroupMemberPatch::default()
            },
        )?
        .2)
    }

    fn add_role(
        &self,
        group_id: String,
        user_id: String,
        role_id: String,
    ) -> Result<VrchatRequest> {
        Ok(member_role_add_input(group_id, user_id, role_id)?.3)
    }

    fn remove_role(
        &self,
        group_id: String,
        user_id: String,
        role_id: String,
    ) -> Result<VrchatRequest> {
        Ok(member_role_remove_input(group_id, user_id, role_id)?.3)
    }
}
