use std::sync::Arc;

use vrcx_0_application::auth::{VrchatConfigFuture, VrchatConfigPort};
use vrcx_0_application::remote::VrchatApiRuntime;
use vrcx_0_application_core::WebClient;
use vrcx_0_contracts::vrchat_api::{VrchatResponse, VrchatScope};

pub struct VrchatConfigAdapter {
    web: Arc<WebClient>,
    api: VrchatApiRuntime,
}

impl VrchatConfigAdapter {
    pub fn new(web: Arc<WebClient>, api: VrchatApiRuntime) -> Self {
        Self { web, api }
    }
}

impl VrchatConfigPort for VrchatConfigAdapter {
    fn cached(&self, endpoint: &str) -> Option<VrchatResponse> {
        self.web.vrchat_config_snapshot(endpoint)
    }

    fn clear(&self) {
        self.web.clear_vrchat_config_snapshot();
    }

    fn fetch(&self, endpoint: String) -> VrchatConfigFuture<'_> {
        let request = vrcx_0_vrchat_protocol::auth::config_get_input(endpoint);
        Box::pin(async move {
            self.api
                .execute(
                    "app__vrchat_auth_config_refresh",
                    "Refreshing VRChat config.",
                    request,
                    VrchatScope::Vrchat,
                )
                .await
        })
    }
}
