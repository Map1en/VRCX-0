use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use moka::policy::EvictionPolicy;
use moka::sync::Cache;
use serde_json::Value;
use vrcx_0_core::ReleaseStatus;
use vrcx_0_persistence::cache_entities::CacheEntityInput;
use vrcx_0_persistence::worlds::{
    world_cache_get, world_cache_get_many, world_cache_search, world_cache_upsert,
    world_cache_upsert_many, WorldSummaryOutput,
};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::{
    execute_response, normalize_vrchat_api_endpoint, ApiScope, HttpApiExecuteResponse,
};
use vrcx_0_vrchat_client::worlds::world_get_input;

use crate::web_client::WebClient;
use vrcx_0_core::location::is_meaningful_world_name;

const WORLD_RESOLVE_FETCH_TIMEOUT_MS: u64 = 5_000;
const WORLD_RESOLVE_FAILURE_TTL: Duration = Duration::from_secs(60);
const WORLD_RESOLVE_FAILURE_CAPACITY: u64 = 32;

pub struct WorldCache {
    working: Cache<String, Arc<CachedWorld>>,
    db: Arc<DatabaseService>,
    inflight: Mutex<HashMap<WorldResolveKey, Weak<tokio::sync::Mutex<()>>>>,
    failures: Cache<WorldResolveKey, ()>,
}

#[derive(Clone, Debug)]
struct CachedWorld {
    summary: WorldSummaryOutput,
    card_fields: Option<WorldCardFields>,
}

#[derive(Clone, Debug)]
struct WorldCardFields {
    tags: Option<Vec<String>>,
    occupants: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct WorldResolveKey {
    endpoint: String,
    world_id: String,
}

impl WorldCache {
    pub fn new(db: Arc<DatabaseService>, capacity: u64, working_ttl: Duration) -> Self {
        let capacity = capacity.max(1);
        Self {
            working: Cache::builder()
                .max_capacity(capacity)
                .time_to_live(working_ttl)
                .build(),
            db,
            inflight: Mutex::new(HashMap::new()),
            failures: Cache::builder()
                .max_capacity(WORLD_RESOLVE_FAILURE_CAPACITY)
                .time_to_live(WORLD_RESOLVE_FAILURE_TTL)
                .eviction_policy(EvictionPolicy::lru())
                .build(),
        }
    }

    pub fn clear_working(&self) {
        self.working.invalidate_all();
    }

    pub fn get_name(&self, world_id: &str) -> Option<String> {
        let world_id = normalize_id(world_id);
        if world_id.is_empty() {
            return None;
        }
        self.working
            .get(&world_id)
            .map(|world| world.summary.name.clone())
    }

    pub fn get_summary(&self, world_id: &str) -> crate::Result<Option<WorldSummaryOutput>> {
        let world_id = normalize_id(world_id);
        if world_id.is_empty() {
            return Ok(None);
        }
        if let Some(summary) = self
            .working
            .get(&world_id)
            .map(|world| world.summary.clone())
        {
            if is_meaningful_world_name(&summary.name) {
                return Ok(Some(summary));
            }
            self.working.invalidate(&world_id);
        }
        let Some(summary) = world_cache_get(self.db.as_ref(), world_id.clone())? else {
            return Ok(None);
        };
        if !is_meaningful_world_name(&summary.name) {
            return Ok(None);
        }
        self.working.insert(
            world_id,
            Arc::new(CachedWorld {
                summary: summary.clone(),
                card_fields: None,
            }),
        );
        Ok(Some(summary))
    }

    pub fn get_cached_card_payload(&self, world_id: &str) -> Option<Value> {
        let world_id = normalize_id(world_id);
        if world_id.is_empty() {
            return None;
        }
        self.working
            .get(&world_id)
            .and_then(|world| world_card_payload(world.as_ref()))
    }

    pub fn search_summaries(
        &self,
        query: &str,
        limit: i64,
    ) -> crate::Result<Vec<WorldSummaryOutput>> {
        let summaries = world_cache_search(self.db.as_ref(), query, limit)?
            .into_iter()
            .filter(|summary| is_meaningful_world_name(&summary.name))
            .collect::<Vec<_>>();
        for summary in &summaries {
            if self.working.get(&summary.id).is_some() {
                continue;
            }
            self.working.insert(
                summary.id.clone(),
                Arc::new(CachedWorld {
                    summary: summary.clone(),
                    card_fields: None,
                }),
            );
        }
        Ok(summaries)
    }

