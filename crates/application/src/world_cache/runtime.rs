use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use moka::sync::Cache;
use serde_json::Value;
use vrcx_0_persistence::cache_entities::CacheEntityInput;
use vrcx_0_persistence::favorites::favorite_list;
use vrcx_0_persistence::worlds::{
    world_cache_get_many, world_cache_list_recent, world_cache_upsert, WorldSummaryOutput,
};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::ApiScope;
use vrcx_0_vrchat_client::worlds::world_get_input;

use crate::web_client::WebClient;
use vrcx_0_core::location::is_meaningful_world_name;

const WORLD_RESOLVE_FETCH_TIMEOUT_MS: u64 = 5_000;
const WORLD_RESOLVE_FAILURE_TTL_MS: u64 = 60_000;

pub struct WorldCache {
    favorites: Mutex<HashMap<String, Arc<CachedWorld>>>,
    working: Cache<String, Arc<CachedWorld>>,
    working_init_limit: usize,
    db: Arc<DatabaseService>,
    inflight: Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>,
    failures: Mutex<HashMap<String, Instant>>,
}

struct CachedWorld {
    name: Option<String>,
}

impl WorldCache {
    pub fn new(db: Arc<DatabaseService>, capacity: u64, working_ttl: Duration) -> Self {
        let capacity = capacity.max(1);
        Self {
            favorites: Mutex::new(HashMap::new()),
            working: Cache::builder()
                .max_capacity(capacity)
                .time_to_live(working_ttl)
                .build(),
            working_init_limit: usize::try_from(capacity).unwrap_or(usize::MAX),
            db,
            inflight: Mutex::new(HashMap::new()),
            failures: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn init_load(&self) {
        let favorite_ids = self.load_favorite_ids();
        let favorite_rows = self.load_world_rows(&favorite_ids);
        let recent_limit = i64::try_from(self.working_init_limit).unwrap_or(i64::MAX);
        let recent_rows = match world_cache_list_recent(self.db.as_ref(), recent_limit) {
            Ok(rows) => rows,
            Err(error) => {
                tracing::warn!("WorldCache init load failed: {error}");
                Vec::new()
            }
        };

        self.working.invalidate_all();
        let mut favorites = self
            .favorites
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        favorites.clear();
        for world_id in &favorite_ids {
            favorites.insert(world_id.clone(), cached_placeholder());
        }
        for row in favorite_rows {
            let world_id = normalize_id(&row.id);
            if world_id.is_empty() || !is_meaningful_world_name(&row.name) {
                continue;
            }
            favorites.insert(world_id, cached_summary(&row));
        }
        drop(favorites);

        for row in recent_rows {
            let world_id = normalize_id(&row.id);
            if world_id.is_empty() || !is_meaningful_world_name(&row.name) {
                continue;
            }
            if !favorite_ids.contains(&world_id) {
                self.working.insert(world_id, cached_summary(&row));
            }
        }
    }

    pub(crate) fn sync_favorites_from_db(&self) {
        let favorite_ids = self.load_favorite_ids().into_iter().collect::<Vec<_>>();
        self.set_favorites(&favorite_ids);
    }

    pub(crate) fn set_favorites(&self, world_ids: &[String]) {
        let desired = world_ids
            .iter()
            .map(|id| normalize_id(id))
            .filter(|id| !id.is_empty())
            .collect::<HashSet<_>>();

        let mut missing_ids = Vec::new();
        let mut demoted = Vec::new();
        {
            let mut favorites = self
                .favorites
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            favorites.retain(|world_id, cached| {
                if desired.contains(world_id) {
                    true
                } else {
                    demoted.push((world_id.clone(), Arc::clone(cached)));
                    false
                }
            });
            for world_id in &desired {
                if favorites.contains_key(world_id) {
                    continue;
                }
                if let Some(cached) = self.working.get(world_id) {
                    favorites.insert(world_id.clone(), cached);
                    self.working.invalidate(world_id);
                } else {
                    favorites.insert(world_id.clone(), cached_placeholder());
                    missing_ids.push(world_id.clone());
                }
            }
        }
        for (world_id, cached) in demoted {
            if cached.name.is_some() {
                self.working.insert(world_id, cached);
            }
        }
        let rows = self.load_world_rows(&missing_ids);
        let mut favorites = self
            .favorites
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for row in rows {
            let world_id = normalize_id(&row.id);
            if world_id.is_empty() || !is_meaningful_world_name(&row.name) {
                continue;
            }
            if favorites.contains_key(&world_id) {
                favorites.insert(world_id, cached_summary(&row));
            }
        }
    }

    pub(crate) fn clear_working(&self) {
        self.working.invalidate_all();
    }

    pub fn get_name(&self, world_id: &str) -> Option<String> {
        let world_id = normalize_id(world_id);
        if world_id.is_empty() {
            return None;
        }
        if let Some(name) = self
            .favorite(&world_id)
            .and_then(|world| world.name.clone())
        {
            return Some(name);
        }
        if let Some(name) = self
            .working
            .get(&world_id)
            .and_then(|world| world.name.clone())
        {
            return Some(name);
        }
        None
    }

    pub(crate) fn hydrate_from_payload(&self, world_value: &Value) -> Option<String> {
        let world_id = world_id(world_value);
        if world_id.is_empty() {
            return None;
        }
        let name = world_name(world_value)?;
        let cached = Arc::new(CachedWorld {
            name: Some(name.clone()),
        });
        let mut favorites = self
            .favorites
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if favorites.contains_key(&world_id) {
            favorites.insert(world_id.clone(), Arc::clone(&cached));
        } else {
            self.working.insert(world_id.clone(), Arc::clone(&cached));
        }
        drop(favorites);

        if is_persistable_world(world_value, &name) {
            let entry = CacheEntityInput {
                id: Value::String(world_id.clone()),
                author_id: value_or_null(world_value, "authorId"),
                author_name: value_or_null(world_value, "authorName"),
                created_at: value_or_null(world_value, "createdAt"),
                description: value_or_null(world_value, "description"),
                image_url: value_or_null(world_value, "imageUrl"),
                name: Value::String(name.clone()),
                release_status: value_or_null(world_value, "releaseStatus"),
                thumbnail_image_url: value_or_null(world_value, "thumbnailImageUrl"),
                updated_at: value_or_null(world_value, "updatedAt"),
                version: value_or_null(world_value, "version"),
            };
            if let Err(error) = world_cache_upsert(self.db.as_ref(), entry) {
                tracing::warn!(world_id = %world_id, "WorldCache upsert failed: {error}");
            }
        }
        Some(name)
    }

    pub async fn resolve_name(
        &self,
        web: &WebClient,
        endpoint: &str,
        world_id: &str,
    ) -> Option<String> {
        let world_id = normalize_id(world_id);
        if world_id.is_empty() {
            return None;
        }
        if let Some(name) = self.get_name(&world_id) {
            return Some(name);
        }
        let endpoint = endpoint.trim();
        if endpoint.is_empty() {
            return None;
        }
        if self.recently_failed(&world_id) {
            return None;
        }
        let inflight = self.inflight_lock(&world_id);
        let _guard = inflight.lock().await;
        if let Some(name) = self.get_name(&world_id) {
            return Some(name);
        }
        if self.recently_failed(&world_id) {
            return None;
        }
        match self.fetch_world_name(web, endpoint, &world_id).await {
            Some(name) => {
                self.clear_failure(&world_id);
                Some(name)
            }
            None => {
                self.record_failure(&world_id);
                None
            }
        }
    }

    async fn fetch_world_name(
        &self,
        web: &WebClient,
        endpoint: &str,
        world_id: &str,
    ) -> Option<String> {
        let (_, request) = world_get_input(endpoint.to_string(), world_id.to_string()).ok()?;
        let response = tokio::time::timeout(
            Duration::from_millis(WORLD_RESOLVE_FETCH_TIMEOUT_MS),
            web.execute_api(request, ApiScope::Vrchat, self.db.as_ref()),
        )
        .await
        .ok()?
        .ok()?;
        if !(200..=299).contains(&response.status) {
            return None;
        }
        let world = serde_json::from_str::<Value>(&response.data).ok()?;
        self.hydrate_from_payload(&world)
    }

    fn recently_failed(&self, world_id: &str) -> bool {
        self.failures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(world_id)
            .is_some_and(|at| at.elapsed() < Duration::from_millis(WORLD_RESOLVE_FAILURE_TTL_MS))
    }

    fn record_failure(&self, world_id: &str) {
        let mut map = self
            .failures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        map.retain(|_, at| at.elapsed() < Duration::from_millis(WORLD_RESOLVE_FAILURE_TTL_MS));
        map.insert(world_id.to_string(), Instant::now());
    }

    fn clear_failure(&self, world_id: &str) {
        self.failures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(world_id);
    }

    fn inflight_lock(&self, world_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut map = self
            .inflight
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(existing) = map.get(world_id).and_then(Weak::upgrade) {
            return existing;
        }
        map.retain(|_, weak| weak.strong_count() > 0);
        let lock = Arc::new(tokio::sync::Mutex::new(()));
        map.insert(world_id.to_string(), Arc::downgrade(&lock));
        lock
    }

    fn load_favorite_ids(&self) -> HashSet<String> {
        match favorite_list(self.db.as_ref(), "world".into()) {
            Ok(rows) => rows
                .into_iter()
                .filter_map(|row| {
                    row.get("worldId")
                        .and_then(Value::as_str)
                        .map(normalize_id)
                        .filter(|id| !id.is_empty())
                })
                .collect(),
            Err(error) => {
                tracing::warn!("WorldCache favorite load failed: {error}");
                HashSet::new()
            }
        }
    }

    fn load_world_rows(
        &self,
        world_ids: impl IntoIterator<Item = impl AsRef<str>>,
    ) -> Vec<WorldSummaryOutput> {
        let world_ids = world_ids
            .into_iter()
            .map(|id| normalize_id(id.as_ref()))
            .filter(|id| !id.is_empty())
            .collect::<Vec<_>>();
        if world_ids.is_empty() {
            return Vec::new();
        }
        match world_cache_get_many(self.db.as_ref(), &world_ids) {
            Ok(rows) => rows,
            Err(error) => {
                tracing::warn!("WorldCache row batch load failed: {error}");
                Vec::new()
            }
        }
    }

    fn favorite(&self, world_id: &str) -> Option<Arc<CachedWorld>> {
        self.favorites
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(world_id)
            .cloned()
    }
}

fn cached_summary(row: &WorldSummaryOutput) -> Arc<CachedWorld> {
    Arc::new(CachedWorld {
        name: Some(row.name.clone()),
    })
}

fn cached_placeholder() -> Arc<CachedWorld> {
    Arc::new(CachedWorld { name: None })
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

fn is_persistable_world(value: &Value, name: &str) -> bool {
    let release_status = value
        .get("releaseStatus")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
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
    release_status == "public"
        && is_meaningful_world_name(name)
        && (!image_url.is_empty() || !thumbnail_image_url.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    use serde_json::json;
    use vrcx_0_persistence::cache_entities::CacheEntityInput;
    use vrcx_0_persistence::favorites::favorite_add;
    use vrcx_0_persistence::worlds::{world_cache_get, world_cache_upsert};

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
    fn hydrate_from_payload_caches_name_only_and_persists_summary() {
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
                .and_then(|world| world.name.clone())
                .as_deref(),
            Some("Heavy World")
        );

        let row = world_cache_get(db.as_ref(), "wrld_heavy".into())
            .unwrap()
            .unwrap();
        assert_eq!(row.name, "Heavy World");
        assert_eq!(row.description, "Summary detail");
        assert_eq!(row.version, 7);
    }

    #[test]
    fn set_favorites_promotes_working_and_demotes_removed() {
        let (_dir, db) = test_db("set-favorites");
        let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));
        cache.hydrate_from_payload(&json!({
            "id": "wrld_promote",
            "name": "Promoted World",
            "releaseStatus": "public",
            "imageUrl": "image.png"
        }));

        cache.set_favorites(&["wrld_promote".to_string()]);
        cache.clear_working();

        assert_eq!(
            cache.get_name("wrld_promote").as_deref(),
            Some("Promoted World")
        );

        cache.set_favorites(&[]);
        cache.clear_working();

        assert_eq!(cache.get_name("wrld_promote"), None);
    }

    #[test]
    fn set_favorites_loads_missing_rows_from_db() {
        let (_dir, db) = test_db("set-favorites-db");
        world_cache_upsert(
            db.as_ref(),
            world_entry("wrld_cached", "Cached Favorite", "2026-01-02T00:00:00.000Z"),
        )
        .unwrap();
        let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

        cache.set_favorites(&["wrld_cached".to_string()]);

        assert_eq!(
            cache.get_name("wrld_cached").as_deref(),
            Some("Cached Favorite")
        );
    }

    #[test]
    fn init_load_preserves_unknown_favorite_pin_for_later_hydration() {
        let (_dir, db) = test_db("init-placeholder-favorite");
        favorite_add(
            db.as_ref(),
            "world".into(),
            "wrld_unknown".into(),
            "Favorites".into(),
        )
        .unwrap();
        let cache = WorldCache::new(Arc::clone(&db), 1, Duration::from_secs(60));

        cache.init_load();
        cache.hydrate_from_payload(&json!({
            "id": "wrld_unknown",
            "name": "Hydrated Favorite",
            "releaseStatus": "public",
            "imageUrl": "image.png"
        }));
        cache.clear_working();

        assert_eq!(
            cache.get_name("wrld_unknown").as_deref(),
            Some("Hydrated Favorite")
        );
    }
}
