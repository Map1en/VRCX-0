mod artifacts;
mod filesystem;
mod journal;
mod validation;

pub(crate) use filesystem::{create_private_file, hash_file_with_progress, sync_directory_durable};

pub use artifacts::{
    cleanup_profile_backup_artifacts, clear_profile_restore_rollbacks,
    discard_staged_profile_restore, has_pending_profile_restore, profile_restore_rollback_count,
    take_last_profile_restore_result,
};
pub use journal::{
    consume_pending_profile_restore, request_staged_profile_restore,
    request_staged_profile_restore_with_progress, PendingProfileRestore,
    RequestStagedProfileRestoreError,
};
pub use validation::{
    read_profile_database_version, validate_and_stage_profile_restore,
    validate_and_stage_profile_restore_with_progress, ProfileRestoreWorkPhase,
};

#[cfg(test)]
mod tests;
