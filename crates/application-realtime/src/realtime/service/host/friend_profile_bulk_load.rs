use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::future::join_all;
use tokio::sync::watch;

use vrcx_0_application_core::{
    BackendRuntimeStatusPublisher, Error, RateLimitBackoff, RequestPacer, Result, RuntimeAuthScope,
};
pub use vrcx_0_application_core::{FriendProfileBulkLoadStatus, FriendProfileLoadStatusPayload};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint;

use crate::realtime::{
    RealtimeSessionContext, UserQueryCachePolicy, UserQueryKind, UserQueryOptions,
};

use super::state::ActiveRealtimeContext;
use super::{RealtimeHostRuntime, RealtimeHostRuntimeDeps, RealtimeStopRequest};

const FRIEND_PROFILE_BULK_LOAD_BACKOFF: RateLimitBackoff =
    RateLimitBackoff::new(Duration::from_millis(500), 4);
#[cfg(test)]
pub(super) const FRIEND_PROFILE_BULK_LOAD_REQUEST_INTERVAL: Duration = Duration::from_secs(1);
pub(super) const FRIEND_PROFILE_BULK_LOAD_CONCURRENCY: usize = 3;
pub(super) const FRIEND_PROFILE_BULK_LOAD_REQUEST_SPACING: Duration = Duration::from_millis(333);

pub(super) struct FriendProfileBulkLoadInitialProgress {
    pub(super) total: u32,
    pub(super) processed: u32,
}

impl FriendProfileBulkLoadInitialProgress {
    pub(super) fn new(total_friends: usize, pending_friends: usize) -> Self {
        let total = u32::try_from(total_friends).unwrap_or(u32::MAX);
        let pending = u32::try_from(pending_friends)
            .unwrap_or(u32::MAX)
            .min(total);
        Self {
            total,
            processed: total.saturating_sub(pending),
        }
    }
}

pub(super) enum FriendProfileBulkLoadItemOutcome {
    Loaded,
    Failed,
}

#[derive(Default)]
pub struct FriendProfileBulkLoadState {
    run_id: u64,
    status: FriendProfileBulkLoadStatus,
    owner: Option<FriendProfileBulkLoadOwner>,
    total: u32,
    processed: u32,
    loaded: u32,
    failed: u32,
    started_at: String,
    finished_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FriendProfileBulkLoadOwner {
    user_id: String,
    endpoint: String,
    auth_scope_generation: u64,
}

impl FriendProfileBulkLoadOwner {
    fn matches_auth_scope(
        &self,
        scope: &vrcx_0_application_core::RuntimeAuthScopeSnapshot,
    ) -> bool {
        scope.active
            && scope.generation == self.auth_scope_generation
            && scope.current_user_id == self.user_id
            && scope.endpoint == self.endpoint
    }

    fn matches_session(&self, session: &RealtimeSessionContext) -> bool {
        self.user_id == session.user_id.trim()
            && self.endpoint == normalize_vrchat_api_endpoint(Some(&session.endpoint))
    }

