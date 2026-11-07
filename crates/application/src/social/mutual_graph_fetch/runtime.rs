use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use vrcx_0_core::OwnerId;

#[cfg(test)]
use std::time::Duration;
use vrcx_0_core::time::now_iso;

use crate::remote::VrchatRequestPort;
use vrcx_0_application_core::{
    Error, RequestPacer, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeEventBus,
    TaskSupervisor,
};

use super::request::{
    fetch_friend_mutuals, fetch_should_cancel, normalize_friend_ids, normalize_id,
    preserve_failed_friend_cache, resolve_fetch_scope, FriendFetchResult, MutualGraphFetchContext,
    MUTUAL_GRAPH_REQUEST_INTERVAL,
};
use super::types::{
    MutualGraphFetchCancelInput, MutualGraphFetchStartInput, MutualGraphFetchState,
    MutualGraphFetchStatus, MutualGraphMetaInput, MutualGraphSnapshotEntryInput, MutualGraphStore,
};

#[derive(Clone)]
pub struct MutualGraphFetchRuntime {
    shared: Arc<MutualGraphFetchShared>,
    event_bus: RuntimeEventBus,
}

struct MutualGraphFetchShared {
    state: Mutex<MutualGraphFetchInner>,
    next_run_id: AtomicU64,
}

struct MutualGraphFetchInner {
    status: MutualGraphFetchStatus,
    cancel_flag: Option<Arc<AtomicBool>>,
}

struct MutualGraphFetchJob {
    run_id: u64,
    owner_user_id: OwnerId,
    endpoint: String,
    friend_ids: Vec<String>,
    store: Arc<dyn MutualGraphStore>,
    remote: Arc<dyn VrchatRequestPort>,
    auth_scope: RuntimeAuthScope,
    expected_scope: RuntimeAuthScopeSnapshot,
    cancel_flag: Arc<AtomicBool>,
}

impl Default for MutualGraphFetchRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl MutualGraphFetchRuntime {
    pub fn new() -> Self {
        Self::with_event_bus(RuntimeEventBus::new())
    }

    pub fn with_event_bus(event_bus: RuntimeEventBus) -> Self {
        Self {
            shared: Arc::new(MutualGraphFetchShared {
                state: Mutex::new(MutualGraphFetchInner {
                    status: idle_status(),
                    cancel_flag: None,
                }),
                next_run_id: AtomicU64::new(1),
            }),
            event_bus,
        }
    }

    pub fn status(&self) -> MutualGraphFetchStatus {
        self.shared
            .state
            .lock()
            .map(|inner| inner.status.clone())
            .unwrap_or_else(|_| idle_status())
    }

    pub fn start(
        &self,
        input: MutualGraphFetchStartInput,
        store: Arc<dyn MutualGraphStore>,
        remote: Arc<dyn VrchatRequestPort>,
        auth_scope: RuntimeAuthScope,
        tasks: TaskSupervisor,
    ) -> Result<MutualGraphFetchStatus> {
        let (owner_user_id, endpoint, expected_scope) = resolve_fetch_scope(&input, &auth_scope)?;

        let friend_ids = normalize_friend_ids(input.friend_ids);
        if friend_ids.is_empty() {
            return Err(Error::Custom(
                "MutualGraphFetchStart requires at least one friend id.".into(),
            ));
        }

        let cancel_flag = Arc::new(AtomicBool::new(false));
        let run_id = self.shared.next_run_id.fetch_add(1, Ordering::AcqRel);
        let status = {
            let mut inner = self.shared.state.lock().map_err(|error| {
                Error::Custom(format!("mutual graph fetch lock poisoned: {error}"))
            })?;
            if inner.status.status.is_active() {
                if inner.status.owner_user_id == OwnerId::new(owner_user_id) {
                    return Ok(inner.status.clone());
                }
                return Err(Error::Custom(
                    "A mutual graph fetch is already running.".into(),
                ));
            }
            let now = now_iso();
            let status = MutualGraphFetchStatus {
                run_id,
                revision: 1,
                status: MutualGraphFetchState::Running,
                owner_user_id: OwnerId::new(owner_user_id.clone()),
                total_friends: crate::wire_count(friend_ids.len()),
                processed_friends: 0,
                current_friend_id: String::new(),
                fetched_friends: 0,
                opted_out_friends: 0,
                failed_friends: 0,
                cancel_requested: false,
                started_at: now.clone(),
                updated_at: now,
                finished_at: None,
                last_error: None,
            };
            inner.status = status.clone();
            inner.cancel_flag = Some(Arc::clone(&cancel_flag));
            status
        };
        self.emit_status(status.clone());

        let runtime = self.clone();
        tasks.spawn(async move {
            runtime
                .run_fetch_job(MutualGraphFetchJob {
                    run_id,
                    owner_user_id: OwnerId::new(owner_user_id),
                    endpoint,
                    friend_ids,
                    store,
                    remote,
                    auth_scope,
                    expected_scope,
                    cancel_flag,
                })
                .await;
        });

        Ok(status)
    }

