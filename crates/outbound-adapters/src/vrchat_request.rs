use std::sync::Arc;

use vrcx_0_application::remote::{VrchatRequestFuture, VrchatRequestPort};
use vrcx_0_application_core::WebClient;
use vrcx_0_contracts::vrchat_api::{VrchatRequest, VrchatScope};

#[derive(Clone)]
pub struct VrchatRequestAdapter {
    web: Arc<WebClient>,
}

impl VrchatRequestAdapter {
    pub fn new(web: Arc<WebClient>) -> Self {
        Self { web }
    }
}

impl VrchatRequestPort for VrchatRequestAdapter {
    fn send(&self, input: VrchatRequest, scope: VrchatScope) -> VrchatRequestFuture<'_> {
        Box::pin(async move { self.web.execute_api(input, scope).await })
    }
}