    pub fn hydrate_from_payload(&self, world_value: &Value) -> Option<String> {
        self.hydrate_summary_from_payload(world_value)
            .map(|summary| summary.name)
    }

    pub fn hydrate_summary_from_payload(&self, world_value: &Value) -> Option<WorldSummaryOutput> {
        let (summary, entry) = self.hydrate_summary_from_payload_with_policy(world_value, false)?;
        if let Some(entry) = entry {
            let world_id = summary.id.clone();
            if let Err(error) = world_cache_upsert(self.db.as_ref(), entry) {
                tracing::warn!(world_id = %world_id, "WorldCache upsert failed: {error}");
            }
        }
        Some(summary)
    }

    fn hydrate_summary_from_payload_with_policy(
        &self,
        world_value: &Value,
        insert_private: bool,
    ) -> Option<(WorldSummaryOutput, Option<CacheEntityInput>)> {
        let world_id = world_id(world_value);
        if world_id.is_empty() {
            return None;
        }
        let name = world_name(world_value)?;
        let summary = world_summary(world_value, world_id.clone(), name.clone());
        self.working.insert(
            world_id.clone(),
            Arc::new(CachedWorld {
                summary: summary.clone(),
                card_fields: Some(world_card_fields(world_value)),
            }),
        );

        let persist = is_persistable_world(world_value, &name)
            || (insert_private && is_cacheable_private_world(world_value, &name));
        if !persist {
            return Some((summary, None));
        }
        let entry = CacheEntityInput {
            id: Value::String(world_id.clone()),
            author_id: value_or_null(world_value, "authorId"),
            author_name: value_or_null(world_value, "authorName"),
            created_at: value_or_null_with_fallback(world_value, "created_at", "createdAt"),
            description: value_or_null(world_value, "description"),
            image_url: value_or_null(world_value, "imageUrl"),
            name: Value::String(name.clone()),
            release_status: value_or_null(world_value, "releaseStatus"),
            thumbnail_image_url: value_or_null(world_value, "thumbnailImageUrl"),
            updated_at: value_or_null_with_fallback(world_value, "updated_at", "updatedAt"),
            version: value_or_null(world_value, "version"),
        };
        Some((summary, Some(entry)))
    }

    pub fn hydrate_favorite_payloads<'a>(
        &self,
        world_values: impl IntoIterator<Item = &'a Value>,
    ) -> Vec<Option<Value>> {
        let world_values = world_values.into_iter().collect::<Vec<_>>();
        let private_ids = world_values
            .iter()
            .filter_map(|world_value| {
                let name = world_name(world_value)?;
                is_cacheable_private_world(world_value, &name)
                    .then(|| world_id(world_value))
                    .filter(|id| !id.is_empty())
            })
            .collect::<HashSet<_>>();
        let private_ids_to_insert = if private_ids.is_empty() {
            HashSet::new()
        } else {
            match world_cache_get_many(
                self.db.as_ref(),
                &private_ids.iter().cloned().collect::<Vec<_>>(),
            ) {
                Ok(existing) => {
                    let existing = existing
                        .into_iter()
                        .map(|summary| summary.id)
                        .collect::<HashSet<_>>();
                    private_ids.difference(&existing).cloned().collect()
                }
                Err(error) => {
                    tracing::warn!("WorldCache private batch lookup failed: {error}");
                    HashSet::new()
                }
            }
        };
        let mut pending = Vec::new();
        let payloads = world_values
            .into_iter()
            .map(|world_value| {
                let id = world_id(world_value);
                let (summary, entry) = self.hydrate_summary_from_payload_with_policy(
                    world_value,
                    private_ids_to_insert.contains(&id),
                )?;
                pending.extend(entry);
                self.get_cached_card_payload(&summary.id)
            })
            .collect();
        if let Err(error) = world_cache_upsert_many(self.db.as_ref(), pending) {
            tracing::warn!("WorldCache batch upsert failed: {error}");
        }
        payloads
    }

    pub async fn resolve_name(
        &self,
        web: &WebClient,
        endpoint: &str,
        world_id: &str,
    ) -> Option<String> {
        if let Some(name) = self.get_name(world_id) {
            return Some(name);
        }
        self.resolve_summary(web, endpoint, world_id)
            .await
            .map(|summary| summary.name)
    }

