#[cfg(test)]
use futures_util::future::BoxFuture;

use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};

use chrono::Utc;
use vrcx_0_application_core::{
    Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeEventBus, TaskSupervisor,
};

use crate::favorites::FavoriteMutationCoordinator;

#[cfg(test)]
use super::PreparedSharedCollectionImport;
use super::{
    prepare_shared_collection_import, run_shared_collection_import, SharedCollectionImportActions,
    SharedCollectionImportProgress, SharedCollectionImportResult, SharedCollectionImportStartInput,
    SharedCollectionImportState, SharedCollectionImportStatus,
};

pub trait SharedCollectionImportActionsFactory: Send + Sync {
    fn create(&self, endpoint: String) -> Arc<dyn SharedCollectionImportActions>;
}

pub trait SharedCollectionImportCompletion: Send + Sync {
    fn complete(&self, scope: &RuntimeAuthScopeSnapshot, imported: usize);
}

impl SharedCollectionImportCompletion for FavoriteMutationCoordinator {
    fn complete(&self, scope: &RuntimeAuthScopeSnapshot, imported: usize) {
        self.complete_shared_collection_import(scope, imported);
    }
}

#[cfg(test)]
type TestImportRunner = Arc<
    dyn Fn(
            PreparedSharedCollectionImport,
            Arc<AtomicBool>,
        ) -> BoxFuture<'static, Result<SharedCollectionImportResult>>
        + Send
        + Sync,
>;

#[derive(Clone)]
pub struct SharedCollectionImportRuntime {
    shared: Arc<SharedCollectionImportRuntimeShared>,
    actions: Arc<dyn SharedCollectionImportActionsFactory>,
    event_bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    auth_scope: RuntimeAuthScope,
    completion: Arc<dyn SharedCollectionImportCompletion>,
    #[cfg(test)]
    test_runner: Option<TestImportRunner>,
}

struct SharedCollectionImportRuntimeShared {
    state: Mutex<SharedCollectionImportRuntimeInner>,
    generation: AtomicU64,
}

#[derive(Default)]
struct SharedCollectionImportRuntimeInner {
    status: SharedCollectionImportStatus,
    cancel: Option<Arc<AtomicBool>>,
    auth_generation: u64,
}

impl SharedCollectionImportRuntime {
    pub fn new(
        actions: Arc<dyn SharedCollectionImportActionsFactory>,
        event_bus: RuntimeEventBus,
        tasks: TaskSupervisor,
        auth_scope: RuntimeAuthScope,
        completion: Arc<dyn SharedCollectionImportCompletion>,
    ) -> Self {
        Self {
            shared: Arc::new(SharedCollectionImportRuntimeShared {
                state: Mutex::new(SharedCollectionImportRuntimeInner::default()),
                generation: AtomicU64::new(0),
            }),
            actions,
            event_bus,
            tasks,
            auth_scope,
            completion,
            #[cfg(test)]
            test_runner: None,
        }
    }

    #[cfg(test)]
    fn with_test_runner(mut self, test_runner: TestImportRunner) -> Self {
        self.test_runner = Some(test_runner);
        self
    }

    pub fn status(&self) -> SharedCollectionImportStatus {
        self.lock_inner().status.clone()
    }

    pub fn start(
        &self,
        input: SharedCollectionImportStartInput,
    ) -> Result<SharedCollectionImportStatus> {
        let prepared = prepare_shared_collection_import(input)?;
        let scope = self.auth_scope.snapshot();
        if !scope.active || scope.current_user_id.trim().is_empty() {
            return Err(Error::Custom(
                "Shared collection import requires an authenticated session.".into(),
            ));
        }

        let cancel = Arc::new(AtomicBool::new(false));
        let status = {
            let mut inner = self.lock_inner();
            if is_active_status(inner.status.status) {
                return Err(Error::Custom(
                    "Another shared collection import is already active.".into(),
                ));
            }
            let generation = self.shared.generation.fetch_add(1, Ordering::AcqRel) + 1;
            let status = SharedCollectionImportStatus {
                run_id: format!("shared-{}-{generation}", Utc::now().timestamp_millis()),
                status: SharedCollectionImportState::Running,
                total: crate::wire_count(prepared.world_ids.len()),
                processed: 0,
                imported: 0,
                failed: 0,
                group_name: prepared.group_name.clone(),
                started_at: Some(Utc::now().to_rfc3339()),
                finished_at: None,
                last_error: None,
            };
            inner.status = status.clone();
            inner.cancel = Some(Arc::clone(&cancel));
            inner.auth_generation = scope.generation;
            status
        };
        self.emit_status(status.clone());

        let runtime = self.clone();
        let run_id = status.run_id.clone();
        self.tasks.spawn_cancellable(move |stop_token| async move {
            #[cfg(test)]
            if let Some(test_runner) = runtime.test_runner.clone() {
                let result = test_runner(prepared, Arc::clone(&cancel)).await;
                runtime.finish(&run_id, &scope, result);
                return;
            }
            let actions = runtime.actions.create(scope.endpoint.clone());
            let cancel_for_check = Arc::clone(&cancel);
            let auth_scope_for_check = runtime.auth_scope.clone();
            let scope_for_check = scope.clone();
            let runtime_for_progress = runtime.clone();
            let run_id_for_progress = run_id.clone();
            let result = run_shared_collection_import(
                actions.as_ref(),
                prepared,
                move || {
                    cancel_for_check.load(Ordering::Acquire)
                        || stop_token.is_stop_requested()
                        || !auth_scope_for_check
                            .snapshot()
                            .generation_matches(&scope_for_check)
                },
                move |progress| {
                    runtime_for_progress.apply_progress(&run_id_for_progress, progress);
                },
            )
            .await;
            runtime.finish(&run_id, &scope, result);
        });

        Ok(status)
    }

