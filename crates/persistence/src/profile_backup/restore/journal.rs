use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::Error;

use super::super::{
    ProfileRestoreDataDisposition, ProfileRestoreFailure, ProfileRestoreFailureCode,
    ProfileRestoreManifestSummary, ProfileRestoreResult, ProfileRestoreResultStatus,
    ProfileRestoreValidation, DATABASE_FILE_NAME, RESTORE_JOURNAL_FILE_NAME,
    RESTORE_PENDING_DIRECTORY, RESTORE_ROLLBACK_DIRECTORY,
};
use super::filesystem::{
    ensure_rollback_directory, hash_file, hash_file_with_progress, install_staged_database,
    move_database_family_to_rollback, prune_rollback_directories, remove_database_family,
    remove_directory_if_exists, remove_file_if_exists, restore_database_family_from_rollback,
    sync_directory_durable, valid_rollback_directory_name, write_restore_result,
};

const RESTORE_JOURNAL_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(into = "u8", try_from = "u8")]
pub(super) enum RestoreJournalPhase {
    Staged,
    RollbackMoved,
    Installed,
    RollingBackClearing,
    RollingBackRestoring,
}

impl From<RestoreJournalPhase> for u8 {
    fn from(value: RestoreJournalPhase) -> Self {
        match value {
            RestoreJournalPhase::Staged => 0,
            RestoreJournalPhase::RollbackMoved => 1,
            RestoreJournalPhase::Installed => 2,
            RestoreJournalPhase::RollingBackClearing => 3,
            RestoreJournalPhase::RollingBackRestoring => 4,
        }
    }
}

impl TryFrom<u8> for RestoreJournalPhase {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Staged),
            1 => Ok(Self::RollbackMoved),
            2 => Ok(Self::Installed),
            3 => Ok(Self::RollingBackClearing),
            4 => Ok(Self::RollingBackRestoring),
            _ => Err(format!("Invalid restore journal phase: {value}")),
        }
    }
}