    pub async fn resolve_summary(
        &self,
        web: &WebClient,
        endpoint: &str,
        world_id: &str,
    ) -> Option<WorldSummaryOutput> {
        let world_id = normalize_id(world_id);
        if world_id.is_empty() {
            return None;
        }
        if let Some(summary) = self.get_summary(&world_id).ok().flatten() {
            return Some(summary);
        }
        let endpoint = endpoint.trim();
        if endpoint.is_empty() {
            return None;
        }
        let key = resolve_key(endpoint, &world_id);
        match tokio::time::timeout(
            Duration::from_millis(WORLD_RESOLVE_FETCH_TIMEOUT_MS),
            self.get(web, endpoint, &world_id, false, false),
        )
        .await
        {
            Ok(Ok(response)) if (200..=299).contains(&response.status) => {
                self.get_summary(&world_id).ok().flatten()
            }
            Err(_) => {
                self.record_failure(&key);
                None
            }
            _ => None,
        }
    }

    pub async fn resolve_image_url(
        &self,
        web: &WebClient,
        endpoint: &str,
        world_id: &str,
    ) -> Option<String> {
        self.resolve_image_url_with(endpoint, world_id, |endpoint, world_id| async move {
            let (_, request) = world_get_input(endpoint, world_id)?;
            web.execute_api(request, ApiScope::Vrchat, self.db.as_ref())
                .await
        })
        .await
    }

    async fn resolve_image_url_with<F, Fut>(
        &self,
        endpoint: &str,
        world_id: &str,
        fetch: F,
    ) -> Option<String>
    where
        F: FnOnce(String, String) -> Fut,
        Fut: Future<Output = crate::Result<HttpApiExecuteResponse>>,
    {
        let world_id = normalize_id(world_id);
        if world_id.is_empty() {
            return None;
        }
        if let Some(image_url) = self.cached_image_url(&world_id) {
            return Some(image_url);
        }
        let endpoint = endpoint.trim();
        if endpoint.is_empty() {
            return None;
        }
        let key = resolve_key(endpoint, &world_id);
        if self.recently_failed(&key) {
            return None;
        }
        let inflight = self.inflight_lock(&key);
        let _guard = inflight.lock().await;
        if let Some(image_url) = self.cached_image_url(&world_id) {
            return Some(image_url);
        }
        if self.recently_failed(&key) {
            return None;
        }

        let response = match tokio::time::timeout(
            Duration::from_millis(WORLD_RESOLVE_FETCH_TIMEOUT_MS),
            fetch(key.endpoint.clone(), key.world_id.clone()),
        )
        .await
        {
            Ok(Ok(response)) => response,
            Ok(Err(_)) | Err(_) => {
                self.record_failure(&key);
                return None;
            }
        };
        if !(200..=299).contains(&response.status) {
            self.record_failure(&key);
            return None;
        }
        self.hydrate_response(&response);
        self.clear_failure(&key);
        self.cached_image_url(&world_id)
    }

    pub async fn get(
        &self,
        web: &WebClient,
        endpoint: &str,
        world_id: &str,
        force: bool,
        full: bool,
    ) -> crate::Result<HttpApiExecuteResponse> {
        let world_id = normalize_id(world_id);
        if world_id.is_empty() {
            return Err(crate::Error::Custom("World id is required.".into()));
        }
        if !force && !full {
            if let Some(summary) = self.get_summary(&world_id)? {
                return summary_response(&summary);
            }
        }

        let key = resolve_key(endpoint, &world_id);
        if !force && !full && self.recently_failed(&key) {
            return Err(crate::Error::Custom(format!(
                "World request recently failed: {world_id}"
            )));
        }
        let inflight = self.inflight_lock(&key);
        let _guard = inflight.lock().await;
        if !force && !full {
            if let Some(summary) = self.get_summary(&world_id)? {
                return summary_response(&summary);
            }
            if self.recently_failed(&key) {
                return Err(crate::Error::Custom(format!(
                    "World request recently failed: {world_id}"
                )));
            }
        }

        let (_, request) = world_get_input(key.endpoint.clone(), world_id.clone())?;
        let response = web
            .execute_api(request, ApiScope::Vrchat, self.db.as_ref())
            .await;
        match response {
            Ok(response) => {
                if (200..=299).contains(&response.status) {
                    self.hydrate_response(&response);
                    self.clear_failure(&key);
                } else {
                    self.record_failure(&key);
                }
                Ok(response)
            }
            Err(error) => {
                self.record_failure(&key);
                Err(error)
            }
        }
    }

