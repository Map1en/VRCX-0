use serde_json::json;
use vrcx_0_application::social::InstanceInviteRemoteRequests;
use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::VrchatRequest;
use vrcx_0_vrchat_client::{
    instances::instance_self_invite_input, notifications::invite_send_input,
};

pub struct VrchatInstanceInviteRemoteRequests;

impl InstanceInviteRemoteRequests for VrchatInstanceInviteRemoteRequests {
    fn self_invite(
        &self,
        endpoint: String,
        world_id: String,
        instance_id: String,
        short_name: String,
    ) -> Result<VrchatRequest> {
        Ok(instance_self_invite_input(endpoint, world_id, instance_id, short_name)?.2)
    }

    fn user_invite(
        &self,
        endpoint: String,
        receiver_user_id: String,
        location: String,
        world_id: String,
        world_name: String,
    ) -> Result<VrchatRequest> {
        Ok(invite_send_input(
            endpoint,
            receiver_user_id,
            json!({
                "instanceId": location,
                "worldId": world_id,
                "worldName": world_name,
            }),
        )?
        .1)
    }
}
