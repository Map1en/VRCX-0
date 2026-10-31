use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use moka::sync::Cache;
use serde_json::Value;
use vrcx_0_core::vrchat_json::AvatarJson;
use vrcx_0_persistence::avatars::{
    avatar_cache_existing_ids, avatar_cache_find_by_file_id, avatar_cache_get, avatar_cache_upsert,
    avatar_cache_upsert_many, AvatarCacheOutput,
};
use vrcx_0_persistence::cache_entities::CacheEntityInput;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::avatars::avatar_get_input;
use vrcx_0_vrchat_client::http_api::{normalize_vrchat_api_endpoint, ApiScope};

use vrcx_0_application_core::WebClient;

const AVATAR_RESOLVE_FETCH_TIMEOUT: Duration = Duration::from_secs(5);

pub struct AvatarCache {
    working: Cache<AvatarCacheKey, Arc<AvatarCacheEntry>>,
    db: Arc<DatabaseService>,
    inflight: Mutex<HashMap<AvatarCacheKey, Weak<tokio::sync::Mutex<()>>>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct AvatarCacheKey {
    user_id: String,
    endpoint: String,
    avatar_id: String,
}

struct AvatarCacheEntry {
    summary: AvatarCacheOutput,
    full: Option<Arc<Value>>,
}

impl AvatarCache {
    pub fn new(db: Arc<DatabaseService>, capacity: u64, working_ttl: Duration) -> Self {
        let capacity = capacity.max(1);
        Self {
            working: Cache::builder()
                .max_capacity(capacity)
                .time_to_live(working_ttl)
                .build(),
            db,
            inflight: Mutex::new(HashMap::new()),
        }
    }

    pub fn invalidate(&self, user_id: &str, endpoint: &str, avatar_id: &str) {
        self.working
            .invalidate(&cache_key(user_id, endpoint, avatar_id));
    }

    pub fn get_summary(
        &self,
        user_id: &str,
        endpoint: &str,
        avatar_id: &str,
    ) -> crate::Result<Option<AvatarCacheOutput>> {
        let key = cache_key(user_id, endpoint, avatar_id);
        if key.avatar_id.is_empty() {
            return Ok(None);
        }
        if let Some(entry) = self.working.get(&key) {
            return Ok(Some(entry.summary.clone()));
        }
        let Some(summary) = avatar_cache_get(self.db.as_ref(), key.avatar_id.clone())? else {
            return Ok(None);
        };
        if !is_meaningful_summary(&summary) {
            return Ok(None);
        }
        self.insert_summary(key, summary.clone());
        Ok(Some(summary))
    }

    pub fn find_by_image_url(
        &self,
        user_id: &str,
        endpoint: &str,
        image_url: &str,
    ) -> crate::Result<Option<Arc<Value>>> {
        let Some(file_id) = extract_file_id(image_url) else {
            return Ok(None);
        };
        let Some(summary) = avatar_cache_find_by_file_id(self.db.as_ref(), &file_id)? else {
            return Ok(None);
        };
        if !is_meaningful_summary(&summary) {
            return Ok(None);
        }
        let key = cache_key(user_id, endpoint, &summary.id);
        self.insert_summary(key, summary.clone());
        Ok(Some(Arc::new(summary_value(&summary)?)))
    }

    pub fn hydrate_from_payload(
        &self,
        user_id: &str,
        endpoint: &str,
        avatar: Value,
    ) -> Option<Arc<Value>> {
        let summary = avatar_summary(&avatar)?;
        let key = cache_key(user_id, endpoint, &summary.id);
        let avatar = Arc::new(avatar);
        self.working.insert(
            key,
            Arc::new(AvatarCacheEntry {
                summary: summary.clone(),
                full: Some(Arc::clone(&avatar)),
            }),
        );
        if let Err(error) = avatar_cache_upsert(
            self.db.as_ref(),
            cache_entity_input(avatar.as_ref(), &summary),
        ) {
            tracing::warn!(avatar_id = %summary.id, "AvatarCache upsert failed: {error}");
        }
        Some(avatar)
    }

    pub fn existing_summary_ids(&self, avatar_ids: &[String]) -> crate::Result<Vec<String>> {
        avatar_cache_existing_ids(self.db.as_ref(), avatar_ids).map_err(crate::Error::from)
    }

