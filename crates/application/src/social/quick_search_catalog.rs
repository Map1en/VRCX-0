use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use vrcx_0_application_core::{
    vrchat_api::{VrchatApiRequest, VrchatScope},
    RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeDiagnostics, RuntimeOperationStatus,
    RuntimeSyncEngine, WorldCache,
};
use vrcx_0_application_realtime::RealtimeFriendSnapshot;
use vrcx_0_contracts::{VrchatJsonResponse, WorldSummaryOutput};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::json::RawJson;

use crate::avatars::{get_my_avatars, AvatarRemote, MyAvatarsDeps, MyAvatarsInput, MyAvatarsStore};
use crate::remote::VrchatRequestPort;
use vrcx_0_application_core::{Error, Result};
use vrcx_0_core::OwnerId;

const WORLD_PAGE_SIZE: i32 = 50;
const FAVORITE_PAGE_SIZE: i32 = 300;
const MAX_PAGES_PER_SOURCE: usize = 50;
const RESULT_LIMIT: usize = 8;
const DETAIL_QUERY_MIN_LENGTH: usize = 2;
const REMOTE_WORKING_SET_TTL: Duration = Duration::from_secs(60);
const PARTIAL_REMOTE_WORKING_SET_TTL: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub struct QuickSearchRuntime {
    inner: Arc<QuickSearchRuntimeInner>,
}

struct QuickSearchRuntimeInner {
    detail_store: Arc<dyn QuickSearchDetailStore>,
    remote_requests: Arc<dyn QuickSearchRemoteRequests>,
    avatar_store: Arc<dyn MyAvatarsStore>,
    avatar_remote: Arc<dyn AvatarRemote>,
    remote: Arc<dyn VrchatRequestPort>,
    auth_scope: RuntimeAuthScope,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
    world_cache: Arc<WorldCache>,
    remote_working_set: Mutex<Option<CachedRemoteWorkingSet>>,
    remote_load_gate: tokio::sync::Mutex<()>,
    remote_revision: AtomicU64,
}

