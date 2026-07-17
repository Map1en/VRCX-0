use std::fs;
use std::path::Path;

use crate::Error;

use super::super::{
    ProfileRestoreResult, BACKUP_STAGING_DIRECTORY, DATABASE_FILE_NAME, RESTORE_JOURNAL_FILE_NAME,
    RESTORE_PENDING_DIRECTORY, RESTORE_RESULT_FILE_NAME,
};
use super::filesystem::{
    existing_rollback_root, prune_rollback_directories, remove_directory_if_exists,
    sync_directory_durable, valid_rollback_directory_name,
};
use super::journal::active_rollback_directory_name;

pub fn take_last_profile_restore_result(
    app_data: &Path,
) -> Result<Option<ProfileRestoreResult>, Error> {
    let result_path = app_data.join(RESTORE_RESULT_FILE_NAME);
    if !result_path.exists() {
        return Ok(None);
    }
    let result = serde_json::from_slice(&fs::read(&result_path)?)?;
    if let Err(error) = fs::remove_file(&result_path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!("Failed to remove the profile restore result file: {error}");
        }
    }
    Ok(Some(result))
}

pub fn cleanup_profile_backup_artifacts(app_data: &Path) -> Result<(), Error> {
    remove_directory_if_exists(&app_data.join(BACKUP_STAGING_DIRECTORY))?;
    let journal_path = app_data.join(RESTORE_JOURNAL_FILE_NAME);
    if !journal_path.exists() {
        remove_directory_if_exists(&app_data.join(RESTORE_PENDING_DIRECTORY))?;
        return prune_rollback_directories(app_data, 1, None);
    }
    let Some(active) = active_rollback_directory_name(app_data) else {
        return Ok(());
    };
    prune_rollback_directories(app_data, 1, Some(active.as_str()))
}

pub fn profile_restore_rollback_count(app_data: &Path) -> Result<u32, Error> {
    let Some(root) = existing_rollback_root(app_data)? else {
        return Ok(0);
    };
    let mut count = 0_u32;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !is_valid_rollback_directory(&entry)? {
            continue;
        }
        if rollback_directory_has_database_family(&entry.path())? {
            count = count
                .checked_add(1)
                .ok_or_else(|| Error::InvalidData("Too many profile restore rollbacks.".into()))?;
        }
    }
    Ok(count)
}

pub fn clear_profile_restore_rollbacks(app_data: &Path) -> Result<(), Error> {
    if has_pending_profile_restore(app_data) {
        return Err(Error::InvalidData(
            "Cannot clear profile restore rollbacks while a restore is pending.".into(),
        ));
    }
    let Some(root) = existing_rollback_root(app_data)? else {
        return Ok(());
    };
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        if is_valid_rollback_directory(&entry)? {
            fs::remove_dir_all(entry.path())?;
        }
    }
    sync_directory_durable(&root)?;
    if fs::read_dir(&root)?.next().is_none() {
        fs::remove_dir(&root)?;
        sync_directory_durable(app_data)?;
    }
    Ok(())
}

fn is_valid_rollback_directory(entry: &fs::DirEntry) -> Result<bool, Error> {
    if !entry.file_type()?.is_dir() {
        return Ok(false);
    }
    let name = entry.file_name();
    Ok(name.to_str().is_some_and(valid_rollback_directory_name))
}

fn rollback_directory_has_database_family(path: &Path) -> Result<bool, Error> {
    for file_name in [
        DATABASE_FILE_NAME.to_owned(),
        format!("{DATABASE_FILE_NAME}-wal"),
        format!("{DATABASE_FILE_NAME}-shm"),
    ] {
        match fs::metadata(path.join(file_name)) {
            Ok(metadata) if metadata.is_file() => return Ok(true),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(Error::Io(error)),
        }
    }
    Ok(false)
}

pub fn discard_staged_profile_restore(app_data: &Path) -> Result<(), Error> {
    if has_pending_profile_restore(app_data) {
        return Err(Error::InvalidData(
            "Cannot discard a staged profile restore after it is requested.".into(),
        ));
    }
    remove_directory_if_exists(&app_data.join(RESTORE_PENDING_DIRECTORY))
}

pub fn has_pending_profile_restore(app_data: &Path) -> bool {
    app_data.join(RESTORE_JOURNAL_FILE_NAME).is_file()
}