    fn matches_stop_request(&self, request: &RealtimeStopRequest) -> bool {
        request
            .user_id
            .as_ref()
            .map(|user_id| self.user_id == user_id.trim())
            .unwrap_or(true)
            && request
                .endpoint
                .as_ref()
                .map(|endpoint| {
                    self.endpoint == normalize_vrchat_api_endpoint(Some(endpoint.as_str()))
                })
                .unwrap_or(true)
    }
}

impl FriendProfileBulkLoadState {
    fn payload(&self) -> FriendProfileLoadStatusPayload {
        FriendProfileLoadStatusPayload {
            run_id: self.run_id,
            status: self.status,
            total: self.total,
            processed: self.processed,
            loaded: self.loaded,
            failed: self.failed,
            started_at: self.started_at.clone(),
            finished_at: self.finished_at.clone(),
        }
    }
}

fn is_active_bulk_load_status(status: FriendProfileBulkLoadStatus) -> bool {
    matches!(
        status,
        FriendProfileBulkLoadStatus::Running | FriendProfileBulkLoadStatus::Cancelling
    )
}

pub(super) fn select_friend_profile_bulk_load_targets(
    friends_by_id: &HashMap<String, FriendRecord>,
) -> Vec<String> {
    let mut ids: Vec<String> = friends_by_id
        .values()
        .filter(|friend| !friend.id.trim().is_empty() && friend_missing_date_joined(friend))
        .map(|friend| friend.id.clone())
        .collect();
    ids.sort();
    ids
}

fn friend_missing_date_joined(friend: &FriendRecord) -> bool {
    friend
        .date_joined
        .as_str()
        .is_none_or(|value| value.trim().is_empty())
}

pub(super) struct FriendProfileBulkLoader {
    state: Mutex<FriendProfileBulkLoadState>,
    cancel_tx: watch::Sender<u64>,
    auth_scope: RuntimeAuthScope,
    backend_status: BackendRuntimeStatusPublisher,
}

impl RealtimeHostRuntime {
    pub fn start_friend_profile_bulk_load(
        self: &Arc<Self>,
    ) -> Result<FriendProfileLoadStatusPayload> {
        self.friend_profile_bulk
            .start_friend_profile_bulk_load(self)
    }

    pub fn cancel_friend_profile_bulk_load(&self) -> Result<FriendProfileLoadStatusPayload> {
        self.friend_profile_bulk.cancel_friend_profile_bulk_load()
    }

    #[cfg(test)]
    pub fn friend_profile_bulk_load_status(&self) -> FriendProfileLoadStatusPayload {
        self.friend_profile_bulk.friend_profile_bulk_load_status()
    }
}

impl FriendProfileBulkLoader {
    pub(super) fn new(deps: &RealtimeHostRuntimeDeps) -> Self {
        let (cancel_tx, _) = watch::channel(0);
        Self {
            state: Mutex::new(FriendProfileBulkLoadState::default()),
            cancel_tx,
            auth_scope: deps.auth_scope.clone(),
            backend_status: deps.backend_status.clone(),
        }
    }

    fn start_friend_profile_bulk_load(
        &self,
        host: &Arc<RealtimeHostRuntime>,
    ) -> Result<FriendProfileLoadStatusPayload> {
        let active = {
            let state = host
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            state.connection.active_context.clone().ok_or_else(|| {
                Error::Custom(
                    "Friend profile bulk load requires an active realtime session.".into(),
                )
            })?
        };
        let owner = self
            .friend_profile_bulk_load_owner(&active)
            .ok_or_else(|| {
                Error::Custom(
                    "Friend profile bulk load requires the active authenticated scope.".into(),
                )
            })?;
        let (targets, run_id, spawn_worker, stale_run_id) = {
            let mut bulk = self.state.lock().map_err(|error| {
                Error::Custom(format!("friend profile bulk load lock: {error}"))
            })?;
            if is_active_bulk_load_status(bulk.status) && bulk.owner.as_ref() == Some(&owner) {
                return Ok(bulk.payload());
            }
            let snapshot = host.friends.snapshot().filter(|snapshot| {
                snapshot.generation == active.generation
                    && snapshot.current_user_id == active.session.user_id
            });
            let Some(snapshot) = snapshot else {
                return Err(Error::Custom(
                    "Friend profile bulk load requires a loaded friend roster.".into(),
                ));
            };
            let stale_run_id = is_active_bulk_load_status(bulk.status).then_some(bulk.run_id);
            let targets = select_friend_profile_bulk_load_targets(&snapshot.friends_by_id);
            let initial_progress = FriendProfileBulkLoadInitialProgress::new(
                snapshot.friends_by_id.len(),
                targets.len(),
            );
            let run_id = bulk.run_id.saturating_add(1);
            let now = chrono::Utc::now().to_rfc3339();
            bulk.run_id = run_id;
            bulk.owner = Some(owner.clone());
            bulk.total = initial_progress.total;
            bulk.processed = initial_progress.processed;
            bulk.loaded = 0;
            bulk.failed = 0;
            bulk.started_at = now.clone();
            bulk.finished_at = None;
            let spawn_worker = !targets.is_empty();
            bulk.status = if spawn_worker {
                FriendProfileBulkLoadStatus::Running
            } else {
                bulk.finished_at = Some(now);
                FriendProfileBulkLoadStatus::Completed
            };
            (targets, run_id, spawn_worker, stale_run_id)
        };

        if let Some(stale_run_id) = stale_run_id {
            self.cancel_tx.send_replace(stale_run_id);
        }
        let payload = self.emit_friend_profile_bulk_load_status();
        if spawn_worker {
            let runtime = Arc::clone(host);
            host.deps.tasks.spawn(async move {
                runtime
                    .friend_profile_bulk
                    .run_friend_profile_bulk_load(&runtime, run_id, owner, targets)
                    .await;
            });
        }
        Ok(payload)
    }

