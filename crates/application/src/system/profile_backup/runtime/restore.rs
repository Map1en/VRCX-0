use std::path::Path;

use vrcx_0_persistence::data_dir_migration::has_pending_data_dir_migration;
use vrcx_0_persistence::profile_backup::{
    cleanup_profile_backup_artifacts, clear_profile_restore_rollbacks,
    discard_staged_profile_restore, has_pending_profile_restore, profile_restore_rollback_count,
    request_staged_profile_restore_with_progress, take_last_profile_restore_result,
    validate_and_stage_profile_restore_with_progress, ProfileRestoreWorkPhase,
    RequestStagedProfileRestoreError, RESTORE_ROLLBACK_DIRECTORY,
};

use crate::Result;

use super::super::{
    ProfileBackupError, ProfileBackupErrorCode, ProfileRestoreFailure, ProfileRestoreFailureCode,
    ProfileRestoreProgressOperation, ProfileRestoreProgressPhase, ProfileRestoreResult,
    ProfileRestoreRollbackCleanupOutcome, ProfileRestoreRollbackState,
    ProfileRestoreValidationOutcome,
};
use super::{OperationGuard, ProfileBackupRuntime};

impl ProfileBackupRuntime {
    pub fn validate_restore(&self, source: &Path) -> ProfileRestoreValidationOutcome {
        let Some(_guard) = OperationGuard::try_acquire(&self.inner.operation_gate) else {
            return restore_rejected(ProfileRestoreFailureCode::OperationBusy, None);
        };
        if !self.inner.db.is_main_mode() {
            return restore_rejected(ProfileRestoreFailureCode::OperationBusy, None);
        }
        if has_pending_profile_restore(&self.inner.app_data) {
            return restore_rejected(ProfileRestoreFailureCode::PendingRestore, None);
        }
        if has_pending_data_dir_migration(&self.inner.control_dir) {
            return restore_rejected(ProfileRestoreFailureCode::PendingDataDirMigration, None);
        }
        self.clear_validated_restore();
        let outcome = match validate_and_stage_profile_restore_with_progress(
            source,
            &self.inner.app_data,
            &self.inner.app_version,
            |phase, processed, total| {
                self.update_restore_progress(
                    ProfileRestoreProgressOperation::Validate,
                    restore_progress_phase(phase),
                    processed,
                    total,
                );
            },
        ) {
            Ok(outcome) => outcome,
            Err(error) => {
                tracing::warn!(error = %error, "failed to validate profile restore archive");
                restore_rejected(
                    ProfileRestoreFailureCode::Io,
                    Some(source.to_string_lossy().into_owned()),
                )
            }
        };
        if let Some(validation) = outcome.validation.clone() {
            if let Ok(mut state) = self.inner.state.lock() {
                state.validated_restore = Some(validation);
            }
        }
        outcome
    }

    pub fn request_restore(&self, expected_sha256: &str) -> ProfileRestoreValidationOutcome {
        let Some(_guard) = OperationGuard::try_acquire(&self.inner.operation_gate) else {
            return restore_rejected(ProfileRestoreFailureCode::OperationBusy, None);
        };
        if !self.inner.db.is_main_mode() {
            return restore_rejected(ProfileRestoreFailureCode::OperationBusy, None);
        }
        if has_pending_profile_restore(&self.inner.app_data) {
            return restore_rejected(ProfileRestoreFailureCode::PendingRestore, None);
        }
        if has_pending_data_dir_migration(&self.inner.control_dir) {
            return restore_rejected(ProfileRestoreFailureCode::PendingDataDirMigration, None);
        }
        let validation = self
            .inner
            .state
            .lock()
            .ok()
            .and_then(|mut state| state.validated_restore.take());
        let Some(validation) = validation else {
            return restore_rejected(ProfileRestoreFailureCode::ValidationExpired, None);
        };
        if validation.staged_sha256 != expected_sha256 {
            let _ = discard_staged_profile_restore(&self.inner.app_data);
            return restore_rejected(ProfileRestoreFailureCode::ValidationExpired, None);
        }
        if let Err(error) = request_staged_profile_restore_with_progress(
            &self.inner.app_data,
            &validation,
            |processed, total| {
                self.update_restore_progress(
                    ProfileRestoreProgressOperation::Prepare,
                    ProfileRestoreProgressPhase::VerifyStaging,
                    processed,
                    Some(total),
                );
            },
        ) {
            let code = match error {
                RequestStagedProfileRestoreError::StagingCorrupted => {
                    ProfileRestoreFailureCode::StagingCorrupted
                }
                RequestStagedProfileRestoreError::Other(error) => {
                    tracing::warn!(error = %error, "failed to persist profile restore request");
                    ProfileRestoreFailureCode::Io
                }
            };
            let _ = discard_staged_profile_restore(&self.inner.app_data);
            return restore_rejected(code, None);
        }
        ProfileRestoreValidationOutcome {
            validation: Some(validation),
            failure: None,
        }
    }

