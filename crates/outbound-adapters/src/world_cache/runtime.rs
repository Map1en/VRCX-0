use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::thread;
use std::time::{Duration, Instant};

use moka::policy::EvictionPolicy;
use moka::sync::Cache;
use serde_json::Value;
use vrcx_0_core::ReleaseStatus;
use vrcx_0_persistence::cache_entities::CacheEntityInput;
use vrcx_0_persistence::worlds::{
    world_cache_get, world_cache_search, world_cache_upsert_many, WorldSummaryOutput,
};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::{
    execute_response, normalize_vrchat_api_endpoint, ApiScope, HttpApiExecuteResponse,
};
use vrcx_0_vrchat_client::worlds::world_get_input;

use vrcx_0_application_core::WebClient;
use vrcx_0_core::location::is_meaningful_world_name;

const WORLD_RESOLVE_FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const WORLD_RESOLVE_FAILURE_TTL: Duration = Duration::from_secs(60);
const WORLD_RESOLVE_FAILURE_CAPACITY: u64 = 32;
const WORLD_CACHE_WRITE_RETRY_INTERVAL: Duration = Duration::from_secs(1);
const WORLD_CACHE_WRITE_RETRY_LOG_INTERVAL: Duration = Duration::from_secs(30);

pub struct WorldCache {
    working: Cache<String, Arc<CachedWorld>>,
    db: Arc<DatabaseService>,
    pending_writes: Arc<PendingWorldWrites>,
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

struct PendingWorldWrites {
    db: Arc<DatabaseService>,
    entries: Mutex<HashMap<String, (u64, CacheEntityInput)>>,
    next_generation: AtomicU64,
    flush_lock: Mutex<()>,
}

impl PendingWorldWrites {
    fn enqueue(&self, entries: impl IntoIterator<Item = CacheEntityInput>) {
        let mut pending = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        for entry in entries {
            let Some(id) = entry.id.as_str().map(str::trim).filter(|id| !id.is_empty()) else {
                tracing::warn!("Skipping world cache retry entry without an id");
                continue;
            };
            let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
            pending.insert(id.to_owned(), (generation, entry));
        }
    }

    fn flush(&self) -> crate::Result<()> {
        let _flush = self
            .flush_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let snapshot = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .iter()
            .map(|(id, (generation, entry))| (id.clone(), *generation, entry.clone()))
            .collect::<Vec<_>>();
        if snapshot.is_empty() {
            return Ok(());
        }
        world_cache_upsert_many(
            self.db.as_ref(),
            snapshot.iter().map(|(_, _, entry)| entry.clone()).collect(),
        )
        .map_err(crate::map_persistence_error)?;
        let mut pending = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        for (id, generation, _) in snapshot {
            if pending
                .get(&id)
                .is_some_and(|(pending_generation, _)| *pending_generation == generation)
            {
                pending.remove(&id);
            }
        }
        Ok(())
    }

