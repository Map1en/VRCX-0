use vrcx_0_application::social::GroupMembershipRemoteRequests;
use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::VrchatRequest;
use vrcx_0_vrchat_protocol::groups::{
    member_ban_input, member_get_input, member_kick_input, user_group_permissions_get_input,
    user_groups_get_input,
};

pub struct VrchatGroupMembershipRemoteRequests;

impl GroupMembershipRemoteRequests for VrchatGroupMembershipRemoteRequests {
    fn user_groups(&self, endpoint: String, user_id: String) -> Result<VrchatRequest> {
        Ok(user_groups_get_input(endpoint, user_id)?.1)
    }

    fn user_permissions(&self, endpoint: String, user_id: String) -> Result<VrchatRequest> {
        Ok(user_group_permissions_get_input(endpoint, user_id)?.1)
    }

    fn member(&self, endpoint: String, group_id: String, user_id: String) -> Result<VrchatRequest> {
        Ok(member_get_input(endpoint, group_id, user_id)?.2)
    }

    fn kick(&self, endpoint: String, group_id: String, user_id: String) -> Result<VrchatRequest> {
        Ok(member_kick_input(endpoint, group_id, user_id)?.2)
    }

    fn ban(&self, endpoint: String, group_id: String, user_id: String) -> Result<VrchatRequest> {
        Ok(member_ban_input(endpoint, group_id, user_id)?.2)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_moderation_requests_preserve_encoded_group_member_paths() {
        let requests = VrchatGroupMembershipRemoteRequests;
        let kick = requests
            .kick(
                "https://api.vrchat.cloud/api/1".into(),
                "grp 1".into(),
                "usr 1".into(),
            )
            .unwrap();
        let ban = requests
            .ban(
                "https://api.vrchat.cloud/api/1".into(),
                "grp 1".into(),
                "usr 1".into(),
            )
            .unwrap();

        assert_eq!(kick.method.as_deref(), Some("DELETE"));
        assert_eq!(kick.path.as_deref(), Some("groups/grp%201/members/usr%201"));
        assert_eq!(ban.method.as_deref(), Some("POST"));
        assert_eq!(ban.path.as_deref(), Some("groups/grp%201/bans"));
    }
}
