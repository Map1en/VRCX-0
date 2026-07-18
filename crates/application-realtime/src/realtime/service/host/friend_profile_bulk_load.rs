use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use futures_util::stream::{self, StreamExt};
pub use vrcx_0_application_core::{FriendProfileBulkLoadStatus, FriendProfileLoadStatusPayload};

use super::state::ActiveRealtimeContext;
use super::*;

pub(super) const FRIEND_PROFILE_BULK_LOAD_CONCURRENCY: usize = 3;
const FRIEND_PROFILE_BULK_LOAD_MAX_RETRIES: u32 = 4;
const FRIEND_PROFILE_BULK_LOAD_BASE_DELAY_MS: u64 = 500;
const PROGRESS_EMIT_MIN_INTERVAL_MS: i64 = 250;
const PROGRESS_EMIT_MIN_PROCESSED_DELTA: u32 = 10;
const FRIEND_PROFILE_BULK_LOAD_START_INTERVAL_MS: u64 = 1_000;

#[derive(Default)]
pub struct FriendProfileBulkLoadState {
    run_id: u64,
    status: FriendProfileBulkLoadStatus,
    owner: Option<ActiveRealtimeContext>,
    total: u32,
    processed: u32,
    loaded: u32,
    failed: u32,
    started_at: String,
    finished_at: Option<String>,
    last_error: Option<String>,
    last_emit_at_ms: i64,
    last_emit_processed: u32,
}

fn friend_profile_bulk_load_owner_matches(
    owner: Option<&ActiveRealtimeContext>,
    active: &ActiveRealtimeContext,
) -> bool {
    owner
        .map(|owner| {
            owner.generation == active.generation
                && owner.client_run_id == active.client_run_id
                && owner.session_generation == active.session_generation
                && owner.session == active.session
        })
        .unwrap_or(false)
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
            last_error: self.last_error.clone(),
        }
    }
}

fn is_active_bulk_load_status(status: FriendProfileBulkLoadStatus) -> bool {
    matches!(
        status,
        FriendProfileBulkLoadStatus::Running | FriendProfileBulkLoadStatus::Cancelling
    )
}

