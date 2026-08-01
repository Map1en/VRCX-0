use std::collections::{HashMap, HashSet};

use chrono::Utc;
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_core::json::RawJson;
use vrcx_0_persistence::{
    avatars::{avatar_cache_existing_ids, avatar_cache_upsert},
    worlds::{world_cache_get_many, world_cache_upsert},
    DatabaseService,
};
use vrcx_0_vrchat_client::{
    favorites::{favorite_avatars_get_input, favorite_worlds_get_input},
    http_api::{normalize_text, ApiScope, HttpApiRequestInput},
    worlds::world_get_input,
};

use crate::{Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, WebClient};

use super::cache_policy::{
    cache_entry_from_entity, cache_write_decision, entity_id, release_status, CacheWriteDecision,
    FavoriteCacheKind,
};

const FAVORITE_DETAILS_PAGE_SIZE: i64 = 300;
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
    pub avatar_tags: Vec<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteDetailsHydrateOutput {
    pub details_by_id: HashMap<String, RawJson>,
    pub availability_by_id: HashMap<String, String>,
    pub cached_count: u32,
    pub fetched_at: String,
}

pub struct FavoriteDetailsHydrateDeps<'a> {
    pub db: &'a DatabaseService,
    pub web: &'a WebClient,
    pub auth_scope: &'a RuntimeAuthScope,
    pub expected_scope: RuntimeAuthScopeSnapshot,
}

