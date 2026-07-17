use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use sha2::{Digest, Sha256};

use crate::Error;

use super::super::archive::sha256_hex;
use super::super::{
    ProfileRestoreResult, DATABASE_FILE_NAME, RESTORE_RESULT_FILE_NAME, RESTORE_ROLLBACK_DIRECTORY,
};

pub(super) fn move_database_family_to_rollback(
    db_path: &Path,
    rollback_dir: &Path,
) -> Result<(), Error> {
    move_to_rollback_if_present(db_path, &rollback_dir.join(DATABASE_FILE_NAME))?;
    for suffix in ["wal", "shm"] {
        let source = database_sidecar_path(db_path, suffix);
        let destination = rollback_dir.join(format!("{DATABASE_FILE_NAME}-{suffix}"));
        move_to_rollback_if_present(&source, &destination)?;
    }
    if let Some(parent) = db_path.parent() {
        sync_directory_durable(parent)?;
    }
    sync_directory_durable(rollback_dir)?;
    Ok(())
}

pub(super) fn ensure_rollback_directory(app_data: &Path, rollback_dir: &Path) -> Result<(), Error> {
    fs::create_dir_all(app_data)?;
    let rollback_root = app_data.join(RESTORE_ROLLBACK_DIRECTORY);
    if !rollback_root.exists() {
        fs::create_dir(&rollback_root)?;
        sync_directory_durable(app_data)?;
    }
    if !rollback_dir.exists() {
        fs::create_dir(rollback_dir)?;
        sync_directory_durable(&rollback_root)?;
    }
    sync_directory_durable(&rollback_root)?;
    sync_directory_durable(app_data)?;
    Ok(())
}

fn move_to_rollback_if_present(source: &Path, destination: &Path) -> Result<(), Error> {
    match (source.exists(), destination.exists()) {
        (true, false) => fs::rename(source, destination).map_err(Error::Io),
        (false, _) => Ok(()),
        (true, true) => Err(Error::InvalidData(format!(
            "Both restore source and rollback destination exist: {}",
            source.display()
        ))),
    }
}

pub(super) fn install_staged_database(staged_db: &Path, db_path: &Path) -> Result<(), Error> {
    match (staged_db.exists(), db_path.exists()) {
        (true, false) => fs::rename(staged_db, db_path).map_err(Error::Io),
        (false, true) => Ok(()),
        (true, true) => Err(Error::InvalidData(
            "Both staged and installed profile databases exist.".into(),
        )),
        (false, false) => Err(Error::InvalidData(
            "Neither staged nor installed profile database exists.".into(),
        )),
    }?;
    if let Some(parent) = staged_db.parent() {
        sync_directory_durable(parent)?;
    }
    if let Some(parent) = db_path.parent() {
        sync_directory_durable(parent)?;
    }
    Ok(())
}

pub(super) fn remove_database_family(db_path: &Path) -> Result<(), Error> {
    remove_file_if_exists(db_path)?;
    for suffix in ["wal", "shm"] {
        remove_file_if_exists(&database_sidecar_path(db_path, suffix))?;
    }
    if let Some(parent) = db_path.parent() {
        sync_directory_durable(parent)?;
    }
    Ok(())
}

pub(super) fn restore_database_family_from_rollback(
    db_path: &Path,
    rollback_dir: &Path,
) -> Result<(), Error> {
    restore_from_rollback(&rollback_dir.join(DATABASE_FILE_NAME), db_path, true)?;
    for suffix in ["wal", "shm"] {
        restore_from_rollback(
            &rollback_dir.join(format!("{DATABASE_FILE_NAME}-{suffix}")),
            &database_sidecar_path(db_path, suffix),
            false,
        )?;
    }
    if let Some(parent) = db_path.parent() {
        sync_directory_durable(parent)?;
    }
    sync_directory_durable(rollback_dir)?;
    Ok(())
}

fn restore_from_rollback(source: &Path, destination: &Path, required: bool) -> Result<(), Error> {
    match (source.exists(), destination.exists()) {
        (true, false) => fs::rename(source, destination).map_err(Error::Io),
        (false, true) => Ok(()),
        (true, true) => Err(Error::InvalidData(format!(
            "Both rollback and restored profile files exist: {}",
            destination.display()
        ))),
        (false, false) if required => Err(Error::InvalidData(
            "Neither rollback nor restored profile database exists.".into(),
        )),
        (false, false) => Ok(()),
    }
}

pub(super) fn write_restore_result(
    app_data: &Path,
    result: &ProfileRestoreResult,
) -> Result<(), Error> {
    fs::create_dir_all(app_data)?;
    let path = app_data.join(RESTORE_RESULT_FILE_NAME);
    let mut file = File::create(path)?;
    file.write_all(&serde_json::to_vec(result)?)?;
    file.sync_all()?;
    Ok(())
}