    fn cancel_friend_profile_bulk_load(&self) -> Result<FriendProfileLoadStatusPayload> {
        let cancelled_run_id = {
            let mut bulk = self.state.lock().map_err(|error| {
                Error::Custom(format!("friend profile bulk load lock: {error}"))
            })?;
            if bulk.status == FriendProfileBulkLoadStatus::Running {
                bulk.status = FriendProfileBulkLoadStatus::Cancelling;
                Some(bulk.run_id)
            } else {
                None
            }
        };
        if let Some(run_id) = cancelled_run_id {
            self.cancel_tx.send_replace(run_id);
        }
        Ok(self.emit_friend_profile_bulk_load_status())
    }

    pub(super) fn cancel_friend_profile_bulk_load_for_session(
        &self,
        session: &RealtimeSessionContext,
    ) {
        self.cancel_friend_profile_bulk_load_if(|owner| owner.matches_session(session));
    }

    pub(super) fn cancel_friend_profile_bulk_load_for_replacement(
        &self,
        session: &RealtimeSessionContext,
    ) {
        let scope = self.auth_scope.snapshot();
        self.cancel_friend_profile_bulk_load_if(|owner| {
            !owner.matches_session(session) || !owner.matches_auth_scope(&scope)
        });
    }

    pub(super) fn cancel_friend_profile_bulk_load_for_stop_request(
        &self,
        request: &RealtimeStopRequest,
    ) {
        self.cancel_friend_profile_bulk_load_if(|owner| owner.matches_stop_request(request));
    }

    fn cancel_friend_profile_bulk_load_if(
        &self,
        should_cancel: impl FnOnce(&FriendProfileBulkLoadOwner) -> bool,
    ) {
        let cancelled_run_id = {
            let Ok(mut bulk) = self.state.lock() else {
                return;
            };
            if !is_active_bulk_load_status(bulk.status)
                || !bulk.owner.as_ref().is_some_and(should_cancel)
            {
                return;
            }
            bulk.status = FriendProfileBulkLoadStatus::Cancelled;
            bulk.finished_at = Some(chrono::Utc::now().to_rfc3339());
            bulk.run_id
        };
        self.cancel_tx.send_replace(cancelled_run_id);
        self.emit_friend_profile_bulk_load_status();
    }

    #[cfg(test)]
    fn friend_profile_bulk_load_status(&self) -> FriendProfileLoadStatusPayload {
        self.state
            .lock()
            .map(|bulk| bulk.payload())
            .unwrap_or_default()
    }

    fn emit_friend_profile_bulk_load_status(&self) -> FriendProfileLoadStatusPayload {
        let payload = {
            let Ok(bulk) = self.state.lock() else {
                return FriendProfileBulkLoadState::default().payload();
            };
            bulk.payload()
        };
        self.backend_status
            .publish_friend_profile_load_status(payload.clone());
        payload
    }

