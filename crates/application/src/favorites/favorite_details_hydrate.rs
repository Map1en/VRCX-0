use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::Utc;
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex as AsyncMutex;
use vrcx_0_application_core::{
    vrchat_api::normalize_text, AvatarCache, Error, Result, RuntimeAuthScope,
    RuntimeAuthScopeSnapshot, TaskSupervisor, WorldCache,
};
use vrcx_0_contracts::vrchat_api::VrchatResponse;
use vrcx_0_core::json::RawJson;
use vrcx_0_core::vrchat_json::response_error_message;

use super::cache_policy::{
    cache_entry_from_entity, cache_write_decision, entity_id, release_status, CacheWriteDecision,
    FavoriteCacheKind,
};
use super::favorite_world_cards::{FavoriteWorldCard, FavoriteWorldCardCache};
use crate::scope_gate::ScopeGate;

const GATE: ScopeGate = ScopeGate::new("Favorite detail hydrate");

const FAVORITE_DETAILS_PAGE_SIZE: i32 = 300;
const FAVORITE_WORLD_GROUP_PAGE_SIZE: i32 = 100;
const FAVORITE_DETAILS_MAX_PAGES: usize = 50;
const FAVORITE_DETAILS_PROBE_CONCURRENCY: usize = 3;
const WORLD_AVAILABILITY_UNVERIFIED: &str = "unverified";

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
    pub group_tags: Vec<String>,
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
    remote: &'a dyn super::FavoriteRemote,
    auth_scope: &'a RuntimeAuthScope,
    expected_scope: RuntimeAuthScopeSnapshot,
}

struct FavoriteDetailsRuntimeInner {
    remote: Arc<dyn super::FavoriteRemote>,
    auth_scope: RuntimeAuthScope,
    world_cache: Arc<WorldCache>,
    avatar_cache: Arc<AvatarCache>,
    world_cards: Arc<FavoriteWorldCardCache>,
    tasks: TaskSupervisor,
    world_sync_gate: AsyncMutex<()>,
}

#[derive(Clone)]
pub struct FavoriteDetailsRuntime {
    inner: Arc<FavoriteDetailsRuntimeInner>,
}

