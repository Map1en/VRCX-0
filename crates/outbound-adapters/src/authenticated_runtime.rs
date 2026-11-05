use std::{path::PathBuf, sync::Arc};

use serde_json::Value;
use vrcx_0_application::social::{
    AuthenticatedRuntimeAuthProbe, AuthenticatedRuntimeLifecycleTrail,
    AuthenticatedRuntimeProbeFuture,
};
use vrcx_0_application_core::WebClient;
use vrcx_0_contracts::vrchat_api::VrchatScope;
use vrcx_0_persistence::DatabaseService;

pub struct VrchatAuthenticatedRuntimeAuthProbe {
    web: Arc<WebClient>,
}

impl VrchatAuthenticatedRuntimeAuthProbe {
    pub fn new(web: Arc<WebClient>) -> Self {
        Self { web }
    }
}

impl AuthenticatedRuntimeAuthProbe for VrchatAuthenticatedRuntimeAuthProbe {
    fn probe<'a>(&'a self, endpoint: &'a str) -> AuthenticatedRuntimeProbeFuture<'a> {
        Box::pin(async move {
            let response = self
                .web
                .execute_api(
                    vrcx_0_vrchat_protocol::auth::current_user_get_input(endpoint.to_string()),
                    VrchatScope::Vrchat,
                )
                .await?;
            Ok(response.status)
        })
    }
}

pub struct LocalAuthenticatedRuntimeLifecycleTrail {
    db_path: PathBuf,
}

impl LocalAuthenticatedRuntimeLifecycleTrail {
    pub fn new(db: &DatabaseService) -> Self {
        Self {
            db_path: db.db_path().to_path_buf(),
        }
    }
}

impl AuthenticatedRuntimeLifecycleTrail for LocalAuthenticatedRuntimeLifecycleTrail {
    fn record(&self, kind: &str, fields: Value) {
        crate::realtime_lifecycle_log::record(&self.db_path, kind, fields);
    }
}