    pub fn store_summaries(
        &self,
        user_id: &str,
        endpoint: &str,
        entries: Vec<CacheEntityInput>,
    ) -> crate::Result<u32> {
        let avatar_ids = entries
            .iter()
            .filter_map(|entry| entry.id.as_str().map(str::to_string))
            .collect::<Vec<_>>();
        let stored = avatar_cache_upsert_many(self.db.as_ref(), entries)?;
        for avatar_id in avatar_ids {
            self.invalidate(user_id, endpoint, &avatar_id);
        }
        Ok(stored)
    }

    pub async fn resolve(
        &self,
        web: &WebClient,
        user_id: &str,
        endpoint: &str,
        avatar_id: &str,
        full: bool,
        fresh: bool,
    ) -> crate::Result<Option<Arc<Value>>> {
        let key = cache_key(user_id, endpoint, avatar_id);
        if key.avatar_id.is_empty() {
            return Ok(None);
        }
        if !fresh {
            if let Some(value) = self.working_value_for_key(&key, full) {
                return Ok(Some(value));
            }
            if !full {
                if let Some(summary) = self.get_summary(user_id, endpoint, avatar_id)? {
                    return Ok(Some(Arc::new(summary_value(&summary)?)));
                }
            }
        }
        let inflight = self.inflight_lock(&key);
        let _guard = inflight.lock().await;
        if !fresh {
            if let Some(value) = self.working_value_for_key(&key, full) {
                return Ok(Some(value));
            }
            if !full {
                if let Some(summary) = self.get_summary(user_id, endpoint, avatar_id)? {
                    return Ok(Some(Arc::new(summary_value(&summary)?)));
                }
            }
        }
        self.fetch_avatar(web, &key).await.map(Some)
    }

    async fn fetch_avatar(
        &self,
        web: &WebClient,
        key: &AvatarCacheKey,
    ) -> crate::Result<Arc<Value>> {
        let (_, request) = avatar_get_input(key.endpoint.clone(), key.avatar_id.clone())?;
        let response = tokio::time::timeout(
            AVATAR_RESOLVE_FETCH_TIMEOUT,
            web.execute_api(request, ApiScope::Vrchat),
        )
        .await
        .map_err(|_| {
            crate::Error::Custom(format!("Avatar request timed out: {}", key.avatar_id))
        })??;
        if !(200..=299).contains(&response.status) {
            return Err(crate::Error::Custom(format!(
                "Avatar request failed with status {}: {}",
                response.status, key.avatar_id
            )));
        }
        let avatar = serde_json::from_str::<Value>(&response.data)?;
        self.hydrate_from_payload(&key.user_id, &key.endpoint, avatar)
            .ok_or_else(|| {
                crate::Error::Custom(format!("Invalid avatar response: {}", key.avatar_id))
            })
    }

    fn insert_summary(&self, key: AvatarCacheKey, summary: AvatarCacheOutput) {
        self.working.insert(
            key,
            Arc::new(AvatarCacheEntry {
                summary,
                full: None,
            }),
        );
    }

    fn working_value_for_key(&self, key: &AvatarCacheKey, full: bool) -> Option<Arc<Value>> {
        let entry = self.working.get(key)?;
        if full {
            return entry.full.as_ref().map(Arc::clone);
        }
        entry
            .full
            .as_ref()
            .map(Arc::clone)
            .or_else(|| summary_value(&entry.summary).ok().map(Arc::new))
    }

    #[cfg(test)]
    fn working_value(
        &self,
        user_id: &str,
        endpoint: &str,
        avatar_id: &str,
        full: bool,
    ) -> Option<Arc<Value>> {
        self.working_value_for_key(&cache_key(user_id, endpoint, avatar_id), full)
    }

    fn inflight_lock(&self, key: &AvatarCacheKey) -> Arc<tokio::sync::Mutex<()>> {
        let mut inflight = self
            .inflight
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(existing) = inflight.get(key).and_then(Weak::upgrade) {
            return existing;
        }
        inflight.retain(|_, weak| weak.strong_count() > 0);
        let lock = Arc::new(tokio::sync::Mutex::new(()));
        inflight.insert(key.clone(), Arc::downgrade(&lock));
        lock
    }

    #[cfg(test)]
    fn entry_count(&self) -> u64 {
        self.working.entry_count()
    }

    #[cfg(test)]
    fn run_pending_tasks(&self) {
        self.working.run_pending_tasks();
    }
}

#[async_trait::async_trait]
impl vrcx_0_application_core::AvatarCachePort for AvatarCache {
    fn invalidate(&self, user_id: &str, endpoint: &str, avatar_id: &str) {
        AvatarCache::invalidate(self, user_id, endpoint, avatar_id);
    }

