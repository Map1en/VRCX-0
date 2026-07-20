mod filesystem;
mod journal;
mod types;

#[cfg(test)]
mod tests;

use std::fs;
use std::path::Path;

pub use filesystem::{
    cleanup_manifest_size, cleanup_migrated_data, clear_data_dir_migration_staging,
    copy_frozen_database_to_staging, copy_frozen_database_to_staging_cancellable,
    data_dir_available_space, data_dir_migration_required_bytes, finalize_data_dir_migration,
    install_staged_data_dir_database,
};
pub use journal::{
    has_pending_data_dir_migration, migration_journal_path, read_data_dir_cleanup_pending,
    read_data_dir_cleanup_pendings, read_pending_data_dir_migration,
    remove_data_dir_cleanup_pending, remove_pending_data_dir_migration,
    take_data_dir_migration_result, write_data_dir_cleanup_pending,
    write_data_dir_migration_result, write_pending_data_dir_migration,
};
pub use types::{
    DataDirCleanupPending, DataDirCleanupReport, DataDirMigrationFinalizeOutcome,
    DataDirMigrationJournalPhase, DataDirMigrationResult, DataDirMigrationResultStatus,
    DataDirMigrationTargetState, DataDirMigrationWarning, PendingDataDirMigration,
    StagedDataDirMigration, DATA_DIR_CLEANUP_PENDING_FILE_NAME,
    DATA_DIR_MIGRATION_JOURNAL_FILE_NAME, DATA_DIR_MIGRATION_REPLACED_PREFIX,
    DATA_DIR_MIGRATION_RESULT_FILE_NAME, DATA_DIR_MIGRATION_SPACE_MARGIN_BYTES,
    DATA_DIR_MIGRATION_STAGING_DIRECTORY,
};

use crate::{Error, Result};

const PROFILE_DATABASE_FILE: &str = "VRCX-0.sqlite3";

pub fn inspect_data_dir_migration_target(target_dir: &Path) -> Result<DataDirMigrationTargetState> {
    if !target_dir.is_dir() {
        return Err(Error::InvalidData(format!(
            "Data directory migration target is not a directory: {}",
            target_dir.display()
        )));
    }
    if target_dir.join(PROFILE_DATABASE_FILE).is_file() {
        return Ok(DataDirMigrationTargetState::ExistingProfile);
    }
    if fs::read_dir(target_dir)?.next().transpose()?.is_none() {
        Ok(DataDirMigrationTargetState::Empty)
    } else {
        Ok(DataDirMigrationTargetState::ForeignContent)
    }
}

pub fn cleanup_interrupted_data_dir_migration(
    control_dir: &Path,
    journal: &PendingDataDirMigration,
) -> Result<()> {
    journal.validate()?;
    if journal.phase != DataDirMigrationJournalPhase::Copying {
        return Err(Error::InvalidData(
            "Only a copying data directory migration can be interrupted.".into(),
        ));
    }
    clear_data_dir_migration_staging(Path::new(&journal.target_dir))?;
    write_data_dir_migration_result(
        control_dir,
        &DataDirMigrationResult {
            status: DataDirMigrationResultStatus::Interrupted,
            source_dir: journal.source_dir.clone(),
            target_dir: journal.target_dir.clone(),
            warnings: Vec::new(),
        },
    )?;
    remove_pending_data_dir_migration(control_dir)
}

pub fn complete_data_dir_migration(
    control_dir: &Path,
    journal: &PendingDataDirMigration,
    outcome: &DataDirMigrationFinalizeOutcome,
) -> Result<()> {
    journal::append_data_dir_cleanup_pending(control_dir, &outcome.cleanup_pending)?;
    write_data_dir_migration_result(
        control_dir,
        &DataDirMigrationResult {
            status: DataDirMigrationResultStatus::Succeeded,
            source_dir: journal.source_dir.clone(),
            target_dir: journal.target_dir.clone(),
            warnings: outcome.warnings.clone(),
        },
    )?;
    remove_pending_data_dir_migration(control_dir)
}

pub fn record_data_dir_migration_database_open_failure(
    control_dir: &Path,
    journal: &PendingDataDirMigration,
) -> Result<()> {
    remove_pending_data_dir_migration(control_dir)?;
    write_data_dir_migration_result(
        control_dir,
        &DataDirMigrationResult {
            status: DataDirMigrationResultStatus::DatabaseOpenFailed,
            source_dir: journal.source_dir.clone(),
            target_dir: journal.target_dir.clone(),
            warnings: Vec::new(),
        },
    )
}

pub fn dismiss_data_dir_cleanup(control_dir: &Path) -> Result<()> {
    let Some(mut pending) = read_data_dir_cleanup_pending(control_dir)? else {
        return Ok(());
    };
    pending.dismissed = true;
    write_data_dir_cleanup_pending(control_dir, &pending)
}
