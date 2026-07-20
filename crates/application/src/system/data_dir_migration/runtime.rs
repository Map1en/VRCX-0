use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::Utc;
use vrcx_0_application_core::{Error, Result, RuntimeEventBus};
use vrcx_0_persistence::data_dir_migration::{
    cleanup_migrated_data, clear_data_dir_migration_staging,
    copy_frozen_database_to_staging_cancellable, dismiss_data_dir_cleanup,
    has_pending_data_dir_migration, install_staged_data_dir_database,
    read_data_dir_cleanup_pending, read_data_dir_cleanup_pendings,
    remove_pending_data_dir_migration, take_data_dir_migration_result,
    write_data_dir_cleanup_pending, write_pending_data_dir_migration, DataDirCleanupPending,
    DataDirCleanupReport, DataDirMigrationResult, PendingDataDirMigration,
};
use vrcx_0_persistence::profile_backup::has_pending_profile_restore;
use vrcx_0_persistence::DatabaseService;

use super::super::profile_backup::{OperationGuard, ProfileOperationGate};
use super::types::{
    DataDirMigrationActionOutcome, DataDirMigrationError, DataDirMigrationErrorCode,
    DataDirMigrationPhase, DataDirMigrationState, DataDirMigrationStatus,
};

const PROGRESS_EVENT_INTERVAL: Duration = Duration::from_millis(20);

pub type DataDirPointerCommitter = Arc<dyn Fn(&Path) -> Result<()> + Send + Sync + 'static>;

#[derive(Clone)]
pub struct DataDirMigrationRuntime {
    inner: Arc<DataDirMigrationRuntimeInner>,
}

struct DataDirMigrationRuntimeInner {
    source_dir: PathBuf,
    control_dir: PathBuf,
    db: Arc<DatabaseService>,
    event_bus: RuntimeEventBus,
    operation_gate: ProfileOperationGate,
    pointer_committer: DataDirPointerCommitter,
    cancel_requested: AtomicBool,
    status: Mutex<DataDirMigrationRuntimeState>,
}

#[derive(Default)]
struct DataDirMigrationRuntimeState {
    snapshot: DataDirMigrationStatus,
    last_progress_event_at: Option<Instant>,
}

impl DataDirMigrationRuntime {
    pub fn new(
        source_dir: PathBuf,
        control_dir: PathBuf,
        db: Arc<DatabaseService>,
        event_bus: RuntimeEventBus,
        operation_gate: ProfileOperationGate,
        pointer_committer: DataDirPointerCommitter,
    ) -> Self {
        Self {
            inner: Arc::new(DataDirMigrationRuntimeInner {
                source_dir,
                control_dir,
                db,
                event_bus,
                operation_gate,
                pointer_committer,
                cancel_requested: AtomicBool::new(false),
                status: Mutex::new(DataDirMigrationRuntimeState::default()),
            }),
        }
    }

    pub fn current_status(&self) -> DataDirMigrationStatus {
        self.inner
            .status
            .lock()
            .map(|state| state.snapshot.clone())
            .unwrap_or_default()
    }

