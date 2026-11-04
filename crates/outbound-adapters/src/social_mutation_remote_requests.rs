use vrcx_0_application::social::SocialMutationRemoteRequests;
use vrcx_0_contracts::vrchat_api::VrchatRequest;

#[derive(Clone, Copy, Default)]
pub struct VrchatSocialMutationRemoteRequests;

impl SocialMutationRemoteRequests for VrchatSocialMutationRemoteRequests {
    fn unfriend(&self, endpoint: String, target_user_id: String) -> crate::Result<VrchatRequest> {
        Ok(vrcx_0_vrchat_client::friends::friend_delete_input(endpoint, target_user_id)?.1)
    }

    fn send_friend_request(
        &self,
        endpoint: String,
        target_user_id: String,
    ) -> crate::Result<VrchatRequest> {
        Ok(vrcx_0_vrchat_client::friends::friend_request_send_input(endpoint, target_user_id)?.1)
    }

    fn cancel_friend_request(
        &self,
        endpoint: String,
        target_user_id: String,
        notification_id: String,
    ) -> crate::Result<VrchatRequest> {
        Ok(vrcx_0_vrchat_client::friends::friend_request_cancel_input(
            endpoint,
            target_user_id,
            notification_id,
        )?
        .1)
    }

    fn accept_friend_request(
        &self,
        endpoint: String,
        notification_id: String,
    ) -> crate::Result<VrchatRequest> {
        Ok(
            vrcx_0_vrchat_client::notifications::notification_accept_friend_request_input(
                endpoint,
                notification_id,
            )?
            .1,
        )
    }
}