struct CachedRemoteWorkingSet {
    scope_generation: u64,
    current_user_id: String,
    endpoint: String,
    expires_at: Instant,
    catalog: Arc<QuickSearchRemoteCatalog>,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QuickSearchQueryInput {
    pub query: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum QuickSearchQueryStatus {
    Ready,
    Partial,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum QuickSearchEntityType {
    Friend,
    Avatar,
    World,
    Group,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum QuickSearchMatchedField {
    Name,
    Memo,
    Note,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QuickSearchResult {
    pub id: String,
    #[serde(rename = "type")]
    pub entity_type: QuickSearchEntityType,
    pub source: String,
    pub name: String,
    pub subtitle: String,
    pub image_url: String,
    pub seed_data: Option<RawJson>,
    pub memo: String,
    pub note: String,
    pub matched_field: QuickSearchMatchedField,
    pub user_colour: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QuickSearchQueryOutput {
    pub status: QuickSearchQueryStatus,
    pub detail: String,
    pub friends: Vec<QuickSearchResult>,
    pub own_avatars: Vec<QuickSearchResult>,
    pub favorite_avatars: Vec<QuickSearchResult>,
    pub own_worlds: Vec<QuickSearchResult>,
    pub favorite_worlds: Vec<QuickSearchResult>,
    pub own_groups: Vec<QuickSearchResult>,
    pub joined_groups: Vec<QuickSearchResult>,
}

impl QuickSearchQueryOutput {
    fn empty() -> Self {
        Self {
            status: QuickSearchQueryStatus::Ready,
            detail: String::new(),
            friends: Vec::new(),
            own_avatars: Vec::new(),
            favorite_avatars: Vec::new(),
            own_worlds: Vec::new(),
            favorite_worlds: Vec::new(),
            own_groups: Vec::new(),
            joined_groups: Vec::new(),
        }
    }
}

#[derive(Clone, Debug)]
struct QuickSearchCandidate {
    id: String,
    entity_type: QuickSearchEntityType,
    source: &'static str,
    name: String,
    normalized_name: String,
    subtitle: String,
    image_url: String,
    owner_id: String,
    seed_data: Value,
}

#[derive(Debug, Default)]
struct QuickSearchRemoteCatalog {
    own_avatars: Vec<QuickSearchCandidate>,
    favorite_avatars: Vec<QuickSearchCandidate>,
    own_worlds: Vec<QuickSearchCandidate>,
    favorite_worlds: Vec<QuickSearchCandidate>,
    groups: Vec<QuickSearchCandidate>,
    failures: usize,
}

#[derive(Clone, Copy)]
pub enum QuickSearchRemoteSource {
    OwnWorlds,
    FavoriteAvatars,
    FavoriteWorlds,
}

pub trait QuickSearchDetailStore: Send + Sync {
    fn user_memos(&self) -> Result<Vec<(String, String)>>;
    fn user_notes(&self, owner: OwnerId) -> Result<Vec<(String, String)>>;
}

pub trait QuickSearchRemoteRequests: Send + Sync {
    fn page(
        &self,
        source: QuickSearchRemoteSource,
        endpoint: String,
        current_user_id: String,
        n: i32,
        offset: i32,
    ) -> Result<VrchatApiRequest>;
    fn user_groups(&self, endpoint: String, current_user_id: String) -> Result<VrchatApiRequest>;
}

pub struct QuickSearchSources {
    detail_store: Arc<dyn QuickSearchDetailStore>,
    remote_requests: Arc<dyn QuickSearchRemoteRequests>,
    avatar_store: Arc<dyn MyAvatarsStore>,
    avatar_remote: Arc<dyn AvatarRemote>,
    world_cache: Arc<WorldCache>,
}

impl QuickSearchSources {
    pub fn new(
        detail_store: Arc<dyn QuickSearchDetailStore>,
        remote_requests: Arc<dyn QuickSearchRemoteRequests>,
        avatar_store: Arc<dyn MyAvatarsStore>,
        avatar_remote: Arc<dyn AvatarRemote>,
        world_cache: Arc<WorldCache>,
    ) -> Self {
        Self {
            detail_store,
            remote_requests,
            avatar_store,
            avatar_remote,
            world_cache,
        }
    }
}

impl QuickSearchRuntime {
    pub fn new(
        sources: QuickSearchSources,
        remote: Arc<dyn VrchatRequestPort>,
        auth_scope: RuntimeAuthScope,
        diagnostics: RuntimeDiagnostics,
        sync: RuntimeSyncEngine,
    ) -> Self {
        Self {
            inner: Arc::new(QuickSearchRuntimeInner {
                detail_store: sources.detail_store,
                remote_requests: sources.remote_requests,
                avatar_store: sources.avatar_store,
                avatar_remote: sources.avatar_remote,
                remote,
                auth_scope,
                diagnostics,
                sync,
                world_cache: sources.world_cache,
                remote_working_set: Mutex::new(None),
                remote_load_gate: tokio::sync::Mutex::new(()),
                remote_revision: AtomicU64::new(0),
            }),
        }
    }

    pub async fn query(
        &self,
        input: QuickSearchQueryInput,
        friend_snapshot: Option<RealtimeFriendSnapshot>,
    ) -> Result<QuickSearchQueryOutput> {
        let command = "app__quick_search_query";
        let scope = require_active_scope(&self.inner.auth_scope)?;
        let query = normalize_search_text(&input.query);
        if query.is_empty() {
            return Ok(QuickSearchQueryOutput::empty());
        }

        self.inner.diagnostics.record_command(
            command,
            RuntimeOperationStatus::Running,
            "Searching the quick search sources.",
        );

        let mut failures = 0;
        let can_search_details = query.chars().count() >= DETAIL_QUERY_MIN_LENGTH;
        let (memo_by_user_id, note_by_user_id) = if can_search_details {
            let memos = match self.inner.detail_store.user_memos() {
                Ok(rows) => rows.into_iter().collect::<HashMap<_, _>>(),
                Err(error) => {
                    failures += 1;
                    tracing::debug!(error = %error, "quick search user memos failed");
                    HashMap::new()
                }
            };
            let notes = match self
                .inner
                .detail_store
                .user_notes(OwnerId::new(scope.current_user_id.clone()))
            {
                Ok(rows) => rows.into_iter().collect::<HashMap<_, _>>(),
                Err(error) => {
                    failures += 1;
                    tracing::debug!(error = %error, "quick search user notes failed");
                    HashMap::new()
                }
            };
            (memos, notes)
        } else {
            (HashMap::new(), HashMap::new())
        };

        let friends = friend_snapshot
            .filter(|snapshot| friend_snapshot_matches_scope(snapshot, &scope))
            .map(|snapshot| {
                search_friends(
                    snapshot.friends_by_id.into_values(),
                    &memo_by_user_id,
                    &note_by_user_id,
                    &query,
                )
            })
            .unwrap_or_default();

        let mut output = QuickSearchQueryOutput {
            friends,
            ..QuickSearchQueryOutput::empty()
        };

        if can_search_details {
            let local_worlds = match self.inner.world_cache.search_summaries(&query, 16) {
                Ok(rows) => rows
                    .into_iter()
                    .take(RESULT_LIMIT)
                    .map(local_world_result)
                    .collect(),
                Err(error) => {
                    failures += 1;
                    tracing::debug!(error = %error, "quick search local worlds failed");
                    Vec::new()
                }
            };

            let remote = self.remote_catalog(&scope).await?;
            failures += remote.failures;
            output.own_avatars = search_candidates(&remote.own_avatars, &query, &HashSet::new());
            let own_avatar_ids = remote
                .own_avatars
                .iter()
                .map(|row| row.id.clone())
                .collect::<HashSet<_>>();
            output.favorite_avatars =
                search_candidates(&remote.favorite_avatars, &query, &own_avatar_ids);
            output.own_worlds = search_candidates(&remote.own_worlds, &query, &HashSet::new());
            let own_world_ids = remote
                .own_worlds
                .iter()
                .map(|row| row.id.clone())
                .collect::<HashSet<_>>();
            output.favorite_worlds =
                search_candidates(&remote.favorite_worlds, &query, &own_world_ids);
            merge_results(&mut output.favorite_worlds, local_worlds);

            let own_groups = remote
                .groups
                .iter()
                .filter(|row| row.owner_id == scope.current_user_id)
                .cloned()
                .collect::<Vec<_>>();
            let own_group_ids = own_groups
                .iter()
                .map(|row| row.id.clone())
                .collect::<HashSet<_>>();
            output.own_groups = search_candidates(&own_groups, &query, &HashSet::new());
            output.joined_groups = search_candidates(&remote.groups, &query, &own_group_ids);
        }

        ensure_scope_matches(&self.inner.auth_scope, &scope)?;
        let partial = failures > 0;
        output.status = if partial {
            QuickSearchQueryStatus::Partial
        } else {
            QuickSearchQueryStatus::Ready
        };
        output.detail = if partial {
            format!("{failures} search source(s) failed to load.")
        } else {
            String::new()
        };
        self.inner.diagnostics.record_command(
            command,
            if partial {
                RuntimeOperationStatus::Partial
            } else {
                RuntimeOperationStatus::Ok
            },
            if partial {
                output.detail.clone()
            } else {
                "Quick search completed.".into()
            },
        );
        self.inner.sync.record(
            "quickSearch",
            if partial {
                RuntimeOperationStatus::Partial
            } else {
                RuntimeOperationStatus::Ready
            },
            if partial {
                output.detail.clone()
            } else {
                "Quick search completed.".into()
            },
            0,
        );
        Ok(output)
    }

    pub fn invalidate_remote_working_set(&self) {
        self.inner.remote_revision.fetch_add(1, Ordering::SeqCst);
        *self
            .inner
            .remote_working_set
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = None;
    }

    async fn remote_catalog(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
    ) -> Result<Arc<QuickSearchRemoteCatalog>> {
        if let Some(catalog) = self.cached_remote_catalog(scope) {
            return Ok(catalog);
        }

        let _guard = self.inner.remote_load_gate.lock().await;
        if let Some(catalog) = self.cached_remote_catalog(scope) {
            return Ok(catalog);
        }

        let load_revision = self.inner.remote_revision.load(Ordering::SeqCst);
        let catalog = Arc::new(load_quick_search_remote_catalog(&self.inner, scope).await);
        ensure_scope_matches(&self.inner.auth_scope, scope)?;
        let ttl = if catalog.failures == 0 {
            REMOTE_WORKING_SET_TTL
        } else {
            PARTIAL_REMOTE_WORKING_SET_TTL
        };
        let cached = CachedRemoteWorkingSet {
            scope_generation: scope.generation,
            current_user_id: scope.current_user_id.clone(),
            endpoint: scope.endpoint.clone(),
            expires_at: Instant::now() + ttl,
            catalog: catalog.clone(),
        };
        if self.inner.remote_revision.load(Ordering::SeqCst) == load_revision {
            *self
                .inner
                .remote_working_set
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = Some(cached);
        }
        Ok(catalog)
    }

    fn cached_remote_catalog(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
    ) -> Option<Arc<QuickSearchRemoteCatalog>> {
        let cache = self
            .inner
            .remote_working_set
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let cached = cache.as_ref()?;
        (cached.scope_generation == scope.generation
            && cached.current_user_id == scope.current_user_id
            && cached.endpoint == scope.endpoint
            && cached.expires_at > Instant::now())
        .then(|| cached.catalog.clone())
    }
}

async fn load_quick_search_remote_catalog(
    runtime: &QuickSearchRuntimeInner,
    scope: &RuntimeAuthScopeSnapshot,
) -> QuickSearchRemoteCatalog {
    let my_avatars_deps = MyAvatarsDeps {
        store: runtime.avatar_store.as_ref(),
        remote: runtime.avatar_remote.as_ref(),
        auth_scope: &runtime.auth_scope,
        expected_scope: scope.clone(),
    };
    let own_avatars = get_my_avatars(&my_avatars_deps, MyAvatarsInput::default());
    let own_worlds = collect_pages(
        runtime,
        scope,
        QuickSearchRemoteSource::OwnWorlds,
        WORLD_PAGE_SIZE,
    );
    let favorite_avatars = collect_pages(
        runtime,
        scope,
        QuickSearchRemoteSource::FavoriteAvatars,
        FAVORITE_PAGE_SIZE,
    );
    let favorite_worlds = collect_pages(
        runtime,
        scope,
        QuickSearchRemoteSource::FavoriteWorlds,
        FAVORITE_PAGE_SIZE,
    );
    let groups = fetch_user_groups(runtime, scope);
    let (own_avatars, own_worlds, favorite_avatars, favorite_worlds, groups) = tokio::join!(
        own_avatars,
        own_worlds,
        favorite_avatars,
        favorite_worlds,
        groups
    );

    let mut failures = 0;
    QuickSearchRemoteCatalog {
        own_avatars: project_rows(
            rows_or_empty(own_avatars, &mut failures),
            QuickSearchEntityType::Avatar,
            "own",
        ),
        favorite_avatars: project_rows(
            rows_or_empty(favorite_avatars, &mut failures),
            QuickSearchEntityType::Avatar,
            "favorite",
        ),
        own_worlds: project_rows(
            rows_or_empty(own_worlds, &mut failures),
            QuickSearchEntityType::World,
            "own",
        ),
        favorite_worlds: project_rows(
            rows_or_empty(favorite_worlds, &mut failures),
            QuickSearchEntityType::World,
            "favorite",
        ),
        groups: project_rows(
            rows_or_empty(groups, &mut failures),
            QuickSearchEntityType::Group,
            "joined",
        ),
        failures,
    }
}

async fn collect_pages(
    runtime: &QuickSearchRuntimeInner,
    scope: &RuntimeAuthScopeSnapshot,
    source: QuickSearchRemoteSource,
    page_size: i32,
) -> Result<Vec<Value>> {
    let mut rows = Vec::new();
    for page in 0..=MAX_PAGES_PER_SOURCE {
        ensure_scope_matches(&runtime.auth_scope, scope)?;
        let offset = (page as i32) * page_size;
        let request = runtime.remote_requests.page(
            source,
            scope.endpoint.clone(),
            scope.current_user_id.clone(),
            page_size,
            offset,
        )?;
        let page_rows = execute_rows(runtime, scope, request).await?;
        let count = page_rows.len();
        if page == MAX_PAGES_PER_SOURCE {
            if count == 0 {
                return Ok(rows);
            }
            return Err(Error::Custom(
                "Quick search source pagination exceeded the safety limit.".into(),
            ));
        }
        rows.extend(page_rows);
        if count < page_size as usize {
            return Ok(rows);
        }
    }
    Ok(rows)
}

async fn fetch_user_groups(
    runtime: &QuickSearchRuntimeInner,
    scope: &RuntimeAuthScopeSnapshot,
) -> Result<Vec<Value>> {
    let request = runtime
        .remote_requests
        .user_groups(scope.endpoint.clone(), scope.current_user_id.clone())?;
    let mut rows = execute_rows(runtime, scope, request).await?;
    remap_group_membership_row_ids(&mut rows);
    Ok(rows)
}

fn remap_group_membership_row_ids(rows: &mut [Value]) {
    for row in rows {
        let Some(object) = row.as_object_mut() else {
            continue;
        };
        let Some(group_id) = object
            .get("groupId")
            .and_then(Value::as_str)
            .filter(|group_id| !group_id.is_empty())
            .map(str::to_owned)
        else {
            continue;
        };
        object.insert("id".into(), Value::String(group_id));
    }
}

async fn execute_rows(
    runtime: &QuickSearchRuntimeInner,
    scope: &RuntimeAuthScopeSnapshot,
    request: VrchatApiRequest,
) -> Result<Vec<Value>> {
    let response = runtime.remote.send(request, VrchatScope::Vrchat).await?;
    ensure_scope_matches(&runtime.auth_scope, scope)?;
    let response = VrchatJsonResponse {
        status: response.status,
        json: serde_json::from_str::<Value>(&response.data)?,
    };
    if !(200..300).contains(&response.status) || response.has_error_field() {
        return Err(Error::Custom(format!(
            "Quick search source request failed: {}",
            response.error_message_or("VRChat API request failed")
        )));
    }
    Ok(response.json.as_array().cloned().unwrap_or_default())
}

fn search_friends(
    friends: impl IntoIterator<Item = FriendRecord>,
    memo_by_user_id: &HashMap<String, String>,
    note_by_user_id: &HashMap<String, String>,
    query: &str,
) -> Vec<QuickSearchResult> {
    let can_search_details = query.chars().count() >= DETAIL_QUERY_MIN_LENGTH;
    let mut matches = friends
        .into_iter()
        .filter_map(|friend| {
            let name = friend.display_name_or_id();
            let memo = memo_by_user_id
                .get(&friend.id)
                .map(String::as_str)
                .unwrap_or_default();
            let note = note_by_user_id
                .get(&friend.id)
                .map(String::as_str)
                .unwrap_or_default();
            let normalized_name = normalize_search_text(&name);
            let matched_field = if normalized_name.contains(query) {
                QuickSearchMatchedField::Name
            } else if can_search_details && normalize_search_text(memo).contains(query) {
                QuickSearchMatchedField::Memo
            } else if can_search_details && normalize_search_text(note).contains(query) {
                QuickSearchMatchedField::Note
            } else {
                return None;
            };
            let sort_name = normalized_name.clone();
            let result = friend_result(friend, name, memo, note, matched_field);
            Some((!normalized_name.starts_with(query), sort_name, result))
        })
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| {
        (&left.0, &left.1, &left.2.id).cmp(&(&right.0, &right.1, &right.2.id))
    });
    matches
        .into_iter()
        .take(RESULT_LIMIT)
        .map(|(_, _, result)| result)
        .collect()
}

fn friend_result(
    friend: FriendRecord,
    name: String,
    memo: &str,
    note: &str,
    matched_field: QuickSearchMatchedField,
) -> QuickSearchResult {
    let image_url = friend
        .extra
        .get("profilePicOverrideThumbnail")
        .or_else(|| friend.extra.get("profilePicOverride"))
        .or_else(|| friend.extra.get("thumbnailUrl"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            if friend.current_avatar_thumbnail_image_url.trim().is_empty() {
                friend.current_avatar_image_url.clone()
            } else {
                friend.current_avatar_thumbnail_image_url.clone()
            }
        });
    let user_colour = friend
        .extra
        .get("$userColour")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let subtitle = friend.status_description.to_string();
    let seed_data = serde_json::to_value(&friend).ok().map(RawJson::from);
    QuickSearchResult {
        id: friend.id,
        entity_type: QuickSearchEntityType::Friend,
        source: "friends".into(),
        name,
        subtitle,
        image_url,
        seed_data,
        memo: memo.trim().to_string(),
        note: note.trim().to_string(),
        matched_field,
        user_colour,
    }
}

fn local_world_result(row: WorldSummaryOutput) -> QuickSearchResult {
    let image_url = if row.thumbnail_image_url.trim().is_empty() {
        row.image_url.clone()
    } else {
        row.thumbnail_image_url.clone()
    };
    let subtitle = row.author_name.clone();
    QuickSearchResult {
        id: row.id.clone(),
        entity_type: QuickSearchEntityType::World,
        source: "local".into(),
        name: row.name.clone(),
        subtitle,
        image_url,
        seed_data: serde_json::to_value(row).ok().map(RawJson::from),
        memo: String::new(),
        note: String::new(),
        matched_field: QuickSearchMatchedField::Name,
        user_colour: String::new(),
    }
}

fn project_rows(
    rows: Vec<Value>,
    entity_type: QuickSearchEntityType,
    source: &'static str,
) -> Vec<QuickSearchCandidate> {
    let mut seen = HashSet::new();
    rows.into_iter()
        .filter_map(|row| project_row(row, entity_type, source))
        .filter(|row| seen.insert(row.id.clone()))
        .collect()
}

fn project_row(
    row: Value,
    entity_type: QuickSearchEntityType,
    source: &'static str,
) -> Option<QuickSearchCandidate> {
    let object = row.as_object()?;
    let id = first_text_field(object, &["id"]);
    if id.is_empty() {
        return None;
    }
    let default_name = match entity_type {
        QuickSearchEntityType::Friend => "User",
        QuickSearchEntityType::Avatar => "Avatar",
        QuickSearchEntityType::World => "World",
        QuickSearchEntityType::Group => "Group",
    };
    let name = {
        let value = first_text_field(object, &["name", "displayName"]);
        if value.is_empty() {
            default_name.to_string()
        } else {
            value
        }
    };
    let subtitle = first_text_field(
        object,
        &["authorName", "author_name", "ownerDisplayName", "groupName"],
    );
    let normalized_name = normalize_search_text(&name);
    let image_url = first_text_field(
        object,
        &[
            "thumbnailImageUrl",
            "thumbnail_image_url",
            "imageUrl",
            "image_url",
            "iconUrl",
            "bannerUrl",
        ],
    );
    let owner_id = first_text_field(object, &["ownerId"]);
    let seed_data = project_seed_data(object, &id);
    Some(QuickSearchCandidate {
        id,
        entity_type,
        source,
        name,
        normalized_name,
        subtitle,
        image_url,
        owner_id,
        seed_data,
    })
}

fn project_seed_data(object: &Map<String, Value>, id: &str) -> Value {
    const SEED_FIELDS: &[&str] = &[
        "groupId",
        "name",
        "displayName",
        "authorId",
        "authorName",
        "ownerId",
        "ownerDisplayName",
        "description",
        "imageUrl",
        "thumbnailImageUrl",
        "iconUrl",
        "bannerUrl",
        "releaseStatus",
        "memberCount",
        "shortCode",
    ];
    let mut seed = Map::new();
    seed.insert("id".into(), Value::String(id.to_string()));
    for field in SEED_FIELDS {
        if let Some(value) = object.get(*field) {
            seed.insert((*field).to_string(), value.clone());
        }
    }
    Value::Object(seed)
}

fn search_candidates(
    candidates: &[QuickSearchCandidate],
    query: &str,
    exclude_ids: &HashSet<String>,
) -> Vec<QuickSearchResult> {
    let mut matches = candidates
        .iter()
        .filter(|row| !exclude_ids.contains(&row.id))
        .filter(|&row| row.normalized_name.contains(query))
        .map(|row| {
            (
                !row.normalized_name.starts_with(query),
                row.normalized_name.as_str(),
                row,
            )
        })
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| {
        (&left.0, left.1, &left.2.id).cmp(&(&right.0, right.1, &right.2.id))
    });
    matches
        .into_iter()
        .take(RESULT_LIMIT)
        .map(|(_, _, row)| candidate_result(row))
        .collect()
}

fn candidate_result(row: &QuickSearchCandidate) -> QuickSearchResult {
    QuickSearchResult {
        id: row.id.clone(),
        entity_type: row.entity_type,
        source: row.source.into(),
        name: row.name.clone(),
        subtitle: row.subtitle.clone(),
        image_url: row.image_url.clone(),
        seed_data: Some(RawJson::from(row.seed_data.clone())),
        memo: String::new(),
        note: String::new(),
        matched_field: QuickSearchMatchedField::Name,
        user_colour: String::new(),
    }
}

fn merge_results(target: &mut Vec<QuickSearchResult>, rows: Vec<QuickSearchResult>) {
    let mut seen = target
        .iter()
        .map(|row| row.id.clone())
        .collect::<HashSet<_>>();
    for row in rows {
        if target.len() >= RESULT_LIMIT {
            break;
        }
        if seen.insert(row.id.clone()) {
            target.push(row);
        }
    }
}

fn normalize_search_text(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter(|character| !character.is_whitespace())
        .map(fold_search_character)
        .flat_map(char::to_lowercase)
        .collect()
}

fn fold_search_character(character: char) -> char {
    match character {
        '\u{24b6}'..='\u{24cf}' => {
            char::from_u32('A' as u32 + character as u32 - 0x24b6).unwrap_or(character)
        }
        '\u{24d0}'..='\u{24e9}' => {
            char::from_u32('a' as u32 + character as u32 - 0x24d0).unwrap_or(character)
        }
        '\u{ff10}'..='\u{ff19}' => {
            char::from_u32('0' as u32 + character as u32 - 0xff10).unwrap_or(character)
        }
        '\u{ff21}'..='\u{ff3a}' => {
            char::from_u32('A' as u32 + character as u32 - 0xff21).unwrap_or(character)
        }
        '\u{ff41}'..='\u{ff5a}' => {
            char::from_u32('a' as u32 + character as u32 - 0xff41).unwrap_or(character)
        }
        _ => character,
    }
}

fn first_text_field(object: &Map<String, Value>, fields: &[&str]) -> String {
    fields
        .iter()
        .find_map(|field| {
            object
                .get(*field)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_default()
        .to_string()
}

fn rows_or_empty(result: Result<Vec<Value>>, failures: &mut usize) -> Vec<Value> {
    match result {
        Ok(rows) => rows,
        Err(error) => {
            *failures += 1;
            tracing::debug!(error = %error, "quick search source failed");
            Vec::new()
        }
    }
}

fn friend_snapshot_matches_scope(
    snapshot: &RealtimeFriendSnapshot,
    scope: &RuntimeAuthScopeSnapshot,
) -> bool {
    snapshot.current_user_id == scope.current_user_id && snapshot.endpoint == scope.endpoint
}

fn require_active_scope(auth_scope: &RuntimeAuthScope) -> Result<RuntimeAuthScopeSnapshot> {
    crate::scope_gate::require_active_scope(auth_scope, "Quick search")
}

fn ensure_scope_matches(
    auth_scope: &RuntimeAuthScope,
    expected: &RuntimeAuthScopeSnapshot,
) -> Result<()> {
    crate::scope_gate::ensure_scope_matches(auth_scope, expected, "Quick search")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn candidate(id: &str, name: &str) -> QuickSearchCandidate {
        QuickSearchCandidate {
            id: id.into(),
            entity_type: QuickSearchEntityType::Avatar,
            source: "test",
            name: name.into(),
            normalized_name: normalize_search_text(name),
            subtitle: String::new(),
            image_url: String::new(),
            owner_id: String::new(),
            seed_data: json!({ "id": id, "name": name }),
        }
    }

    #[test]
    fn remap_group_membership_row_ids_prefers_group_id_over_membership_record_id() {
        let mut rows = vec![
            json!({ "id": "gmem_membership_1", "groupId": "grp_real_1", "name": "Real Group" }),
            json!({ "id": "gmem_membership_2", "groupId": "", "name": "Missing Group Id" }),
            json!({ "id": "gmem_membership_3", "name": "No Group Id Field" }),
        ];

        remap_group_membership_row_ids(&mut rows);

        assert_eq!(rows[0]["id"], json!("grp_real_1"));
        assert_eq!(rows[1]["id"], json!("gmem_membership_2"));
        assert_eq!(rows[2]["id"], json!("gmem_membership_3"));
    }

    #[test]
    fn normalization_folds_whitespace_and_common_compatibility_characters() {
        assert_eq!(normalize_search_text("  ⓐlpha  ＢＥＴＡ "), "alphabeta");
    }

    #[test]
    fn candidate_search_prioritizes_prefixes_and_limits_results() {
        let candidates = [
            candidate("9", "Zed alpha"),
            candidate("1", "Alpha 9"),
            candidate("2", "Alpha 8"),
            candidate("3", "Alpha 7"),
            candidate("4", "Alpha 6"),
            candidate("5", "Alpha 5"),
            candidate("6", "Alpha 4"),
            candidate("7", "Alpha 3"),
            candidate("8", "Alpha 2"),
            candidate("10", "Beta alpha"),
        ];

        let results = search_candidates(&candidates, "alpha", &HashSet::new());

        assert_eq!(results.len(), RESULT_LIMIT);
        assert_eq!(
            results
                .iter()
                .map(|result| result.name.as_str())
                .collect::<Vec<_>>(),
            [
                "Alpha 2", "Alpha 3", "Alpha 4", "Alpha 5", "Alpha 6", "Alpha 7", "Alpha 8",
                "Alpha 9"
            ]
        );
    }

    #[test]
    fn friend_details_require_two_characters() {
        let friend = FriendRecord {
            id: "usr_1".into(),
            display_name: "Alpha".into(),
            ..FriendRecord::default()
        };
        let memos = HashMap::from([("usr_1".into(), "x-ray".into())]);
        let notes = HashMap::from([("usr_1".into(), "yellow".into())]);

        assert!(search_friends([friend.clone()], &memos, &notes, "x").is_empty());
        assert_eq!(
            search_friends([friend], &memos, &notes, "x-")[0].matched_field,
            QuickSearchMatchedField::Memo
        );
    }

    #[test]
    fn remote_projection_retains_only_dialog_seed_fields() {
        let row = json!({
            "id": "avtr_1",
            "name": "Avatar",
            "authorName": "Author",
            "thumbnailImageUrl": "https://example.test/image",
            "largeUnusedPayload": [1, 2, 3]
        });

        let projected = project_row(row, QuickSearchEntityType::Avatar, "favorite").unwrap();

        assert_eq!(projected.id, "avtr_1");
        assert_eq!(projected.name, "Avatar");
        assert!(projected.seed_data.get("largeUnusedPayload").is_none());
    }

    #[test]
    fn favorite_world_projection_uses_world_id_instead_of_favorite_record_id() {
        let row = json!({
            "favoriteId": "fvrt_1",
            "id": "wrld_1",
            "name": "Favorite World",
        });

        let projected = project_row(row, QuickSearchEntityType::World, "favorite").unwrap();

        assert_eq!(projected.id, "wrld_1");
        assert_eq!(projected.seed_data["id"], json!("wrld_1"));
    }
}