    pub fn run_migration(
        &self,
        target_dir: PathBuf,
        replace_existing: bool,
    ) -> DataDirMigrationActionOutcome {
        let Some(_guard) = OperationGuard::try_acquire(&self.inner.operation_gate) else {
            return self.rejected(DataDirMigrationErrorCode::OperationBusy, None);
        };
        if !self.inner.db.is_main_mode() {
            return self.rejected(DataDirMigrationErrorCode::DatabaseUnavailable, None);
        }
        if has_pending_profile_restore(&self.inner.source_dir) {
            return self.rejected(DataDirMigrationErrorCode::PendingRestore, None);
        }
        if self
            .inner
            .source_dir
            .join("pending_vrcx_migration")
            .is_file()
        {
            return self.rejected(DataDirMigrationErrorCode::PendingLegacyMigration, None);
        }
        if has_pending_data_dir_migration(&self.inner.control_dir) {
            return self.rejected(DataDirMigrationErrorCode::PendingMigration, None);
        }
        match self.cleanup_conflicts_with(&target_dir) {
            Ok(true) => {
                return self.rejected(
                    DataDirMigrationErrorCode::CleanupConflict,
                    Some(&target_dir),
                );
            }
            Ok(false) => {}
            Err(error) => {
                tracing::warn!(error = %error, "failed to inspect data directory cleanup state");
                return self.rejected(DataDirMigrationErrorCode::Io, None);
            }
        }

        self.inner.cancel_requested.store(false, Ordering::Release);
        self.update_status(
            DataDirMigrationState::Running,
            Some(DataDirMigrationPhase::Preparing),
            Some(0),
            Some(&target_dir),
            None,
            true,
        );
        let mut journal = PendingDataDirMigration::copying(
            self.inner.source_dir.to_string_lossy().into_owned(),
            target_dir.to_string_lossy().into_owned(),
            Utc::now().to_rfc3339(),
            replace_existing,
        );
        if let Err(error) = write_pending_data_dir_migration(&self.inner.control_dir, &journal) {
            tracing::warn!(error = %error, "failed to create data directory migration journal");
            return self.failed(DataDirMigrationErrorCode::Io, Some(&target_dir));
        }
        if self.inner.cancel_requested.load(Ordering::Acquire) {
            return self.cancel_before_freeze(&target_dir);
        }

        self.update_status(
            DataDirMigrationState::Running,
            Some(DataDirMigrationPhase::Freezing),
            None,
            Some(&target_dir),
            None,
            true,
        );
        let frozen = match self.inner.db.freeze_for_migration() {
            Ok(frozen) => frozen,
            Err(error) => {
                tracing::warn!(error = %error, "failed to freeze database for data directory migration");
                let _ = remove_pending_data_dir_migration(&self.inner.control_dir);
                return self.failed(DataDirMigrationErrorCode::DatabaseUnavailable, None);
            }
        };

        self.update_status(
            DataDirMigrationState::Running,
            Some(DataDirMigrationPhase::Copying),
            Some(0),
            Some(&target_dir),
            None,
            true,
        );
        let copied = copy_frozen_database_to_staging_cancellable(
            &frozen,
            &target_dir,
            |processed, total| {
                self.update_copy_progress(processed, total, &target_dir);
                !self.inner.cancel_requested.load(Ordering::Acquire)
            },
        );
        let copied = match copied {
            Ok(copied) => copied,
            Err(error) => {
                tracing::warn!(error = %error, "failed to copy frozen database for data directory migration");
                return self.abort_after_freeze(
                    &target_dir,
                    DataDirMigrationErrorCode::CopyFailed,
                    self.inner.cancel_requested.load(Ordering::Acquire),
                );
            }
        };
        if self.inner.cancel_requested.load(Ordering::Acquire) {
            return self.abort_after_freeze(
                &target_dir,
                DataDirMigrationErrorCode::CopyFailed,
                true,
            );
        }

        self.update_status(
            DataDirMigrationState::Running,
            Some(DataDirMigrationPhase::Verifying),
            Some(100),
            Some(&target_dir),
            None,
            true,
        );
        let replaced_dir = match install_staged_data_dir_database(&target_dir, replace_existing) {
            Ok(replaced_dir) => replaced_dir,
            Err(error) => {
                tracing::warn!(error = %error, "failed to install staged data directory database");
                return self.abort_after_freeze(
                    &target_dir,
                    DataDirMigrationErrorCode::CommitFailed,
                    false,
                );
            }
        };
        if self.inner.cancel_requested.load(Ordering::Acquire) {
            return self.abort_after_freeze(
                &target_dir,
                DataDirMigrationErrorCode::CommitFailed,
                true,
            );
        }
        journal.mark_switched(
            &copied,
            replaced_dir.map(|path| path.to_string_lossy().into_owned()),
        );
        if let Err(error) = write_pending_data_dir_migration(&self.inner.control_dir, &journal) {
            tracing::warn!(error = %error, "failed to advance data directory migration journal");
            return self.abort_after_freeze(
                &target_dir,
                DataDirMigrationErrorCode::CommitFailed,
                false,
            );
        }

        self.update_status(
            DataDirMigrationState::Running,
            Some(DataDirMigrationPhase::Committing),
            Some(100),
            Some(&target_dir),
            None,
            true,
        );
        if let Err(error) = (self.inner.pointer_committer)(&target_dir) {
            tracing::warn!(error = %error, "failed to commit data directory pointer");
            return self.failed(
                DataDirMigrationErrorCode::PointerCommitFailed,
                Some(&target_dir),
            );
        }
        self.inner.cancel_requested.store(false, Ordering::Release);
        let status = self.update_status(
            DataDirMigrationState::Completed,
            Some(DataDirMigrationPhase::Committing),
            Some(100),
            Some(&target_dir),
            None,
            true,
        );
        DataDirMigrationActionOutcome {
            accepted: true,
            status,
            error: None,
        }
    }

    pub fn request_cancel(&self) -> DataDirMigrationActionOutcome {
        let snapshot = self.current_status();
        if !matches!(
            snapshot.state,
            DataDirMigrationState::Running | DataDirMigrationState::Cancelling
        ) || snapshot.phase != Some(DataDirMigrationPhase::Copying)
        {
            return self.rejected(DataDirMigrationErrorCode::OperationBusy, None);
        }
        self.inner.cancel_requested.store(true, Ordering::Release);
        let status = self.update_status(
            DataDirMigrationState::Cancelling,
            snapshot.phase,
            snapshot.percent,
            snapshot.target_dir.as_deref().map(Path::new),
            None,
            true,
        );
        DataDirMigrationActionOutcome {
            accepted: true,
            status,
            error: None,
        }
    }