pub(super) fn prune_rollback_directories(
    app_data: &Path,
    retain: usize,
    active: Option<&str>,
) -> Result<(), Error> {
    let Some(root) = existing_rollback_root(app_data)? else {
        return Ok(());
    };
    let now = SystemTime::now();
    let max_age = Duration::from_secs(30 * 24 * 60 * 60);
    let mut directories = Vec::new();
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if !valid_rollback_directory_name(&name) {
            continue;
        }
        if active == Some(name.as_str()) {
            directories.push((name, entry.path()));
            continue;
        }
        let old = chrono::NaiveDateTime::parse_from_str(&name, "%Y%m%d-%H%M%S")
            .ok()
            .and_then(|timestamp| {
                let timestamp = SystemTime::from(timestamp.and_utc());
                now.duration_since(timestamp).ok()
            })
            .is_some_and(|age| age > max_age);
        if old {
            fs::remove_dir_all(entry.path())?;
        } else {
            directories.push((name, entry.path()));
        }
    }
    directories.sort_by(|left, right| right.0.cmp(&left.0));
    let active_count = usize::from(
        active.is_some_and(|active_name| directories.iter().any(|entry| entry.0 == active_name)),
    );
    let mut kept_other = 0_usize;
    for (name, path) in directories {
        if active == Some(name.as_str()) {
            continue;
        }
        if kept_other < retain.saturating_sub(active_count) {
            kept_other += 1;
        } else {
            fs::remove_dir_all(path)?;
        }
    }
    Ok(())
}

pub(super) fn existing_rollback_root(app_data: &Path) -> Result<Option<PathBuf>, Error> {
    let root = app_data.join(RESTORE_ROLLBACK_DIRECTORY);
    let metadata = match fs::symlink_metadata(&root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(Error::Io(error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(Error::InvalidData(format!(
            "Profile restore rollback root is not a directory: {}",
            root.display()
        )));
    }
    let canonical_app_data = fs::canonicalize(app_data)?;
    let canonical_root = fs::canonicalize(&root)?;
    if canonical_root != canonical_app_data.join(RESTORE_ROLLBACK_DIRECTORY) {
        return Err(Error::InvalidData(format!(
            "Profile restore rollback root escapes app data: {}",
            root.display()
        )));
    }
    Ok(Some(root))
}

pub(super) fn valid_rollback_directory_name(value: &str) -> bool {
    value.len() == 15
        && value.as_bytes()[8] == b'-'
        && value
            .bytes()
            .enumerate()
            .all(|(index, byte)| index == 8 || byte.is_ascii_digit())
}

pub(super) fn hash_file(path: &Path) -> Result<(String, u64), Error> {
    hash_file_with_progress(path, |_, _| {})
}

pub(super) fn hash_file_with_progress(
    path: &Path,
    mut progress: impl FnMut(u64, u64),
) -> Result<(String, u64), Error> {
    let mut file = File::open(path)?;
    let total = file.metadata()?.len();
    let mut hasher = Sha256::new();
    let mut bytes = 0_u64;
    let mut buffer = [0_u8; 128 * 1024];
    progress(0, total);
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        bytes = bytes
            .checked_add(read as u64)
            .ok_or_else(|| Error::InvalidData("The hashed file size overflowed.".into()))?;
        progress(bytes, total);
    }
    Ok((sha256_hex(hasher.finalize()), bytes))
}

pub(super) fn create_private_file(path: &Path) -> Result<File, Error> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    Ok(options.open(path)?)
}

pub(super) fn source_file_name(source: &Path) -> String {
    source
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| source.to_string_lossy().into_owned())
}

pub(super) fn database_sidecar_path(db_path: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}-{suffix}", db_path.to_string_lossy()))
}

pub(super) fn remove_file_if_exists(path: &Path) -> Result<(), Error> {
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

pub(super) fn remove_directory_if_exists(path: &Path) -> Result<(), Error> {
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    Ok(())
}

pub(super) fn sync_directory(path: &Path) {
    if let Err(error) =
        crate::profile_backup::fsutil::open_directory_for_sync(path).and_then(|dir| dir.sync_all())
    {
        tracing::debug!("Failed to sync profile backup directory: {error}");
    }
}

pub(super) fn sync_directory_durable(path: &Path) -> Result<(), Error> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()?;
    }
    #[cfg(not(unix))]
    {
        if let Err(error) = crate::profile_backup::fsutil::open_directory_for_sync(path)
            .and_then(|dir| dir.sync_all())
        {
            tracing::warn!("Failed to durably sync profile restore directory: {error}");
        }
    }
    Ok(())
}