    pub fn cancel(&self, input: MutualGraphFetchCancelInput) -> Result<MutualGraphFetchStatus> {
        let owner_user_id = normalize_id(input.owner_user_id.as_str());
        let status = {
            let mut inner = self.shared.state.lock().map_err(|error| {
                Error::Custom(format!("mutual graph fetch lock poisoned: {error}"))
            })?;
            if !inner.status.status.is_active() {
                return Ok(inner.status.clone());
            }
            if !owner_user_id.is_empty()
                && inner.status.owner_user_id != OwnerId::new(owner_user_id)
            {
                return Ok(inner.status.clone());
            }
            if let Some(cancel_flag) = &inner.cancel_flag {
                cancel_flag.store(true, Ordering::Release);
            }
            inner.status.status = MutualGraphFetchState::Cancelling;
            inner.status.cancel_requested = true;
            inner.status.updated_at = now_iso();
            inner.status.revision += 1;
            inner.status.clone()
        };
        self.emit_status(status.clone());
        Ok(status)
    }

    pub fn cancel_active(&self) -> Result<MutualGraphFetchStatus> {
        self.cancel(MutualGraphFetchCancelInput {
            owner_user_id: OwnerId::default(),
        })
    }

    async fn run_fetch_job(&self, job: MutualGraphFetchJob) {
        let MutualGraphFetchJob {
            run_id,
            owner_user_id,
            endpoint,
            friend_ids,
            store,
            remote,
            auth_scope,
            expected_scope,
            cancel_flag,
        } = job;
        let mut entries = Vec::new();
        let mut meta_entries = Vec::new();
        let mut processed_friends = 0usize;
        let mut fetched_friends = 0usize;
        let mut opted_out_friends = 0usize;
        let mut failed_friends = 0usize;
        let mut failed_friend_ids = HashSet::new();
        let mut last_error = None;
        let mut fetch_context = MutualGraphFetchContext {
            remote: remote.as_ref(),
            endpoint: &endpoint,
            cancel_flag: &cancel_flag,
            auth_scope: &auth_scope,
            expected_scope: &expected_scope,
            pacer: RequestPacer::new(MUTUAL_GRAPH_REQUEST_INTERVAL),
        };

        for friend_id in friend_ids {
            if fetch_should_cancel(&cancel_flag, &auth_scope, &expected_scope) {
                self.finish_run(run_id, MutualGraphFetchState::Cancelled, None);
                return;
            }

            self.update_current_friend(run_id, &friend_id);
            match fetch_friend_mutuals(&mut fetch_context, &friend_id).await {
                FriendFetchResult::MutualIds {
                    mutual_ids,
                    total_count,
                } => {
                    entries.push(MutualGraphSnapshotEntryInput {
                        friend_id: friend_id.clone(),
                        mutual_ids,
                    });
                    meta_entries.push(MutualGraphMetaInput {
                        friend_id: friend_id.clone(),
                        last_fetched_at: String::new(),
                        opted_out: false,
                        total_count: Some(total_count),
                    });
                    fetched_friends += 1;
                }
                FriendFetchResult::OptedOut => {
                    meta_entries.push(MutualGraphMetaInput {
                        friend_id: friend_id.clone(),
                        last_fetched_at: String::new(),
                        opted_out: true,
                        total_count: None,
                    });
                    opted_out_friends += 1;
                }
                FriendFetchResult::Cancelled => {
                    self.finish_run(run_id, MutualGraphFetchState::Cancelled, None);
                    return;
                }
                FriendFetchResult::Failed(error) => {
                    failed_friends += 1;
                    failed_friend_ids.insert(friend_id.clone());
                    last_error = Some(error);
                }
            }

            processed_friends += 1;
            self.update_progress(
                run_id,
                processed_friends,
                fetched_friends,
                opted_out_friends,
                failed_friends,
                last_error.clone(),
            );
        }

        if fetch_should_cancel(&cancel_flag, &auth_scope, &expected_scope) {
            self.finish_run(run_id, MutualGraphFetchState::Cancelled, None);
            return;
        }

        if failed_friends > 0 && fetched_friends + opted_out_friends == 0 {
            self.finish_run(
                run_id,
                MutualGraphFetchState::Error,
                Some(last_error.unwrap_or_else(|| {
                    format!("{failed_friends} mutual graph friend fetches failed.")
                })),
            );
            return;
        }

        if !failed_friend_ids.is_empty() {
            match store.snapshot_get(owner_user_id.to_string()) {
                Ok(cached) => preserve_failed_friend_cache(
                    &mut entries,
                    &mut meta_entries,
                    &failed_friend_ids,
                    cached,
                ),
                Err(error) => {
                    self.finish_run(
                        run_id,
                        MutualGraphFetchState::Error,
                        Some(error.to_string()),
                    );
                    return;
                }
            }
        }

        if fetch_should_cancel(&cancel_flag, &auth_scope, &expected_scope) {
            self.finish_run(run_id, MutualGraphFetchState::Cancelled, None);
            return;
        }

        match store.snapshot_commit(owner_user_id.to_string(), entries, meta_entries) {
            Ok(()) => {
                self.finish_run(run_id, MutualGraphFetchState::Completed, last_error);
            }
            Err(error) => {
                self.finish_run(
                    run_id,
                    MutualGraphFetchState::Error,
                    Some(error.to_string()),
                );
            }
        }
    }

