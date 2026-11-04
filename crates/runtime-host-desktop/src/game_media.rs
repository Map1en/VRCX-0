use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use vrcx_0_application_core::{save_ugc_image_to_file, ImageCache, WebClient};
use vrcx_0_application_game::{InstanceMediaPort, VideoMetadataPort};
use vrcx_0_contracts::external_api::{youtube_video_metadata_get_input, ExternalApiScope};
use vrcx_0_contracts::vrchat_api::VrchatScope;
use vrcx_0_contracts::UgcCategory;
use vrcx_0_vrchat_protocol::groups::profile_get_input as group_profile_get_input;
use vrcx_0_vrchat_protocol::media::{print_get_input, user_inventory_item_get_input};

pub(crate) struct DesktopGameMediaAdapter {
    web: Arc<WebClient>,
    image_cache: Arc<ImageCache>,
}

impl DesktopGameMediaAdapter {
    pub(crate) fn new(web: Arc<WebClient>, image_cache: Arc<ImageCache>) -> Self {
        Self { web, image_cache }
    }

    async fn execute_json(
        &self,
        request: vrcx_0_contracts::VrchatRequest,
    ) -> vrcx_0_application_core::Result<Option<Value>> {
        let response = self.web.execute_api(request, VrchatScope::Vrchat).await?;
        if !(200..300).contains(&response.status) {
            return Ok(None);
        }
        Ok(serde_json::from_str(&response.data).ok())
    }
}

#[async_trait]
impl InstanceMediaPort for DesktopGameMediaAdapter {
    async fn get_print(&self, print_id: &str) -> vrcx_0_application_core::Result<Option<Value>> {
        self.execute_json(print_get_input(String::new(), print_id.to_string())?)
            .await
    }

    async fn get_group(&self, group_id: &str) -> vrcx_0_application_core::Result<Option<Value>> {
        let (_, request) = group_profile_get_input(String::new(), group_id.to_string(), false)?;
        self.execute_json(request).await
    }

    async fn get_inventory_item(
        &self,
        user_id: &str,
        inventory_id: &str,
    ) -> vrcx_0_application_core::Result<Option<Value>> {
        self.execute_json(user_inventory_item_get_input(
            String::new(),
            user_id.to_string(),
            inventory_id.to_string(),
        )?)
        .await
    }

    async fn save_ugc_image(
        &self,
        url: &str,
        ugc_folder_path: &str,
        category: UgcCategory,
        month_folder: &str,
        file_name: &str,
    ) -> vrcx_0_application_core::Result<String> {
        save_ugc_image_to_file(
            &self.image_cache,
            url,
            ugc_folder_path,
            category,
            month_folder,
            file_name,
        )
        .await
    }

    fn crop_print_file(&self, path: &str) -> vrcx_0_application_core::Result<()> {
        vrcx_0_media::image_processing::crop_print_file(std::path::Path::new(path))
            .map(|_| ())
            .map_err(|error| match error {
                vrcx_0_media::Error::Io(error) => vrcx_0_application_core::Error::Io(error),
                vrcx_0_media::Error::Custom(message) => {
                    vrcx_0_application_core::Error::Custom(message)
                }
            })
    }
}

#[async_trait]
impl VideoMetadataPort for DesktopGameMediaAdapter {
    async fn youtube_metadata(
        &self,
        video_id: &str,
        api_key: &str,
    ) -> vrcx_0_application_core::Result<Option<Value>> {
        let response = self
            .web
            .execute_external_api(
                youtube_video_metadata_get_input(video_id, api_key),
                ExternalApiScope::Youtube,
            )
            .await?;
        if response.status != 200 {
            return Ok(None);
        }
        Ok(Some(
            serde_json::from_str(&response.data).unwrap_or(Value::Null),
        ))
    }
}