    pub fn discard_staged_restore(&self) -> Result<()> {
        let Some(_guard) = OperationGuard::try_acquire(&self.inner.operation_gate) else {
            return Err(crate::Error::Custom(
                "A profile backup or restore operation is already running.".into(),
            ));
        };
        self.clear_validated_restore();
        discard_staged_profile_restore(&self.inner.app_data)?;
        Ok(())
    }

    pub fn take_last_restore_result(&self) -> Result<Option<ProfileRestoreResult>> {
        Ok(take_last_profile_restore_result(&self.inner.app_data)?)
    }

    pub fn cleanup_startup_artifacts(&self) -> Result<()> {
        Ok(cleanup_profile_backup_artifacts(&self.inner.app_data)?)
    }

    pub fn restore_rollback_state(&self) -> Result<ProfileRestoreRollbackState> {
        let count = profile_restore_rollback_count(&self.inner.app_data)?;
        Ok(ProfileRestoreRollbackState {
            count,
            cleanup_allowed: count > 0
                && !has_pending_profile_restore(&self.inner.app_data)
                && !has_pending_data_dir_migration(&self.inner.control_dir),
        })
    }

    pub fn clear_restore_rollback(&self) -> ProfileRestoreRollbackCleanupOutcome {
        let Some(_guard) = OperationGuard::try_acquire(&self.inner.operation_gate) else {
            return rollback_cleanup_rejected(
                self.restore_rollback_state().unwrap_or_default(),
                ProfileBackupErrorCode::OperationBusy,
                None,
            );
        };
        let rollback_path = self.inner.app_data.join(RESTORE_ROLLBACK_DIRECTORY);
        let state = match self.restore_rollback_state() {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!(error = %error, "failed to inspect profile restore rollbacks");
                return rollback_cleanup_rejected(
                    self.restore_rollback_state().unwrap_or_default(),
                    ProfileBackupErrorCode::Io,
                    Some(&rollback_path),
                );
            }
        };
        if has_pending_profile_restore(&self.inner.app_data) {
            return rollback_cleanup_rejected(state, ProfileBackupErrorCode::PendingRestore, None);
        }
        if has_pending_data_dir_migration(&self.inner.control_dir) {
            return rollback_cleanup_rejected(
                state,
                ProfileBackupErrorCode::PendingDataDirMigration,
                None,
            );
        }
        if let Err(error) = clear_profile_restore_rollbacks(&self.inner.app_data) {
            tracing::warn!(error = %error, "failed to clear profile restore rollbacks");
            return rollback_cleanup_rejected(
                state,
                ProfileBackupErrorCode::Io,
                Some(&rollback_path),
            );
        }
        match self.restore_rollback_state() {
            Ok(state) => rollback_cleanup_outcome(true, state, None),
            Err(error) => {
                tracing::warn!(error = %error, "failed to refresh profile restore rollbacks");
                rollback_cleanup_rejected(state, ProfileBackupErrorCode::Io, Some(&rollback_path))
            }
        }
    }

    fn clear_validated_restore(&self) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.validated_restore = None;
        }
    }
}

fn restore_progress_phase(phase: ProfileRestoreWorkPhase) -> ProfileRestoreProgressPhase {
    match phase {
        ProfileRestoreWorkPhase::CopyArchive => ProfileRestoreProgressPhase::CopyArchive,
        ProfileRestoreWorkPhase::ExtractDatabase => ProfileRestoreProgressPhase::ExtractDatabase,
        ProfileRestoreWorkPhase::CheckDatabase => ProfileRestoreProgressPhase::CheckDatabase,
        ProfileRestoreWorkPhase::VerifyStaging => ProfileRestoreProgressPhase::VerifyStaging,
    }
}

fn restore_rejected(
    code: ProfileRestoreFailureCode,
    path: Option<String>,
) -> ProfileRestoreValidationOutcome {
    ProfileRestoreValidationOutcome {
        validation: None,
        failure: Some(ProfileRestoreFailure { code, path }),
    }
}

fn rollback_cleanup_outcome(
    accepted: bool,
    state: ProfileRestoreRollbackState,
    error: Option<ProfileBackupError>,
) -> ProfileRestoreRollbackCleanupOutcome {
    ProfileRestoreRollbackCleanupOutcome {
        accepted,
        state,
        error,
    }
}

fn rollback_cleanup_rejected(
    state: ProfileRestoreRollbackState,
    code: ProfileBackupErrorCode,
    path: Option<&Path>,
) -> ProfileRestoreRollbackCleanupOutcome {
    rollback_cleanup_outcome(
        false,
        state,
        Some(ProfileBackupError {
            code,
            path: path.map(|path| path.to_string_lossy().into_owned()),
        }),
    )
}