    fn friend_profile_bulk_load_owner(
        &self,
        active: &ActiveRealtimeContext,
    ) -> Option<FriendProfileBulkLoadOwner> {
        let scope = self.auth_scope.snapshot();
        let endpoint = normalize_vrchat_api_endpoint(Some(&active.session.endpoint));
        (scope.active
            && scope.current_user_id == active.session.user_id
            && scope.endpoint == endpoint)
            .then_some(FriendProfileBulkLoadOwner {
                user_id: scope.current_user_id,
                endpoint: scope.endpoint,
                auth_scope_generation: scope.generation,
            })
    }

    fn friend_profile_bulk_load_owner_is_current(
        &self,
        owner: &FriendProfileBulkLoadOwner,
    ) -> bool {
        owner.matches_auth_scope(&self.auth_scope.snapshot())
    }

    fn friend_profile_bulk_load_is_current(
        &self,
        run_id: u64,
        owner: &FriendProfileBulkLoadOwner,
    ) -> bool {
        if *self.cancel_tx.borrow() == run_id {
            return false;
        }
        let bulk_current = self
            .state
            .lock()
            .map(|bulk| {
                bulk.run_id == run_id
                    && bulk.status == FriendProfileBulkLoadStatus::Running
                    && bulk.owner.as_ref() == Some(owner)
            })
            .unwrap_or(false);
        bulk_current && self.friend_profile_bulk_load_owner_is_current(owner)
    }

    fn friend_profile_bulk_load_active_context(
        &self,
        host: &RealtimeHostRuntime,
        owner: &FriendProfileBulkLoadOwner,
    ) -> Option<ActiveRealtimeContext> {
        host.state.lock().ok().and_then(|state| {
            state
                .connection
                .active_context
                .as_ref()
                .filter(|active| owner.matches_session(&active.session))
                .cloned()
        })
    }

    fn friend_profile_bulk_load_transport_is_current(
        &self,
        host: &RealtimeHostRuntime,
        active: &ActiveRealtimeContext,
    ) -> bool {
        host.state
            .lock()
            .map(|state| {
                host.is_message_current_locked(
                    &state,
                    active.generation,
                    active.session_generation,
                    &active.session,
                )
            })
            .unwrap_or(false)
    }

    async fn wait_for_friend_profile_bulk_load_transport(
        &self,
        host: &RealtimeHostRuntime,
        run_id: u64,
        owner: &FriendProfileBulkLoadOwner,
        cancel_rx: &mut tokio::sync::watch::Receiver<u64>,
        transport_rx: &mut tokio::sync::watch::Receiver<u64>,
    ) -> Option<ActiveRealtimeContext> {
        loop {
            if !self.friend_profile_bulk_load_is_current(run_id, owner) {
                return None;
            }
            if let Some(active) = self.friend_profile_bulk_load_active_context(host, owner) {
                return Some(active);
            }
            tokio::select! {
                biased;
                _ = wait_for_friend_profile_bulk_load_cancel(run_id, cancel_rx) => return None,
                changed = transport_rx.changed() => {
                    if changed.is_err() {
                        return None;
                    }
                }
            }
        }
    }