    pub fn cancel(&self) -> SharedCollectionImportStatus {
        let status = {
            let mut inner = self.lock_inner();
            if !is_active_status(inner.status.status) {
                return inner.status.clone();
            }
            if let Some(cancel) = &inner.cancel {
                cancel.store(true, Ordering::Release);
            }
            inner.status.status = SharedCollectionImportState::Cancelling;
            inner.status.clone()
        };
        self.emit_status(status.clone());
        status
    }

    fn apply_progress(&self, run_id: &str, progress: SharedCollectionImportProgress) {
        let status = {
            let mut inner = self.lock_inner();
            if inner.status.run_id != run_id || !is_active_status(inner.status.status) {
                return;
            }
            inner.status.processed = crate::wire_count(progress.processed);
            inner.status.imported = crate::wire_count(progress.imported);
            inner.status.failed = crate::wire_count(progress.failed);
            inner.status.last_error = progress.last_error;
            inner.status.clone()
        };
        self.emit_status(status);
    }

    fn finish(
        &self,
        run_id: &str,
        scope: &RuntimeAuthScopeSnapshot,
        result: Result<SharedCollectionImportResult>,
    ) {
        let terminal = {
            let inner = self.lock_inner();
            let Some(terminal) = prepare_terminal_result(&inner, run_id, result) else {
                return;
            };
            terminal
        };
        self.completion
            .complete(scope, terminal.status.imported as usize);
        let status = {
            let mut inner = self.lock_inner();
            if !commit_terminal_status(&mut inner, run_id, terminal.status) {
                return;
            }
            inner.status.clone()
        };
        self.emit_status(status);
    }

    fn emit_status(&self, status: SharedCollectionImportStatus) {
        self.event_bus.emit(status);
    }

    fn lock_inner(&self) -> std::sync::MutexGuard<'_, SharedCollectionImportRuntimeInner> {
        self.shared
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn is_active_status(status: SharedCollectionImportState) -> bool {
    matches!(
        status,
        SharedCollectionImportState::Running | SharedCollectionImportState::Cancelling
    )
}

fn prepare_terminal_result(
    inner: &SharedCollectionImportRuntimeInner,
    run_id: &str,
    result: Result<SharedCollectionImportResult>,
) -> Option<AppliedSharedCollectionImportTerminal> {
    if inner.status.run_id != run_id || !is_active_status(inner.status.status) {
        return None;
    }
    let mut status = inner.status.clone();
    match result {
        Ok(result) => {
            status.processed = crate::wire_count(result.processed);
            status.imported = crate::wire_count(result.imported);
            status.failed = crate::wire_count(result.failed);
            status.last_error = result.last_error;
            status.status = if result.cancelled {
                SharedCollectionImportState::Cancelled
            } else {
                SharedCollectionImportState::Completed
            };
        }
        Err(error) => {
            status.status = SharedCollectionImportState::Error;
            status.last_error = Some(error.to_string());
        }
    }
    status.finished_at = Some(Utc::now().to_rfc3339());
    Some(AppliedSharedCollectionImportTerminal { status })
}

fn commit_terminal_status(
    inner: &mut SharedCollectionImportRuntimeInner,
    run_id: &str,
    status: SharedCollectionImportStatus,
) -> bool {
    if inner.status.run_id != run_id || !is_active_status(inner.status.status) {
        return false;
    }
    inner.status = status;
    inner.cancel = None;
    true
}

struct AppliedSharedCollectionImportTerminal {
    status: SharedCollectionImportStatus,
}

#[cfg(test)]
#[path = "shared_collection_import_runtime_tests.rs"]
mod tests;
