use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex as AsyncMutex;
use vrcx_0_application_core::{
    vrchat_api::{normalize_text, VrchatApiResponse},
    Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, WorldCache,
};
use vrcx_0_core::json::RawJson;
use vrcx_0_core::vrchat_json::response_error_message;

use super::cache_policy::{
    cache_entry_from_entity, cache_write_decision, entity_id, release_status, CacheWriteDecision,
    FavoriteCacheKind,
};

const FAVORITE_DETAILS_PAGE_SIZE: i32 = 300;
const FAVORITE_DETAILS_MAX_PAGES: usize = 50;
const FAVORITE_DETAILS_PROBE_CONCURRENCY: usize = 3;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteDetailsHydrateKind {
    Avatar,
    World,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteDetailsHydrateInput {
    pub kind: FavoriteDetailsHydrateKind,
    #[serde(default)]
    pub favorite_ids: Vec<String>,
    #[serde(default)]
    pub requested_ids: Vec<String>,
    #[serde(default)]
    pub avatar_tags: Vec<String>,
    #[serde(default)]
    pub refresh_key: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteDetailsHydrateOutput {
    pub details_by_id: HashMap<String, RawJson>,
    pub availability_by_id: HashMap<String, String>,
    pub cached_count: u32,
    pub fetched_at: String,
}

struct FavoriteDetailsHydrateDeps<'a> {
    store: &'a dyn super::FavoriteStore,
    remote: &'a dyn super::FavoriteRemote,
    auth_scope: &'a RuntimeAuthScope,
    expected_scope: RuntimeAuthScopeSnapshot,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FavoriteWorldCacheKey {
    endpoint: String,
    generation: u64,
    refresh_key: String,
}

#[derive(Clone, Debug)]
struct FavoriteWorldCacheState {
    key: FavoriteWorldCacheKey,
    fetched_at: String,
}

struct FavoriteDetailsRuntimeInner {
    store: Arc<dyn super::FavoriteStore>,
    remote: Arc<dyn super::FavoriteRemote>,
    auth_scope: RuntimeAuthScope,
    world_cache: Arc<WorldCache>,
    world_cache_state: Mutex<Option<FavoriteWorldCacheState>>,
    world_sync_gate: AsyncMutex<()>,
}

#[derive(Clone)]
pub struct FavoriteDetailsRuntime {
    inner: Arc<FavoriteDetailsRuntimeInner>,
}

impl FavoriteDetailsRuntime {
    pub fn new(
        store: Arc<dyn super::FavoriteStore>,
        remote: Arc<dyn super::FavoriteRemote>,
        auth_scope: RuntimeAuthScope,
        world_cache: Arc<WorldCache>,
    ) -> Self {
        Self {
            inner: Arc::new(FavoriteDetailsRuntimeInner {
                store,
                remote,
                auth_scope,
                world_cache,
                world_cache_state: Mutex::new(None),
                world_sync_gate: AsyncMutex::new(()),
            }),
        }
    }

    pub async fn hydrate(
        &self,
        input: FavoriteDetailsHydrateInput,
        expected_scope: RuntimeAuthScopeSnapshot,
    ) -> Result<FavoriteDetailsHydrateOutput> {
        match input.kind {
            FavoriteDetailsHydrateKind::Avatar => self.hydrate_avatar(input, expected_scope).await,
            FavoriteDetailsHydrateKind::World => self.hydrate_world(input, expected_scope).await,
        }
    }

    async fn hydrate_avatar(
        &self,
        input: FavoriteDetailsHydrateInput,
        expected_scope: RuntimeAuthScopeSnapshot,
    ) -> Result<FavoriteDetailsHydrateOutput> {
        let deps = FavoriteDetailsHydrateDeps {
            store: self.inner.store.as_ref(),
            remote: self.inner.remote.as_ref(),
            auth_scope: &self.inner.auth_scope,
            expected_scope,
        };
        let entities = fetch_favorite_avatar_entities(&deps, &input.avatar_tags).await?;
        let details_by_id = filter_details_by_id(entities, &input.favorite_ids);
        let cached_count = persist_avatar_details(deps.store, &details_by_id);
        Ok(project_details(
            details_by_id,
            HashMap::new(),
            &input.requested_ids,
            cached_count,
            Utc::now().to_rfc3339(),
        ))
    }

    async fn hydrate_world(
        &self,
        input: FavoriteDetailsHydrateInput,
        expected_scope: RuntimeAuthScopeSnapshot,
    ) -> Result<FavoriteDetailsHydrateOutput> {
        let requested_ids = requested_favorite_ids(&input.favorite_ids, &input.requested_ids);
        let cache_key = FavoriteWorldCacheKey {
            endpoint: expected_scope.endpoint.clone(),
            generation: expected_scope.generation,
            refresh_key: input.refresh_key.trim().to_string(),
        };
        ensure_scope_matches(&self.inner.auth_scope.snapshot(), &expected_scope)?;
        if let Some(output) = self.cached_world_output(&cache_key, &requested_ids) {
            return Ok(output);
        }

        let _guard = self.inner.world_sync_gate.lock().await;
        ensure_scope_matches(&self.inner.auth_scope.snapshot(), &expected_scope)?;
        if let Some(output) = self.cached_world_output(&cache_key, &requested_ids) {
            return Ok(output);
        }

        let deps = FavoriteDetailsHydrateDeps {
            store: self.inner.store.as_ref(),
            remote: self.inner.remote.as_ref(),
            auth_scope: &self.inner.auth_scope,
            expected_scope,
        };
        let entities = fetch_favorite_world_entities(&deps).await?;
        let mut details_by_id = filter_details_by_id(entities, &input.favorite_ids);
        let availability_by_id =
            probe_missing_world_details(&deps, &requested_ids, &mut details_by_id).await?;
        let (details_by_id, cached_count) = hydrate_world_details(
            self.inner.world_cache.as_ref(),
            details_by_id,
            &requested_ids,
        );
        ensure_scope_matches(&deps.auth_scope.snapshot(), &deps.expected_scope)?;
        let fetched_at = Utc::now().to_rfc3339();
        *self
            .inner
            .world_cache_state
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(FavoriteWorldCacheState {
            key: cache_key,
            fetched_at: fetched_at.clone(),
        });
        Ok(project_details(
            details_by_id,
            availability_by_id,
            &requested_ids,
            cached_count,
            fetched_at,
        ))
    }

    fn cached_world_output(
        &self,
        key: &FavoriteWorldCacheKey,
        requested_ids: &[String],
    ) -> Option<FavoriteDetailsHydrateOutput> {
        let fetched_at = self
            .inner
            .world_cache_state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
            .filter(|state| state.key == *key)
            .map(|state| state.fetched_at.clone())?;
        let details_by_id = requested_ids
            .iter()
            .map(|id| {
                self.inner
                    .world_cache
                    .get_cached_card_payload(id)
                    .map(|detail| (id.clone(), detail))
            })
            .collect::<Option<HashMap<_, _>>>()?;
        Some(project_details(
            details_by_id,
            HashMap::new(),
            requested_ids,
            0,
            fetched_at,
        ))
    }
}

fn project_details(
    details_by_id: HashMap<String, Value>,
    availability_by_id: HashMap<String, String>,
    requested_ids: &[String],
    cached_count: u32,
    fetched_at: String,
) -> FavoriteDetailsHydrateOutput {
    let requested = normalize_ids(requested_ids)
        .into_iter()
        .collect::<HashSet<_>>();
    FavoriteDetailsHydrateOutput {
        details_by_id: details_by_id
            .into_iter()
            .filter(|(id, _)| requested.contains(id))
            .map(|(id, entity)| (id, RawJson::from(entity)))
            .collect(),
        availability_by_id: availability_by_id
            .into_iter()
            .filter(|(id, _)| requested.contains(id))
            .collect(),
        cached_count,
        fetched_at,
    }
}

fn normalize_ids(ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.iter()
        .map(normalize_text)
        .filter(|id| !id.is_empty())
        .filter(|id| seen.insert(id.clone()))
        .collect()
}

fn requested_favorite_ids(favorite_ids: &[String], requested_ids: &[String]) -> Vec<String> {
    let favorite_ids = normalize_ids(favorite_ids)
        .into_iter()
        .collect::<HashSet<_>>();
    normalize_ids(requested_ids)
        .into_iter()
        .filter(|id| favorite_ids.contains(id))
        .collect()
}

async fn probe_missing_world_details(
    deps: &FavoriteDetailsHydrateDeps<'_>,
    favorite_ids: &[String],
    details_by_id: &mut HashMap<String, Value>,
) -> Result<HashMap<String, String>> {
    let mut availability_by_id = HashMap::new();
    let mut probes = stream::iter(
        missing_world_ids(favorite_ids, details_by_id)
            .into_iter()
            .map(|id| async move {
                let outcome = probe_world(deps, &id).await;
                (id, outcome)
            }),
    )
    .buffer_unordered(FAVORITE_DETAILS_PROBE_CONCURRENCY);
    while let Some((id, outcome)) = probes.next().await {
        match outcome? {
            WorldProbeOutcome::Deleted => {
                availability_by_id.insert(id, "deleted".to_string());
            }
            WorldProbeOutcome::Available(entity, availability) => {
                availability_by_id.insert(id.clone(), availability);
                details_by_id.insert(id, entity);
            }
            WorldProbeOutcome::Failed => {}
        }
    }
    Ok(availability_by_id)
}

async fn probe_world(deps: &FavoriteDetailsHydrateDeps<'_>, id: &str) -> Result<WorldProbeOutcome> {
    match execute_json(
        deps,
        deps.remote
            .world(deps.expected_scope.endpoint.clone(), id.to_string()),
    )
    .await
    {
        Ok((status, payload)) => Ok(classify_world_probe(status, payload)),
        Err(error) => {
            ensure_scope_matches(&deps.auth_scope.snapshot(), &deps.expected_scope)?;
            tracing::warn!("world availability probe failed for {id}: {error}");
            Ok(WorldProbeOutcome::Failed)
        }
    }
}

fn missing_world_ids(
    favorite_ids: &[String],
    details_by_id: &HashMap<String, Value>,
) -> Vec<String> {
    let mut seen = HashSet::new();
    favorite_ids
        .iter()
        .map(normalize_text)
        .filter(|id| !id.is_empty())
        .filter(|id| seen.insert(id.clone()))
        .filter(|id| {
            details_by_id
                .get(id)
                .is_none_or(|entity| !has_displayable_detail(entity))
        })
        .collect()
}

fn has_displayable_detail(entity: &Value) -> bool {
    let display_fields = [
        "name",
        "authorName",
        "thumbnailImageUrl",
        "imageUrl",
        "description",
        "releaseStatus",
    ];
    if display_fields.iter().any(
        |field| matches!(entity.get(*field), Some(Value::String(text)) if !text.trim().is_empty()),
    ) {
        return true;
    }
    matches!(entity.get("tags"), Some(Value::Array(tags)) if !tags.is_empty())
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum WorldProbeOutcome {
    Available(Value, String),
    Deleted,
    Failed,
}

fn classify_world_probe(status: i32, payload: Value) -> WorldProbeOutcome {
    if status == 404 {
        return WorldProbeOutcome::Deleted;
    }
    if status >= 400 || payload.get("error").is_some() {
        return WorldProbeOutcome::Failed;
    }
    let availability = if release_status(&payload) == "public" {
        "public"
    } else {
        "private"
    };
    WorldProbeOutcome::Available(payload, availability.to_string())
}

async fn fetch_favorite_world_entities(
    deps: &FavoriteDetailsHydrateDeps<'_>,
) -> Result<Vec<Value>> {
    let mut entities = Vec::new();
    let mut offset = 0_i32;
    for _ in 0..FAVORITE_DETAILS_MAX_PAGES {
        let rows = execute_page(
            deps,
            deps.remote.favorite_worlds(
                deps.expected_scope.endpoint.clone(),
                FAVORITE_DETAILS_PAGE_SIZE,
                offset,
                String::new(),
                String::new(),
                String::new(),
            ),
            "favorite world detail sync",
        )
        .await?;
        let page_len = rows.len();
        entities.extend(rows);
        if page_len < FAVORITE_DETAILS_PAGE_SIZE as usize {
            break;
        }
        offset += FAVORITE_DETAILS_PAGE_SIZE;
    }
    Ok(entities)
}

async fn fetch_favorite_avatar_entities(
    deps: &FavoriteDetailsHydrateDeps<'_>,
    avatar_tags: &[String],
) -> Result<Vec<Value>> {
    let tags = normalize_avatar_tags(avatar_tags);
    let mut entities = Vec::new();
    let mut seen_ids = HashSet::new();
    for tag in tags {
        let mut offset = 0_i32;
        for _ in 0..FAVORITE_DETAILS_MAX_PAGES {
            let rows = execute_page(
                deps,
                deps.remote.favorite_avatars(
                    deps.expected_scope.endpoint.clone(),
                    FAVORITE_DETAILS_PAGE_SIZE,
                    offset,
                    tag.clone(),
                ),
                "favorite avatar detail sync",
            )
            .await?;
            let page_len = rows.len();
            merge_avatar_rows(rows, &mut seen_ids, &mut entities);
            if page_len < FAVORITE_DETAILS_PAGE_SIZE as usize {
                break;
            }
            offset += FAVORITE_DETAILS_PAGE_SIZE;
        }
    }
    Ok(entities)
}

async fn execute_json(
    deps: &FavoriteDetailsHydrateDeps<'_>,
    response: super::FavoriteRemoteFuture<'_, VrchatApiResponse>,
) -> Result<(i32, Value)> {
    ensure_scope_matches(&deps.auth_scope.snapshot(), &deps.expected_scope)?;
    let response = response.await?;
    ensure_scope_matches(&deps.auth_scope.snapshot(), &deps.expected_scope)?;
    let payload = serde_json::from_str::<Value>(&response.data)
        .unwrap_or_else(|_| Value::String(response.data.clone()));
    Ok((response.status, payload))
}

async fn execute_page(
    deps: &FavoriteDetailsHydrateDeps<'_>,
    response: super::FavoriteRemoteFuture<'_, VrchatApiResponse>,
    action: &str,
) -> Result<Vec<Value>> {
    let (status, payload) = execute_json(deps, response).await?;
    if status >= 400 || payload.get("error").is_some() {
        return Err(Error::Custom(response_error_message(
            &payload, status, action,
        )));
    }
    match payload {
        Value::Array(rows) => Ok(rows),
        _ => Ok(Vec::new()),
    }
}

fn normalize_avatar_tags(avatar_tags: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let tags = avatar_tags
        .iter()
        .map(normalize_text)
        .filter(|tag| !tag.is_empty())
        .filter(|tag| seen.insert(tag.clone()))
        .collect::<Vec<_>>();
    if tags.is_empty() {
        vec![String::new()]
    } else {
        tags
    }
}

fn merge_avatar_rows(rows: Vec<Value>, seen_ids: &mut HashSet<String>, entities: &mut Vec<Value>) {
    for row in rows {
        let id = entity_id(&row);
        if id.is_empty() || !seen_ids.insert(id) {
            continue;
        }
        entities.push(row);
    }
}

fn filter_details_by_id(entities: Vec<Value>, favorite_ids: &[String]) -> HashMap<String, Value> {
    let wanted = favorite_ids
        .iter()
        .map(normalize_text)
        .filter(|id| !id.is_empty())
        .collect::<HashSet<_>>();
    let mut details_by_id = HashMap::new();
    for entity in entities {
        let id = entity_id(&entity);
        if id.is_empty() {
            continue;
        }
        if !wanted.is_empty() && !wanted.contains(&id) {
            continue;
        }
        details_by_id.insert(id, entity);
    }
    details_by_id
}

fn hydrate_world_details(
    world_cache: &WorldCache,
    details_by_id: HashMap<String, Value>,
    requested_ids: &[String],
) -> (HashMap<String, Value>, u32) {
    let requested = normalize_ids(requested_ids)
        .into_iter()
        .collect::<HashSet<_>>();
    let mut projected = HashMap::new();
    let mut ordered_entities = Vec::with_capacity(details_by_id.len());
    let mut requested_entities = Vec::new();
    for (id, entity) in details_by_id {
        if requested.contains(&id) {
            requested_entities.push((id, entity));
        } else {
            ordered_entities.push((id, entity));
        }
    }
    ordered_entities.extend(requested_entities);
    let payloads =
        world_cache.hydrate_favorite_payloads(ordered_entities.iter().map(|(_, entity)| entity));
    let cached_count = payloads.iter().filter(|payload| payload.is_some()).count() as u32;
    for ((id, _), detail) in ordered_entities.into_iter().zip(payloads) {
        if requested.contains(&id) {
            let Some(detail) = detail else {
                continue;
            };
            projected.insert(id, detail);
        }
    }
    (projected, cached_count)
}

fn persist_avatar_details(
    store: &dyn super::FavoriteStore,
    details_by_id: &HashMap<String, Value>,
) -> u32 {
    let writable = details_by_id
        .iter()
        .map(|(id, entity)| {
            (
                id,
                entity,
                cache_write_decision(FavoriteCacheKind::Avatar, entity),
            )
        })
        .filter(|(_, _, decision)| *decision != CacheWriteDecision::Skip)
        .collect::<Vec<_>>();

    let insert_candidates = writable
        .iter()
        .filter(|(_, _, decision)| *decision == CacheWriteDecision::InsertIfMissing)
        .map(|(id, _, _)| (*id).clone())
        .collect::<Vec<_>>();
    let existing_ids: Option<HashSet<String>> = if insert_candidates.is_empty() {
        Some(HashSet::new())
    } else {
        match store.avatar_cache_existing_ids(&insert_candidates) {
            Ok(ids) => Some(ids.into_iter().collect()),
            Err(error) => {
                tracing::warn!("failed to read favorite avatar cache: {error}");
                None
            }
        }
    };

    let entries = writable
        .into_iter()
        .filter(|(id, _, decision)| match decision {
            CacheWriteDecision::InsertIfMissing => existing_ids
                .as_ref()
                .is_some_and(|existing| !existing.contains(*id)),
            _ => true,
        })
        .map(|(id, entity, _)| cache_entry_from_entity(entity, id))
        .collect::<Vec<_>>();

    match store.avatar_cache_upsert_many(entries) {
        Ok(cached_count) => cached_count,
        Err(error) => {
            tracing::warn!("failed to cache favorite avatar details: {error}");
            0
        }
    }
}

fn ensure_scope_matches(
    current: &RuntimeAuthScopeSnapshot,
    expected: &RuntimeAuthScopeSnapshot,
) -> Result<()> {
    crate::scope_gate::ensure_snapshot_scope_matches(current, expected, "Favorite detail hydrate")
}

#[cfg(test)]
mod tests;
