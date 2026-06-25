use vrcx_0_integrations::external_api::{
    self, ExternalApiExecuteResponse, ExternalApiScope, ExternalHttpRequestInput,
    ExternalWebExecuteRequest,
};
use vrcx_0_persistence::cookies;
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::{self, ApiScope, HttpApiExecuteResponse, HttpApiRequestInput};
use vrcx_0_vrchat_client::image_fetcher::ImageFetcher;
use vrcx_0_vrchat_client::realtime::RealtimeConnectionOptions;
use vrcx_0_vrchat_client::web_client::{self as transport, WebExecuteRequest};

use crate::Result;

pub struct WebClient {
    inner: transport::WebClient,
    realtime_origin: String,
}

impl WebClient {
    pub fn new(
        storage: &StorageService,
        db: &DatabaseService,
        realtime_origin: String,
        app_version: &str,
    ) -> Result<Self> {
        let proxy_url = crate::proxy::load_proxy_url(storage);
        let persisted_cookies = cookies::get_default_cookies(db)?;
        let inner =
            transport::WebClient::new(proxy_url, persisted_cookies.as_deref(), app_version)?;
        Ok(Self {
            inner,
            realtime_origin,
        })
    }

    pub fn save_cookies(&self, db: &DatabaseService) {
        let jar = self.inner.cookie_jar();
        let Some(maybe_b64) = jar.flush_if_dirty(transport::serialize_cookie_store) else {
            return;
        };
        let Some(b64) = maybe_b64 else {
            jar.mark_dirty();
            return;
        };
        if let Err(error) = cookies::save_default_cookies(db, &b64) {
            jar.mark_dirty();
            tracing::warn!("failed to persist cookies: {error}");
        }
    }

    pub fn proxy_url(&self) -> Option<&str> {
        self.inner.proxy_url()
    }

    pub fn image_fetcher(&self) -> Result<ImageFetcher> {
        Ok(ImageFetcher::new(
            self.inner.cookie_jar(),
            self.inner.proxy_url(),
        )?)
    }

    pub fn realtime_connection_options(&self) -> RealtimeConnectionOptions {
        RealtimeConnectionOptions {
            origin: self.realtime_origin.clone(),
            proxy_url: self.inner.proxy_url().map(ToString::to_string),
        }
    }

    pub fn clear_cookies(&self) {
        self.inner.clear_cookies();
    }

    pub fn clear_auth_cookies(&self) {
        self.inner.clear_auth_cookies();
    }

    pub fn get_cookies(&self) -> String {
        self.inner.get_cookies()
    }

    pub fn set_cookies(&self, b64: &str) -> Result<()> {
        Ok(self.inner.set_cookies(b64)?)
    }

    pub async fn execute(&self, request: WebExecuteRequest) -> Result<(i32, String)> {
        Ok(self.inner.execute(request).await?)
    }

    pub async fn execute_external(
        &self,
        request: ExternalWebExecuteRequest,
    ) -> Result<(i32, String)> {
        Ok(self
            .inner
            .execute(external_request_to_transport(request))
            .await?)
    }

    pub async fn execute_api(
        &self,
        input: HttpApiRequestInput,
        scope: ApiScope,
        db: &DatabaseService,
    ) -> Result<HttpApiExecuteResponse> {
        let save_cookies = http_api::scope_saves_cookies(scope);
        let mut request = http_api::build_web_execute_request(input, scope)
            .map_err(|error| crate::Error::Custom(error.to_string()))?;
        request.user_agent = Some(self.inner.user_agent().to_string());
        let (status, data) = self.execute(request).await?;
        if save_cookies {
            self.save_cookies(db);
        }
        if status == -1 {
            return Err(crate::Error::Custom(data));
        }
        Ok(http_api::execute_response(status, data, scope))
    }

    pub async fn execute_external_api(
        &self,
        input: ExternalHttpRequestInput,
        scope: ExternalApiScope,
    ) -> Result<ExternalApiExecuteResponse> {
        let request = external_api::build_web_execute_request(input, scope)
            .map_err(|error| crate::Error::Custom(error.to_string()))?;
        let (status, data) = self.execute_external(request).await?;
        if status == -1 {
            return Err(crate::Error::Custom(data));
        }
        Ok(external_api::execute_response(status, data, scope))
    }
}

fn external_request_to_transport(request: ExternalWebExecuteRequest) -> WebExecuteRequest {
    WebExecuteRequest {
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body,
        upload: vrcx_0_vrchat_client::web_client::WebUploadMode::None,
        user_agent: None,
    }
}
