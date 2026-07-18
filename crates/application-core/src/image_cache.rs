use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};

use vrcx_0_media::image_cache::ImageCache as LocalImageCache;
use vrcx_0_media::ugc_image_files::UgcCategory;
use vrcx_0_media::Error as MediaError;
use vrcx_0_vrchat_client::image_fetcher::ImageFetcher;

use crate::{Error, Result};

const FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const FAILURE_TTL: Duration = Duration::from_secs(60);

#[derive(Default)]
struct FetchGuardTable {
    failures: Mutex<HashMap<String, Instant>>,
    inflight: Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>,
}

impl FetchGuardTable {
    fn recently_failed(&self, key: &str) -> bool {
        lock(&self.failures)
            .get(key)
            .is_some_and(|at| at.elapsed() < FAILURE_TTL)
    }

    fn record_failure(&self, key: &str) {
        let mut map = lock(&self.failures);
        map.retain(|_, at| at.elapsed() < FAILURE_TTL);
        map.insert(key.to_string(), Instant::now());
    }

    async fn inflight_lock(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut map = lock(&self.inflight);
        if let Some(existing) = map.get(key).and_then(Weak::upgrade) {
            return existing;
        }
        map.retain(|_, weak| weak.strong_count() > 0);
        let guard = Arc::new(tokio::sync::Mutex::new(()));
        map.insert(key.to_string(), Arc::downgrade(&guard));
        guard
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub struct ImageCache {
    fetcher: Arc<ImageFetcher>,
    local_cache: LocalImageCache,
    guards: FetchGuardTable,
}

impl ImageCache {
    pub fn new(cache_dir: PathBuf, fetcher: Arc<ImageFetcher>) -> Result<Self> {
        Ok(Self {
            fetcher,
            local_cache: LocalImageCache::new(cache_dir)?,
            guards: FetchGuardTable::default(),
        })
    }

    pub async fn get_image(&self, url: &str, file_id: &str, version: &str) -> Result<String> {
        let key = format!("{file_id}/{version}");
        if self.guards.recently_failed(&key) {
            return Err(Error::Custom(format!("image fetch recently failed: {key}")));
        }
        let inflight = self.guards.inflight_lock(&key).await;
        let _guard = inflight.lock().await;
        if self.guards.recently_failed(&key) {
            return Err(Error::Custom(format!("image fetch recently failed: {key}")));
        }
        let result = self
            .local_cache
            .get_image_with_fetch(file_id, version, || async {
                match tokio::time::timeout(FETCH_TIMEOUT, self.fetch_image(url)).await {
                    Ok(result) => result.map_err(|error| MediaError::Custom(error.to_string())),
                    Err(_) => Err(MediaError::Custom(format!("image fetch timed out: {url}"))),
                }
            })
            .await;
        match result {
            Ok(path) => Ok(path),
            Err(error) => {
                self.guards.record_failure(&key);
                Err(error.into())
            }
        }
    }

    pub async fn save_image_to_file(&self, url: &str, path: &str) -> Result<()> {
        Ok(self
            .local_cache
            .save_image_to_file_with_fetch(path, || async {
                self.fetch_image(url)
                    .await
                    .map_err(|error| MediaError::Custom(error.to_string()))
            })
            .await?)
    }

    async fn fetch_image(&self, url: &str) -> Result<Vec<u8>> {
        Ok(self.fetcher.fetch_image(url).await?)
    }
}

pub async fn save_ugc_image_to_file(
    image_cache: &ImageCache,
    url: &str,
    ugc_folder_path: &str,
    category: UgcCategory,
    month_folder: &str,
    file_name: &str,
) -> Result<String> {
    let out = vrcx_0_media::ugc_image_files::build_ugc_image_path(
        ugc_folder_path,
        category,
        month_folder,
        file_name,
    )?;
    let out_str = out.to_string_lossy().into_owned();
    image_cache.save_image_to_file(url, &out_str).await?;
    Ok(out_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fetch_guard_table_short_circuits_within_failure_ttl() {
        let table = FetchGuardTable::default();
        assert!(!table.recently_failed("file_a/1"));

        table.record_failure("file_a/1");

        assert!(table.recently_failed("file_a/1"));
        assert!(!table.recently_failed("file_b/1"));
    }

    #[tokio::test]
    async fn fetch_guard_table_reuses_inflight_lock_for_same_key() {
        let table = FetchGuardTable::default();

        let first = table.inflight_lock("file_a/1").await;
        let second = table.inflight_lock("file_a/1").await;
        assert!(Arc::ptr_eq(&first, &second));

        let other = table.inflight_lock("file_b/1").await;
        assert!(!Arc::ptr_eq(&first, &other));
    }

    #[tokio::test]
    async fn fetch_guard_table_drops_inflight_entry_once_unreferenced() {
        let table = FetchGuardTable::default();

        {
            let first = table.inflight_lock("file_a/1").await;
            drop(first);
        }
        let second = table.inflight_lock("file_a/1").await;
        assert_eq!(Arc::strong_count(&second), 1);
    }
}
