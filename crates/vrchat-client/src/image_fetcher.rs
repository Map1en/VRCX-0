use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use crate::cookies::CookieJar;
use crate::web_client::build_vrcx_user_agent;
use reqwest::Client;
use vrcx_0_core::vrchat_endpoints::{
    VRCHAT_API_HOST, VRCHAT_ASSETS_HOST, VRCHAT_FILES_HOST, VRCHAT_LEGACY_CLOUDFRONT_HOST,
};

pub type Result<T> = std::result::Result<T, ImageFetchError>;

#[derive(Debug, thiserror::Error)]
pub enum ImageFetchError {
    #[error("{0}")]
    Custom(String),
}

pub struct ImageFetcher {
    client: Client,
    allowed_hosts: Mutex<HashSet<String>>,
}

impl ImageFetcher {
    pub fn new(
        cookie_jar: Arc<CookieJar>,
        proxy_url: Option<&str>,
        app_version: &str,
    ) -> Result<Self> {
        let mut builder = Client::builder()
            .cookie_provider(cookie_jar)
            .user_agent(build_vrcx_user_agent(app_version))
            .pool_max_idle_per_host(10)
            .tcp_keepalive(std::time::Duration::from_secs(60))
            .connect_timeout(std::time::Duration::from_secs(10))
            .read_timeout(std::time::Duration::from_secs(30));

        if let Some(proxy) = proxy_url {
            builder = builder.proxy(
                reqwest::Proxy::all(proxy)
                    .map_err(|e| ImageFetchError::Custom(format!("image cache proxy: {e}")))?,
            );
        }

        let client = builder
            .build()
            .map_err(|e| ImageFetchError::Custom(format!("image cache http client: {e}")))?;

        let mut hosts = HashSet::new();
        hosts.insert(VRCHAT_API_HOST.into());
        hosts.insert(VRCHAT_FILES_HOST.into());
        hosts.insert(VRCHAT_LEGACY_CLOUDFRONT_HOST.into());
        hosts.insert(VRCHAT_ASSETS_HOST.into());

        Ok(Self {
            client,
            allowed_hosts: Mutex::new(hosts),
        })
    }

    pub async fn fetch_image(&self, url: &str) -> Result<Vec<u8>> {
        let parsed = reqwest::Url::parse(url)
            .map_err(|e| ImageFetchError::Custom(format!("invalid image url: {e}")))?;
        let host = parsed
            .host_str()
            .ok_or_else(|| ImageFetchError::Custom("image url has no host".into()))?;

        {
            let allowed = self.allowed_hosts.lock().unwrap();
            if !allowed.contains(host) {
                return Err(ImageFetchError::Custom(format!(
                    "invalid image host: {host}"
                )));
            }
        }

        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| ImageFetchError::Custom(format!("image fetch: {e}")))?;

        if !response.status().is_success() {
            return Err(ImageFetchError::Custom(format!(
                "image fetch status: {}",
                response.status()
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| ImageFetchError::Custom(format!("image read: {e}")))?;

        Ok(bytes.to_vec())
    }
}
