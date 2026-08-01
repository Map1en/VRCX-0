use std::sync::Arc;

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

pub struct RealtimeAuthTokenFetch {
    pub response: HttpApiExecuteResponse,
    pub rejected_pooled_status: Option<i32>,
}

pub struct WebClient {
    inner: transport::WebClient,
    realtime_origin: String,
    image_fetcher: Arc<ImageFetcher>,
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
        let image_fetcher = Arc::new(ImageFetcher::new(
            inner.cookie_jar(),
            inner.proxy_url(),
            app_version,
        )?);
        Ok(Self {
            inner,
            realtime_origin,
            image_fetcher,
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

    pub fn image_fetcher(&self) -> Result<Arc<ImageFetcher>> {
        Ok(Arc::clone(&self.image_fetcher))
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

    pub fn cookie_diagnostics(&self) -> serde_json::Value {
        let summary = self.inner.auth_cookie_summary();
        serde_json::json!({
            "cookieCount": summary.total_cookie_count,
            "authCookies": summary
                .auth_cookies
                .into_iter()
                .map(|cookie| serde_json::json!({ "domain": cookie.domain, "expired": cookie.expired }))
                .collect::<Vec<_>>(),
        })
    }

    pub fn auth_cookie_value(&self) -> Option<String> {
        self.inner.auth_cookie_value()
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
        let follow_redirects = request.follow_redirects;
        let request = external_request_to_transport(request);
        if follow_redirects {
            Ok(self.inner.execute(request).await?)
        } else {
            Ok(self.inner.execute_without_redirects(request).await?)
        }
    }

    pub async fn execute_api(
        &self,
        input: HttpApiRequestInput,
        scope: ApiScope,
        db: &DatabaseService,
    ) -> Result<HttpApiExecuteResponse> {
        let request = self.build_api_request(input, scope)?;
        let (status, data) = self.execute(request).await?;
        self.finish_api_request(status, data, db)
    }

    pub async fn fetch_realtime_auth_token(
        &self,
        endpoint: &str,
        db: &DatabaseService,
    ) -> Result<RealtimeAuthTokenFetch> {
        let input = vrcx_0_vrchat_client::auth::session_get_input(endpoint.to_string());
        let scope = ApiScope::Vrchat;
        let (pooled_status, pooled_data) = self
            .inner
            .execute(self.build_api_request(input.clone(), scope)?)
            .await?;
        if (200..300).contains(&pooled_status) {
            return Ok(RealtimeAuthTokenFetch {
                response: self.finish_api_request(pooled_status, pooled_data, db)?,
                rejected_pooled_status: None,
            });
        }

        let (status, data) = self
            .inner
            .execute_fresh_standard(self.build_api_request(input, scope)?)
            .await?;
        Ok(RealtimeAuthTokenFetch {
            response: self.finish_api_request(status, data, db)?,
            rejected_pooled_status: Some(pooled_status),
        })
    }

    pub async fn execute_external_api(
        &self,
        input: ExternalHttpRequestInput,
        scope: ExternalApiScope,
    ) -> Result<ExternalApiExecuteResponse> {
        self.execute_external_api_with_limit(input, scope, None)
            .await
    }

    pub async fn execute_external_api_limited(
        &self,
        input: ExternalHttpRequestInput,
        scope: ExternalApiScope,
        max_response_bytes: usize,
    ) -> Result<ExternalApiExecuteResponse> {
        self.execute_external_api_with_limit(input, scope, Some(max_response_bytes))
            .await
    }

    async fn execute_external_api_with_limit(
        &self,
        input: ExternalHttpRequestInput,
        scope: ExternalApiScope,
        max_response_bytes: Option<usize>,
    ) -> Result<ExternalApiExecuteResponse> {
        let mut request = external_api::build_web_execute_request(input, scope)
            .map_err(|error| crate::Error::Custom(error.to_string()))?;
        request.response_body_limit = max_response_bytes;
        let (status, data) = self.execute_external(request).await?;
        if status == -1 {
            return Err(crate::Error::Custom(data));
        }
        Ok(external_api::execute_response(status, data, scope))
    }

    fn build_api_request(
        &self,
        input: HttpApiRequestInput,
        scope: ApiScope,
    ) -> Result<WebExecuteRequest> {
        http_api::build_web_execute_request(input, scope)
            .map_err(|error| crate::Error::Custom(error.to_string()))
    }

    fn finish_api_request(
        &self,
        status: i32,
        data: String,
        db: &DatabaseService,
    ) -> Result<HttpApiExecuteResponse> {
        self.save_cookies(db);
        if status == -1 {
            return Err(crate::Error::Custom(data));
        }
        Ok(http_api::execute_response(status, data))
    }
}

fn external_request_to_transport(request: ExternalWebExecuteRequest) -> WebExecuteRequest {
    WebExecuteRequest {
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body,
        upload: vrcx_0_vrchat_client::web_client::WebUploadMode::None,
        response_body_limit: request.response_body_limit,
    }
}
