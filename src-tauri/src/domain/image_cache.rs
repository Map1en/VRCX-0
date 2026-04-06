use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use reqwest::Client;
use reqwest_cookie_store::CookieStoreMutex;

use crate::error::AppError;

/// Disk-backed image cache with HTTP fetching.
///
/// Port of C# `ImageCache` — downloads VRChat images to
/// `{AppData}/ImageCache/{fileId}/{version}.png` and serves the local path.
pub struct ImageCache {
    client: Client,
    cache_dir: PathBuf,
    allowed_hosts: Mutex<HashSet<String>>,
}

impl ImageCache {
    /// Create a new ImageCache.
    ///
    /// `cache_dir` — root directory for cached images (e.g. `AppData/ImageCache`).
    /// `cookie_jar` — shared cookie store from `WebClient` so api.vrchat.cloud
    ///   requests include auth cookies automatically.
    /// `proxy_url` — optional proxy inherited from `WebClient` / user settings.
    pub fn new(cache_dir: PathBuf, cookie_jar: Arc<CookieStoreMutex>, proxy_url: Option<&str>) -> Result<Self, AppError> {
        std::fs::create_dir_all(&cache_dir)?;

        let mut builder = Client::builder()
            .cookie_provider(cookie_jar)
            .user_agent("VRCX-0");

        if let Some(proxy) = proxy_url {
            builder = builder.proxy(
                reqwest::Proxy::all(proxy)
                    .map_err(|e| AppError::Custom(format!("image cache proxy: {e}")))?,
            );
        }

        let client = builder
            .build()
            .map_err(|e| AppError::Custom(format!("image cache http client: {e}")))?;

        let mut hosts = HashSet::new();
        hosts.insert("api.vrchat.cloud".into());
        hosts.insert("files.vrchat.cloud".into());
        hosts.insert("d348imysud55la.cloudfront.net".into());
        hosts.insert("assets.vrchat.com".into());

        Ok(Self {
            client,
            cache_dir,
            allowed_hosts: Mutex::new(hosts),
        })
    }

    /// Register additional image hosts provided by the frontend.
    /// Each entry is a full URL — we extract the host component.
    pub fn populate_hosts(&self, hosts: &[String]) {
        let mut allowed = self.allowed_hosts.lock().unwrap();
        for host_url in hosts {
            if host_url.is_empty() {
                continue;
            }
            if let Ok(url) = reqwest::Url::parse(host_url) {
                if let Some(host) = url.host_str() {
                    allowed.insert(host.to_string());
                }
            }
        }
    }

    /// Returns the cached file path for the given image, downloading it if
    /// not already cached.
    ///
    /// - `url` — full download URL
    /// - `file_id` — unique file identifier (used as directory name)
    /// - `version` — version number (used as file name `{version}.png`)
    pub async fn get_image(
        &self,
        url: &str,
        file_id: &str,
        version: &str,
    ) -> Result<String, AppError> {
        let dir = self.cache_dir.join(file_id);
        let file_path = dir.join(format!("{version}.png"));

        // Cache hit — update directory mtime and return
        if file_path.exists() {
            if let Ok(meta) = std::fs::metadata(&file_path) {
                if meta.len() > 0 {
                    // Touch directory mtime — write+delete a temp marker
                    let marker = dir.join(".touch");
                    let _ = std::fs::write(&marker, b"");
                    let _ = std::fs::remove_file(&marker);
                    return Ok(file_path.to_string_lossy().into_owned());
                }
            }
        }

        // Delete stale directory if it exists, then recreate
        if dir.exists() {
            let _ = std::fs::remove_dir_all(&dir);
        }
        std::fs::create_dir_all(&dir)?;

        // Download
        let bytes = self.fetch_image(url).await?;
        std::fs::write(&file_path, &bytes)?;

        // Evict old entries if cache is too large
        self.clean_cache_if_needed();

        Ok(file_path.to_string_lossy().into_owned())
    }

    /// Download an image directly to a specific path.
    pub async fn save_image_to_file(&self, url: &str, path: &str) -> Result<(), AppError> {
        let bytes = self.fetch_image(url).await?;
        if let Some(parent) = std::path::Path::new(path).parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, &bytes)?;
        Ok(())
    }

    /// Fetch image bytes from a URL, validating the host is allowed.
    async fn fetch_image(&self, url: &str) -> Result<Vec<u8>, AppError> {
        let parsed = reqwest::Url::parse(url)
            .map_err(|e| AppError::Custom(format!("invalid image url: {e}")))?;
        let host = parsed
            .host_str()
            .ok_or_else(|| AppError::Custom("image url has no host".into()))?;

        {
            let allowed = self.allowed_hosts.lock().unwrap();
            if !allowed.contains(host) {
                return Err(AppError::Custom(format!("invalid image host: {host}")));
            }
        }

        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| AppError::Custom(format!("image fetch: {e}")))?;

        if !response.status().is_success() {
            return Err(AppError::Custom(format!(
                "image fetch status: {}",
                response.status()
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| AppError::Custom(format!("image read: {e}")))?;

        Ok(bytes.to_vec())
    }

    /// If cache has more than 1100 directories, delete the oldest until 1000 remain.
    fn clean_cache_if_needed(&self) {
        let entries = match std::fs::read_dir(&self.cache_dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        let mut dirs: Vec<(PathBuf, std::time::SystemTime)> = entries
            .flatten()
            .filter(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
            .filter_map(|e| {
                let mtime = e.metadata().ok()?.modified().ok()?;
                Some((e.path(), mtime))
            })
            .collect();

        if dirs.len() <= 1100 {
            return;
        }

        // Sort by mtime descending — newest first
        dirs.sort_by(|a, b| b.1.cmp(&a.1));

        // Delete everything past the 1000th entry
        for (path, _) in dirs.iter().skip(1000) {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}