    fn update_current_friend(&self, run_id: u64, friend_id: &str) {
        self.update_status(run_id, |status| {
            status.current_friend_id = friend_id.to_string();
        });
    }

    fn update_progress(
        &self,
        run_id: u64,
        processed_friends: usize,
        fetched_friends: usize,
        opted_out_friends: usize,
        failed_friends: usize,
        last_error: Option<String>,
    ) {
        self.update_status(run_id, |status| {
            status.processed_friends = crate::wire_count(processed_friends);
            status.fetched_friends = crate::wire_count(fetched_friends);
            status.opted_out_friends = crate::wire_count(opted_out_friends);
            status.failed_friends = crate::wire_count(failed_friends);
            status.last_error = last_error;
        });
    }

    fn finish_run(
        &self,
        run_id: u64,
        state: MutualGraphFetchState,
        last_error: Option<String>,
    ) -> MutualGraphFetchStatus {
        let now = now_iso();
        let mut output = idle_status();
        let mut emitted = None;
        if let Ok(mut inner) = self.shared.state.lock() {
            if inner.status.run_id == run_id {
                inner.status.status = state;
                inner.status.cancel_requested = false;
                inner.status.current_friend_id.clear();
                inner.status.updated_at = now.clone();
                inner.status.finished_at = Some(now);
                inner.status.last_error = last_error;
                inner.status.revision += 1;
                inner.cancel_flag = None;
                emitted = Some(inner.status.clone());
            }
            output = inner.status.clone();
        }
        if let Some(status) = emitted {
            self.emit_status(status);
        }
        output
    }

    fn update_status<F>(&self, run_id: u64, mutate: F)
    where
        F: FnOnce(&mut MutualGraphFetchStatus),
    {
        let status = if let Ok(mut inner) = self.shared.state.lock() {
            if inner.status.run_id != run_id {
                return;
            }
            mutate(&mut inner.status);
            inner.status.updated_at = now_iso();
            inner.status.revision += 1;
            Some(inner.status.clone())
        } else {
            None
        };
        if let Some(status) = status {
            self.emit_status(status);
        }
    }

    fn emit_status(&self, status: MutualGraphFetchStatus) {
        self.event_bus.emit(status);
    }
}

fn idle_status() -> MutualGraphFetchStatus {
    MutualGraphFetchStatus {
        run_id: 0,
        revision: 0,
        status: MutualGraphFetchState::Idle,
        owner_user_id: OwnerId::default(),
        total_friends: 0,
        processed_friends: 0,
        current_friend_id: String::new(),
        fetched_friends: 0,
        opted_out_friends: 0,
        failed_friends: 0,
        cancel_requested: false,
        started_at: String::new(),
        updated_at: String::new(),
        finished_at: None,
        last_error: None,
    }
}

#[cfg(test)]
mod tests;