    pub fn hydrate_response(&self, response: &HttpApiExecuteResponse) {
        if !(200..=299).contains(&response.status) {
            return;
        }
        if let Ok(world) = serde_json::from_str::<Value>(&response.data) {
            self.hydrate_from_payload(&world);
        }
    }

    fn recently_failed(&self, key: &WorldResolveKey) -> bool {
        self.failures.get(key).is_some()
    }

    fn cached_image_url(&self, world_id: &str) -> Option<String> {
        if let Some(image_url) = self
            .working
            .get(world_id)
            .and_then(|world| summary_image_url(&world.summary))
        {
            return Some(image_url);
        }
        match world_cache_get(self.db.as_ref(), world_id.to_string()) {
            Ok(Some(summary)) => {
                let image_url = summary_image_url(&summary);
                if is_meaningful_world_name(&summary.name) {
                    self.working.insert(
                        world_id.to_string(),
                        Arc::new(CachedWorld {
                            summary,
                            card_fields: None,
                        }),
                    );
                }
                image_url
            }
            Ok(None) => None,
            Err(error) => {
                tracing::warn!(world_id, "world image cache lookup failed: {error}");
                None
            }
        }
    }

    fn record_failure(&self, key: &WorldResolveKey) {
        self.failures.insert(key.clone(), ());
    }

    fn clear_failure(&self, key: &WorldResolveKey) {
        self.failures.invalidate(key);
    }

    fn inflight_lock(&self, key: &WorldResolveKey) -> Arc<tokio::sync::Mutex<()>> {
        let mut map = self
            .inflight
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(existing) = map.get(key).and_then(Weak::upgrade) {
            return existing;
        }
        map.retain(|_, weak| weak.strong_count() > 0);
        let lock = Arc::new(tokio::sync::Mutex::new(()));
        map.insert(key.clone(), Arc::downgrade(&lock));
        lock
    }
}

fn world_summary(value: &Value, id: String, name: String) -> WorldSummaryOutput {
    WorldSummaryOutput {
        id,
        author_id: text_field(value, "authorId"),
        author_name: text_field(value, "authorName"),
        created_at: text_field_with_fallback(value, "created_at", "createdAt").into(),
        description: text_field(value, "description"),
        image_url: text_field(value, "imageUrl"),
        name,
        release_status: text_field(value, "releaseStatus").into(),
        thumbnail_image_url: text_field(value, "thumbnailImageUrl"),
        updated_at: text_field_with_fallback(value, "updated_at", "updatedAt").into(),
        version: value
            .get("version")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
    }
}

fn world_card_fields(value: &Value) -> WorldCardFields {
    WorldCardFields {
        tags: value.get("tags").and_then(Value::as_array).map(|tags| {
            tags.iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        }),
        occupants: value.get("occupants").and_then(Value::as_i64),
    }
}

fn world_card_payload(world: &CachedWorld) -> Option<Value> {
    let card_fields = world.card_fields.as_ref()?;
    let mut payload = serde_json::to_value(&world.summary).ok()?;
    let fields = payload.as_object_mut()?;
    if let Some(tags) = &card_fields.tags {
        fields.insert("tags".to_string(), serde_json::to_value(tags).ok()?);
    }
    if let Some(occupants) = card_fields.occupants {
        fields.insert("occupants".to_string(), Value::from(occupants));
    }
    Some(payload)
}

