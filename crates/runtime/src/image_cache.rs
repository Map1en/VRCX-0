use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use reqwest::Client;
use reqwest_cookie_store::CookieStoreMutex;
use vrcx_0_media::image_cache::ImageCache as LocalImageCache;
use vrcx_0_media::Error as MediaError;

use crate::{Error, Result};

pub struct ImageCache {
    client: Client,
    local_cache: LocalImageCache,
    allowed_hosts: Mutex<HashSet<String>>,
}

impl ImageCache {
    pub fn new(
        cache_dir: PathBuf,
        cookie_jar: Arc<CookieStoreMutex>,
        proxy_url: Option<&str>,
    ) -> Result<Self> {
        let mut builder = Client::builder()
            .cookie_provider(cookie_jar)
            .user_agent("VRCX-0");

        if let Some(proxy) = proxy_url {
            builder = builder.proxy(
                reqwest::Proxy::all(proxy)
                    .map_err(|e| Error::Custom(format!("image cache proxy: {e}")))?,
            );
        }

        let client = builder
            .build()
            .map_err(|e| Error::Custom(format!("image cache http client: {e}")))?;

        let mut hosts = HashSet::new();
        hosts.insert("api.vrchat.cloud".into());
        hosts.insert("files.vrchat.cloud".into());
        hosts.insert("d348imysud55la.cloudfront.net".into());
        hosts.insert("assets.vrchat.com".into());

        Ok(Self {
            client,
            local_cache: LocalImageCache::new(cache_dir)?,
            allowed_hosts: Mutex::new(hosts),
        })
    }

    pub async fn get_image(&self, url: &str, file_id: &str, version: &str) -> Result<String> {
        Ok(self
            .local_cache
            .get_image_with_fetch(file_id, version, || async {
                self.fetch_image(url)
                    .await
                    .map_err(|error| MediaError::Custom(error.to_string()))
            })
            .await?)
    }

    pub async fn save_image_to_file(&self, url: &str, path: &str) -> Result<()> {
        let bytes = self.fetch_image(url).await?;
        if let Some(parent) = std::path::Path::new(path).parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, &bytes)?;
        Ok(())
    }

    async fn fetch_image(&self, url: &str) -> Result<Vec<u8>> {
        let parsed = reqwest::Url::parse(url)
            .map_err(|e| Error::Custom(format!("invalid image url: {e}")))?;
        let host = parsed
            .host_str()
            .ok_or_else(|| Error::Custom("image url has no host".into()))?;

        {
            let allowed = self.allowed_hosts.lock().unwrap();
            if !allowed.contains(host) {
                return Err(Error::Custom(format!("invalid image host: {host}")));
            }
        }

        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| Error::Custom(format!("image fetch: {e}")))?;

        if !response.status().is_success() {
            return Err(Error::Custom(format!(
                "image fetch status: {}",
                response.status()
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| Error::Custom(format!("image read: {e}")))?;

        Ok(bytes.to_vec())
    }
}

pub async fn save_ugc_image_to_file(
    image_cache: &ImageCache,
    url: &str,
    ugc_folder_path: &str,
    month_folder: &str,
    file_name: &str,
) -> Result<String> {
    let out = vrcx_0_media::ugc_image_files::build_ugc_image_path(
        ugc_folder_path,
        month_folder,
        file_name,
    )?;
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let out_str = out.to_string_lossy().into_owned();
    image_cache.save_image_to_file(url, &out_str).await?;
    Ok(out_str)
}
