use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_application_core::{read_config_string_array, FavoritesChangedPayload, TaskStopToken};
use vrcx_0_core::json::RawJson;
use vrcx_0_persistence::{
    avatars::avatar_cache_upsert, cache_entities::CacheEntityInput, favorites::favorite_add,
    DatabaseService,
};
use vrcx_0_vrchat_client::{
    avatars::avatar_get_input,
    favorites::{favorite_add_input, favorites_get_input},
    http_api::ApiScope,
    users::user_get_input,
    worlds::world_get_input,
};

use crate::{
    Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeEventBus, TaskSupervisor,
    WebClient, WorldCache,
};

use super::local_favorites::local_group_config_key;

pub const FAVORITE_IMPORT_MAX_ITEMS: usize = 1_000;
const FAVORITE_IMPORT_INTERVAL: Duration = Duration::from_millis(500);
const FAVORITE_IMPORT_CANCEL_POLL: Duration = Duration::from_millis(50);
const FAVORITE_IMPORT_PAGE_SIZE: i64 = 300;
const FAVORITE_IMPORT_MAX_PAGES: usize = 50;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteImportKind {
    Avatar,
    World,
    Friend,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteImportOperation {
    Hydrate,
    Import,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteImportLocation {
    Remote,
    Local,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteImportTarget {
    pub location: FavoriteImportLocation,
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub favorite_type: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteImportStartInput {
    pub kind: FavoriteImportKind,
    pub operation: FavoriteImportOperation,
    #[serde(default)]
    pub ids: Vec<String>,
    pub target: Option<FavoriteImportTarget>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteImportState {
    #[default]
    Idle,
    Running,
    Cancelling,
    Completed,
    Cancelled,
    Error,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteImportItemState {
    Succeeded,
    Failed,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteImportItemResult {
    pub id: String,
    pub state: FavoriteImportItemState,
    pub message: String,
    pub entity: Option<RawJson>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteImportStatus {
    pub run_id: String,
    pub status: FavoriteImportState,
    pub operation: FavoriteImportOperation,
    pub kind: FavoriteImportKind,
    pub auth_scope_generation: u64,
    pub total: usize,
    pub processed: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub cancel_requested: bool,
    pub items: Vec<FavoriteImportItemResult>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub last_error: Option<String>,
}

impl Default for FavoriteImportStatus {
    fn default() -> Self {
        Self {
            run_id: String::new(),
            status: FavoriteImportState::Idle,
            operation: FavoriteImportOperation::Hydrate,
            kind: FavoriteImportKind::Avatar,
            auth_scope_generation: 0,
            total: 0,
            processed: 0,
            succeeded: 0,
            failed: 0,
            cancel_requested: false,
            items: Vec::new(),
            started_at: None,
            finished_at: None,
            last_error: None,
        }
    }
}

#[derive(Clone)]
pub struct FavoriteImportRuntime {
    inner: Arc<Mutex<FavoriteImportRuntimeInner>>,
    generation: Arc<AtomicU64>,
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
    world_cache: Arc<WorldCache>,
    event_bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    auth_scope: RuntimeAuthScope,
}

#[derive(Default)]
struct FavoriteImportRuntimeInner {
    status: FavoriteImportStatus,
    cancel: Option<Arc<AtomicBool>>,
}

struct PreparedFavoriteImport {
    kind: FavoriteImportKind,
    operation: FavoriteImportOperation,
    ids: Vec<String>,
    target: Option<FavoriteImportTarget>,
}

impl FavoriteImportRuntime {
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        world_cache: Arc<WorldCache>,
        event_bus: RuntimeEventBus,
        tasks: TaskSupervisor,
        auth_scope: RuntimeAuthScope,
    ) -> Self {
        Self {
            inner: Arc::new(Mutex::new(FavoriteImportRuntimeInner::default())),
            generation: Arc::new(AtomicU64::new(0)),
            db,
            web,
            world_cache,
            event_bus,
            tasks,
            auth_scope,
        }
    }

    pub fn status(&self) -> FavoriteImportStatus {
        self.lock_inner().status.clone()
    }

    pub fn start(&self, input: FavoriteImportStartInput) -> Result<FavoriteImportStatus> {
        let prepared = prepare_favorite_import(input)?;
        let scope = self.auth_scope.snapshot();
        require_active_scope(&scope)?;
        let cancel = Arc::new(AtomicBool::new(false));
        let status = {
            let mut inner = self.lock_inner();
            if is_active_state(inner.status.status) {
                return Err(Error::Custom(
                    "Another favorite import is already active.".into(),
                ));
            }
            let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
            let status = FavoriteImportStatus {
                run_id: format!("favorite-{}-{generation}", Utc::now().timestamp_millis()),
                status: FavoriteImportState::Running,
                operation: prepared.operation,
                kind: prepared.kind,
                auth_scope_generation: scope.generation,
                total: prepared.ids.len(),
                started_at: Some(Utc::now().to_rfc3339()),
                ..Default::default()
            };
            inner.status = status.clone();
            inner.cancel = Some(Arc::clone(&cancel));
            status
        };
        self.emit_status(status.clone());

        let runtime = self.clone();
        let run_id = status.run_id.clone();
        self.tasks.spawn_cancellable(move |stop_token| async move {
            runtime
                .run_job(run_id, prepared, scope, cancel, stop_token)
                .await;
        });
        Ok(status)
    }

    pub fn cancel(&self) -> FavoriteImportStatus {
        let status = {
            let mut inner = self.lock_inner();
            if !is_active_state(inner.status.status) {
                return inner.status.clone();
            }
            if let Some(cancel) = &inner.cancel {
                cancel.store(true, Ordering::Release);
            }
            inner.status.status = FavoriteImportState::Cancelling;
            inner.status.cancel_requested = true;
            inner.status.clone()
        };
        self.emit_status(status.clone());
        status
    }

    pub fn cancel_if_scope_mismatch(&self) -> FavoriteImportStatus {
        let scope = self.auth_scope.snapshot();
        let status = {
            let mut inner = self.lock_inner();
            if !is_active_state(inner.status.status)
                || inner.status.auth_scope_generation == scope.generation
            {
                return inner.status.clone();
            }
            if let Some(cancel) = &inner.cancel {
                cancel.store(true, Ordering::Release);
            }
            inner.status.status = FavoriteImportState::Cancelling;
            inner.status.cancel_requested = true;
            inner.status.clone()
        };
        self.emit_status(status.clone());
        status
    }

    async fn run_job(
        &self,
        run_id: String,
        prepared: PreparedFavoriteImport,
        scope: RuntimeAuthScopeSnapshot,
        cancel: Arc<AtomicBool>,
        stop_token: TaskStopToken,
    ) {
        let import_location = prepared.target.as_ref().map(|target| target.location);
        if let Some(target) = prepared
            .target
            .as_ref()
            .filter(|target| target.location == FavoriteImportLocation::Local)
        {
            if let Err(error) = self.validate_local_target(prepared.kind, target) {
                self.finish_error(&run_id, error);
                return;
            }
        }
        let mut remote_ids = if prepared.operation == FavoriteImportOperation::Import
            && prepared
                .target
                .as_ref()
                .is_some_and(|target| target.location == FavoriteImportLocation::Remote)
        {
            match self
                .fetch_remote_favorite_ids(&scope, cancel.as_ref(), &stop_token)
                .await
            {
                Ok(ids) => Some(ids),
                Err(error) => {
                    if self.is_cancelled(&scope, cancel.as_ref(), &stop_token) {
                        self.finish_cancelled(&run_id, import_location);
                    } else {
                        self.finish_error(&run_id, error);
                    }
                    return;
                }
            }
        } else {
            None
        };

        for (index, id) in prepared.ids.iter().enumerate() {
            if self.is_cancelled(&scope, cancel.as_ref(), &stop_token) {
                self.finish_cancelled(&run_id, import_location);
                return;
            }
            if (index > 0 || remote_ids.is_some())
                && wait_for_interval(|| self.is_cancelled(&scope, cancel.as_ref(), &stop_token))
                    .await
            {
                self.finish_cancelled(&run_id, import_location);
                return;
            }

            let result = match prepared.operation {
                FavoriteImportOperation::Hydrate => {
                    self.hydrate_one(&scope, prepared.kind, id).await
                }
                FavoriteImportOperation::Import => self
                    .import_one(
                        &scope,
                        prepared.kind,
                        id,
                        prepared.target.as_ref().expect("validated import target"),
                        remote_ids.as_mut(),
                    )
                    .await
                    .map(|()| None),
            };
            let item = match result {
                Ok(entity) => FavoriteImportItemResult {
                    id: id.clone(),
                    state: FavoriteImportItemState::Succeeded,
                    message: String::new(),
                    entity,
                },
                Err(error) => FavoriteImportItemResult {
                    id: id.clone(),
                    state: FavoriteImportItemState::Failed,
                    message: error.to_string(),
                    entity: None,
                },
            };
            self.apply_item(&run_id, item);
            if self.is_cancelled(&scope, cancel.as_ref(), &stop_token) {
                self.finish_cancelled(&run_id, import_location);
                return;
            }
        }
        self.finish_completed(&run_id, import_location);
    }

    async fn hydrate_one(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
        kind: FavoriteImportKind,
        id: &str,
    ) -> Result<Option<RawJson>> {
        ensure_scope_matches(&self.auth_scope.snapshot(), scope)?;
        let request = match kind {
            FavoriteImportKind::Avatar => {
                avatar_get_input(scope.endpoint.clone(), id.to_string())?.1
            }
            FavoriteImportKind::World => world_get_input(scope.endpoint.clone(), id.to_string())?.1,
            FavoriteImportKind::Friend => user_get_input(scope.endpoint.clone(), id.to_string())?.1,
        };
        let payload = self
            .execute_json(scope, request, "favorite import profile lookup")
            .await?;
        let response_id = payload
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if response_id != id {
            return Err(Error::Custom(
                "Favorite import profile id did not match request.".into(),
            ));
        }
        match hydration_cache(kind) {
            FavoriteImportHydrationCache::Avatar => {
                avatar_cache_upsert(self.db.as_ref(), cache_entity_from_payload(&payload))?;
            }
            FavoriteImportHydrationCache::World => {
                self.world_cache
                    .hydrate_from_payload(&payload)
                    .ok_or_else(|| Error::Custom("World payload could not be cached.".into()))?;
            }
            FavoriteImportHydrationCache::None => {}
        }
        Ok(Some(RawJson::from(payload)))
    }

    async fn import_one(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
        kind: FavoriteImportKind,
        id: &str,
        target: &FavoriteImportTarget,
        remote_ids: Option<&mut HashSet<String>>,
    ) -> Result<()> {
        ensure_scope_matches(&self.auth_scope.snapshot(), scope)?;
        match target.location {
            FavoriteImportLocation::Local => {
                let affected = favorite_add(
                    self.db.as_ref(),
                    Some(&scope.current_user_id),
                    kind_name(kind).into(),
                    id.to_string(),
                    target.group.clone(),
                )?;
                if affected == 0 {
                    return Err(Error::Custom(format!(
                        "{} is already in local favorites.",
                        kind_label(kind)
                    )));
                }
            }
            FavoriteImportLocation::Remote => {
                let remote_ids = remote_ids.ok_or_else(|| {
                    Error::Custom("Remote favorite validation state is unavailable.".into())
                })?;
                if remote_ids.contains(id) {
                    return Err(Error::Custom(format!(
                        "{} is already in favorites.",
                        kind_label(kind)
                    )));
                }
                let (_, _, request) = favorite_add_input(
                    scope.endpoint.clone(),
                    target.favorite_type.clone(),
                    id.to_string(),
                    target.group.clone(),
                )?;
                self.execute_json(scope, request, "favorite import remote add")
                    .await?;
                remote_ids.insert(id.to_string());
            }
        }
        Ok(())
    }

    async fn fetch_remote_favorite_ids(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
        cancel: &AtomicBool,
        stop_token: &TaskStopToken,
    ) -> Result<HashSet<String>> {
        let mut ids = HashSet::new();
        let mut offset = 0;
        for page in 0..FAVORITE_IMPORT_MAX_PAGES {
            if self.is_cancelled(scope, cancel, stop_token) {
                return Err(Error::Custom("Favorite import was cancelled.".into()));
            }
            if page > 0 && wait_for_interval(|| self.is_cancelled(scope, cancel, stop_token)).await
            {
                return Err(Error::Custom("Favorite import was cancelled.".into()));
            }
            ensure_scope_matches(&self.auth_scope.snapshot(), scope)?;
            let request =
                favorites_get_input(scope.endpoint.clone(), FAVORITE_IMPORT_PAGE_SIZE, offset);
            let payload = self
                .execute_json(scope, request, "favorite import remote validation")
                .await?;
            let rows = payload.as_array().cloned().unwrap_or_default();
            let page_len = rows.len();
            for row in rows {
                if let Some(id) = row.get("favoriteId").and_then(Value::as_str) {
                    let id = id.trim();
                    if !id.is_empty() {
                        ids.insert(id.to_string());
                    }
                }
            }
            if page_len < FAVORITE_IMPORT_PAGE_SIZE as usize {
                break;
            }
            offset += FAVORITE_IMPORT_PAGE_SIZE;
        }
        Ok(ids)
    }

    fn validate_local_target(
        &self,
        kind: FavoriteImportKind,
        target: &FavoriteImportTarget,
    ) -> Result<()> {
        let groups =
            read_config_string_array(self.db.as_ref(), local_group_config_key(kind_name(kind))?)?;
        if groups.iter().any(|group| group == &target.group) {
            Ok(())
        } else {
            Err(Error::Custom(format!(
                "Local favorite group {} does not exist.",
                target.group
            )))
        }
    }

    async fn execute_json(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
        request: vrcx_0_vrchat_client::http_api::HttpApiRequestInput,
        action: &str,
    ) -> Result<Value> {
        ensure_scope_matches(&self.auth_scope.snapshot(), scope)?;
        let response = self
            .web
            .execute_api(request, ApiScope::Vrchat, self.db.as_ref())
            .await?;
        ensure_scope_matches(&self.auth_scope.snapshot(), scope)?;
        let payload = serde_json::from_str::<Value>(&response.data)
            .unwrap_or_else(|_| Value::String(response.data.clone()));
        if response.status >= 400 || payload.get("error").is_some() {
            return Err(Error::Custom(response_error_message(
                &payload,
                response.status,
                action,
            )));
        }
        Ok(payload)
    }

    fn is_cancelled(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
        cancel: &AtomicBool,
        stop_token: &TaskStopToken,
    ) -> bool {
        cancel.load(Ordering::Acquire)
            || stop_token.is_stop_requested()
            || ensure_scope_matches(&self.auth_scope.snapshot(), scope).is_err()
    }

    fn apply_item(&self, run_id: &str, item: FavoriteImportItemResult) {
        let status = {
            let mut inner = self.lock_inner();
            if inner.status.run_id != run_id || !is_active_state(inner.status.status) {
                return;
            }
            inner.status.processed += 1;
            match item.state {
                FavoriteImportItemState::Succeeded => inner.status.succeeded += 1,
                FavoriteImportItemState::Failed => {
                    inner.status.failed += 1;
                    inner.status.last_error = Some(item.message.clone());
                }
            }
            inner.status.items.push(item);
            inner.status.clone()
        };
        self.emit_status(status);
    }

    fn finish_completed(&self, run_id: &str, location: Option<FavoriteImportLocation>) {
        self.finish(run_id, FavoriteImportState::Completed, None, location);
    }

    fn finish_cancelled(&self, run_id: &str, location: Option<FavoriteImportLocation>) {
        self.finish(run_id, FavoriteImportState::Cancelled, None, location);
    }

    fn finish_error(&self, run_id: &str, error: Error) {
        self.finish(
            run_id,
            FavoriteImportState::Error,
            Some(error.to_string()),
            None,
        );
    }

    fn finish(
        &self,
        run_id: &str,
        state: FavoriteImportState,
        error: Option<String>,
        location: Option<FavoriteImportLocation>,
    ) {
        let status = {
            let mut inner = self.lock_inner();
            if inner.status.run_id != run_id || !is_active_state(inner.status.status) {
                return;
            }
            inner.status.status = state;
            inner.status.cancel_requested = false;
            inner.status.finished_at = Some(Utc::now().to_rfc3339());
            if error.is_some() {
                inner.status.last_error = error;
            }
            inner.cancel = None;
            inner.status.clone()
        };
        if status.operation == FavoriteImportOperation::Import && status.succeeded > 0 {
            if status.kind == FavoriteImportKind::World
                && location == Some(FavoriteImportLocation::Local)
            {
                self.world_cache.sync_favorites_from_db();
            }
            self.event_bus
                .emit_favorites_changed(FavoritesChangedPayload {
                    kind: kind_name(status.kind).into(),
                    local: location == Some(FavoriteImportLocation::Local),
                    remote: location == Some(FavoriteImportLocation::Remote),
                });
        }
        self.emit_status(status);
    }

    fn emit_status(&self, status: FavoriteImportStatus) {
        self.event_bus.emit(status);
    }

    fn lock_inner(&self) -> std::sync::MutexGuard<'_, FavoriteImportRuntimeInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn prepare_favorite_import(input: FavoriteImportStartInput) -> Result<PreparedFavoriteImport> {
    let mut seen = HashSet::new();
    let ids = input
        .ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| is_entity_id(input.kind, id))
        .filter(|id| seen.insert(id.clone()))
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Err(Error::Custom(
            "Favorite import requires at least one valid entity id.".into(),
        ));
    }
    if ids.len() > FAVORITE_IMPORT_MAX_ITEMS {
        return Err(Error::Custom(format!(
            "Favorite import cannot exceed {FAVORITE_IMPORT_MAX_ITEMS} items."
        )));
    }
    let target = match input.operation {
        FavoriteImportOperation::Hydrate => None,
        FavoriteImportOperation::Import => {
            let mut target = input
                .target
                .ok_or_else(|| Error::Custom("Favorite import requires a target group.".into()))?;
            target.group = target.group.trim().to_string();
            target.favorite_type = target.favorite_type.trim().to_string();
            if target.group.is_empty() {
                return Err(Error::Custom(
                    "Favorite import requires a target group.".into(),
                ));
            }
            if target.location == FavoriteImportLocation::Remote && target.favorite_type.is_empty()
            {
                return Err(Error::Custom(
                    "Remote favorite import requires a favorite type.".into(),
                ));
            }
            if target.location == FavoriteImportLocation::Remote
                && !favorite_type_matches_kind(input.kind, &target.favorite_type)
            {
                return Err(Error::Custom(
                    "Remote favorite type does not match the imported entity kind.".into(),
                ));
            }
            Some(target)
        }
    };
    Ok(PreparedFavoriteImport {
        kind: input.kind,
        operation: input.operation,
        ids,
        target,
    })
}

fn require_active_scope(scope: &RuntimeAuthScopeSnapshot) -> Result<()> {
    if scope.active && !scope.current_user_id.trim().is_empty() {
        Ok(())
    } else {
        Err(Error::Custom(
            "Favorite import requires an authenticated session.".into(),
        ))
    }
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
            "Favorite import authentication scope changed.".into(),
        ))
    }
}

fn is_active_state(state: FavoriteImportState) -> bool {
    matches!(
        state,
        FavoriteImportState::Running | FavoriteImportState::Cancelling
    )
}

async fn wait_for_interval(should_cancel: impl Fn() -> bool) -> bool {
    let started_at = tokio::time::Instant::now();
    loop {
        if should_cancel() {
            return true;
        }
        let elapsed = started_at.elapsed();
        if elapsed >= FAVORITE_IMPORT_INTERVAL {
            return false;
        }
        tokio::time::sleep((FAVORITE_IMPORT_INTERVAL - elapsed).min(FAVORITE_IMPORT_CANCEL_POLL))
            .await;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FavoriteImportHydrationCache {
    Avatar,
    World,
    None,
}

fn hydration_cache(kind: FavoriteImportKind) -> FavoriteImportHydrationCache {
    match kind {
        FavoriteImportKind::Avatar => FavoriteImportHydrationCache::Avatar,
        FavoriteImportKind::World => FavoriteImportHydrationCache::World,
        FavoriteImportKind::Friend => FavoriteImportHydrationCache::None,
    }
}

fn kind_name(kind: FavoriteImportKind) -> &'static str {
    match kind {
        FavoriteImportKind::Avatar => "avatar",
        FavoriteImportKind::World => "world",
        FavoriteImportKind::Friend => "friend",
    }
}

fn kind_label(kind: FavoriteImportKind) -> &'static str {
    match kind {
        FavoriteImportKind::Avatar => "Avatar",
        FavoriteImportKind::World => "World",
        FavoriteImportKind::Friend => "Friend",
    }
}

fn favorite_type_matches_kind(kind: FavoriteImportKind, favorite_type: &str) -> bool {
    match kind {
        FavoriteImportKind::Avatar => favorite_type == "avatar",
        FavoriteImportKind::World => matches!(favorite_type, "world" | "vrcPlusWorld"),
        FavoriteImportKind::Friend => favorite_type == "friend",
    }
}

fn is_entity_id(kind: FavoriteImportKind, value: &str) -> bool {
    let prefix = match kind {
        FavoriteImportKind::Avatar => "avtr_",
        FavoriteImportKind::World => "wrld_",
        FavoriteImportKind::Friend => "usr_",
    };
    let Some(uuid) = value.strip_prefix(prefix) else {
        return false;
    };
    uuid.len() == 36
        && uuid.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn cache_entity_from_payload(payload: &Value) -> CacheEntityInput {
    CacheEntityInput {
        id: payload.get("id").cloned().unwrap_or_default(),
        author_id: payload.get("authorId").cloned().unwrap_or_default(),
        author_name: payload.get("authorName").cloned().unwrap_or_default(),
        created_at: payload
            .get("created_at")
            .or_else(|| payload.get("createdAt"))
            .cloned()
            .unwrap_or_default(),
        description: payload.get("description").cloned().unwrap_or_default(),
        image_url: payload.get("imageUrl").cloned().unwrap_or_default(),
        name: payload.get("name").cloned().unwrap_or_default(),
        release_status: payload.get("releaseStatus").cloned().unwrap_or_default(),
        thumbnail_image_url: payload
            .get("thumbnailImageUrl")
            .cloned()
            .unwrap_or_default(),
        updated_at: payload
            .get("updated_at")
            .or_else(|| payload.get("updatedAt"))
            .cloned()
            .unwrap_or_default(),
        version: payload.get("version").cloned().unwrap_or_default(),
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

    const AVATAR_ID: &str = "avtr_00000000-0000-0000-0000-000000000001";
    const WORLD_ID: &str = "wrld_00000000-0000-0000-0000-000000000002";
    const FRIEND_ID: &str = "usr_00000000-0000-0000-0000-000000000003";

    #[test]
    fn entity_by_location_matrix_preserves_hydration_and_write_ownership() {
        let rows = [
            (
                FavoriteImportKind::Avatar,
                FavoriteImportHydrationCache::Avatar,
                "avatar",
            ),
            (
                FavoriteImportKind::World,
                FavoriteImportHydrationCache::World,
                "world",
            ),
            (
                FavoriteImportKind::Friend,
                FavoriteImportHydrationCache::None,
                "friend",
            ),
        ];
        for (kind, expected_cache, expected_kind) in rows {
            assert_eq!(hydration_cache(kind), expected_cache);
            assert_eq!(kind_name(kind), expected_kind);
            for location in [
                FavoriteImportLocation::Remote,
                FavoriteImportLocation::Local,
            ] {
                let prepared = prepare_favorite_import(FavoriteImportStartInput {
                    kind,
                    operation: FavoriteImportOperation::Import,
                    ids: vec![match kind {
                        FavoriteImportKind::Avatar => AVATAR_ID,
                        FavoriteImportKind::World => WORLD_ID,
                        FavoriteImportKind::Friend => FRIEND_ID,
                    }
                    .into()],
                    target: Some(FavoriteImportTarget {
                        location,
                        group: "target".into(),
                        favorite_type: expected_kind.into(),
                    }),
                })
                .unwrap();
                assert_eq!(prepared.target.unwrap().location, location);
            }
        }
    }

    #[test]
    fn prepare_deduplicates_and_rejects_ids_from_other_entity_types() {
        let prepared = prepare_favorite_import(FavoriteImportStartInput {
            kind: FavoriteImportKind::Avatar,
            operation: FavoriteImportOperation::Hydrate,
            ids: vec![AVATAR_ID.into(), AVATAR_ID.into(), WORLD_ID.into()],
            target: None,
        })
        .unwrap();

        assert_eq!(prepared.ids, vec![AVATAR_ID]);
        assert!(prepared.target.is_none());
    }

    #[test]
    fn remote_import_requires_favorite_type_but_local_import_does_not() {
        let input = |location| FavoriteImportStartInput {
            kind: FavoriteImportKind::Friend,
            operation: FavoriteImportOperation::Import,
            ids: vec![FRIEND_ID.into()],
            target: Some(FavoriteImportTarget {
                location,
                group: "target".into(),
                favorite_type: String::new(),
            }),
        };

        assert!(prepare_favorite_import(input(FavoriteImportLocation::Remote)).is_err());
        assert!(prepare_favorite_import(input(FavoriteImportLocation::Local)).is_ok());
    }

    #[test]
    fn remote_import_rejects_a_favorite_type_from_another_entity_kind() {
        assert!(prepare_favorite_import(FavoriteImportStartInput {
            kind: FavoriteImportKind::Avatar,
            operation: FavoriteImportOperation::Import,
            ids: vec![AVATAR_ID.into()],
            target: Some(FavoriteImportTarget {
                location: FavoriteImportLocation::Remote,
                group: "avatars1".into(),
                favorite_type: "friend".into(),
            }),
        })
        .is_err());
    }
}