fn summary_image_url(summary: &WorldSummaryOutput) -> Option<String> {
    let thumbnail = summary.thumbnail_image_url.trim();
    if !thumbnail.is_empty() {
        return Some(thumbnail.to_string());
    }
    let image = summary.image_url.trim();
    (!image.is_empty()).then(|| image.to_string())
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
    value
        .get(key)
        .or_else(|| value.get(fallback))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

fn normalize_id(value: &str) -> String {
    value.trim().to_string()
}

fn world_id(value: &Value) -> String {
    value
        .get("id")
        .or_else(|| value.get("worldId"))
        .and_then(Value::as_str)
        .map(normalize_id)
        .unwrap_or_default()
}

fn world_name(value: &Value) -> Option<String> {
    value
        .get("name")
        .or_else(|| value.get("worldName"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| is_meaningful_world_name(name))
        .map(ToString::to_string)
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

fn resolve_key(endpoint: &str, world_id: &str) -> WorldResolveKey {
    WorldResolveKey {
        endpoint: normalize_vrchat_api_endpoint(Some(endpoint)),
        world_id: world_id.to_string(),
    }
}

fn summary_response(summary: &WorldSummaryOutput) -> crate::Result<HttpApiExecuteResponse> {
    Ok(execute_response(200, serde_json::to_string(summary)?))
}

fn is_persistable_world(value: &Value, name: &str) -> bool {
    matches!(world_release_status(value), ReleaseStatus::Public)
        && is_persistable_world_fields(value, name)
}

fn is_cacheable_private_world(value: &Value, name: &str) -> bool {
    matches!(world_release_status(value), ReleaseStatus::Private)
        && is_persistable_world_fields(value, name)
}

fn world_release_status(value: &Value) -> ReleaseStatus {
    ReleaseStatus::from(
        value
            .get("releaseStatus")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default(),
    )
}

fn is_persistable_world_fields(value: &Value, name: &str) -> bool {
    let image_url = value
        .get("imageUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let thumbnail_image_url = value
        .get("thumbnailImageUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    is_meaningful_world_name(name) && (!image_url.is_empty() || !thumbnail_image_url.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use serde_json::json;
    use vrcx_0_persistence::cache_entities::CacheEntityInput;
    use vrcx_0_persistence::worlds::{world_cache_get, world_cache_remove, world_cache_upsert};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("vrcx-0-world-cache-{name}-{nonce}"));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn test_db(name: &str) -> (TestDir, Arc<DatabaseService>) {
        let dir = TestDir::new(name);
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
        (dir, db)
    }

    fn test_web(dir: &TestDir, db: &DatabaseService) -> WebClient {
        let storage =
            vrcx_0_persistence::storage::StorageService::new(&dir.path.join("storage.json"))
                .unwrap();
        WebClient::new(
            &storage,
            db,
            "wss://pipeline.vrchat.cloud".to_string(),
            env!("CARGO_PKG_VERSION"),
        )
        .unwrap()
    }

    fn world_entry(id: &str, name: &str, updated_at: &str) -> CacheEntityInput {
        CacheEntityInput {
            id: json!(id),
            author_id: json!(null),
            author_name: json!(null),
            created_at: json!("2026-01-01T00:00:00.000Z"),
            description: json!(null),
            image_url: json!("image.png"),
            name: json!(name),
            release_status: json!("public"),
            thumbnail_image_url: json!("thumb.png"),
            updated_at: json!(updated_at),
            version: json!(1),
        }
    }

    #[test]
    fn hydrate_from_payload_caches_bounded_card_fields_and_persists_summary() {
        let (_dir, db) = test_db("hydrate-name-only");
        let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

        let name = cache.hydrate_from_payload(&json!({
            "id": "wrld_heavy",
            "name": "Heavy World",
            "authorId": "usr_author",
            "authorName": "Author",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "description": "Summary detail",
            "imageUrl": "image.png",
            "releaseStatus": "public",
            "thumbnailImageUrl": "thumb.png",
            "updatedAt": "2026-01-02T00:00:00.000Z",
            "version": 7,
            "unityPackages": [{ "assetUrl": "https://example.test/large.bundle" }],
            "instances": [["123", 4]],
            "tags": ["author_tag_large"]
        }));

        assert_eq!(name.as_deref(), Some("Heavy World"));
        assert_eq!(cache.get_name("wrld_heavy").as_deref(), Some("Heavy World"));
        assert_eq!(
            cache
                .working
                .get("wrld_heavy")
                .map(|world| world.summary.name.clone())
                .as_deref(),
            Some("Heavy World")
        );
        let card = cache.get_cached_card_payload("wrld_heavy").unwrap();
        assert_eq!(card["tags"], json!(["author_tag_large"]));
        assert!(card.get("unityPackages").is_none());
        assert!(card.get("instances").is_none());
        cache.search_summaries("Heavy", 10).unwrap();
        assert_eq!(
            cache.get_cached_card_payload("wrld_heavy").unwrap()["tags"],
            json!(["author_tag_large"])
        );

        let row = world_cache_get(db.as_ref(), "wrld_heavy".into())
            .unwrap()
            .unwrap();
        assert_eq!(row.name, "Heavy World");
        assert_eq!(row.description, "Summary detail");
        assert_eq!(row.version, 7);
    }

    #[test]
    fn favorite_hydrate_inserts_private_summary_without_overwriting_existing_cache() {
        let (_dir, db) = test_db("favorite-private-summary");
        let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));
        let private_world = json!({
            "id": "wrld_private",
            "name": "Private World",
            "imageUrl": "private.png",
            "releaseStatus": "private"
        });

        cache.hydrate_favorite_payloads([&private_world]);
        assert_eq!(
            world_cache_get(db.as_ref(), "wrld_private".into())
                .unwrap()
                .unwrap()
                .name,
            "Private World"
        );

        world_cache_upsert(
            db.as_ref(),
            world_entry("wrld_private", "Existing World", "2026-01-02T00:00:00.000Z"),
        )
        .unwrap();
        cache.hydrate_favorite_payloads([&private_world]);

        assert_eq!(
            world_cache_get(db.as_ref(), "wrld_private".into())
                .unwrap()
                .unwrap()
                .name,
            "Existing World"
        );
    }

    #[test]
    fn hydrate_from_vrchat_payload_preserves_snake_case_timestamps() {
        let (_dir, db) = test_db("hydrate-vrchat-timestamps");
        let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

        cache.hydrate_from_payload(&json!({
            "id": "wrld_timestamps",
            "name": "Timestamped World",
            "created_at": "2026-01-01T00:00:00.000Z",
            "updated_at": "2026-01-02T00:00:00.000Z",
            "releaseStatus": "public",
            "imageUrl": "image.png"
        }));

        let row = world_cache_get(db.as_ref(), "wrld_timestamps".into())
            .unwrap()
            .unwrap();
        assert_eq!(row.created_at, "2026-01-01T00:00:00.000Z");
        assert_eq!(row.updated_at, "2026-01-02T00:00:00.000Z");
    }

    #[test]
    fn summary_lookup_starts_empty_then_loads_db_row_into_memory() {
        let (_dir, db) = test_db("summary-db-fallback");
        world_cache_upsert(
            db.as_ref(),
            world_entry("wrld_db_only", "DB Only World", "2026-01-02T00:00:00.000Z"),
        )
        .unwrap();
        let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

        assert_eq!(cache.get_name("wrld_db_only"), None);

        let summary = cache
            .get_summary("wrld_db_only")
            .unwrap()
            .expect("DB row should be loaded on demand");

        assert_eq!(summary.name, "DB Only World");
        world_cache_remove(db.as_ref(), "wrld_db_only".into()).unwrap();
        let memory_summary = cache
            .get_summary("wrld_db_only")
            .unwrap()
            .expect("memory hit should not query the removed DB row");
        assert_eq!(memory_summary.name, "DB Only World");
        assert_eq!(
            cache.get_name("wrld_db_only").as_deref(),
            Some("DB Only World")
        );
    }

    #[test]
    fn summary_lookup_ignores_invalid_db_shells() {
        let (_dir, db) = test_db("summary-invalid-shell");
        world_cache_upsert(
            db.as_ref(),
            world_entry("wrld_shell", "", "2026-01-02T00:00:00.000Z"),
        )
        .unwrap();
        let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

        assert!(cache.get_summary("wrld_shell").unwrap().is_none());
        assert_eq!(cache.get_name("wrld_shell"), None);
    }

    #[tokio::test]
    async fn summary_resolution_uses_db_before_remote_api() {
        let (dir, db) = test_db("summary-db-before-api");
        world_cache_upsert(
            db.as_ref(),
            world_entry(
                "wrld_db_first",
                "DB First World",
                "2026-01-02T00:00:00.000Z",
            ),
        )
        .unwrap();
        let web = test_web(&dir, db.as_ref());
        let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

        let summary = cache
            .resolve_summary(&web, "http://127.0.0.1:9/api/1", "wrld_db_first")
            .await
            .expect("DB row should resolve without remote API");

        assert_eq!(summary.name, "DB First World");
    }

    #[tokio::test]
    async fn ordinary_get_returns_db_summary_without_remote_api() {
        let (dir, db) = test_db("get-db-before-api");
        world_cache_upsert(
            db.as_ref(),
            world_entry("wrld_db_get", "DB Get World", "2026-01-02T00:00:00.000Z"),
        )
        .unwrap();
        let web = test_web(&dir, db.as_ref());
        let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

        let response = cache
            .get(
                &web,
                "http://127.0.0.1:9/api/1",
                "wrld_db_get",
                false,
                false,
            )
            .await
            .expect("ordinary get should use the DB summary");
        let payload = serde_json::from_str::<Value>(&response.data).unwrap();

        assert_eq!(response.status, 200);
        assert_eq!(payload["name"], "DB Get World");
    }

    #[tokio::test]
    async fn image_resolution_prefers_memory_thumbnail() {
        let (dir, db) = test_db("image-memory");
        let web = test_web(&dir, db.as_ref());
        let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));
        cache.hydrate_from_payload(&json!({
            "id": "wrld_memory_image",
            "name": "Memory World",
            "releaseStatus": "public",
            "imageUrl": "image.png",
            "thumbnailImageUrl": "thumb.png"
        }));

        assert_eq!(
            cache
                .resolve_image_url(&web, "http://127.0.0.1:9/api/1", "wrld_memory_image")
                .await
                .as_deref(),
            Some("thumb.png")
        );
    }

    #[tokio::test]
    async fn image_resolution_accepts_partial_db_row_without_world_name() {
        let (dir, db) = test_db("image-partial-db");
        world_cache_upsert(
            db.as_ref(),
            world_entry("wrld_partial_image", "", "2026-01-02T00:00:00.000Z"),
        )
        .unwrap();
        let web = test_web(&dir, db.as_ref());
        let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

        assert_eq!(
            cache
                .resolve_image_url(&web, "http://127.0.0.1:9/api/1", "wrld_partial_image")
                .await
                .as_deref(),
            Some("thumb.png")
        );
        assert_eq!(cache.get_name("wrld_partial_image"), None);
    }

    #[tokio::test]
    async fn concurrent_image_resolution_fetches_world_once() {
        let (_dir, db) = test_db("image-single-flight");
        let cache = WorldCache::new(db, 8, Duration::from_secs(60));
        let calls = Arc::new(AtomicUsize::new(0));
        let body = json!({
            "id": "wrld_single_flight",
            "name": "Single Flight World",
            "releaseStatus": "public",
            "imageUrl": "image.png",
            "thumbnailImageUrl": "thumb.png"
        })
        .to_string();

        let first_calls = Arc::clone(&calls);
        let first_body = body.clone();
        let first = cache.resolve_image_url_with(
            "https://api.vrchat.cloud/api/1",
            "wrld_single_flight",
            move |endpoint, world_id| async move {
                assert_eq!(endpoint, "https://api.vrchat.cloud/api/1");
                assert_eq!(world_id, "wrld_single_flight");
                first_calls.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(25)).await;
                Ok(execute_response(200, first_body))
            },
        );
        let second_calls = Arc::clone(&calls);
        let second = cache.resolve_image_url_with(
            "https://api.vrchat.cloud/api/1/",
            "wrld_single_flight",
            move |_, _| async move {
                second_calls.fetch_add(1, Ordering::SeqCst);
                Ok(execute_response(200, body))
            },
        );

        let (first_image, second_image) = tokio::join!(first, second);

        assert_eq!(first_image.as_deref(), Some("thumb.png"));
        assert_eq!(second_image.as_deref(), Some("thumb.png"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn image_resolution_respects_failure_cooldown() {
        let (_dir, db) = test_db("image-failure-cooldown");
        let cache = WorldCache::new(db, 8, Duration::from_secs(60));
        let calls = Arc::new(AtomicUsize::new(0));
        let first_calls = Arc::clone(&calls);

        let first = cache
            .resolve_image_url_with(
                "https://api.vrchat.cloud/api/1",
                "wrld_failure_cooldown",
                move |_, _| async move {
                    first_calls.fetch_add(1, Ordering::SeqCst);
                    Err(crate::Error::Custom("remote world lookup failed".into()))
                },
            )
            .await;
        let second_calls = Arc::clone(&calls);
        let second = cache
            .resolve_image_url_with(
                "https://api.vrchat.cloud/api/1",
                "wrld_failure_cooldown",
                move |_, _| async move {
                    second_calls.fetch_add(1, Ordering::SeqCst);
                    Ok(execute_response(
                        200,
                        json!({
                            "id": "wrld_failure_cooldown",
                            "name": "Unexpected Retry",
                            "releaseStatus": "public",
                            "imageUrl": "unexpected.png"
                        })
                        .to_string(),
                    ))
                },
            )
            .await;

        assert!(first.is_none());
        assert!(second.is_none());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn force_get_bypasses_cached_summary_and_preserves_it_on_failure() {
        let (dir, db) = test_db("force-bypasses-cache");
        world_cache_upsert(
            db.as_ref(),
            world_entry("wrld_force", "Cached World", "2026-01-02T00:00:00.000Z"),
        )
        .unwrap();
        let web = test_web(&dir, db.as_ref());
        let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

        assert!(cache
            .get(&web, "http://127.0.0.1:9/api/1", "wrld_force", true, false,)
            .await
            .is_err());
        assert_eq!(
            cache.get_summary("wrld_force").unwrap().unwrap().name,
            "Cached World"
        );
    }

    #[test]
    fn successful_remote_response_refreshes_memory_and_database_summary() {
        let (_dir, db) = test_db("hydrate-response");
        world_cache_upsert(
            db.as_ref(),
            world_entry("wrld_refresh", "Old World", "2026-01-02T00:00:00.000Z"),
        )
        .unwrap();
        let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

        cache.hydrate_response(&execute_response(
            200,
            json!({
                "id": "wrld_refresh",
                "name": "Fresh World",
                "releaseStatus": "public",
                "imageUrl": "fresh.png"
            })
            .to_string(),
        ));

        assert_eq!(
            cache.get_name("wrld_refresh").as_deref(),
            Some("Fresh World")
        );
        assert_eq!(
            cache
                .working
                .get("wrld_refresh")
                .and_then(|world| summary_image_url(&world.summary))
                .as_deref(),
            Some("fresh.png")
        );
        assert_eq!(
            world_cache_get(db.as_ref(), "wrld_refresh".into())
                .unwrap()
                .unwrap()
                .name,
            "Fresh World"
        );
    }

    #[test]
    fn resolve_guards_are_scoped_by_normalized_endpoint() {
        let (_dir, db) = test_db("endpoint-scoped-guards");
        let cache = WorldCache::new(db, 8, Duration::from_secs(60));
        let world_id = "wrld_shared";

        let first = resolve_key(" https://one.example/api/1/ ", world_id);
        let same = resolve_key("https://one.example/api/1", world_id);
        let other = resolve_key("https://two.example/api/1", world_id);

        cache.record_failure(&first);
        assert!(cache.recently_failed(&same));
        assert!(!cache.recently_failed(&other));

        let first_lock = cache.inflight_lock(&first);
        let same_lock = cache.inflight_lock(&same);
        let other_lock = cache.inflight_lock(&other);
        assert!(Arc::ptr_eq(&first_lock, &same_lock));
        assert!(!Arc::ptr_eq(&first_lock, &other_lock));
    }

    #[test]
    fn failure_cache_is_bounded() {
        let (_dir, db) = test_db("bounded-failures");
        let cache = WorldCache::new(db, 8, Duration::from_secs(60));
        assert_eq!(
            cache.failures.policy().max_capacity(),
            Some(WORLD_RESOLVE_FAILURE_CAPACITY)
        );
        assert_eq!(
            cache.failures.policy().time_to_live(),
            Some(WORLD_RESOLVE_FAILURE_TTL)
        );

        for index in 0..WORLD_RESOLVE_FAILURE_CAPACITY * 2 {
            cache.record_failure(&resolve_key(
                "https://api.example/api/1",
                &format!("wrld_{index}"),
            ));
        }
        cache.failures.run_pending_tasks();

        assert!(cache.failures.entry_count() <= WORLD_RESOLVE_FAILURE_CAPACITY);
    }

    #[test]
    fn capacity_bounds_every_hydrated_world() {
        let (_dir, db) = test_db("bounded-summaries");
        let cache = WorldCache::new(Arc::clone(&db), 1, Duration::from_secs(60));
        cache.hydrate_from_payload(&json!({
            "id": "wrld_first",
            "name": "First World",
            "releaseStatus": "public",
            "imageUrl": "image.png"
        }));
        cache.hydrate_from_payload(&json!({
            "id": "wrld_second",
            "name": "Second World",
            "releaseStatus": "public",
            "imageUrl": "image.png"
        }));
        cache.working.run_pending_tasks();

        assert!(cache.working.entry_count() <= 1);
    }
}
