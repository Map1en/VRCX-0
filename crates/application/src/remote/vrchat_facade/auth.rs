use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::{VrchatResponse, VrchatScope};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_vrchat_protocol::auth::{
    current_user_get_input, file_analysis_get_input, visits_get_input,
};

use super::VrchatRemoteFacade;

impl VrchatRemoteFacade {
    pub async fn current_user(&self) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_auth_current_user_get",
            "Getting current VRChat user.",
            current_user_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn visits(&self) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_auth_visits_get",
            "Getting online visits.",
            visits_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn file_analysis(
        &self,
        file_id: String,
        version: i64,
        variant: String,
    ) -> Result<VrchatResponse> {
        let (file_id, request) = file_analysis_get_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            file_id,
            version,
            variant,
        )?;
        self.execute(
            "app__vrchat_auth_file_analysis_get",
            format!("Getting file analysis for {file_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }
}