pub async fn hydrate_favorite_details(
    deps: &FavoriteDetailsHydrateDeps<'_>,
    input: FavoriteDetailsHydrateInput,
) -> Result<FavoriteDetailsHydrateOutput> {
    let entities = match input.kind {
        FavoriteDetailsHydrateKind::Avatar => {
            fetch_favorite_avatar_entities(deps, &input.avatar_tags).await?
        }
        FavoriteDetailsHydrateKind::World => fetch_favorite_world_entities(deps).await?,
    };
    let mut details_by_id = filter_details_by_id(entities, &input.favorite_ids);
    let availability_by_id = match input.kind {
        FavoriteDetailsHydrateKind::Avatar => HashMap::new(),
        FavoriteDetailsHydrateKind::World => {
            probe_missing_world_details(deps, &input.favorite_ids, &mut details_by_id).await?
        }
    };
    let cached_count = persist_details(deps.db, input.kind, &details_by_id);
    Ok(FavoriteDetailsHydrateOutput {
        details_by_id: details_by_id
            .into_iter()
            .map(|(id, entity)| (id, RawJson::from(entity)))
            .collect(),
        availability_by_id,
        cached_count,
        fetched_at: Utc::now().to_rfc3339(),
    })
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
    let request = match world_get_input(deps.expected_scope.endpoint.clone(), id.to_string()) {
        Ok((_, request)) => request,
        Err(error) => {
            tracing::warn!("failed to build world availability probe for {id}: {error}");
            return Ok(WorldProbeOutcome::Failed);
        }
    };
    match execute_json(deps, request).await {
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
    let mut offset = 0_i64;
    for _ in 0..FAVORITE_DETAILS_MAX_PAGES {
        let request = favorite_worlds_get_input(
            deps.expected_scope.endpoint.clone(),
            FAVORITE_DETAILS_PAGE_SIZE,
            offset,
            String::new(),
            String::new(),
            String::new(),
        );
        let rows = execute_page(deps, request, "favorite world detail sync").await?;
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
        let mut offset = 0_i64;
        for _ in 0..FAVORITE_DETAILS_MAX_PAGES {
            let request = favorite_avatars_get_input(
                deps.expected_scope.endpoint.clone(),
                FAVORITE_DETAILS_PAGE_SIZE,
                offset,
                tag.clone(),
            );
            let rows = execute_page(deps, request, "favorite avatar detail sync").await?;
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
    request: HttpApiRequestInput,
) -> Result<(i32, Value)> {
    ensure_scope_matches(&deps.auth_scope.snapshot(), &deps.expected_scope)?;
    let response = deps
        .web
        .execute_api(request, ApiScope::Vrchat, deps.db)
        .await?;
    ensure_scope_matches(&deps.auth_scope.snapshot(), &deps.expected_scope)?;
    let payload = serde_json::from_str::<Value>(&response.data)
        .unwrap_or_else(|_| Value::String(response.data.clone()));
    Ok((response.status, payload))
}

async fn execute_page(
    deps: &FavoriteDetailsHydrateDeps<'_>,
    request: HttpApiRequestInput,
    action: &str,
) -> Result<Vec<Value>> {
    let (status, payload) = execute_json(deps, request).await?;
    if status >= 400 || payload.get("error").is_some() {
        return Err(Error::Custom(response_error_message(
            &payload, status, action,
        )));
    }
    Ok(payload.as_array().cloned().unwrap_or_default())
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

fn persist_details(
    db: &DatabaseService,
    kind: FavoriteDetailsHydrateKind,
    details_by_id: &HashMap<String, Value>,
) -> u32 {
    match kind {
        FavoriteDetailsHydrateKind::Avatar => persist_avatar_details(db, details_by_id),
        FavoriteDetailsHydrateKind::World => persist_world_details(db, details_by_id),
    }
}

fn persist_avatar_details(db: &DatabaseService, details_by_id: &HashMap<String, Value>) -> u32 {
    let insert_candidates = details_by_id
        .iter()
        .filter(|(_, entity)| {
            cache_write_decision(FavoriteCacheKind::Avatar, entity)
                == CacheWriteDecision::InsertIfMissing
        })
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    let existing_ids: HashSet<String> = if insert_candidates.is_empty() {
        HashSet::new()
    } else {
        match avatar_cache_existing_ids(db, &insert_candidates) {
            Ok(ids) => ids.into_iter().collect(),
            Err(error) => {
                tracing::warn!("failed to read favorite avatar cache: {error}");
                return 0;
            }
        }
    };

    let mut cached_count = 0;
    for (id, entity) in details_by_id {
        let decision = cache_write_decision(FavoriteCacheKind::Avatar, entity);
        if decision == CacheWriteDecision::Skip {
            continue;
        }
        if decision == CacheWriteDecision::InsertIfMissing && existing_ids.contains(id) {
            continue;
        }
        match avatar_cache_upsert(db, cache_entry_from_entity(entity, id)) {
            Ok(_) => cached_count += 1,
            Err(error) => {
                tracing::warn!("failed to cache favorite avatar details for {id}: {error}");
            }
        }
    }
    cached_count
}

fn persist_world_details(db: &DatabaseService, details_by_id: &HashMap<String, Value>) -> u32 {
    let insert_candidates = details_by_id
        .iter()
        .filter(|(_, entity)| {
            cache_write_decision(FavoriteCacheKind::World, entity)
                == CacheWriteDecision::InsertIfMissing
        })
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    let existing_ids = if insert_candidates.is_empty() {
        HashSet::new()
    } else {
        match world_cache_get_many(db, &insert_candidates) {
            Ok(rows) => rows.into_iter().map(|row| row.id).collect(),
            Err(error) => {
                tracing::warn!("failed to read favorite world cache: {error}");
                return 0;
            }
        }
    };

    let mut cached_count = 0;
    for (id, entity) in details_by_id {
        match cache_write_decision(FavoriteCacheKind::World, entity) {
            CacheWriteDecision::Skip => continue,
            CacheWriteDecision::InsertIfMissing if existing_ids.contains(id) => continue,
            CacheWriteDecision::InsertIfMissing | CacheWriteDecision::Upsert => {}
        }
        match world_cache_upsert(db, cache_entry_from_entity(entity, id)) {
            Ok(_) => cached_count += 1,
            Err(error) => {
                tracing::warn!("failed to cache favorite world details for {id}: {error}");
            }
        }
    }
    cached_count
}

fn ensure_scope_matches(
    current: &RuntimeAuthScopeSnapshot,
    expected: &RuntimeAuthScopeSnapshot,
) -> Result<()> {
    if current.active
        && current.generation == expected.generation
        && current.current_user_id == expected.current_user_id
        && current.endpoint == expected.endpoint
    {
        Ok(())
    } else {
        Err(Error::Custom(
            "Favorite detail hydrate authentication scope changed.".into(),
        ))
    }
}

fn response_error_message(payload: &Value, status: i32, action: &str) -> String {
    payload
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| payload.get("message").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| format!("VRChat {action} failed with HTTP {status}."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn complete(release_status: &str) -> Value {
        json!({
            "id": "avtr_1",
            "name": "Entity",
            "releaseStatus": release_status,
            "thumbnailImageUrl": "https://example.test/thumb.png",
        })
    }

    #[test]
    fn avatar_decision_upserts_public_complete_snapshots() {
        assert_eq!(
            cache_write_decision(FavoriteCacheKind::Avatar, &complete("public")),
            CacheWriteDecision::Upsert
        );
    }

    #[test]
    fn avatar_decision_inserts_non_public_complete_snapshots_only_when_missing() {
        for status in ["private", "hidden", ""] {
            assert_eq!(
                cache_write_decision(FavoriteCacheKind::Avatar, &complete(status)),
                CacheWriteDecision::InsertIfMissing
            );
        }
    }

    #[test]
    fn avatar_decision_skips_incomplete_snapshots() {
        assert_eq!(
            cache_write_decision(
                FavoriteCacheKind::Avatar,
                &json!({ "id": "avtr_1", "releaseStatus": "public" }),
            ),
            CacheWriteDecision::Skip
        );
        assert_eq!(
            cache_write_decision(
                FavoriteCacheKind::Avatar,
                &json!({
                    "id": "avtr_1",
                    "name": "Broken Avatar",
                    "releaseStatus": "public",
                })
            ),
            CacheWriteDecision::Skip
        );
    }

    #[test]
    fn avatar_decision_normalizes_release_status_case_and_whitespace() {
        let mut entity = complete("  Public  ");
        assert_eq!(
            cache_write_decision(FavoriteCacheKind::Avatar, &entity),
            CacheWriteDecision::Upsert
        );
        entity["imageUrl"] = json!("https://example.test/image.png");
        entity["thumbnailImageUrl"] = json!("   ");
        assert_eq!(
            cache_write_decision(FavoriteCacheKind::Avatar, &entity),
            CacheWriteDecision::Upsert
        );
    }

    #[test]
    fn world_decision_upserts_public_complete_snapshots() {
        assert_eq!(
            cache_write_decision(FavoriteCacheKind::World, &complete("public")),
            CacheWriteDecision::Upsert
        );
    }

    #[test]
    fn world_decision_inserts_private_complete_snapshots_only_when_missing() {
        assert_eq!(
            cache_write_decision(FavoriteCacheKind::World, &complete("private")),
            CacheWriteDecision::InsertIfMissing
        );
    }

    #[test]
    fn world_decision_skips_other_release_statuses_unlike_avatars() {
        for status in ["hidden", "labs", ""] {
            assert_eq!(
                cache_write_decision(FavoriteCacheKind::World, &complete(status)),
                CacheWriteDecision::Skip
            );
        }
    }

    #[test]
    fn world_decision_skips_incomplete_snapshots() {
        assert_eq!(
            cache_write_decision(
                FavoriteCacheKind::World,
                &json!({
                    "id": "wrld_1",
                    "name": "World",
                    "releaseStatus": "public",
                })
            ),
            CacheWriteDecision::Skip
        );
    }

    #[test]
    fn filter_keeps_only_requested_favorite_ids() {
        let entities = vec![
            json!({ "id": "wrld_1", "name": "One" }),
            json!({ "id": " wrld_2 ", "name": "Two" }),
            json!({ "id": "wrld_3", "name": "Three" }),
            json!({ "name": "No id" }),
        ];

        let details = filter_details_by_id(entities, &["wrld_2".into(), " wrld_3 ".into()]);

        assert_eq!(details.len(), 2);
        assert!(details.contains_key("wrld_2"));
        assert!(details.contains_key("wrld_3"));
    }

    #[test]
    fn filter_keeps_everything_when_favorite_ids_are_empty() {
        let entities = vec![
            json!({ "id": "wrld_1" }),
            json!({ "id": "wrld_2" }),
            json!({ "name": "No id" }),
        ];

        let details = filter_details_by_id(entities, &[]);

        assert_eq!(details.len(), 2);
    }

    #[test]
    fn merge_avatar_rows_deduplicates_across_tag_pages() {
        let mut seen_ids = HashSet::new();
        let mut entities = Vec::new();

        merge_avatar_rows(
            vec![
                json!({ "id": "avtr_1", "name": "First" }),
                json!({ "id": "avtr_2" }),
            ],
            &mut seen_ids,
            &mut entities,
        );
        merge_avatar_rows(
            vec![
                json!({ "id": " avtr_1 ", "name": "Duplicate" }),
                json!({ "id": "" }),
                json!({ "id": "avtr_3" }),
            ],
            &mut seen_ids,
            &mut entities,
        );

        let ids = entities.iter().map(entity_id).collect::<Vec<_>>();
        assert_eq!(ids, vec!["avtr_1", "avtr_2", "avtr_3"]);
        assert_eq!(entities[0]["name"], json!("First"));
    }

    #[test]
    fn normalize_avatar_tags_deduplicates_and_falls_back_to_single_untagged_round() {
        assert_eq!(
            normalize_avatar_tags(&[" one ".into(), "one".into(), "two".into(), "  ".into()]),
            vec!["one".to_string(), "two".to_string()]
        );
        assert_eq!(normalize_avatar_tags(&[]), vec![String::new()]);
        assert_eq!(normalize_avatar_tags(&["  ".into()]), vec![String::new()]);
    }

    #[test]
    fn missing_world_ids_returns_favorites_without_displayable_details() {
        let details_by_id = HashMap::from([
            ("wrld_named".to_string(), json!({ "name": "Named" })),
            ("wrld_tagged".to_string(), json!({ "tags": ["tag"] })),
            ("wrld_blank".to_string(), json!({ "name": "   " })),
            ("wrld_empty".to_string(), json!({})),
        ]);

        let missing = missing_world_ids(
            &[
                " wrld_named ".to_string(),
                "wrld_tagged".to_string(),
                "wrld_blank".to_string(),
                "wrld_empty".to_string(),
                "wrld_absent".to_string(),
                "wrld_absent".to_string(),
                "  ".to_string(),
            ],
            &details_by_id,
        );

        assert_eq!(missing, vec!["wrld_blank", "wrld_empty", "wrld_absent"]);
    }

    #[test]
    fn world_probe_marks_http_404_as_deleted() {
        assert_eq!(
            classify_world_probe(404, json!({ "error": { "message": "not found" } })),
            WorldProbeOutcome::Deleted
        );
    }

    #[test]
    fn world_probe_failures_do_not_produce_availability() {
        assert_eq!(
            classify_world_probe(500, json!({ "message": "boom" })),
            WorldProbeOutcome::Failed
        );
        assert_eq!(
            classify_world_probe(200, json!({ "error": { "message": "soft error" } })),
            WorldProbeOutcome::Failed
        );
    }

    #[test]
    fn world_probe_classifies_release_status_into_public_or_private() {
        let world = json!({ "id": "wrld_1", "name": "World", "releaseStatus": "Public" });
        assert_eq!(
            classify_world_probe(200, world.clone()),
            WorldProbeOutcome::Available(world, "public".to_string())
        );

        for status in ["private", "hidden", ""] {
            let world = json!({ "id": "wrld_1", "releaseStatus": status });
            assert_eq!(
                classify_world_probe(200, world.clone()),
                WorldProbeOutcome::Available(world, "private".to_string())
            );
        }
    }

    #[test]
    fn cache_entry_maps_snake_and_camel_timestamps_with_version_fallback() {
        let entity = json!({
            "id": "avtr_1",
            "authorId": " usr_author ",
            "authorName": "Author",
            "createdAt": "2026-06-01T00:00:00.000Z",
            "updated_at": "2026-06-02T00:00:00.000Z",
            "description": "Desc",
            "imageUrl": "https://example.test/image.png",
            "name": "Entity",
            "releaseStatus": "public",
            "thumbnailImageUrl": "https://example.test/thumb.png",
            "version": 7,
        });

        let entry = cache_entry_from_entity(&entity, "avtr_fallback");

        assert_eq!(entry.id, json!("avtr_1"));
        assert_eq!(entry.author_id, json!("usr_author"));
        assert_eq!(entry.created_at, json!("2026-06-01T00:00:00.000Z"));
        assert_eq!(entry.updated_at, json!("2026-06-02T00:00:00.000Z"));
        assert_eq!(entry.version, json!(7));

        let sparse = json!({ "name": "Fallback", "version": "not-a-number" });
        let entry = cache_entry_from_entity(&sparse, " avtr_fallback ");
        assert_eq!(entry.id, json!("avtr_fallback"));
        assert_eq!(entry.version, json!(0));
    }
}