    pub fn switch_data_dir_pointer(&self, target_dir: PathBuf) -> DataDirMigrationActionOutcome {
        let Some(_guard) = OperationGuard::try_acquire(&self.inner.operation_gate) else {
            return self.rejected(DataDirMigrationErrorCode::OperationBusy, None);
        };
        if !self.inner.db.is_main_mode() {
            return self.rejected(DataDirMigrationErrorCode::DatabaseUnavailable, None);
        }
        if has_pending_profile_restore(&self.inner.source_dir) {
            return self.rejected(DataDirMigrationErrorCode::PendingRestore, None);
        }
        if self
            .inner
            .source_dir
            .join("pending_vrcx_migration")
            .is_file()
        {
            return self.rejected(DataDirMigrationErrorCode::PendingLegacyMigration, None);
        }
        if has_pending_data_dir_migration(&self.inner.control_dir) {
            return self.rejected(DataDirMigrationErrorCode::PendingMigration, None);
        }
        match self.cleanup_conflicts_with(&target_dir) {
            Ok(true) => {
                return self.rejected(
                    DataDirMigrationErrorCode::CleanupConflict,
                    Some(&target_dir),
                );
            }
            Ok(false) => {}
            Err(error) => {
                tracing::warn!(error = %error, "failed to inspect data directory cleanup state");
                return self.rejected(DataDirMigrationErrorCode::Io, None);
            }
        }
        if let Err(error) = (self.inner.pointer_committer)(&target_dir) {
            tracing::warn!(error = %error, "failed to commit data directory pointer");
            return self.failed(
                DataDirMigrationErrorCode::PointerCommitFailed,
                Some(&target_dir),
            );
        }
        self.inner.cancel_requested.store(false, Ordering::Release);
        let status = self.update_status(
            DataDirMigrationState::Completed,
            Some(DataDirMigrationPhase::Committing),
            Some(100),
            Some(&target_dir),
            None,
            true,
        );
        DataDirMigrationActionOutcome {
            accepted: true,
            status,
            error: None,
        }
    }

    pub fn take_last_result(&self) -> Result<Option<DataDirMigrationResult>> {
        Ok(take_data_dir_migration_result(&self.inner.control_dir)?)
    }

    fn cleanup_conflicts_with(&self, target_dir: &Path) -> Result<bool> {
        Ok(read_data_dir_cleanup_pendings(&self.inner.control_dir)?
            .into_iter()
            .any(|pending| paths_match(Path::new(&pending.old_dir), target_dir)))
    }

    pub fn cleanup_pending(&self) -> Result<Option<DataDirCleanupPending>> {
        Ok(read_data_dir_cleanup_pending(&self.inner.control_dir)?)
    }

    pub fn cleanup_migrated_data(&self) -> Result<Option<DataDirCleanupReport>> {
        let Some(_guard) = OperationGuard::try_acquire(&self.inner.operation_gate) else {
            return Err(Error::Custom(
                "A profile or data directory operation is already running.".into(),
            ));
        };
        if !self.inner.db.is_main_mode() {
            return Err(Error::Custom(
                "Migrated data cleanup requires the main database mode.".into(),
            ));
        }
        let Some(pending) = read_data_dir_cleanup_pending(&self.inner.control_dir)? else {
            return Ok(None);
        };
        Ok(Some(cleanup_migrated_data(
            &self.inner.control_dir,
            &self.inner.source_dir,
            &pending,
        )?))
    }

    pub fn dismiss_cleanup(&self) -> Result<()> {
        let Some(_guard) = OperationGuard::try_acquire(&self.inner.operation_gate) else {
            return Err(Error::Custom(
                "A profile or data directory operation is already running.".into(),
            ));
        };
        Ok(dismiss_data_dir_cleanup(&self.inner.control_dir)?)
    }

    pub fn mark_cleanup_prompted(&self, prompted_at: String) -> Result<()> {
        let Some(_guard) = OperationGuard::try_acquire(&self.inner.operation_gate) else {
            return Err(Error::Custom(
                "A profile or data directory operation is already running.".into(),
            ));
        };
        let Some(mut pending) = read_data_dir_cleanup_pending(&self.inner.control_dir)? else {
            return Ok(());
        };
        pending.last_prompted_at = Some(prompted_at);
        Ok(write_data_dir_cleanup_pending(
            &self.inner.control_dir,
            &pending,
        )?)
    }

