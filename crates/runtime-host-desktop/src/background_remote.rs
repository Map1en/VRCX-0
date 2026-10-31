use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use vrcx_0_application_core::{WebClient, WorldCache};
use vrcx_0_application_game::BackgroundRemoteApi;
use vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint;
use vrcx_0_vrchat_client::groups::profile_get_input as group_profile_get_input;
use vrcx_0_vrchat_client::http_api::ApiScope;
use vrcx_0_vrchat_client::users::{current_user_update_input, CurrentUserUpdateRequest};

pub(crate) struct DesktopBackgroundRemoteApi {
    web: Arc<WebClient>,
    world_cache: Arc<WorldCache>,
}

impl DesktopBackgroundRemoteApi {
    pub(crate) fn new(web: Arc<WebClient>, world_cache: Arc<WorldCache>) -> Self {
        Self { web, world_cache }
    }
}

#[async_trait]
impl BackgroundRemoteApi for DesktopBackgroundRemoteApi {
    async fn get_world(
        &self,
        endpoint: &str,
        world_id: &str,
    ) -> vrcx_0_application_core::Result<vrcx_0_contracts::VrchatResponse> {
        self.world_cache
            .get(&self.web, endpoint, world_id, false, true)
            .await
    }

    async fn world_image_url(&self, endpoint: &str, world_id: &str) -> Option<String> {
        self.world_cache
            .resolve_image_url(&self.web, endpoint, world_id)
            .await
    }

    async fn get_group(
        &self,
        endpoint: &str,
        group_id: &str,
    ) -> vrcx_0_application_core::Result<vrcx_0_contracts::VrchatResponse> {
        let (_, request) = group_profile_get_input(
            normalize_vrchat_api_endpoint(Some(endpoint)),
            group_id.to_string(),
            false,
        )?;
        self.web.execute_api(request, ApiScope::Vrchat).await
    }

    fn prepare_current_user_update(
        &self,
        endpoint: &str,
        user_id: &str,
        patch: Value,
    ) -> vrcx_0_application_core::Result<vrcx_0_contracts::VrchatRequest> {
        let (_, request) = current_user_update_input(
            normalize_vrchat_api_endpoint(Some(endpoint)),
            user_id.to_string(),
            serde_json::from_value::<CurrentUserUpdateRequest>(patch)?,
        )?;
        Ok(request)
    }

    async fn send_current_user_update(
        &self,
        request: vrcx_0_contracts::VrchatRequest,
    ) -> vrcx_0_application_core::Result<vrcx_0_contracts::VrchatResponse> {
        self.web.execute_api(request, ApiScope::Vrchat).await
    }
}
