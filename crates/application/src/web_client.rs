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
        let request = self.with_user_agent(external_request_to_transport(request));
        Ok(self.inner.execute(request).await?)
    }

    fn with_user_agent(&self, mut request: WebExecuteRequest) -> WebExecuteRequest {
        request.user_agent = Some(self.inner.user_agent().to_string());
        request
    }

    pub async fn execute_api(
        &self,
        input: HttpApiRequestInput,
        scope: ApiScope,
        db: &DatabaseService,
    ) -> Result<HttpApiExecuteResponse> {
        let save_cookies = http_api::scope_saves_cookies(scope);
        let request = http_api::build_web_execute_request(input, scope)
            .map_err(|error| crate::Error::Custom(error.to_string()))?;
        let request = self.with_user_agent(request);
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

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir {
        path: std::path::PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-web-client-test-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn test_web_client(dir: &TestDir, app_version: &str) -> Result<WebClient> {
        let storage = StorageService::new(&dir.path.join("VRCX-0.json"))?;
        let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
        WebClient::new(&storage, &db, "https://app.example".into(), app_version)
    }

    #[test]
    fn with_user_agent_attaches_versioned_ua() -> Result<()> {
        let dir = TestDir::new("with-user-agent");
        let web = test_web_client(&dir, "2.9.2")?;

        let request = web.with_user_agent(WebExecuteRequest::new(
            "https://api.vrchat.cloud/api/1/config".into(),
            "GET".into(),
        ));

        assert_eq!(request.user_agent.as_deref(), Some("VRCX-0/2.9.2"));
        Ok(())
    }

    #[test]
    fn external_request_to_transport_starts_without_user_agent() {
        let external = ExternalWebExecuteRequest::new("https://avtrdb.example/api/search", "GET");

        let transport = external_request_to_transport(external);

        assert!(transport.user_agent.is_none());
    }
}