fn is_terminal_bulk_load_status(status: FriendProfileBulkLoadStatus) -> bool {
    matches!(
        status,
        FriendProfileBulkLoadStatus::Completed
            | FriendProfileBulkLoadStatus::Cancelled
            | FriendProfileBulkLoadStatus::Error
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
    match friend.extra.get("date_joined") {
        None => true,
        Some(Value::Null) => true,
        Some(Value::String(value)) => value.trim().is_empty(),
        Some(_) => false,
    }
}

pub(super) fn friend_profile_bulk_load_backoff_delay_ms(attempt: u32) -> u64 {
    FRIEND_PROFILE_BULK_LOAD_BASE_DELAY_MS.saturating_mul(1u64 << attempt.min(16))
}

pub(super) fn friend_profile_bulk_load_initial_progress(
    total_friends: usize,
    pending_friends: usize,
) -> (u32, u32) {
    let total = u32::try_from(total_friends).unwrap_or(u32::MAX);
    let pending = u32::try_from(pending_friends)
        .unwrap_or(u32::MAX)
        .min(total);
    (total, total.saturating_sub(pending))
}

pub(super) fn reserve_friend_profile_bulk_load_request_slot(
    now: tokio::time::Instant,
    next_request_at: &mut tokio::time::Instant,
) -> tokio::time::Instant {
    let scheduled_at = (*next_request_at).max(now);
    *next_request_at =
        scheduled_at + Duration::from_millis(FRIEND_PROFILE_BULK_LOAD_START_INTERVAL_MS);
    scheduled_at
}

pub(super) fn should_emit_friend_profile_bulk_load_progress(
    is_terminal: bool,
    processed: u32,
    last_emit_processed: u32,
    now_ms: i64,
    last_emit_at_ms: i64,
) -> bool {
    if is_terminal || last_emit_at_ms == 0 {
        return true;
    }
    let elapsed = now_ms.saturating_sub(last_emit_at_ms);
    elapsed >= PROGRESS_EMIT_MIN_INTERVAL_MS
        || processed.saturating_sub(last_emit_processed) >= PROGRESS_EMIT_MIN_PROCESSED_DELTA
}

impl RealtimeHostRuntime {
    pub fn start_friend_profile_bulk_load(
        self: &Arc<Self>,
    ) -> Result<FriendProfileLoadStatusPayload> {
        let active = {
            let state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            state.connection.active_context.clone().ok_or_else(|| {
                Error::Custom(
                    "Friend profile bulk load requires an active realtime session.".into(),
                )
            })?
        };
        let (targets, run_id, spawn_worker, stale_run_id) = {
            let mut bulk = self.friend_profile_bulk_load.lock().map_err(|error| {
                Error::Custom(format!("friend profile bulk load lock: {error}"))
            })?;
            if is_active_bulk_load_status(bulk.status)
                && friend_profile_bulk_load_owner_matches(bulk.owner.as_ref(), &active)
            {
                return Ok(bulk.payload());
            }
            let snapshot = self.friends.snapshot().filter(|snapshot| {
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
            let (total, processed) = friend_profile_bulk_load_initial_progress(
                snapshot.friends_by_id.len(),
                targets.len(),
            );
            let run_id = bulk.run_id.saturating_add(1);
            let now = chrono::Utc::now().to_rfc3339();
            bulk.run_id = run_id;
            bulk.owner = Some(active.clone());
            bulk.total = total;
            bulk.processed = processed;
            bulk.loaded = 0;
            bulk.failed = 0;
            bulk.started_at = now.clone();
            bulk.finished_at = None;
            bulk.last_error = None;
            bulk.last_emit_at_ms = 0;
            bulk.last_emit_processed = 0;
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
            self.friend_profile_bulk_cancel_tx
                .send_replace(stale_run_id);
        }
        let payload = self.emit_friend_profile_bulk_load_status(true);
        if spawn_worker {
            let runtime = Arc::clone(self);
            self.deps.tasks.spawn(async move {
                runtime
                    .run_friend_profile_bulk_load(run_id, active, targets)
                    .await;
            });
        }
        Ok(payload)
    }

    pub fn cancel_friend_profile_bulk_load(&self) -> Result<FriendProfileLoadStatusPayload> {
        let cancelled_run_id = {
            let mut bulk = self.friend_profile_bulk_load.lock().map_err(|error| {
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
            self.friend_profile_bulk_cancel_tx.send_replace(run_id);
        }
        Ok(self.emit_friend_profile_bulk_load_status(true))
    }

    pub(super) fn cancel_friend_profile_bulk_load_for_session(
        &self,
        active: &ActiveRealtimeContext,
    ) {
        let cancelled_run_id = {
            let Ok(mut bulk) = self.friend_profile_bulk_load.lock() else {
                return;
            };
            if !is_active_bulk_load_status(bulk.status)
                || !friend_profile_bulk_load_owner_matches(bulk.owner.as_ref(), active)
            {
                return;
            }
            bulk.status = FriendProfileBulkLoadStatus::Cancelled;
            bulk.finished_at = Some(chrono::Utc::now().to_rfc3339());
            bulk.run_id
        };
        self.friend_profile_bulk_cancel_tx
            .send_replace(cancelled_run_id);
        self.emit_friend_profile_bulk_load_status(true);
    }

    pub fn friend_profile_bulk_load_status(&self) -> FriendProfileLoadStatusPayload {
        self.friend_profile_bulk_load
            .lock()
            .map(|bulk| bulk.payload())
            .unwrap_or_default()
    }

    fn emit_friend_profile_bulk_load_status(&self, force: bool) -> FriendProfileLoadStatusPayload {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let (payload, should_emit) = {
            let Ok(mut bulk) = self.friend_profile_bulk_load.lock() else {
                return FriendProfileBulkLoadState::default().payload();
            };
            let should_emit = force
                || should_emit_friend_profile_bulk_load_progress(
                    is_terminal_bulk_load_status(bulk.status),
                    bulk.processed,
                    bulk.last_emit_processed,
                    now_ms,
                    bulk.last_emit_at_ms,
                );
            if should_emit {
                bulk.last_emit_at_ms = now_ms;
                bulk.last_emit_processed = bulk.processed;
            }
            (bulk.payload(), should_emit)
        };
        if should_emit {
            self.deps
                .event_bus
                .emit_friend_profile_load_status(payload.clone());
        }
        payload
    }

    fn friend_profile_bulk_load_is_current(
        &self,
        run_id: u64,
        active: &ActiveRealtimeContext,
    ) -> bool {
        if *self.friend_profile_bulk_cancel_tx.borrow() == run_id {
            return false;
        }
        let bulk_current = self
            .friend_profile_bulk_load
            .lock()
            .map(|bulk| {
                bulk.run_id == run_id
                    && bulk.status == FriendProfileBulkLoadStatus::Running
                    && friend_profile_bulk_load_owner_matches(bulk.owner.as_ref(), active)
            })
            .unwrap_or(false);
        if !bulk_current {
            return false;
        }
        self.state
            .lock()
            .map(|state| {
                self.is_message_current_locked(
                    &state,
                    active.generation,
                    active.session_generation,
                    &active.session,
                )
            })
            .unwrap_or(false)
    }

    async fn load_friend_profile_bulk_item(
        self: &Arc<Self>,
        run_id: u64,
        active: &ActiveRealtimeContext,
        user_id: &str,
        cancel_rx: &mut tokio::sync::watch::Receiver<u64>,
    ) -> Option<(bool, bool)> {
        let mut attempt = 0u32;
        loop {
            if !self.friend_profile_bulk_load_is_current(run_id, active) {
                return None;
            }
            let response = tokio::select! {
                biased;
                _ = wait_for_friend_profile_bulk_load_cancel(run_id, cancel_rx) => return None,
                response = self.get_user_via_cache_with_source(
                    active.session.endpoint.clone(),
                    user_id.to_string(),
                    false,
                    false,
                    Some(true),
                    Some(RealtimeProjectionSource::FriendProfileBulkLoad),
                ) => response,
            };
            match response {
                Ok(response) if (200..300).contains(&response.status) => {
                    return Some((true, false));
                }
                Ok(response)
                    if response.status == 429 && attempt < FRIEND_PROFILE_BULK_LOAD_MAX_RETRIES =>
                {
                    let delay_ms = friend_profile_bulk_load_backoff_delay_ms(attempt);
                    attempt += 1;
                    tokio::select! {
                        biased;
                        _ = wait_for_friend_profile_bulk_load_cancel(run_id, cancel_rx) => return None,
                        _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => {}
                    }
                    if !self.friend_profile_bulk_load_is_current(run_id, active) {
                        return None;
                    }
                }
                _ => return Some((false, true)),
            }
        }
    }

    fn friend_profile_bulk_load_record_progress(
        &self,
        run_id: u64,
        active: &ActiveRealtimeContext,
        loaded: bool,
        failed: bool,
    ) -> bool {
        if !self.friend_profile_bulk_load_is_current(run_id, active) {
            return false;
        }
        {
            let Ok(mut bulk) = self.friend_profile_bulk_load.lock() else {
                return false;
            };
            if bulk.run_id != run_id || bulk.status != FriendProfileBulkLoadStatus::Running {
                return false;
            }
            bulk.processed = bulk.processed.saturating_add(1);
            if loaded {
                bulk.loaded = bulk.loaded.saturating_add(1);
            }
            if failed {
                bulk.failed = bulk.failed.saturating_add(1);
            }
        }
        self.emit_friend_profile_bulk_load_status(false);
        true
    }

    async fn run_friend_profile_bulk_load(
        self: Arc<Self>,
        run_id: u64,
        active: ActiveRealtimeContext,
        targets: Vec<String>,
    ) {
        let index = Arc::new(AtomicUsize::new(0));
        let targets = Arc::new(targets);
        let next_request_at = Arc::new(tokio::sync::Mutex::new(tokio::time::Instant::now()));
        let workers = FRIEND_PROFILE_BULK_LOAD_CONCURRENCY.min(targets.len().max(1));

        stream::iter(0..workers)
            .for_each_concurrent(workers, |_| {
                let runtime = Arc::clone(&self);
                let index = Arc::clone(&index);
                let targets = Arc::clone(&targets);
                let next_request_at = Arc::clone(&next_request_at);
                let active = active.clone();
                async move {
                    let mut cancel_rx = runtime.friend_profile_bulk_cancel_tx.subscribe();
                    loop {
                        tokio::task::yield_now().await;
                        let next = index.fetch_add(1, Ordering::SeqCst);
                        let Some(user_id) = targets.get(next) else {
                            return;
                        };
                        if !runtime.friend_profile_bulk_load_is_current(run_id, &active) {
                            return;
                        }
                        if !wait_for_friend_profile_bulk_load_request_slot(
                            run_id,
                            &mut cancel_rx,
                            &next_request_at,
                        )
                        .await
                        {
                            return;
                        }
                        if !runtime.friend_profile_bulk_load_is_current(run_id, &active) {
                            return;
                        }
                        let Some((loaded, failed)) = runtime
                            .load_friend_profile_bulk_item(run_id, &active, user_id, &mut cancel_rx)
                            .await
                        else {
                            return;
                        };
                        if !runtime.friend_profile_bulk_load_record_progress(
                            run_id, &active, loaded, failed,
                        ) {
                            return;
                        }
                    }
                }
            })
            .await;

        self.finish_friend_profile_bulk_load(run_id, &active);
    }

    fn finish_friend_profile_bulk_load(&self, run_id: u64, active: &ActiveRealtimeContext) {
        let session_current = self
            .state
            .lock()
            .map(|state| {
                self.is_message_current_locked(
                    &state,
                    active.generation,
                    active.session_generation,
                    &active.session,
                )
            })
            .unwrap_or(false);
        {
            let Ok(mut bulk) = self.friend_profile_bulk_load.lock() else {
                return;
            };
            if bulk.run_id != run_id {
                return;
            }
            bulk.status =
                if !session_current || bulk.status == FriendProfileBulkLoadStatus::Cancelling {
                    FriendProfileBulkLoadStatus::Cancelled
                } else {
                    FriendProfileBulkLoadStatus::Completed
                };
            bulk.finished_at = Some(chrono::Utc::now().to_rfc3339());
        }
        self.emit_friend_profile_bulk_load_status(true);
    }
}

#[cfg(test)]
impl RealtimeHostRuntime {
    pub(super) fn test_force_friend_profile_bulk_load_running(&self, run_id: u64, total: u32) {
        let owner = self.state.lock().unwrap().connection.active_context.clone();
        let mut bulk = self.friend_profile_bulk_load.lock().unwrap();
        bulk.run_id = run_id;
        bulk.status = FriendProfileBulkLoadStatus::Running;
        bulk.owner = owner;
        bulk.total = total;
        bulk.started_at = chrono::Utc::now().to_rfc3339();
    }

    pub(super) fn test_friend_profile_bulk_load_is_current(
        &self,
        run_id: u64,
        active: &ActiveRealtimeContext,
    ) -> bool {
        self.friend_profile_bulk_load_is_current(run_id, active)
    }

    pub(super) fn test_friend_profile_bulk_load_record_progress(
        &self,
        run_id: u64,
        loaded: bool,
        failed: bool,
    ) -> bool {
        let Some(active) = self.state.lock().unwrap().connection.active_context.clone() else {
            return false;
        };
        self.friend_profile_bulk_load_record_progress(run_id, &active, loaded, failed)
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

async fn wait_for_friend_profile_bulk_load_request_slot(
    run_id: u64,
    cancel_rx: &mut tokio::sync::watch::Receiver<u64>,
    next_request_at: &tokio::sync::Mutex<tokio::time::Instant>,
) -> bool {
    let scheduled_at = tokio::select! {
        biased;
        _ = wait_for_friend_profile_bulk_load_cancel(run_id, cancel_rx) => return false,
        mut next = next_request_at.lock() => {
            reserve_friend_profile_bulk_load_request_slot(tokio::time::Instant::now(), &mut next)
        }
    };
    tokio::select! {
        biased;
        _ = wait_for_friend_profile_bulk_load_cancel(run_id, cancel_rx) => false,
        _ = tokio::time::sleep_until(scheduled_at) => true,
    }
}
