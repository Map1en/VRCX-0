mod pipeline;
mod restore;
mod scheduler;

#[cfg(test)]
mod tests;

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::DatabaseService;

use vrcx_0_application_core::{RuntimeBackgroundJobs, RuntimeEventBus, TaskSupervisor};

use super::types::{
    ProfileBackupActionOutcome, ProfileBackupError, ProfileBackupErrorCode, ProfileBackupKind,
    ProfileBackupOutcome, ProfileBackupPhase, ProfileBackupState, ProfileBackupStatus,
    ProfileRestoreProgress, ProfileRestoreProgressOperation, ProfileRestoreProgressPhase,
    ProfileRestoreValidation,
};

const AUTO_ENABLED_KEY: &str = "VRCX_ProfileBackupAutoEnabled";
const AUTO_INTERVAL_DAYS_KEY: &str = "VRCX_ProfileBackupAutoIntervalDays";
const AUTO_RETAIN_EXTRA_KEY: &str = "VRCX_ProfileBackupAutoRetainExtra";
const AUTO_TARGET_DIR_KEY: &str = "VRCX_ProfileBackupAutoTargetDir";
const LAST_AUTO_AT_KEY: &str = "VRCX_ProfileBackupLastAutoAt";
const AUTO_JOB: &str = "profileBackup";
const AUTO_CADENCE: Duration = Duration::from_secs(3 * 60 * 60);
const AUTO_START_DELAY: Duration = Duration::from_secs(60);
const ORPHAN_TEMP_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const PROGRESS_EVENT_INTERVAL: Duration = Duration::from_millis(20);

#[derive(Clone)]
pub struct ProfileBackupRuntime {
    inner: Arc<ProfileBackupRuntimeInner>,
}

struct ProfileBackupRuntimeInner {
    app_data: PathBuf,
    db: Arc<DatabaseService>,
    storage: Arc<StorageService>,
    event_bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    background_jobs: RuntimeBackgroundJobs,
    app_version: String,
    operation_running: Arc<AtomicBool>,
    scheduler_started: AtomicBool,
    auto_check_scheduled: AtomicBool,
    state: Mutex<ProfileBackupRuntimeState>,
}

#[derive(Default)]
struct ProfileBackupRuntimeState {
    status: ProfileBackupStatus,
    pending_delivery: Option<PendingDelivery>,
    last_progress_event_at: Option<Instant>,
    validated_restore: Option<ProfileRestoreValidation>,
    restore_progress_revision: u64,
    last_restore_progress_event_at: Option<Instant>,
}

#[derive(Clone)]
struct PendingDelivery {
    archive: PathBuf,
    target_dir: PathBuf,
    file_name: String,
    kind: ProfileBackupKind,
    retain_extra: u8,
}

struct OperationGuard {
    flag: Arc<AtomicBool>,
}

impl OperationGuard {
    fn try_acquire(flag: &Arc<AtomicBool>) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self {
                flag: Arc::clone(flag),
            })
    }
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Release);
    }
}

impl ProfileBackupRuntime {
    pub fn new(
        app_data: PathBuf,
        db: Arc<DatabaseService>,
        storage: Arc<StorageService>,
        event_bus: RuntimeEventBus,
        tasks: TaskSupervisor,
        background_jobs: RuntimeBackgroundJobs,
        app_version: String,
    ) -> Self {
        Self {
            inner: Arc::new(ProfileBackupRuntimeInner {
                app_data,
                db,
                storage,
                event_bus,
                tasks,
                background_jobs,
                app_version,
                operation_running: Arc::new(AtomicBool::new(false)),
                scheduler_started: AtomicBool::new(false),
                auto_check_scheduled: AtomicBool::new(false),
                state: Mutex::new(ProfileBackupRuntimeState::default()),
            }),
        }
    }

    pub fn current_status(&self) -> ProfileBackupStatus {
        self.inner
            .state
            .lock()
            .map(|state| state.status.clone())
            .unwrap_or_default()
    }

