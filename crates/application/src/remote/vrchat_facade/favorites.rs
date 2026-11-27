use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::{VrchatResponse, VrchatScope};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_vrchat_protocol::favorites::{favorite_groups_get_input, favorite_worlds_get_input};

use super::VrchatRemoteFacade;

impl VrchatRemoteFacade {
    pub async fn favorite_worlds(
        &self,
        n: i32,
        offset: i32,
        owner_id: String,
        user_id: String,
        tag: String,
    ) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_favorite_worlds_get",
            format!("Getting favorite worlds offset {offset}."),
            favorite_worlds_get_input(
                VRCHAT_API_DEFAULT_ENDPOINT.into(),
                n,
                offset,
                owner_id,
                user_id,
                tag,
            ),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn favorite_groups(
        &self,
        n: i32,
        offset: i32,
        owner_id: String,
    ) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_favorite_groups_get",
            format!("Getting favorite groups offset {offset}."),
            favorite_groups_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), n, offset, owner_id),
            VrchatScope::Vrchat,
        )
        .await
    }
}