    fn cancel_before_freeze(&self, target_dir: &Path) -> DataDirMigrationActionOutcome {
        let _ = remove_pending_data_dir_migration(&self.inner.control_dir);
        self.cancelled(target_dir)
    }

    fn abort_after_freeze(
        &self,
        target_dir: &Path,
        error_code: DataDirMigrationErrorCode,
        cancelled: bool,
    ) -> DataDirMigrationActionOutcome {
        let staging_result = clear_data_dir_migration_staging(target_dir);
        let reopen_result = self.inner.db.reopen_after_migration_abort();
        let journal_result = remove_pending_data_dir_migration(&self.inner.control_dir);
        if let Err(error) = &staging_result {
            tracing::warn!(error = %error, "failed to clean aborted data directory migration staging");
        }
        if let Err(error) = &reopen_result {
            tracing::warn!(error = %error, "failed to reopen database after aborted data directory migration");
        }
        if let Err(error) = &journal_result {
            tracing::warn!(error = %error, "failed to remove aborted data directory migration journal");
        }
        self.inner.cancel_requested.store(false, Ordering::Release);
        if staging_result.is_err() || reopen_result.is_err() || journal_result.is_err() {
            return self.failed(DataDirMigrationErrorCode::Io, Some(target_dir));
        }
        if cancelled {
            self.cancelled(target_dir)
        } else {
            self.failed(error_code, Some(target_dir))
        }
    }

    fn update_copy_progress(&self, processed: u64, total: u64, target_dir: &Path) {
        let percent = processed
            .saturating_mul(100)
            .checked_div(total)
            .unwrap_or(100)
            .min(100) as u8;
        self.update_status(
            if self.inner.cancel_requested.load(Ordering::Acquire) {
                DataDirMigrationState::Cancelling
            } else {
                DataDirMigrationState::Running
            },
            Some(DataDirMigrationPhase::Copying),
            Some(percent),
            Some(target_dir),
            None,
            processed == total,
        );
    }

    fn rejected(
        &self,
        code: DataDirMigrationErrorCode,
        path: Option<&Path>,
    ) -> DataDirMigrationActionOutcome {
        let error = DataDirMigrationError {
            code,
            path: path.map(|path| path.to_string_lossy().into_owned()),
        };
        DataDirMigrationActionOutcome {
            accepted: false,
            status: self.current_status(),
            error: Some(error),
        }
    }

    fn failed(
        &self,
        code: DataDirMigrationErrorCode,
        path: Option<&Path>,
    ) -> DataDirMigrationActionOutcome {
        let error = DataDirMigrationError {
            code,
            path: path.map(|path| path.to_string_lossy().into_owned()),
        };
        let current = self.current_status();
        let status = self.update_status(
            DataDirMigrationState::Error,
            current.phase,
            current.percent,
            path,
            Some(error.clone()),
            true,
        );
        DataDirMigrationActionOutcome {
            accepted: false,
            status,
            error: Some(error),
        }
    }

    fn cancelled(&self, target_dir: &Path) -> DataDirMigrationActionOutcome {
        let status = self.update_status(
            DataDirMigrationState::Cancelled,
            None,
            None,
            Some(target_dir),
            None,
            true,
        );
        DataDirMigrationActionOutcome {
            accepted: true,
            status,
            error: None,
        }
    }

    fn update_status(
        &self,
        state: DataDirMigrationState,
        phase: Option<DataDirMigrationPhase>,
        percent: Option<u8>,
        target_dir: Option<&Path>,
        error: Option<DataDirMigrationError>,
        force_emit: bool,
    ) -> DataDirMigrationStatus {
        let now = Instant::now();
        let mut runtime_state = match self.inner.status.lock() {
            Ok(state) => state,
            Err(error) => error.into_inner(),
        };
        runtime_state.snapshot.state = state;
        runtime_state.snapshot.phase = phase;
        runtime_state.snapshot.percent = percent;
        runtime_state.snapshot.source_dir =
            Some(self.inner.source_dir.to_string_lossy().into_owned());
        runtime_state.snapshot.target_dir =
            target_dir.map(|path| path.to_string_lossy().into_owned());
        runtime_state.snapshot.error = error;
        let should_emit = force_emit
            || runtime_state
                .last_progress_event_at
                .is_none_or(|last| now.duration_since(last) >= PROGRESS_EVENT_INTERVAL);
        if should_emit {
            runtime_state.snapshot.revision = runtime_state.snapshot.revision.saturating_add(1);
            runtime_state.last_progress_event_at = Some(now);
        }
        let snapshot = runtime_state.snapshot.clone();
        drop(runtime_state);
        if should_emit {
            self.inner.event_bus.emit(snapshot.clone());
        }
        snapshot
    }
}

fn paths_match(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}