    fn get_summary(
        &self,
        user_id: &str,
        endpoint: &str,
        avatar_id: &str,
    ) -> crate::Result<Option<vrcx_0_contracts::AvatarCacheOutput>> {
        AvatarCache::get_summary(self, user_id, endpoint, avatar_id)
    }

    fn find_by_image_url(
        &self,
        user_id: &str,
        endpoint: &str,
        image_url: &str,
    ) -> crate::Result<Option<Arc<Value>>> {
        AvatarCache::find_by_image_url(self, user_id, endpoint, image_url)
    }

    fn hydrate_from_payload(
        &self,
        user_id: &str,
        endpoint: &str,
        avatar: Value,
    ) -> Option<Arc<Value>> {
        AvatarCache::hydrate_from_payload(self, user_id, endpoint, avatar)
    }

    fn existing_summary_ids(&self, avatar_ids: &[String]) -> crate::Result<Vec<String>> {
        AvatarCache::existing_summary_ids(self, avatar_ids)
    }

    fn store_summaries(
        &self,
        user_id: &str,
        endpoint: &str,
        entries: Vec<CacheEntityInput>,
    ) -> crate::Result<u32> {
        AvatarCache::store_summaries(self, user_id, endpoint, entries)
    }

    async fn resolve(
        &self,
        web: &WebClient,
        user_id: &str,
        endpoint: &str,
        avatar_id: &str,
        full: bool,
        fresh: bool,
    ) -> crate::Result<Option<Arc<Value>>> {
        AvatarCache::resolve(self, web, user_id, endpoint, avatar_id, full, fresh).await
    }
}

fn cache_key(user_id: &str, endpoint: &str, avatar_id: &str) -> AvatarCacheKey {
    AvatarCacheKey {
        user_id: user_id.trim().to_string(),
        endpoint: normalize_vrchat_api_endpoint(Some(endpoint)),
        avatar_id: avatar_id.trim().to_string(),
    }
}

fn avatar_summary(value: &Value) -> Option<AvatarCacheOutput> {
    let id = text_field(value, "id");
    let name = text_field(value, "name");
    if id.is_empty() || name.is_empty() {
        return None;
    }
    Some(AvatarCacheOutput {
        id,
        author_id: text_field(value, "authorId"),
        author_name: text_field(value, "authorName"),
        created_at: text_field_with_fallback(value, "created_at", "createdAt"),
        description: text_field(value, "description"),
        image_url: text_field(value, "imageUrl"),
        name,
        release_status: AvatarJson::new(value).release_status().unwrap_or_default(),
        thumbnail_image_url: text_field(value, "thumbnailImageUrl"),
        updated_at: text_field_with_fallback(value, "updated_at", "updatedAt"),
        version: value
            .get("version")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
    })
}

fn cache_entity_input(value: &Value, summary: &AvatarCacheOutput) -> CacheEntityInput {
    CacheEntityInput {
        id: Value::String(summary.id.clone()),
        author_id: value_or_null(value, "authorId"),
        author_name: value_or_null(value, "authorName"),
        created_at: value_or_null_with_fallback(value, "created_at", "createdAt"),
        description: value_or_null(value, "description"),
        image_url: value_or_null(value, "imageUrl"),
        name: Value::String(summary.name.clone()),
        release_status: value_or_null(value, "releaseStatus"),
        thumbnail_image_url: value_or_null(value, "thumbnailImageUrl"),
        updated_at: value_or_null_with_fallback(value, "updated_at", "updatedAt"),
        version: value_or_null(value, "version"),
    }
}

fn summary_value(summary: &AvatarCacheOutput) -> crate::Result<Value> {
    Ok(serde_json::to_value(summary)?)
}

fn is_meaningful_summary(summary: &AvatarCacheOutput) -> bool {
    !summary.id.trim().is_empty() && !summary.name.trim().is_empty()
}

fn text_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

fn text_field_with_fallback(value: &Value, key: &str, fallback: &str) -> String {
    let text = text_field(value, key);
    if text.is_empty() {
        text_field(value, fallback)
    } else {
        text
    }
}

fn value_or_null(value: &Value, key: &str) -> Value {
    value.get(key).cloned().unwrap_or(Value::Null)
}

fn value_or_null_with_fallback(value: &Value, key: &str, fallback: &str) -> Value {
    value
        .get(key)
        .or_else(|| value.get(fallback))
        .cloned()
        .unwrap_or(Value::Null)
}

use vrcx_0_core::files::extract_file_id;

#[cfg(test)]
mod tests;
