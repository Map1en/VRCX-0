use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::{VrchatResponse, VrchatScope};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_vrchat_protocol::avatars::{
    avatar_gallery_get_input, avatar_list_by_user_get_input, avatar_styles_get_input,
    AvatarListByUserGetInput,
};
use vrcx_0_vrchat_protocol::query::{AvatarListSort, QueryOrder, ReleaseStatusFilter};

use super::VrchatRemoteFacade;

pub struct AvatarListByUserQuery {
    pub n: i32,
    pub offset: i32,
    pub sort: AvatarListSort,
    pub order: QueryOrder,
    pub release_status: ReleaseStatusFilter,
}

impl VrchatRemoteFacade {
    pub async fn avatar_gallery(&self, avatar_id: String) -> Result<VrchatResponse> {
        let (avatar_id, request) =
            avatar_gallery_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), avatar_id)?;
        self.execute(
            "app__vrchat_avatar_gallery_get",
            format!("Getting avatar gallery for {avatar_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn avatars_by_user(
        &self,
        user_id: String,
        user: String,
        query: AvatarListByUserQuery,
    ) -> Result<VrchatResponse> {
        let (display_user, request) = avatar_list_by_user_get_input(AvatarListByUserGetInput {
            endpoint: VRCHAT_API_DEFAULT_ENDPOINT.into(),
            user_id,
            user,
            n: query.n,
            offset: query.offset,
            sort: query.sort,
            order: query.order,
            release_status: query.release_status,
        })?;
        self.execute(
            "app__vrchat_avatar_list_by_user_get",
            format!("Getting avatars for {display_user}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn avatar_styles(&self) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_avatar_styles_get",
            "Getting avatar styles.",
            avatar_styles_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
            VrchatScope::Vrchat,
        )
        .await
    }
}
