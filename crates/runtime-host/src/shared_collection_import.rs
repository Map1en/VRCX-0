use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};

use chrono::Utc;
use vrcx_0_application::{
    prepare_shared_collection_import, run_shared_collection_import, SharedCollectionImportProgress,
    SharedCollectionImportResult, SharedCollectionImportStartInput, SharedCollectionImportState,
    SharedCollectionImportStatus, VrchatSharedCollectionImportActions,
};
use vrcx_0_application_core::{
    FavoritesChangedPayload, RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeEventBus,
    TaskSupervisor, WebClient, WorldCache,
};
use vrcx_0_persistence::DatabaseService;

use crate::{Error, Result};

#[derive(Clone)]
pub struct SharedCollectionImportRuntime {
    inner: Arc<Mutex<SharedCollectionImportRuntimeInner>>,
    generation: Arc<AtomicU64>,
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
    world_cache: Arc<WorldCache>,
    event_bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    auth_scope: RuntimeAuthScope,
}

#[derive(Default)]
struct SharedCollectionImportRuntimeInner {
    status: SharedCollectionImportStatus,
    cancel: Option<Arc<AtomicBool>>,
    auth_generation: u64,
}

impl SharedCollectionImportRuntime {
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        world_cache: Arc<WorldCache>,
        event_bus: RuntimeEventBus,
        tasks: TaskSupervisor,
        auth_scope: RuntimeAuthScope,
    ) -> Self {
        Self {
            inner: Arc::new(Mutex::new(SharedCollectionImportRuntimeInner::default())),
            generation: Arc::new(AtomicU64::new(0)),
            db,
            web,
            world_cache,
            event_bus,
            tasks,
            auth_scope,
        }
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
            let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
            let status = SharedCollectionImportStatus {
                run_id: format!("shared-{}-{generation}", Utc::now().timestamp_millis()),
                status: SharedCollectionImportState::Running,
                total: prepared.world_ids.len(),
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
            let actions = VrchatSharedCollectionImportActions {
                db: runtime.db.as_ref(),
                web: runtime.web.as_ref(),
                world_cache: runtime.world_cache.as_ref(),
                endpoint: &scope.endpoint,
            };
            let cancel_for_check = Arc::clone(&cancel);
            let auth_scope_for_check = runtime.auth_scope.clone();
            let scope_for_check = scope.clone();
            let runtime_for_progress = runtime.clone();
            let run_id_for_progress = run_id.clone();
            let result = run_shared_collection_import(
                &actions,
                prepared,
                move || {
                    cancel_for_check.load(Ordering::Acquire)
                        || stop_token.is_stop_requested()
                        || !auth_scope_matches(&auth_scope_for_check.snapshot(), &scope_for_check)
                },
                move |progress| {
                    runtime_for_progress.apply_progress(&run_id_for_progress, progress);
                },
            )
            .await;
            runtime.finish(&run_id, result);
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

    pub fn cancel_if_scope_mismatch(&self) -> SharedCollectionImportStatus {
        let scope = self.auth_scope.snapshot();
        let status = {
            let mut inner = self.lock_inner();
            if !mark_cancelling_if_scope_mismatch(&mut inner, &scope) {
                return inner.status.clone();
            }
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
            inner.status.processed = progress.processed;
            inner.status.imported = progress.imported;
            inner.status.failed = progress.failed;
            inner.status.last_error = progress.last_error;
            inner.status.clone()
        };
        self.emit_status(status);
    }

    fn finish(
        &self,
        run_id: &str,
        result: vrcx_0_application_core::Result<SharedCollectionImportResult>,
    ) {
        let terminal = {
            let mut inner = self.lock_inner();
            let Some(terminal) = apply_terminal_result(&mut inner, run_id, result) else {
                return;
            };
            terminal
        };
        if terminal.emit_favorites_changed {
            self.world_cache.sync_favorites_from_db();
            self.event_bus
                .emit_favorites_changed(FavoritesChangedPayload {
                    kind: "world".into(),
                    local: true,
                    remote: false,
                });
        }
        self.emit_status(terminal.status);
    }

    fn emit_status(&self, status: SharedCollectionImportStatus) {
        self.event_bus.emit(status);
    }

    fn lock_inner(&self) -> std::sync::MutexGuard<'_, SharedCollectionImportRuntimeInner> {
        self.inner
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

fn auth_scope_matches(
    current: &RuntimeAuthScopeSnapshot,
    expected: &RuntimeAuthScopeSnapshot,
) -> bool {
    current.active
        && current.generation == expected.generation
        && current.current_user_id == expected.current_user_id
        && current.endpoint == expected.endpoint
}

fn mark_cancelling_if_scope_mismatch(
    inner: &mut SharedCollectionImportRuntimeInner,
    scope: &RuntimeAuthScopeSnapshot,
) -> bool {
    if !is_active_status(inner.status.status) || inner.auth_generation == scope.generation {
        return false;
    }
    if let Some(cancel) = &inner.cancel {
        cancel.store(true, Ordering::Release);
    }
    inner.status.status = SharedCollectionImportState::Cancelling;
    true
}

fn apply_terminal_result(
    inner: &mut SharedCollectionImportRuntimeInner,
    run_id: &str,
    result: vrcx_0_application_core::Result<SharedCollectionImportResult>,
) -> Option<AppliedSharedCollectionImportTerminal> {
    if inner.status.run_id != run_id || !is_active_status(inner.status.status) {
        return None;
    }
    match result {
        Ok(result) => {
            inner.status.processed = result.processed;
            inner.status.imported = result.imported;
            inner.status.failed = result.failed;
            inner.status.last_error = result.last_error;
            inner.status.status = if result.cancelled {
                SharedCollectionImportState::Cancelled
            } else {
                SharedCollectionImportState::Completed
            };
        }
        Err(error) => {
            inner.status.status = SharedCollectionImportState::Error;
            inner.status.last_error = Some(error.to_string());
        }
    }
    inner.status.finished_at = Some(Utc::now().to_rfc3339());
    inner.cancel = None;
    Some(AppliedSharedCollectionImportTerminal {
        emit_favorites_changed: inner.status.imported > 0,
        status: inner.status.clone(),
    })
}

struct AppliedSharedCollectionImportTerminal {
    status: SharedCollectionImportStatus,
    emit_favorites_changed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn running_inner() -> SharedCollectionImportRuntimeInner {
        SharedCollectionImportRuntimeInner {
            status: SharedCollectionImportStatus {
                run_id: "run-1".into(),
                status: SharedCollectionImportState::Running,
                total: 2,
                ..Default::default()
            },
            cancel: Some(Arc::new(AtomicBool::new(false))),
            auth_generation: 1,
        }
    }

    #[test]
    fn auth_scope_switch_marks_active_run_cancelling() {
        let mut inner = running_inner();
        let scope = RuntimeAuthScopeSnapshot {
            generation: 2,
            active: true,
            ..Default::default()
        };

        assert!(mark_cancelling_if_scope_mismatch(&mut inner, &scope));
        assert_eq!(inner.status.status, SharedCollectionImportState::Cancelling);
        assert!(inner.cancel.as_ref().unwrap().load(Ordering::Acquire));
    }

    #[test]
    fn same_auth_scope_hydration_keeps_active_run_running() {
        let auth_scope = RuntimeAuthScope::new();
        let first = auth_scope.set("usr_self", "https://api.vrchat.cloud/api/1");
        let hydrated = auth_scope.set(" usr_self ", "https://api.vrchat.cloud/api/1/");
        let mut inner = running_inner();
        inner.auth_generation = first.generation;

        assert_eq!(hydrated.generation, first.generation);
        assert!(!mark_cancelling_if_scope_mismatch(&mut inner, &hydrated));
        assert_eq!(inner.status.status, SharedCollectionImportState::Running);
        assert!(!inner.cancel.as_ref().unwrap().load(Ordering::Acquire));
    }

    #[test]
    fn status_snapshot_retains_running_progress_for_hydration() {
        let mut inner = running_inner();
        inner.status.processed = 1;
        inner.status.imported = 1;

        let hydrated = inner.status.clone();

        assert_eq!(hydrated.run_id, "run-1");
        assert_eq!(hydrated.processed, 1);
        assert_eq!(hydrated.imported, 1);
        assert_eq!(hydrated.total, 2);
    }

    #[test]
    fn cancelled_terminal_with_imports_emits_favorites_changed_once() {
        let mut inner = running_inner();
        let result = SharedCollectionImportResult {
            total: 2,
            processed: 1,
            imported: 1,
            cancelled: true,
            ..Default::default()
        };

        let terminal = apply_terminal_result(&mut inner, "run-1", Ok(result.clone()));
        let duplicate = apply_terminal_result(&mut inner, "run-1", Ok(result));

        assert_eq!(
            terminal.as_ref().unwrap().status.status,
            SharedCollectionImportState::Cancelled
        );
        assert!(terminal.unwrap().emit_favorites_changed);
        assert!(duplicate.is_none());
    }
}