    pub fn discard_pending(&self) -> ProfileBackupActionOutcome {
        let Some(guard) = OperationGuard::try_acquire(&self.inner.operation_running) else {
            return self.rejected_action(ProfileBackupErrorCode::OperationBusy, None);
        };
        let pending = self
            .inner
            .state
            .lock()
            .ok()
            .and_then(|mut state| state.pending_delivery.take());
        if let Some(pending) = pending {
            let _ = fs::remove_file(&pending.archive);
        }
        self.return_to_idle();
        drop(guard);
        self.accepted_action()
    }

    pub fn dismiss_error(&self) -> ProfileBackupStatus {
        let snapshot = match self.inner.state.lock() {
            Ok(mut state) => {
                if state.status.state != ProfileBackupState::Error {
                    return state.status.clone();
                }
                state.status.state = ProfileBackupState::Idle;
                state.status.kind = None;
                state.status.phase = None;
                state.status.percent = None;
                state.status.error = None;
                state.status.revision = state.status.revision.saturating_add(1);
                state.status.clone()
            }
            Err(error) => {
                tracing::warn!(error = %error, "failed to dismiss profile backup error");
                return ProfileBackupStatus::default();
            }
        };
        self.inner.event_bus.emit(snapshot.clone());
        snapshot
    }

    fn begin_running(
        &self,
        kind: ProfileBackupKind,
        phase: ProfileBackupPhase,
        percent: Option<u8>,
    ) {
        let now = Instant::now();
        self.update_status(|state| {
            state.status.state = ProfileBackupState::Running;
            state.status.kind = Some(kind);
            state.status.phase = Some(phase);
            state.status.percent = percent.map(|value| value.min(100));
            state.status.error = None;
            state.status.last_outcome = None;
            state.last_progress_event_at = Some(now);
        });
    }

    fn update_progress(&self, phase: ProfileBackupPhase, percent: Option<u8>) {
        self.update_progress_at(phase, percent, Instant::now());
    }

    fn update_progress_at(&self, phase: ProfileBackupPhase, percent: Option<u8>, now: Instant) {
        let percent = percent.map(|value| value.min(100));
        let snapshot = match self.inner.state.lock() {
            Ok(mut state) => {
                let phase_changed = state.status.phase != Some(phase);
                if state.status.state != ProfileBackupState::Running
                    || (!phase_changed && state.status.percent == percent)
                {
                    return;
                }
                let boundary = phase_changed
                    || percent.is_none()
                    || percent == Some(0)
                    || percent == Some(100);
                let interval_elapsed = state.last_progress_event_at.is_none_or(|last| {
                    now.saturating_duration_since(last) >= PROGRESS_EVENT_INTERVAL
                });
                if !boundary && !interval_elapsed {
                    return;
                }
                state.status.phase = Some(phase);
                state.status.percent = percent;
                state.last_progress_event_at = Some(now);
                state.status.revision = state.status.revision.saturating_add(1);
                state.status.clone()
            }
            Err(error) => {
                tracing::warn!(error = %error, "failed to update profile backup status");
                return;
            }
        };
        self.inner.event_bus.emit(snapshot);
    }

    fn update_restore_progress(
        &self,
        operation: ProfileRestoreProgressOperation,
        phase: ProfileRestoreProgressPhase,
        processed_bytes: u64,
        total_bytes: Option<u64>,
    ) {
        self.update_restore_progress_at(
            operation,
            phase,
            processed_bytes,
            total_bytes,
            Instant::now(),
        );
    }