    async fn load_friend_profile_bulk_item(
        host: &Arc<RealtimeHostRuntime>,
        run_id: u64,
        owner: &FriendProfileBulkLoadOwner,
        user_id: &str,
        pacer: &RequestPacer,
        cancel_rx: &mut tokio::sync::watch::Receiver<u64>,
        transport_rx: &mut tokio::sync::watch::Receiver<u64>,
    ) -> Option<FriendProfileBulkLoadItemOutcome> {
        let loader = &host.friend_profile_bulk;
        let mut attempt = 0u32;
        loop {
            let active = loader
                .wait_for_friend_profile_bulk_load_transport(
                    host,
                    run_id,
                    owner,
                    cancel_rx,
                    transport_rx,
                )
                .await?;
            tokio::select! {
                biased;
                _ = wait_for_friend_profile_bulk_load_cancel(run_id, cancel_rx) => return None,
                _ = pacer.acquire_slot() => {}
            }
            if !loader.friend_profile_bulk_load_is_current(run_id, owner) {
                return None;
            }
            let response = tokio::select! {
                biased;
                _ = wait_for_friend_profile_bulk_load_cancel(run_id, cancel_rx) => return None,
                response = host.get_user_via_cache_with_options(
                    owner.endpoint.clone(),
                    user_id.to_string(),
                    UserQueryOptions {
                        kind: UserQueryKind::LiveFriend,
                        cache_policy: UserQueryCachePolicy::UseCache,
                    },
                ) => response,
            };
            if !loader.friend_profile_bulk_load_is_current(run_id, owner) {
                return None;
            }
            if !loader.friend_profile_bulk_load_transport_is_current(host, &active) {
                host.invalidate_user_query_cache(&owner.endpoint, user_id)
                    .await;
                continue;
            }
            match response {
                Ok(response) if (200..300).contains(&response.status) => {
                    return Some(FriendProfileBulkLoadItemOutcome::Loaded);
                }
                Ok(response)
                    if response.status == 429
                        && attempt < FRIEND_PROFILE_BULK_LOAD_BACKOFF.max_retries() =>
                {
                    let delay = FRIEND_PROFILE_BULK_LOAD_BACKOFF.delay(attempt);
                    attempt += 1;
                    pacer.delay_next_slots(delay).await;
                    tokio::select! {
                        biased;
                        _ = wait_for_friend_profile_bulk_load_cancel(run_id, cancel_rx) => return None,
                        _ = transport_rx.changed() => continue,
                        _ = tokio::time::sleep(delay) => {}
                    }
                    if !loader.friend_profile_bulk_load_is_current(run_id, owner) {
                        return None;
                    }
                }
                _ => return Some(FriendProfileBulkLoadItemOutcome::Failed),
            }
        }
    }

    fn friend_profile_bulk_load_record_progress(
        &self,
        run_id: u64,
        owner: &FriendProfileBulkLoadOwner,
        outcome: FriendProfileBulkLoadItemOutcome,
    ) -> bool {
        if !self.friend_profile_bulk_load_is_current(run_id, owner) {
            return false;
        }
        {
            let Ok(mut bulk) = self.state.lock() else {
                return false;
            };
            if bulk.run_id != run_id || bulk.status != FriendProfileBulkLoadStatus::Running {
                return false;
            }
            bulk.processed = bulk.processed.saturating_add(1);
            match outcome {
                FriendProfileBulkLoadItemOutcome::Loaded => {
                    bulk.loaded = bulk.loaded.saturating_add(1);
                }
                FriendProfileBulkLoadItemOutcome::Failed => {
                    bulk.failed = bulk.failed.saturating_add(1);
                }
            }
        }
        self.emit_friend_profile_bulk_load_status();
        true
    }

    async fn run_friend_profile_bulk_load(
        &self,
        host: &Arc<RealtimeHostRuntime>,
        run_id: u64,
        owner: FriendProfileBulkLoadOwner,
        targets: Vec<String>,
    ) {
        let queue = Mutex::new(VecDeque::from(targets));
        let pacer = RequestPacer::new(FRIEND_PROFILE_BULK_LOAD_REQUEST_SPACING);
        let workers = (0..FRIEND_PROFILE_BULK_LOAD_CONCURRENCY).map(|_| {
            self.run_friend_profile_bulk_load_worker(host, run_id, &owner, &queue, &pacer)
        });
        join_all(workers).await;

        self.finish_friend_profile_bulk_load(run_id, &owner);
    }

