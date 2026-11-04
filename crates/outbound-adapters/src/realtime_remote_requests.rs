use serde_json::Value;
use vrcx_0_application_realtime::RealtimeRemoteRequests;
use vrcx_0_contracts::vrchat_api::VrchatRequest;

#[derive(Clone, Copy, Default)]
pub struct VrchatRealtimeRemoteRequests;

impl RealtimeRemoteRequests for VrchatRealtimeRemoteRequests {
    fn current_user(&self, endpoint: String) -> crate::Result<VrchatRequest> {
        Ok(vrcx_0_vrchat_protocol::auth::current_user_get_input(
            endpoint,
        ))
    }

    fn user(&self, endpoint: String, user_id: String) -> crate::Result<(String, VrchatRequest)> {
        Ok(vrcx_0_vrchat_protocol::users::user_get_input(
            endpoint, user_id,
        )?)
    }

    fn friend_status(
        &self,
        endpoint: String,
        user_id: String,
    ) -> crate::Result<(String, VrchatRequest)> {
        Ok(vrcx_0_vrchat_protocol::friends::friend_status_get_input(
            endpoint, user_id,
        )?)
    }

    fn favorite_limits(&self, endpoint: String) -> crate::Result<VrchatRequest> {
        Ok(vrcx_0_vrchat_protocol::favorites::favorite_limits_get_input(endpoint))
    }

    fn favorites(&self, endpoint: String, n: i32, offset: i32) -> crate::Result<VrchatRequest> {
        Ok(vrcx_0_vrchat_protocol::favorites::favorites_get_input(
            endpoint, n, offset,
        ))
    }

    fn favorite_groups(
        &self,
        endpoint: String,
        n: i32,
        offset: i32,
    ) -> crate::Result<VrchatRequest> {
        Ok(
            vrcx_0_vrchat_protocol::favorites::favorite_groups_get_input(
                endpoint,
                n,
                offset,
                String::new(),
            ),
        )
    }

    fn friends(
        &self,
        endpoint: String,
        offline: bool,
        n: i32,
        offset: i32,
    ) -> crate::Result<VrchatRequest> {
        Ok(vrcx_0_vrchat_protocol::friends::friends_get_input(
            endpoint, offline, n, offset,
        ))
    }

    fn world(&self, endpoint: String, world_id: String) -> crate::Result<(String, VrchatRequest)> {
        Ok(vrcx_0_vrchat_protocol::worlds::world_get_input(
            endpoint, world_id,
        )?)
    }

    fn group(&self, endpoint: String, group_id: String) -> crate::Result<VrchatRequest> {
        Ok(vrcx_0_vrchat_protocol::groups::profile_get_input(endpoint, group_id, true)?.1)
    }

    fn invite_send(
        &self,
        endpoint: String,
        receiver_user_id: String,
        body: Value,
    ) -> crate::Result<(String, VrchatRequest)> {
        Ok(vrcx_0_vrchat_protocol::notifications::invite_send_input(
            endpoint,
            receiver_user_id,
            body,
        )?)
    }

    fn notification_hide(
        &self,
        endpoint: String,
        notification_id: String,
        version: i64,
        notification_type: String,
        sender_user_id: String,
    ) -> crate::Result<(String, VrchatRequest)> {
        Ok(
            vrcx_0_vrchat_protocol::notifications::notification_hide_remote_input(
                endpoint,
                notification_id,
                version,
                notification_type,
                sender_user_id,
            )?,
        )
    }
}
