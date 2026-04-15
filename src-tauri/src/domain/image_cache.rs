use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use reqwest::Client;
use reqwest_cookie_store::CookieStoreMutex;
use sha2::{Digest, Sha256};

use crate::error::AppError;

pub struct ImageCache {
    client: Client,
    cache_dir: PathBuf,
    allowed_hosts: Mutex<HashSet<String>>,
}

impl ImageCache {
    pub fn new(
        cache_dir: PathBuf,
        cookie_jar: Arc<CookieStoreMutex>,
        proxy_url: Option<&str>,
    ) -> Result<Self, AppError> {
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

    pub async fn get_image(
        &self,
        url: &str,
        file_id: &str,
        version: &str,
    ) -> Result<String, AppError> {
        let file_id = safe_cache_component(file_id);
        let version = safe_cache_component(version);
        let dir = self.cache_dir.join(file_id);
        let file_path = dir.join(format!("{version}.png"));

        if file_path.exists() {
            if let Ok(meta) = std::fs::metadata(&file_path) {
                if meta.len() > 0 {
                    let marker = dir.join(".touch");
                    let _ = std::fs::write(&marker, b"");
                    let _ = std::fs::remove_file(&marker);
                    return Ok(file_path.to_string_lossy().into_owned());
                }
            }
        }

        if dir.exists() {
            let _ = std::fs::remove_dir_all(&dir);
        }
        std::fs::create_dir_all(&dir)?;

        let bytes = self.fetch_image(url).await?;
        std::fs::write(&file_path, &bytes)?;

        self.clean_cache_if_needed();

        Ok(file_path.to_string_lossy().into_owned())
    }

    pub async fn save_image_to_file(&self, url: &str, path: &str) -> Result<(), AppError> {
        let bytes = self.fetch_image(url).await?;
        if let Some(parent) = std::path::Path::new(path).parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, &bytes)?;
        Ok(())
    }

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

        dirs.sort_by(|a, b| b.1.cmp(&a.1));

        for (path, _) in dirs.iter().skip(1000) {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

fn safe_cache_component(value: &str) -> String {
    if is_safe_path_component(value) {
        return value.to_string();
    }

    let digest = Sha256::digest(value.as_bytes());
    format!("h-{}", hex::encode(digest))
}

fn is_safe_path_component(value: &str) -> bool {
    if value.is_empty() || value == "." || value == ".." {
        return false;
    }

    if value.ends_with(' ') || value.ends_with('.') {
        return false;
    }

    if value.chars().any(|ch| {
        ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
    }) {
        return false;
    }

    if is_windows_reserved_name(value) {
        return false;
    }

    let mut components = Path::new(value).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(component)), None) => component == std::ffi::OsStr::new(value),
        _ => false,
    }
}

fn is_windows_reserved_name(value: &str) -> bool {
    let upper = value
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON" | "PRN" | "AUX" | "NUL"
            | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9"
            | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9"
    )
}