    async fn run_friend_profile_bulk_load_worker(
        &self,
        host: &Arc<RealtimeHostRuntime>,
        run_id: u64,
        owner: &FriendProfileBulkLoadOwner,
        queue: &Mutex<VecDeque<String>>,
        pacer: &RequestPacer,
    ) {
        let mut cancel_rx = self.cancel_tx.subscribe();
        let mut transport_rx = host.cancel_tx.subscribe();
        loop {
            if !self.friend_profile_bulk_load_is_current(run_id, owner) {
                return;
            }
            let Some(user_id) = queue
                .lock()
                .ok()
                .and_then(|mut targets| targets.pop_front())
            else {
                return;
            };
            let Some(outcome) = Self::load_friend_profile_bulk_item(
                host,
                run_id,
                owner,
                &user_id,
                pacer,
                &mut cancel_rx,
                &mut transport_rx,
            )
            .await
            else {
                return;
            };
            if !self.friend_profile_bulk_load_record_progress(run_id, owner, outcome) {
                return;
            }
        }
    }

    fn finish_friend_profile_bulk_load(&self, run_id: u64, owner: &FriendProfileBulkLoadOwner) {
        let owner_current = self.friend_profile_bulk_load_owner_is_current(owner);
        {
            let Ok(mut bulk) = self.state.lock() else {
                return;
            };
            if bulk.run_id != run_id {
                return;
            }
            bulk.status = match bulk.status {
                FriendProfileBulkLoadStatus::Running if owner_current => {
                    FriendProfileBulkLoadStatus::Completed
                }
                FriendProfileBulkLoadStatus::Running | FriendProfileBulkLoadStatus::Cancelling => {
                    FriendProfileBulkLoadStatus::Cancelled
                }
                _ => return,
            };
            bulk.finished_at = Some(chrono::Utc::now().to_rfc3339());
        }
        self.emit_friend_profile_bulk_load_status();
    }
}

#[cfg(test)]
impl RealtimeHostRuntime {
    pub(super) fn test_force_friend_profile_bulk_load_running(&self, run_id: u64, total: u32) {
        self.friend_profile_bulk
            .test_force_friend_profile_bulk_load_running(self, run_id, total);
    }

    pub(super) fn test_friend_profile_bulk_load_record_progress(
        &self,
        run_id: u64,
        outcome: FriendProfileBulkLoadItemOutcome,
    ) -> bool {
        self.friend_profile_bulk
            .test_friend_profile_bulk_load_record_progress(run_id, outcome)
    }
}

#[cfg(test)]
impl FriendProfileBulkLoader {
    fn test_force_friend_profile_bulk_load_running(
        &self,
        host: &RealtimeHostRuntime,
        run_id: u64,
        total: u32,
    ) {
        let active = host
            .state
            .lock()
            .unwrap()
            .connection
            .active_context
            .clone()
            .expect("test runtime should have an active realtime context");
        let owner = self
            .friend_profile_bulk_load_owner(&active)
            .expect("test runtime should have an active auth scope");
        let mut bulk = self.state.lock().unwrap();
        bulk.run_id = run_id;
        bulk.status = FriendProfileBulkLoadStatus::Running;
        bulk.owner = Some(owner);
        bulk.total = total;
        bulk.started_at = chrono::Utc::now().to_rfc3339();
    }

    fn test_friend_profile_bulk_load_record_progress(
        &self,
        run_id: u64,
        outcome: FriendProfileBulkLoadItemOutcome,
    ) -> bool {
        let Some(owner) = self.state.lock().unwrap().owner.clone() else {
            return false;
        };
        self.friend_profile_bulk_load_record_progress(run_id, &owner, outcome)
    }
}

async fn wait_for_friend_profile_bulk_load_cancel(
    run_id: u64,
    cancel_rx: &mut tokio::sync::watch::Receiver<u64>,
) {
    loop {
        if *cancel_rx.borrow_and_update() == run_id {
            return;
        }
        if cancel_rx.changed().await.is_err() {
            return;
        }
    }
}
