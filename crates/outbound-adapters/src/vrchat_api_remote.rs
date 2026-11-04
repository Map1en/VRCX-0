use std::sync::Arc;

use vrcx_0_application::remote::{VrchatApiFuture, VrchatApiPort};
use vrcx_0_application_core::vrchat_api::{self, VrchatApiRequest, VrchatScope};
use vrcx_0_application_core::{RuntimeDiagnostics, RuntimeSyncEngine, WebClient};

pub struct VrchatApiRemote {
    web: Arc<WebClient>,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
}

impl VrchatApiRemote {
    pub fn new(
        web: Arc<WebClient>,
        diagnostics: RuntimeDiagnostics,
        sync: RuntimeSyncEngine,
    ) -> Self {
        Self {
            web,
            diagnostics,
            sync,
        }
    }
}

impl VrchatApiPort for VrchatApiRemote {
    fn execute(
        &self,
        command: String,
        detail: String,
        input: VrchatApiRequest,
        scope: VrchatScope,
    ) -> VrchatApiFuture<'_> {
        Box::pin(async move {
            vrchat_api::execute_api_command(
                self.web.as_ref(),
                &self.diagnostics,
                &self.sync,
                (&command, detail),
                input,
                scope,
            )
            .await
        })
    }
}
