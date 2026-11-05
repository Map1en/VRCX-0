use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use moka::policy::EvictionPolicy;
use moka::sync::Cache;
use vrcx_0_application_core::WebClient;
use vrcx_0_contracts::vrchat_api::VrchatScope;
use vrcx_0_contracts::FileMetadataOutput;
use vrcx_0_persistence::files::{file_cache_get, file_cache_upsert};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_protocol::avatars::avatar_file_get_input;
use vrcx_0_vrchat_protocol::http_api::normalize_vrchat_api_endpoint;

const FILE_RESOLVE_FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const FILE_RESOLVE_FAILURE_TTL: Duration = Duration::from_secs(60 * 60);
const FILE_RESOLVE_FAILURE_CAPACITY: u64 = 256;

pub struct FileCache {
    working: Cache<String, FileMetadataOutput>,
    db: Arc<DatabaseService>,
    inflight: Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>,
    failures: Cache<String, ()>,
    web: Arc<WebClient>,
}

impl FileCache {
    pub fn new(db: Arc<DatabaseService>, web: Arc<WebClient>, capacity: u64) -> Self {
        Self {
            working: Cache::builder()
                .max_capacity(capacity.max(1))
                .eviction_policy(EvictionPolicy::lru())
                .build(),
            db,
            inflight: Mutex::new(HashMap::new()),
            failures: Cache::builder()
                .max_capacity(FILE_RESOLVE_FAILURE_CAPACITY)
                .time_to_live(FILE_RESOLVE_FAILURE_TTL)
                .eviction_policy(EvictionPolicy::lru())
                .build(),
            web,
        }
    }

    fn get(&self, file_id: &str) -> Option<FileMetadataOutput> {
        let file_id = file_id.trim();
        if !file_id.starts_with("file_") {
            return None;
        }
        if let Some(file) = self.working.get(file_id) {
            return Some(file);
        }
        let file = file_cache_get(self.db.as_ref(), file_id).ok().flatten()?;
        self.working.insert(file_id.to_string(), file.clone());
        Some(file)
    }

    pub async fn resolve(&self, endpoint: &str, file_id: &str) -> Option<FileMetadataOutput> {
        let file_id = file_id.trim();
        if let Some(file) = self.get(file_id) {
            return Some(file);
        }
        if !file_id.starts_with("file_") || self.failures.get(file_id).is_some() {
            return None;
        }
        let inflight = self.inflight_lock(file_id);
        let _guard = inflight.lock().await;
        if let Some(file) = self.working.get(file_id) {
            return Some(file);
        }
        if self.failures.get(file_id).is_some() {
            return None;
        }
        let endpoint = normalize_vrchat_api_endpoint(Some(endpoint));
        let (_, request) = avatar_file_get_input(endpoint, file_id.to_string()).ok()?;
        let fetched = tokio::time::timeout(
            FILE_RESOLVE_FETCH_TIMEOUT,
            self.web.execute_api(request, VrchatScope::Vrchat),
        )
        .await;
        let file = match fetched {
            Ok(Ok(response)) if (200..=299).contains(&response.status) => {
                serde_json::from_str::<serde_json::Value>(&response.data)
                    .ok()
                    .as_ref()
                    .and_then(FileMetadataOutput::from_vrchat_file)
            }
            _ => None,
        };
        let Some(file) = file else {
            self.failures.insert(file_id.to_string(), ());
            return None;
        };
        if let Err(error) = file_cache_upsert(self.db.as_ref(), &file) {
            tracing::warn!(%error, file_id = %file.id, "failed to persist file metadata");
        }
        self.working.insert(file.id.clone(), file.clone());
        Some(file)
    }

    fn inflight_lock(&self, file_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut map = self
            .inflight
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(existing) = map.get(file_id).and_then(Weak::upgrade) {
            return existing;
        }
        map.retain(|_, weak| weak.strong_count() > 0);
        let guard = Arc::new(tokio::sync::Mutex::new(()));
        map.insert(file_id.to_string(), Arc::downgrade(&guard));
        guard
    }
}

#[async_trait::async_trait]
impl vrcx_0_application_core::FileCachePort for FileCache {
    async fn resolve(&self, endpoint: &str, file_id: &str) -> Option<FileMetadataOutput> {
        FileCache::resolve(self, endpoint, file_id).await
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-file-cache-{name}-{}-{nonce}",
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

    #[test]
    fn get_reads_through_the_persisted_cache_and_rejects_non_file_ids() {
        let dir = TestDir::new("read-through");
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
        let storage =
            vrcx_0_persistence::storage::StorageService::new(&dir.path.join("storage.json"))
                .unwrap();
        let web = Arc::new(WebClient::new(
            crate::LocalWebClientAdapter::new(
                &storage,
                Arc::clone(&db),
                "wss://pipeline.vrchat.cloud".to_string(),
                env!("CARGO_PKG_VERSION"),
            )
            .unwrap(),
        ));
        let cache = FileCache::new(Arc::clone(&db), Arc::clone(&web), 16);
        let file = FileMetadataOutput::new(
            "file_1234abcd-0000-1111-2222-abcdefabcdef".into(),
            "Avatar - Rurune - Image - 2022․3․22f1_1_standalonewindows_Release".into(),
            "usr_author".into(),
        );

        assert!(cache.get(&file.id).is_none());
        file_cache_upsert(db.as_ref(), &file).unwrap();
        assert_eq!(cache.get(&file.id), Some(file.clone()));
        assert!(cache.get("avtr_x").is_none());

        let other = FileCache::new(db, web, 16);
        assert_eq!(other.get(&file.id), Some(file));
    }
}