impl RestoreJournalPhase {
    fn rollback_failure_code(self) -> Option<ProfileRestoreFailureCode> {
        match self {
            Self::RollingBackClearing | Self::RollingBackRestoring => {
                Some(ProfileRestoreFailureCode::Io)
            }
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RestoreJournal {
    journal_version: u32,
    pub(super) phase: RestoreJournalPhase,
    staged_sha256: String,
    staged_bytes: u64,
    pub(super) source_file_name: String,
    manifest: ProfileRestoreManifestSummary,
    pub(super) rollback_directory_name: String,
}

pub struct PendingProfileRestore {
    app_data: PathBuf,
    db_path: PathBuf,
    journal: RestoreJournal,
}

pub fn request_staged_profile_restore(
    app_data: &Path,
    validation: &ProfileRestoreValidation,
) -> Result<(), Error> {
    request_staged_profile_restore_with_progress(app_data, validation, |_, _| {}).map_err(|error| {
        match error {
            RequestStagedProfileRestoreError::StagingCorrupted => Error::InvalidData(
                "The staged profile restore database changed after validation.".into(),
            ),
            RequestStagedProfileRestoreError::Other(error) => error,
        }
    })
}

pub enum RequestStagedProfileRestoreError {
    StagingCorrupted,
    Other(Error),
}

pub fn request_staged_profile_restore_with_progress(
    app_data: &Path,
    validation: &ProfileRestoreValidation,
    progress: impl FnMut(u64, u64),
) -> Result<(), RequestStagedProfileRestoreError> {
    let journal_path = app_data.join(RESTORE_JOURNAL_FILE_NAME);
    if journal_path.exists() {
        return Err(RequestStagedProfileRestoreError::Other(Error::InvalidData(
            "A profile restore request is already pending.".into(),
        )));
    }

    let staged_db = app_data
        .join(RESTORE_PENDING_DIRECTORY)
        .join(DATABASE_FILE_NAME);
    let (sha256, bytes) = hash_file_with_progress(&staged_db, progress)
        .map_err(RequestStagedProfileRestoreError::Other)?;
    if sha256 != validation.staged_sha256 || bytes != validation.staged_bytes {
        return Err(RequestStagedProfileRestoreError::StagingCorrupted);
    }

    let rollback_directory_name = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let rollback_dir = app_data
        .join(RESTORE_ROLLBACK_DIRECTORY)
        .join(&rollback_directory_name);
    if rollback_dir.exists() {
        return Err(RequestStagedProfileRestoreError::Other(Error::InvalidData(
            "The profile restore rollback destination already exists.".into(),
        )));
    }

    let journal = RestoreJournal {
        journal_version: RESTORE_JOURNAL_VERSION,
        phase: RestoreJournalPhase::Staged,
        staged_sha256: validation.staged_sha256.clone(),
        staged_bytes: validation.staged_bytes,
        source_file_name: validation.source_file_name.clone(),
        manifest: validation.manifest.clone(),
        rollback_directory_name,
    };
    write_new_journal(&journal_path, &journal).map_err(RequestStagedProfileRestoreError::Other)
}

pub fn consume_pending_profile_restore(
    app_data: &Path,
    db_path: &Path,
) -> Result<Option<PendingProfileRestore>, Error> {
    let journal_path = app_data.join(RESTORE_JOURNAL_FILE_NAME);
    if !journal_path.exists() {
        return Ok(None);
    }
    let staged_db = app_data
        .join(RESTORE_PENDING_DIRECTORY)
        .join(DATABASE_FILE_NAME);

    let mut journal = match read_journal(&journal_path) {
        Ok(journal) => journal,
        Err(error) => {
            tracing::warn!("Invalid profile restore journal: {error}");
            return handle_invalid_journal(app_data, db_path, &staged_db, String::new());
        }
    };

    if journal.journal_version != RESTORE_JOURNAL_VERSION
        || !valid_rollback_directory_name(&journal.rollback_directory_name)
    {
        return handle_invalid_journal(app_data, db_path, &staged_db, journal.source_file_name);
    }

    let rollback_dir = app_data
        .join(RESTORE_ROLLBACK_DIRECTORY)
        .join(&journal.rollback_directory_name);

    if let Some(failure_code) = journal.phase.rollback_failure_code() {
        rollback_restore(app_data, db_path, &journal, failure_code)?;
        return Ok(None);
    }

    if journal.phase == RestoreJournalPhase::Staged {
        let staged_valid = hash_file(&staged_db)
            .map(|(sha256, bytes)| sha256 == journal.staged_sha256 && bytes == journal.staged_bytes)
            .unwrap_or(false);
        if !staged_valid {
            tracing::warn!("Staged profile restore database failed startup verification");
            rollback_restore(
                app_data,
                db_path,
                &journal,
                ProfileRestoreFailureCode::StagingCorrupted,
            )?;
            return Ok(None);
        }
    }

    let advance = (|| -> Result<(), Error> {
        if journal.phase == RestoreJournalPhase::Staged {
            prune_rollback_directories(app_data, 0, None)?;
            ensure_rollback_directory(app_data, &rollback_dir)?;
            advance_journal_phase(
                &journal_path,
                &mut journal,
                RestoreJournalPhase::RollbackMoved,
            )?;
        }

        if journal.phase == RestoreJournalPhase::RollbackMoved {
            ensure_rollback_directory(app_data, &rollback_dir)?;
            move_database_family_to_rollback(db_path, &rollback_dir)?;
            advance_journal_phase(&journal_path, &mut journal, RestoreJournalPhase::Installed)?;
        }

        if journal.phase == RestoreJournalPhase::Installed {
            install_staged_database(&staged_db, db_path)?;
        }
        Ok(())
    })();

    if let Err(error) = advance {
        tracing::warn!("Failed to install pending profile restore: {error}");
        rollback_restore(app_data, db_path, &journal, ProfileRestoreFailureCode::Io)?;
        return Ok(None);
    }

    Ok(Some(PendingProfileRestore {
        app_data: app_data.to_path_buf(),
        db_path: db_path.to_path_buf(),
        journal,
    }))
}

impl PendingProfileRestore {
    pub fn finalize(self) -> Result<ProfileRestoreResult, Error> {
        let result = ProfileRestoreResult {
            status: ProfileRestoreResultStatus::Succeeded,
            data_disposition: ProfileRestoreDataDisposition::Replaced,
            source_file_name: self.journal.source_file_name,
            failure: None,
        };
        write_restore_result(&self.app_data, &result)?;
        sync_directory_durable(&self.app_data)?;
        remove_file_if_exists(&self.app_data.join(RESTORE_JOURNAL_FILE_NAME))?;
        sync_directory_durable(&self.app_data)?;
        remove_directory_if_exists(&self.app_data.join(RESTORE_PENDING_DIRECTORY))?;
        sync_directory_durable(&self.app_data)?;
        Ok(result)
    }

    pub fn rollback(
        self,
        failure_code: ProfileRestoreFailureCode,
    ) -> Result<ProfileRestoreResult, Error> {
        rollback_restore(&self.app_data, &self.db_path, &self.journal, failure_code)
    }
}

pub(super) fn rollback_restore(
    app_data: &Path,
    db_path: &Path,
    journal: &RestoreJournal,
    failure_code: ProfileRestoreFailureCode,
) -> Result<ProfileRestoreResult, Error> {
    let journal_path = app_data.join(RESTORE_JOURNAL_FILE_NAME);
    if journal.phase == RestoreJournalPhase::Staged {
        return finish_failed_restore(app_data, journal, failure_code, false);
    }

    let rollback_dir = app_data
        .join(RESTORE_ROLLBACK_DIRECTORY)
        .join(&journal.rollback_directory_name);
    let durable_failure_code = journal
        .phase
        .rollback_failure_code()
        .unwrap_or(failure_code);
    let mut journal = journal.clone();

    if journal.phase == RestoreJournalPhase::RollbackMoved {
        ensure_rollback_directory(app_data, &rollback_dir)?;
        move_database_family_to_rollback(db_path, &rollback_dir)?;
        advance_journal_phase(
            &journal_path,
            &mut journal,
            RestoreJournalPhase::RollingBackClearing,
        )?;
    } else if journal.phase == RestoreJournalPhase::Installed {
        advance_journal_phase(
            &journal_path,
            &mut journal,
            RestoreJournalPhase::RollingBackClearing,
        )?;
    }

    if journal.phase == RestoreJournalPhase::RollingBackClearing {
        remove_database_family(db_path)?;
        advance_journal_phase(
            &journal_path,
            &mut journal,
            RestoreJournalPhase::RollingBackRestoring,
        )?;
    }

    if journal.phase != RestoreJournalPhase::RollingBackRestoring {
        return Err(Error::InvalidData(
            "The profile restore rollback phase is invalid.".into(),
        ));
    }

    restore_database_family_from_rollback(db_path, &rollback_dir)?;
    finish_failed_restore(app_data, &journal, durable_failure_code, true)
}

fn finish_failed_restore(
    app_data: &Path,
    journal: &RestoreJournal,
    failure_code: ProfileRestoreFailureCode,
    restored_old_data: bool,
) -> Result<ProfileRestoreResult, Error> {
    let result = ProfileRestoreResult {
        status: ProfileRestoreResultStatus::Failed,
        data_disposition: if restored_old_data {
            ProfileRestoreDataDisposition::RolledBack
        } else {
            ProfileRestoreDataDisposition::Unchanged
        },
        source_file_name: journal.source_file_name.clone(),
        failure: Some(ProfileRestoreFailure {
            code: failure_code,
            path: None,
        }),
    };
    write_restore_result(app_data, &result)?;
    sync_directory_durable(app_data)?;
    remove_file_if_exists(&app_data.join(RESTORE_JOURNAL_FILE_NAME))?;
    sync_directory_durable(app_data)?;
    remove_directory_if_exists(&app_data.join(RESTORE_PENDING_DIRECTORY))?;
    sync_directory_durable(app_data)?;
    Ok(result)
}

fn clear_invalid_restore_request(app_data: &Path, source_file_name: String) -> Result<(), Error> {
    let result = ProfileRestoreResult {
        status: ProfileRestoreResultStatus::Failed,
        data_disposition: ProfileRestoreDataDisposition::Unchanged,
        source_file_name,
        failure: Some(ProfileRestoreFailure {
            code: ProfileRestoreFailureCode::StagingCorrupted,
            path: None,
        }),
    };
    write_restore_result(app_data, &result)?;
    sync_directory_durable(app_data)?;
    remove_file_if_exists(&app_data.join(RESTORE_JOURNAL_FILE_NAME))?;
    sync_directory_durable(app_data)?;
    remove_directory_if_exists(&app_data.join(RESTORE_PENDING_DIRECTORY))?;
    sync_directory_durable(app_data)?;
    Ok(())
}

fn handle_invalid_journal(
    app_data: &Path,
    db_path: &Path,
    staged_db: &Path,
    source_file_name: String,
) -> Result<Option<PendingProfileRestore>, Error> {
    if db_path.exists() && staged_db.exists() {
        clear_invalid_restore_request(app_data, source_file_name)?;
        return Ok(None);
    }
    Err(Error::InvalidData(
        "The profile restore journal is invalid after profile files may have moved.".into(),
    ))
}

fn write_new_journal(path: &Path, journal: &RestoreJournal) -> Result<(), Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec(journal)?;
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    if let Some(parent) = path.parent() {
        sync_directory_durable(parent)?;
    }
    Ok(())
}

pub(super) fn read_journal(path: &Path) -> Result<RestoreJournal, Error> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

pub(super) fn advance_journal_phase(
    path: &Path,
    journal: &mut RestoreJournal,
    next: RestoreJournalPhase,
) -> Result<(), Error> {
    let mut updated = journal.clone();
    updated.phase = next;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(&updated)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temporary)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary, path)?;
    if let Some(parent) = path.parent() {
        sync_directory_durable(parent)?;
    }
    journal.phase = next;
    Ok(())
}

pub(super) fn active_rollback_directory_name(app_data: &Path) -> Option<String> {
    let journal_path = app_data.join(RESTORE_JOURNAL_FILE_NAME);
    read_journal(&journal_path)
        .ok()
        .map(|journal| journal.rollback_directory_name)
}
