use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use reqwest::Client;
use reqwest_cookie_store::CookieStoreMutex;

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
    pub fn new(cookie_jar: Arc<CookieStoreMutex>, proxy_url: Option<&str>) -> Result<Self> {
        let mut builder = Client::builder()
            .cookie_provider(cookie_jar)
            .user_agent("VRCX-0");

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
        hosts.insert("api.vrchat.cloud".into());
        hosts.insert("files.vrchat.cloud".into());
        hosts.insert("d348imysud55la.cloudfront.net".into());
        hosts.insert("assets.vrchat.com".into());

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
