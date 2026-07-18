use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};

use chrono::Utc;
use vrcx_0_application::{
    prepare_note_export, run_note_export, NoteExportProgress, NoteExportResult,
    NoteExportStartInput, NoteExportState, NoteExportStatus, VrchatNoteExportActions,
};
use vrcx_0_application_core::{
    RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeEventBus, TaskSupervisor, WebClient,
};
use vrcx_0_persistence::DatabaseService;

use crate::{Error, Result};

#[derive(Clone)]
pub struct NoteExportRuntime {
    inner: Arc<Mutex<NoteExportRuntimeInner>>,
    generation: Arc<AtomicU64>,
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
    event_bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    auth_scope: RuntimeAuthScope,
}

#[derive(Default)]
struct NoteExportRuntimeInner {
    status: NoteExportStatus,
    cancel: Option<Arc<AtomicBool>>,
    auth_generation: u64,
}

impl NoteExportRuntime {
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        event_bus: RuntimeEventBus,
        tasks: TaskSupervisor,
        auth_scope: RuntimeAuthScope,
    ) -> Self {
        Self {
            inner: Arc::new(Mutex::new(NoteExportRuntimeInner::default())),
            generation: Arc::new(AtomicU64::new(0)),
            db,
            web,
            event_bus,
            tasks,
            auth_scope,
        }
    }

    pub fn status(&self) -> NoteExportStatus {
        self.lock_inner().status.clone()
    }

    pub fn start(&self, input: NoteExportStartInput) -> Result<NoteExportStatus> {
        let items = prepare_note_export(input)?;
        let scope = self.auth_scope.snapshot();
        if !scope.active || scope.current_user_id.trim().is_empty() {
            return Err(Error::Custom(
                "Note export requires an authenticated session.".into(),
            ));
        }

        let cancel = Arc::new(AtomicBool::new(false));
        let status = {
            let mut inner = self.lock_inner();
            if is_active_status(inner.status.status) {
                return Err(Error::Custom(
                    "Another note export is already active.".into(),
                ));
            }
            let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
            let status = NoteExportStatus {
                run_id: format!("note-export-{}-{generation}", Utc::now().timestamp_millis()),
                status: NoteExportState::Running,
                total: items.len(),
                items: items
                    .iter()
                    .map(|item| vrcx_0_application::NoteExportItemStatus {
                        user_id: item.user_id.clone(),
                        display_name: item.display_name.clone(),
                        note: item.note.clone(),
                        ..Default::default()
                    })
                    .collect(),
                started_at: Some(Utc::now().to_rfc3339()),
                ..Default::default()
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
            let actions = VrchatNoteExportActions {
                db: runtime.db.as_ref(),
                web: runtime.web.as_ref(),
                auth_scope: &runtime.auth_scope,
                expected_scope: &scope,
                event_bus: &runtime.event_bus,
            };
            let cancel_for_check = Arc::clone(&cancel);
            let auth_scope_for_check = runtime.auth_scope.clone();
            let scope_for_check = scope.clone();
            let runtime_for_progress = runtime.clone();
            let run_id_for_progress = run_id.clone();
            let result = run_note_export(
                &actions,
                items,
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

    pub fn cancel(&self) -> NoteExportStatus {
        let status = {
            let mut inner = self.lock_inner();
            if !is_active_status(inner.status.status) {
                return inner.status.clone();
            }
            if let Some(cancel) = &inner.cancel {
                cancel.store(true, Ordering::Release);
            }
            inner.status.status = NoteExportState::Cancelling;
            inner.status.clone()
        };
        self.emit_status(status.clone());
        status
    }

    pub fn cancel_if_scope_mismatch(&self) -> NoteExportStatus {
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

    fn apply_progress(&self, run_id: &str, progress: NoteExportProgress) {
        let status = {
            let mut inner = self.lock_inner();
            if inner.status.run_id != run_id || !is_active_status(inner.status.status) {
                return;
            }
            inner.status.processed = progress.processed;
            inner.status.succeeded = progress.succeeded;
            inner.status.failed = progress.failed;
            inner.status.items = progress.items;
            inner.status.last_error = progress.last_error;
            inner.status.clone()
        };
        self.emit_status(status);
    }

    fn finish(&self, run_id: &str, result: NoteExportResult) {
        let status = {
            let mut inner = self.lock_inner();
            if inner.status.run_id != run_id || !is_active_status(inner.status.status) {
                return;
            }
            inner.status.processed = result.processed;
            inner.status.succeeded = result.succeeded;
            inner.status.failed = result.failed;
            inner.status.items = result.items;
            inner.status.last_error = result.last_error;
            inner.status.status = if result.cancelled {
                NoteExportState::Cancelled
            } else if result.failed > 0 {
                NoteExportState::Error
            } else {
                NoteExportState::Completed
            };
            inner.status.finished_at = Some(Utc::now().to_rfc3339());
            inner.cancel = None;
            inner.status.clone()
        };
        self.emit_status(status);
    }

    fn emit_status(&self, status: NoteExportStatus) {
        self.event_bus.emit(status);
    }

    fn lock_inner(&self) -> std::sync::MutexGuard<'_, NoteExportRuntimeInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn is_active_status(status: NoteExportState) -> bool {
    matches!(
        status,
        NoteExportState::Running | NoteExportState::Cancelling
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
    inner: &mut NoteExportRuntimeInner,
    scope: &RuntimeAuthScopeSnapshot,
) -> bool {
    if !is_active_status(inner.status.status) || inner.auth_generation == scope.generation {
        return false;
    }
    if let Some(cancel) = &inner.cancel {
        cancel.store(true, Ordering::Release);
    }
    inner.status.status = NoteExportState::Cancelling;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_change_marks_active_export_cancelling() {
        let cancel = Arc::new(AtomicBool::new(false));
        let mut inner = NoteExportRuntimeInner {
            status: NoteExportStatus {
                run_id: "run-1".into(),
                status: NoteExportState::Running,
                ..Default::default()
            },
            cancel: Some(Arc::clone(&cancel)),
            auth_generation: 1,
        };

        assert!(mark_cancelling_if_scope_mismatch(
            &mut inner,
            &RuntimeAuthScopeSnapshot {
                generation: 2,
                active: true,
                ..Default::default()
            }
        ));
        assert_eq!(inner.status.status, NoteExportState::Cancelling);
        assert!(cancel.load(Ordering::Acquire));
    }
}