    fn update_restore_progress_at(
        &self,
        operation: ProfileRestoreProgressOperation,
        phase: ProfileRestoreProgressPhase,
        processed_bytes: u64,
        total_bytes: Option<u64>,
        now: Instant,
    ) {
        let percent = total_bytes.map(|total| {
            processed_bytes
                .min(total)
                .saturating_mul(100)
                .checked_div(total)
                .unwrap_or(100) as u8
        });
        let snapshot = match self.inner.state.lock() {
            Ok(mut state) => {
                let boundary = percent.is_none() || percent == Some(0) || percent == Some(100);
                let interval_elapsed = state.last_restore_progress_event_at.is_none_or(|last| {
                    now.saturating_duration_since(last) >= PROGRESS_EVENT_INTERVAL
                });
                if !boundary && !interval_elapsed {
                    return;
                }
                state.restore_progress_revision = state.restore_progress_revision.saturating_add(1);
                state.last_restore_progress_event_at = Some(now);
                ProfileRestoreProgress {
                    revision: state.restore_progress_revision,
                    operation,
                    phase,
                    processed_bytes,
                    total_bytes,
                    percent,
                }
            }
            Err(error) => {
                tracing::warn!(error = %error, "failed to update profile restore progress");
                return;
            }
        };
        self.inner.event_bus.emit(snapshot);
    }

    fn finish_success(&self, kind: ProfileBackupKind, final_path: PathBuf) {
        let file_name = final_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
        self.update_status(|state| {
            state.status.state = ProfileBackupState::Idle;
            state.status.kind = None;
            state.status.phase = None;
            state.status.percent = None;
            state.status.error = None;
            state.status.last_outcome = Some(ProfileBackupOutcome {
                revision: state.status.revision.saturating_add(1),
                kind,
                succeeded: true,
                file_name,
                error_code: None,
            });
        });
    }

    fn finish_failure(
        &self,
        kind: ProfileBackupKind,
        error: ProfileBackupError,
        pending: Option<PendingDelivery>,
    ) {
        let retryable = pending.is_some();
        let file_name = pending.as_ref().map(|pending| pending.file_name.clone());
        let error_code = error.code;
        if kind == ProfileBackupKind::Auto {
            self.inner
                .background_jobs
                .mark_failed(AUTO_JOB, format!("Profile backup failed: {error_code:?}."));
        }
        self.update_status(|state| {
            state.pending_delivery = pending;
            state.status.state = if retryable {
                ProfileBackupState::Retryable
            } else {
                ProfileBackupState::Error
            };
            state.status.kind = None;
            state.status.phase = None;
            state.status.percent = None;
            state.status.error = Some(error);
            state.status.last_outcome = Some(ProfileBackupOutcome {
                revision: state.status.revision.saturating_add(1),
                kind,
                succeeded: false,
                file_name,
                error_code: Some(error_code),
            });
        });
    }

    fn return_to_idle(&self) {
        self.update_status(|state| {
            state.status.state = ProfileBackupState::Idle;
            state.status.kind = None;
            state.status.phase = None;
            state.status.percent = None;
            state.status.error = None;
        });
    }

    fn update_status(&self, update: impl FnOnce(&mut ProfileBackupRuntimeState)) {
        let snapshot = match self.inner.state.lock() {
            Ok(mut state) => {
                update(&mut state);
                state.status.revision = state.status.revision.saturating_add(1);
                state.status.clone()
            }
            Err(error) => {
                tracing::warn!(error = %error, "failed to update profile backup status");
                return;
            }
        };
        self.inner.event_bus.emit(snapshot);
    }

    fn set_pending_delivery(&self, pending: Option<PendingDelivery>) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.pending_delivery = pending;
        }
    }

    fn accepted_action(&self) -> ProfileBackupActionOutcome {
        ProfileBackupActionOutcome {
            accepted: true,
            status: self.current_status(),
            error: None,
        }
    }

    fn rejected_action(
        &self,
        code: ProfileBackupErrorCode,
        path: Option<PathBuf>,
    ) -> ProfileBackupActionOutcome {
        ProfileBackupActionOutcome {
            accepted: false,
            status: self.current_status(),
            error: Some(ProfileBackupError {
                code,
                path: path.map(|path| path.to_string_lossy().into_owned()),
            }),
        }
    }

    fn rejected_action_with_guard(
        &self,
        guard: OperationGuard,
        code: ProfileBackupErrorCode,
        path: Option<PathBuf>,
    ) -> ProfileBackupActionOutcome {
        drop(guard);
        self.rejected_action(code, path)
    }
}
