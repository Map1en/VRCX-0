use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde::Serialize;

use crate::profile_backup::{create_private_file, replace_file_atomically, sync_directory_durable};
use crate::{Error, Result};

use super::types::{
    DataDirCleanupPending, DataDirMigrationResult, PendingDataDirMigration,
    DATA_DIR_CLEANUP_PENDING_FILE_NAME, DATA_DIR_MIGRATION_JOURNAL_FILE_NAME,
    DATA_DIR_MIGRATION_RESULT_FILE_NAME,
};

pub fn migration_journal_path(control_dir: &Path) -> PathBuf {
    control_dir.join(DATA_DIR_MIGRATION_JOURNAL_FILE_NAME)
}

pub fn has_pending_data_dir_migration(control_dir: &Path) -> bool {
    migration_journal_path(control_dir).is_file()
}

pub fn read_pending_data_dir_migration(
    control_dir: &Path,
) -> Result<Option<PendingDataDirMigration>> {
    let path = migration_journal_path(control_dir);
    let journal: Option<PendingDataDirMigration> = read_json_if_exists(&path)?;
    let Some(journal) = journal else {
        return Ok(None);
    };
    journal.validate()?;
    Ok(Some(journal))
}

pub fn write_pending_data_dir_migration(
    control_dir: &Path,
    journal: &PendingDataDirMigration,
) -> Result<()> {
    journal.validate()?;
    write_json_durable(&migration_journal_path(control_dir), journal)
}

pub fn remove_pending_data_dir_migration(control_dir: &Path) -> Result<()> {
    remove_file_durable(&migration_journal_path(control_dir))
}

pub fn write_data_dir_migration_result(
    control_dir: &Path,
    result: &DataDirMigrationResult,
) -> Result<()> {
    write_json_durable(
        &control_dir.join(DATA_DIR_MIGRATION_RESULT_FILE_NAME),
        result,
    )
}

pub fn take_data_dir_migration_result(
    control_dir: &Path,
) -> Result<Option<DataDirMigrationResult>> {
    let path = control_dir.join(DATA_DIR_MIGRATION_RESULT_FILE_NAME);
    let result = read_json_if_exists(&path)?;
    if result.is_some() {
        if let Err(error) = remove_file_durable(&path) {
            tracing::warn!(error = %error, "failed to remove data directory migration result");
        }
    }
    Ok(result)
}

pub fn read_data_dir_cleanup_pending(control_dir: &Path) -> Result<Option<DataDirCleanupPending>> {
    Ok(read_data_dir_cleanup_pendings(control_dir)?
        .into_iter()
        .next())
}

pub fn read_data_dir_cleanup_pendings(control_dir: &Path) -> Result<Vec<DataDirCleanupPending>> {
    let path = control_dir.join(DATA_DIR_CLEANUP_PENDING_FILE_NAME);
    let Some(stored): Option<StoredDataDirCleanupPending> = read_json_if_exists(&path)? else {
        return Ok(Vec::new());
    };
    Ok(match stored {
        StoredDataDirCleanupPending::Single(pending) => vec![pending],
        StoredDataDirCleanupPending::Queue(pending) => pending,
    })
}

pub fn write_data_dir_cleanup_pending(
    control_dir: &Path,
    pending: &DataDirCleanupPending,
) -> Result<()> {
    let mut pending_queue = read_data_dir_cleanup_pendings(control_dir)?;
    if pending_queue.is_empty() {
        pending_queue.push(pending.clone());
    } else {
        pending_queue.remove(0);
        if pending.dismissed {
            pending_queue.push(pending.clone());
        } else {
            pending_queue.insert(0, pending.clone());
        }
    }
    write_data_dir_cleanup_queue(control_dir, &pending_queue)
}

pub(super) fn append_data_dir_cleanup_pending(
    control_dir: &Path,
    pending: &DataDirCleanupPending,
) -> Result<()> {
    let mut pending_queue = read_data_dir_cleanup_pendings(control_dir)?;
    if !pending_queue
        .iter()
        .any(|existing| same_cleanup_migration(existing, pending))
    {
        let insertion_index = pending_queue
            .iter()
            .position(|existing| existing.dismissed)
            .unwrap_or(pending_queue.len());
        pending_queue.insert(insertion_index, pending.clone());
    }
    write_data_dir_cleanup_queue(control_dir, &pending_queue)
}

pub fn remove_data_dir_cleanup_pending(control_dir: &Path) -> Result<()> {
    let mut pending_queue = read_data_dir_cleanup_pendings(control_dir)?;
    if pending_queue.is_empty() {
        return remove_file_durable(&control_dir.join(DATA_DIR_CLEANUP_PENDING_FILE_NAME));
    }
    pending_queue.remove(0);
    write_data_dir_cleanup_queue(control_dir, &pending_queue)
}

#[derive(Deserialize)]
#[serde(untagged)]
enum StoredDataDirCleanupPending {
    Single(DataDirCleanupPending),
    Queue(Vec<DataDirCleanupPending>),
}

fn same_cleanup_migration(left: &DataDirCleanupPending, right: &DataDirCleanupPending) -> bool {
    left.old_dir == right.old_dir
        && left.migrated_at == right.migrated_at
        && left.replaced_dir == right.replaced_dir
}

fn write_data_dir_cleanup_queue(
    control_dir: &Path,
    pending_queue: &[DataDirCleanupPending],
) -> Result<()> {
    let path = control_dir.join(DATA_DIR_CLEANUP_PENDING_FILE_NAME);
    match pending_queue {
        [] => remove_file_durable(&path),
        [pending] => write_json_durable(&path, pending),
        pending => write_json_durable(&path, &pending),
    }
}

fn read_json_if_exists<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(Error::Io(error)),
    }
}

fn write_json_durable(path: &Path, value: &impl Serialize) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::InvalidData("Control file has no parent directory.".into()))?;
    fs::create_dir_all(parent)?;
    let temporary = path.with_extension("json.tmp");
    if temporary.exists() {
        fs::remove_file(&temporary)?;
    }
    let mut file = create_private_file(&temporary)?;
    file.write_all(&serde_json::to_vec(value)?)?;
    file.sync_all()?;
    drop(file);
    replace_file_atomically(&temporary, path)?;
    sync_directory_durable(parent)
}

fn remove_file_durable(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => {
            if let Some(parent) = path.parent() {
                sync_directory_durable(parent)?;
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(Error::Io(error)),
    }
}