impl FavoriteDetailsRuntime {
    pub fn new(
        remote: Arc<dyn super::FavoriteRemote>,
        auth_scope: RuntimeAuthScope,
        world_cache: Arc<WorldCache>,
        avatar_cache: Arc<AvatarCache>,
        tasks: TaskSupervisor,
    ) -> Self {
        Self {
            inner: Arc::new(FavoriteDetailsRuntimeInner {
                remote,
                auth_scope,
                world_cache,
                avatar_cache,
                world_cards: Arc::new(FavoriteWorldCardCache::new()),
                tasks,
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
            remote: self.inner.remote.as_ref(),
            auth_scope: &self.inner.auth_scope,
            expected_scope,
        };
        let entities = fetch_favorite_avatar_entities(&deps, &input.avatar_tags).await?;
        let details_by_id = filter_details_by_id(entities, &input.favorite_ids);
        let cached_count = persist_avatar_details(
            &self.inner.avatar_cache,
            &deps.expected_scope,
            &details_by_id,
        );
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
        GATE.ensure_matches(&self.inner.auth_scope, &expected_scope)?;
        self.inner.world_cards.enter_scope(&expected_scope).await;
        self.inner.world_cards.start_housekeeping(&self.inner.tasks);

        let requested_ids = normalize_ids(&input.requested_ids);
        let (cards, missing) = self.world_cards_for(&requested_ids).await;
        if missing.is_empty() {
            return Ok(project_world_cards(cards, &requested_ids, 0));
        }

        let _guard = self.inner.world_sync_gate.lock().await;
        GATE.ensure_matches(&self.inner.auth_scope, &expected_scope)?;
        let (cards, missing) = self.world_cards_for(&requested_ids).await;
        if missing.is_empty() {
            return Ok(project_world_cards(cards, &requested_ids, 0));
        }

        let deps = FavoriteDetailsHydrateDeps {
            remote: self.inner.remote.as_ref(),
            auth_scope: &self.inner.auth_scope,
            expected_scope,
        };
        let favorite_ids = normalize_ids(&input.favorite_ids)
            .into_iter()
            .collect::<HashSet<_>>();
        let (remote_missing, local_missing): (Vec<_>, Vec<_>) = missing
            .into_iter()
            .partition(|id| favorite_ids.contains(id));

        let mut cached_count = 0;
        let pending_tags = if remote_missing.is_empty() {
            normalize_ids(&input.group_tags)
        } else {
            let (synced, pending) = self
                .sync_world_groups(&deps, &input.group_tags, &remote_missing)
                .await?;
            cached_count += synced;
            self.probe_world_cards(&deps, &remote_missing).await?;
            pending
        };
        cached_count += self
            .resolve_local_world_cards(&deps, &local_missing)
            .await?;
        GATE.ensure_matches(deps.auth_scope, &deps.expected_scope)?;

        self.prefetch_world_groups(pending_tags, &deps.expected_scope);
        let (cards, _) = self.world_cards_for(&requested_ids).await;
        Ok(project_world_cards(cards, &requested_ids, cached_count))
    }

    async fn world_cards_for(
        &self,
        requested_ids: &[String],
    ) -> (HashMap<String, Arc<FavoriteWorldCard>>, Vec<String>) {
        let mut cards = HashMap::new();
        let mut missing = Vec::new();
        for id in requested_ids {
            match self.inner.world_cards.get(id).await {
                Some(card) => {
                    cards.insert(id.clone(), card);
                }
                None => missing.push(id.clone()),
            }
        }
        (cards, missing)
    }

    async fn sync_world_groups(
        &self,
        deps: &FavoriteDetailsHydrateDeps<'_>,
        group_tags: &[String],
        needed_ids: &[String],
    ) -> Result<(u32, Vec<String>)> {
        let mut cached_count = 0;
        let mut tags = normalize_world_group_tags(group_tags).into_iter();
        for tag in tags.by_ref() {
            let entities = fetch_favorite_world_entities(deps, &tag).await?;
            cached_count += self.store_world_entities(entities).await;
            self.inner.world_cards.mark_tag_synced(&tag);
            let (_, missing) = self.world_cards_for(needed_ids).await;
            if missing.is_empty() {
                break;
            }
        }
        Ok((cached_count, tags.collect()))
    }

    fn prefetch_world_groups(&self, group_tags: Vec<String>, scope: &RuntimeAuthScopeSnapshot) {
        let group_tags = self.inner.world_cards.unsynced_tags(group_tags);
        if group_tags.is_empty() {
            return;
        }
        let runtime = self.clone();
        let expected_scope = scope.clone();
        self.inner
            .tasks
            .spawn_cancellable(move |stop_token| async move {
                let _guard = runtime.inner.world_sync_gate.lock().await;
                let deps = FavoriteDetailsHydrateDeps {
                    remote: runtime.inner.remote.as_ref(),
                    auth_scope: &runtime.inner.auth_scope,
                    expected_scope,
                };
                for tag in group_tags {
                    if stop_token.is_stop_requested() {
                        return;
                    }
                    match fetch_favorite_world_entities(&deps, &tag).await {
                        Ok(entities) => {
                            runtime.store_world_entities(entities).await;
                            runtime.inner.world_cards.mark_tag_synced(&tag);
                        }
                        Err(error) => {
                            tracing::warn!(tag, "favorite world group prefetch failed: {error}");
                            return;
                        }
                    }
                }
            });
    }

    async fn store_world_entities(&self, entities: Vec<Value>) -> u32 {
        let ids = entities.iter().map(entity_id).collect::<Vec<_>>();
        let payloads = self.inner.world_cache.hydrate_favorite_payloads(&entities);
        let mut cached_count = 0;
        for (id, payload) in ids.into_iter().zip(payloads) {
            let Some(payload) = payload else {
                continue;
            };
            if id.is_empty() {
                continue;
            }
            cached_count += 1;
            self.inner
                .world_cards
                .insert(id, FavoriteWorldCard::resolved(&payload, None))
                .await;
        }
        cached_count
    }

    async fn probe_world_cards(
        &self,
        deps: &FavoriteDetailsHydrateDeps<'_>,
        world_ids: &[String],
    ) -> Result<()> {
        let (_, missing) = self.world_cards_for(world_ids).await;
        let mut probes = stream::iter(missing.into_iter().map(|id| async move {
            let outcome = probe_world(deps, &id).await;
            (id, outcome)
        }))
        .buffer_unordered(FAVORITE_DETAILS_PROBE_CONCURRENCY);
        while let Some((id, outcome)) = probes.next().await {
            match outcome? {
                WorldProbeOutcome::Deleted => {
                    self.inner
                        .world_cards
                        .insert(id, FavoriteWorldCard::deleted())
                        .await;
                }
                WorldProbeOutcome::Available(entity, availability) => {
                    let payload = self
                        .inner
                        .world_cache
                        .hydrate_favorite_payloads(std::slice::from_ref(&entity))
                        .pop()
                        .flatten()
                        .unwrap_or(entity);
                    self.inner
                        .world_cards
                        .insert(
                            id,
                            FavoriteWorldCard::resolved(&payload, Some(availability)),
                        )
                        .await;
                }
                WorldProbeOutcome::Failed => {
                    if let Some(payload) = self.local_world_payload(&id) {
                        self.inner
                            .world_cards
                            .insert(
                                id,
                                FavoriteWorldCard::resolved(
                                    &payload,
                                    Some(WORLD_AVAILABILITY_UNVERIFIED.to_string()),
                                ),
                            )
                            .await;
                    }
                }
            }
        }
        Ok(())
    }

    async fn resolve_local_world_cards(
        &self,
        deps: &FavoriteDetailsHydrateDeps<'_>,
        world_ids: &[String],
    ) -> Result<u32> {
        let mut cached_count = 0;
        let mut unresolved = Vec::new();
        for id in world_ids {
            let Some(payload) = self.local_world_payload(id) else {
                unresolved.push(id.clone());
                continue;
            };
            cached_count += 1;
            self.inner
                .world_cards
                .insert(id.clone(), FavoriteWorldCard::resolved(&payload, None))
                .await;
        }
        self.probe_world_cards(deps, &unresolved).await?;
        Ok(cached_count)
    }

    pub async fn invalidate_world_cards(&self) {
        self.inner.world_cards.invalidate_all().await;
    }

    pub async fn refresh_world_card(&self, entity: &Value) {
        let world_id = entity_id(entity);
        if world_id.is_empty() {
            return;
        }
        let payload = self
            .inner
            .world_cache
            .hydrate_favorite_payloads(std::slice::from_ref(entity))
            .pop()
            .flatten()
            .unwrap_or_else(|| entity.clone());
        self.inner
            .world_cards
            .insert(world_id, FavoriteWorldCard::resolved(&payload, None))
            .await;
    }

    fn local_world_payload(&self, world_id: &str) -> Option<Value> {
        if let Some(payload) = self.inner.world_cache.get_cached_card_payload(world_id) {
            return Some(payload);
        }
        let summary = self
            .inner
            .world_cache
            .get_summary(world_id)
            .ok()
            .flatten()?;
        serde_json::to_value(summary).ok()
    }
}

fn project_world_cards(
    cards: HashMap<String, Arc<FavoriteWorldCard>>,
    requested_ids: &[String],
    cached_count: u32,
) -> FavoriteDetailsHydrateOutput {
    let mut details_by_id = HashMap::new();
    let mut availability_by_id = HashMap::new();
    for id in requested_ids {
        let Some(card) = cards.get(id) else {
            continue;
        };
        if let Some(availability) = card.availability() {
            availability_by_id.insert(id.clone(), availability.to_string());
        }
        if let Some(payload) = card.payload() {
            details_by_id.insert(id.clone(), RawJson::from(payload));
        }
    }
    FavoriteDetailsHydrateOutput {
        details_by_id,
        availability_by_id,
        cached_count,
        fetched_at: Utc::now().to_rfc3339(),
    }
}

fn normalize_world_group_tags(group_tags: &[String]) -> Vec<String> {
    let tags = normalize_ids(group_tags);
    if tags.is_empty() {
        vec![String::new()]
    } else {
        tags
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
            GATE.ensure_matches(deps.auth_scope, &deps.expected_scope)?;
            tracing::warn!("world availability probe failed for {id}: {error}");
            Ok(WorldProbeOutcome::Failed)
        }
    }
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
    tag: &str,
) -> Result<Vec<Value>> {
    let mut entities = Vec::new();
    let mut offset = 0_i32;
    for _ in 0..FAVORITE_DETAILS_MAX_PAGES {
        let rows = execute_page(
            deps,
            deps.remote.favorite_worlds(
                deps.expected_scope.endpoint.clone(),
                FAVORITE_WORLD_GROUP_PAGE_SIZE,
                offset,
                String::new(),
                String::new(),
                tag.to_string(),
            ),
            "favorite world detail sync",
        )
        .await?;
        let page_len = rows.len();
        entities.extend(rows);
        if page_len < FAVORITE_WORLD_GROUP_PAGE_SIZE as usize {
            break;
        }
        offset += FAVORITE_WORLD_GROUP_PAGE_SIZE;
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
    response: super::FavoriteRemoteFuture<'_, VrchatResponse>,
) -> Result<(i32, Value)> {
    GATE.ensure_matches(deps.auth_scope, &deps.expected_scope)?;
    let response = response.await?;
    GATE.ensure_matches(deps.auth_scope, &deps.expected_scope)?;
    let payload = serde_json::from_str::<Value>(&response.data)
        .unwrap_or_else(|_| Value::String(response.data.clone()));
    Ok((response.status, payload))
}

async fn execute_page(
    deps: &FavoriteDetailsHydrateDeps<'_>,
    response: super::FavoriteRemoteFuture<'_, VrchatResponse>,
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

fn persist_avatar_details(
    avatar_cache: &AvatarCache,
    scope: &RuntimeAuthScopeSnapshot,
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
        match avatar_cache.existing_summary_ids(&insert_candidates) {
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

    match avatar_cache.store_summaries(&scope.current_user_id, &scope.endpoint, entries) {
        Ok(cached_count) => cached_count,
        Err(error) => {
            tracing::warn!("failed to cache favorite avatar details: {error}");
            0
        }
    }
}

#[cfg(test)]
mod tests;