    fn start_retry_worker(pending: &Arc<Self>) {
        let weak = Arc::downgrade(pending);
        if let Err(error) = thread::Builder::new()
            .name("world-cache-write-retry".into())
            .spawn(move || {
                let mut last_warning: Option<Instant> = None;
                loop {
                    thread::sleep(WORLD_CACHE_WRITE_RETRY_INTERVAL);
                    let Some(pending) = weak.upgrade() else {
                        break;
                    };
                    if pending
                        .entries
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .is_empty()
                    {
                        last_warning = None;
                        continue;
                    }
                    if let Err(error) = pending.flush() {
                        let should_warn = last_warning
                            .map(|last| last.elapsed() >= WORLD_CACHE_WRITE_RETRY_LOG_INTERVAL)
                            .unwrap_or(true);
                        if should_warn {
                            tracing::warn!(error = %error, "World cache persistence retry failed; latest entries remain queued");
                            last_warning = Some(Instant::now());
                        } else {
                            tracing::debug!(error = %error, "World cache persistence retry failed; latest entries remain queued");
                        }
                    } else {
                        last_warning = None;
                    }
                }
            })
        {
            tracing::error!(error = %error, "World cache persistence retry worker could not start");
        }
    }
}

impl WorldCache {
    pub fn new(db: Arc<DatabaseService>, capacity: u64, working_ttl: Duration) -> Self {
        let capacity = capacity.max(1);
        let pending_writes = Arc::new(PendingWorldWrites {
            db: Arc::clone(&db),
            entries: Mutex::new(HashMap::new()),
            next_generation: AtomicU64::new(0),
            flush_lock: Mutex::new(()),
        });
        PendingWorldWrites::start_retry_worker(&pending_writes);
        Self {
            working: Cache::builder()
                .max_capacity(capacity)
                .time_to_live(working_ttl)
                .build(),
            db,
            pending_writes,
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
        let Some(summary) = world_cache_get(self.db.as_ref(), world_id.clone())
            .map_err(crate::map_persistence_error)?
        else {
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
        let summaries = world_cache_search(self.db.as_ref(), query, limit)
            .map_err(crate::map_persistence_error)?
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
        let (summary, entry) = self.hydrate_summary_from_payload_with_entry(world_value)?;
        if let Some(entry) = entry {
            let world_id = summary.id.clone();
            if let Err(error) = self.persist_entries([entry]) {
                tracing::debug!(world_id = %world_id, "WorldCache upsert failed and was queued for retry: {error}");
            }
        }
        Some(summary)
    }

    pub fn store_from_payload(&self, world_value: &Value) -> crate::Result<Option<String>> {
        let Some((summary, entry)) = self.hydrate_summary_from_payload_with_entry(world_value)
        else {
            return Ok(None);
        };
        if let Some(entry) = entry {
            if let Err(error) = self.persist_entries([entry]) {
                tracing::debug!("WorldCache upsert failed and was queued for retry: {error}");
            }
        }
        Ok(Some(summary.name))
    }

    fn hydrate_summary_from_payload_with_entry(
        &self,
        world_value: &Value,
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

        if !is_persistable_world(world_value, &name) {
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
        let mut pending = Vec::new();
        let payloads = world_values
            .into_iter()
            .map(|world_value| {
                let (summary, entry) = self.hydrate_summary_from_payload_with_entry(world_value)?;
                pending.extend(entry);
                self.get_cached_card_payload(&summary.id)
            })
            .collect();
        if let Err(error) = self.persist_entries(pending) {
            tracing::debug!("WorldCache batch upsert failed and was queued for retry: {error}");
        }
        payloads
    }

    fn persist_entries(
        &self,
        entries: impl IntoIterator<Item = CacheEntityInput>,
    ) -> crate::Result<()> {
        self.pending_writes.enqueue(entries);
        self.pending_writes.flush()
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
            WORLD_RESOLVE_FETCH_TIMEOUT,
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
            let (_, request) =
                world_get_input(endpoint, world_id).map_err(crate::map_http_api_error)?;
            web.execute_api(request, ApiScope::Vrchat).await
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
            WORLD_RESOLVE_FETCH_TIMEOUT,
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

        let (_, request) = world_get_input(key.endpoint.clone(), world_id.clone())
            .map_err(crate::map_http_api_error)?;
        let response = web.execute_api(request, ApiScope::Vrchat).await;
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

#[async_trait::async_trait]
impl vrcx_0_application_core::WorldCachePort for WorldCache {
    fn clear_working(&self) {
        WorldCache::clear_working(self);
    }

    fn get_name(&self, world_id: &str) -> Option<String> {
        WorldCache::get_name(self, world_id)
    }

    fn get_summary(
        &self,
        world_id: &str,
    ) -> crate::Result<Option<vrcx_0_contracts::WorldSummaryOutput>> {
        WorldCache::get_summary(self, world_id)
    }

    fn get_cached_card_payload(&self, world_id: &str) -> Option<Value> {
        WorldCache::get_cached_card_payload(self, world_id)
    }

    fn search_summaries(
        &self,
        query: &str,
        limit: i64,
    ) -> crate::Result<Vec<vrcx_0_contracts::WorldSummaryOutput>> {
        WorldCache::search_summaries(self, query, limit)
    }

    fn hydrate_from_payload(&self, world_value: &Value) -> Option<String> {
        WorldCache::hydrate_from_payload(self, world_value)
    }

    fn hydrate_summary_from_payload(
        &self,
        world_value: &Value,
    ) -> Option<vrcx_0_contracts::WorldSummaryOutput> {
        WorldCache::hydrate_summary_from_payload(self, world_value)
    }

    fn store_from_payload(&self, world_value: &Value) -> crate::Result<Option<String>> {
        WorldCache::store_from_payload(self, world_value)
    }

    fn hydrate_favorite_payloads(&self, world_values: &[Value]) -> Vec<Option<Value>> {
        WorldCache::hydrate_favorite_payloads(self, world_values.iter())
    }

    async fn resolve_name(
        &self,
        web: &WebClient,
        endpoint: &str,
        world_id: &str,
    ) -> Option<String> {
        WorldCache::resolve_name(self, web, endpoint, world_id).await
    }

    async fn resolve_summary(
        &self,
        web: &WebClient,
        endpoint: &str,
        world_id: &str,
    ) -> Option<vrcx_0_contracts::WorldSummaryOutput> {
        WorldCache::resolve_summary(self, web, endpoint, world_id).await
    }

    async fn resolve_image_url(
        &self,
        web: &WebClient,
        endpoint: &str,
        world_id: &str,
    ) -> Option<String> {
        WorldCache::resolve_image_url(self, web, endpoint, world_id).await
    }

    async fn get(
        &self,
        web: &WebClient,
        endpoint: &str,
        world_id: &str,
        force: bool,
        full: bool,
    ) -> crate::Result<vrcx_0_contracts::VrchatResponse> {
        WorldCache::get(self, web, endpoint, world_id, force, full).await
    }

    fn hydrate_response(&self, response: &vrcx_0_contracts::VrchatResponse) {
        WorldCache::hydrate_response(self, response);
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
    matches!(
        world_release_status(value),
        ReleaseStatus::Public | ReleaseStatus::Private
    ) && is_persistable_world_fields(value, name)
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
mod tests;
