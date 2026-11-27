use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::{VrchatResponse, VrchatScope};
use vrcx_0_core::time::now_iso;
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_core::OwnerId;
use vrcx_0_vrchat_protocol::friends::friend_status_get_input;
use vrcx_0_vrchat_protocol::users::{
    account_standing_get_input, profile_get_input, user_represented_group_get_input,
};

use crate::social::observe_profile_response;

use super::VrchatRemoteFacade;

impl VrchatRemoteFacade {
    pub async fn user_profile(&self, user_id: String, as_self: bool) -> Result<VrchatResponse> {
        let (user_id, request) =
            profile_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), user_id, as_self)?;
        let response = self
            .execute(
                "app__vrchat_user_profile_get",
                format!("Getting profile for user {user_id}."),
                request,
                VrchatScope::Vrchat,
            )
            .await?;
        self.observe_profile_bio(&response);
        Ok(response)
    }

    pub async fn account_standing(&self) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_current_user_account_standing_get",
            "Getting current user account standing.",
            account_standing_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn user_represented_group(&self, user_id: String) -> Result<VrchatResponse> {
        let (user_id, request) =
            user_represented_group_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), user_id)?;
        self.execute(
            "app__vrchat_user_represented_group_get",
            format!("Getting represented group for user {user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn friend_status(&self, user_id: String) -> Result<VrchatResponse> {
        let (user_id, request) =
            friend_status_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), user_id)?;
        self.execute(
            "app__vrchat_friend_status_get",
            format!("Getting friend status for {user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    fn observe_profile_bio(&self, response: &VrchatResponse) {
        let owner = OwnerId::new(self.auth_scope.snapshot().current_user_id);
        if let Err(error) = observe_profile_response(
            self.profile_bio.as_ref(),
            &self.realtime,
            &owner,
            response,
            &now_iso(),
        ) {
            tracing::warn!(error = %error, "failed to observe a profile bio");
        }
    }
}
