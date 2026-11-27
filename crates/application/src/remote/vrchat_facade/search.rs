use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::{VrchatResponse, VrchatScope};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_vrchat_protocol::search::{
    search_groups_get_input, search_groups_strict_get_input, search_instance_short_name_get_input,
    search_users_get_input, search_worlds_get_input, GroupSearchParams, UserSearchParams,
    WorldSearchParams,
};

use super::VrchatRemoteFacade;

impl VrchatRemoteFacade {
    pub async fn search_worlds(
        &self,
        params: WorldSearchParams,
        option: Option<String>,
    ) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_search_worlds_get",
            "Searching worlds.",
            search_worlds_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params, option),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn search_users(&self, params: UserSearchParams) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_search_users_get",
            "Searching users.",
            search_users_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn search_groups(&self, params: GroupSearchParams) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_search_groups_get",
            "Searching groups.",
            search_groups_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn search_groups_strict(&self, params: GroupSearchParams) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_search_groups_strict_get",
            "Strict searching groups.",
            search_groups_strict_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn search_instance_short_name(&self, short_name: String) -> Result<VrchatResponse> {
        let (short_name, request) =
            search_instance_short_name_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), short_name)?;
        self.execute(
            "app__vrchat_search_instance_short_name_get",
            format!("Resolving instance short name {short_name}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }
}
