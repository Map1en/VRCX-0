use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::{VrchatResponse, VrchatScope};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_vrchat_protocol::notifications::{
    boop_send_input, request_invite_photo_input, request_invite_send_input, RequestInviteRequest,
};

use crate::media::prepare_media_upload_request;

use super::VrchatRemoteFacade;

impl VrchatRemoteFacade {
    pub async fn request_invite(
        &self,
        receiver_user_id: String,
        params: RequestInviteRequest,
    ) -> Result<VrchatResponse> {
        let (receiver_user_id, request) = request_invite_send_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            receiver_user_id,
            params,
        )?;
        self.execute(
            "app__vrchat_request_invite_send",
            format!("Sending invite request to {receiver_user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn request_invite_photo(
        &self,
        receiver_user_id: String,
        params: RequestInviteRequest,
        image_data: String,
    ) -> Result<VrchatResponse> {
        let (receiver_user_id, request) = request_invite_photo_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            receiver_user_id,
            params,
            image_data,
        )?;
        let request = prepare_media_upload_request(self.media_upload.as_ref(), request)?;
        self.execute(
            "app__vrchat_request_invite_photo_send",
            format!("Sending invite request photo to {receiver_user_id}."),
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn boop(
        &self,
        user_id: String,
        emoji_id: String,
        inventory_item_id: String,
    ) -> Result<VrchatResponse> {
        let (user_id, request) = boop_send_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            user_id,
            emoji_id,
            inventory_item_id,
        )?;
        self.execute(
            "app__vrchat_boop_send",
            format!("Sending boop to {user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }
}
