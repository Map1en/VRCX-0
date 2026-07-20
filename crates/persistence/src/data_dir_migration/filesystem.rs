use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::profile_backup::{create_private_file, hash_file_with_progress, sync_directory_durable};
use crate::{Error, FrozenDatabase, Result};

use super::types::{
    DataDirCleanupPending, DataDirCleanupReport, DataDirMigrationFinalizeOutcome,
    DataDirMigrationJournalPhase, DataDirMigrationWarning, PendingDataDirMigration,
    StagedDataDirMigration, DATA_DIR_MIGRATION_REPLACED_PREFIX,
    DATA_DIR_MIGRATION_STAGING_DIRECTORY,
};

const PROFILE_DATABASE_FILE: &str = "VRCX-0.sqlite3";
const PROFILE_CONFIG_FILE: &str = "VRCX-0.json";
const METADATA_CACHE_FILE: &str = "metadataCache.db";
const SCREENSHOT_THUMBS_DIRECTORY: &str = "ScreenshotThumbs";
const PURE_CACHE_ENTRIES: [&str; 5] = [
    "ImageCache",
    "ws-events.jsonl",
    "db-upgrade",
    ".backup-staging",
    "startup",
];
const CLEANUP_FILES: [&str; 7] = [
    PROFILE_CONFIG_FILE,
    "ws-events.jsonl",
    "error-log.txt",
    "runtime.lock",
    "last_profile_restore_result.json",
    "VRCX-0.sqlite3-wal",
    "VRCX-0.sqlite3-shm",
];
const CLEANUP_DIRECTORIES: [&str; 8] = [
    "ImageCache",
    SCREENSHOT_THUMBS_DIRECTORY,
    "diagnostics",
    "startup",
    "db-upgrade",
    ".backup-staging",
    ".restore-pending",
    ".restore-rollback",
];

pub fn data_dir_migration_required_bytes(source_dir: &Path) -> Result<u64> {
    let mut total = 0_u64;
    for path in [
        source_dir.join(PROFILE_DATABASE_FILE),
        source_dir.join(format!("{PROFILE_DATABASE_FILE}-wal")),
        source_dir.join(PROFILE_CONFIG_FILE),
        source_dir.join(METADATA_CACHE_FILE),
        source_dir.join(format!("{METADATA_CACHE_FILE}-wal")),
        source_dir.join(format!("{METADATA_CACHE_FILE}-shm")),
        source_dir.join(SCREENSHOT_THUMBS_DIRECTORY),
    ] {
        total = total
            .checked_add(path_size(&path)?)
            .ok_or_else(|| Error::InvalidData("Migration size overflowed.".into()))?;
    }
    Ok(total)
}

pub fn data_dir_available_space(path: &Path) -> Result<u64> {
    fs4::available_space(path).map_err(Error::Io)
}

pub fn clear_data_dir_migration_staging(target_dir: &Path) -> Result<()> {
    let staging = target_dir.join(DATA_DIR_MIGRATION_STAGING_DIRECTORY);
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
        sync_directory_durable(target_dir)?;
    }
    Ok(())
}

pub fn copy_frozen_database_to_staging(
    frozen: &FrozenDatabase,
    target_dir: &Path,
    mut progress: impl FnMut(u64, u64),
) -> Result<StagedDataDirMigration> {
    copy_frozen_database_to_staging_with_verification_hook(
        frozen,
        target_dir,
        |processed, total| {
            progress(processed, total);
            true
        },
        |_| Ok(()),
    )
}

pub fn copy_frozen_database_to_staging_cancellable(
    frozen: &FrozenDatabase,
    target_dir: &Path,
    progress: impl FnMut(u64, u64) -> bool,
) -> Result<StagedDataDirMigration> {
    copy_frozen_database_to_staging_with_verification_hook(frozen, target_dir, progress, |_| Ok(()))
}

pub(super) fn copy_frozen_database_to_staging_with_verification_hook(
    frozen: &FrozenDatabase,
    target_dir: &Path,
    mut progress: impl FnMut(u64, u64) -> bool,
    after_database_copy: impl FnOnce(&Path) -> Result<()>,
) -> Result<StagedDataDirMigration> {
    clear_data_dir_migration_staging(target_dir)?;
    let staging = target_dir.join(DATA_DIR_MIGRATION_STAGING_DIRECTORY);
    create_private_directory(&staging)?;
    sync_directory_durable(target_dir)?;
    let total = frozen
        .db_bytes
        .checked_add(frozen.wal_bytes.unwrap_or(0))
        .ok_or_else(|| Error::InvalidData("Migration copy size overflowed.".into()))?;
    ensure_copy_continues(progress(0, total))?;

    let staged_db = staging.join(PROFILE_DATABASE_FILE);
    let (db_sha256, db_bytes) =
        copy_file_with_hash(&frozen.db_path, &staged_db, 0, total, &mut progress)?;
    if db_bytes != frozen.db_bytes {
        return Err(Error::InvalidData(
            "Frozen database size changed during migration copy.".into(),
        ));
    }
    after_database_copy(&staged_db)?;
    let (staged_hash, staged_bytes) = hash_file_with_progress(&staged_db, |_, _| {})?;
    if staged_hash != db_sha256 || staged_bytes != db_bytes {
        return Err(Error::InvalidData(
            "Copied database hash verification failed.".into(),
        ));
    }

    if let (Some(wal_path), Some(wal_bytes)) = (&frozen.wal_path, frozen.wal_bytes) {
        let staged_wal = staging.join(format!("{PROFILE_DATABASE_FILE}-wal"));
        let (wal_hash, copied_wal_bytes) =
            copy_file_with_hash(wal_path, &staged_wal, db_bytes, total, &mut progress)?;
        if copied_wal_bytes != wal_bytes {
            return Err(Error::InvalidData(
                "Frozen WAL size changed during migration copy.".into(),
            ));
        }
        let (staged_wal_hash, staged_wal_bytes) = hash_file_with_progress(&staged_wal, |_, _| {})?;
        if staged_wal_hash != wal_hash || staged_wal_bytes != copied_wal_bytes {
            return Err(Error::InvalidData(
                "Copied WAL hash verification failed.".into(),
            ));
        }
    }
    sync_directory_durable(&staging)?;
    Ok(StagedDataDirMigration {
        db_sha256,
        db_bytes,
        wal_bytes: frozen.wal_bytes,
    })
}

pub fn install_staged_data_dir_database(
    target_dir: &Path,
    replace_existing: bool,
) -> Result<Option<PathBuf>> {
    let staging = target_dir.join(DATA_DIR_MIGRATION_STAGING_DIRECTORY);
    let staged_db = staging.join(PROFILE_DATABASE_FILE);
    if !staged_db.is_file() {
        return Err(Error::InvalidData(
            "Staged data directory database is missing.".into(),
        ));
    }
    let replaced_dir = if replace_existing {
        move_existing_profile_to_replaced_directory(target_dir)?
    } else {
        None
    };
    let target_db = target_dir.join(PROFILE_DATABASE_FILE);
    if target_db.exists() {
        return Err(Error::InvalidData(format!(
            "Migration target database already exists: {}",
            target_db.display()
        )));
    }
    fs::rename(&staged_db, &target_db)?;
    let staged_wal = staging.join(format!("{PROFILE_DATABASE_FILE}-wal"));
    if staged_wal.exists() {
        fs::rename(
            &staged_wal,
            target_dir.join(format!("{PROFILE_DATABASE_FILE}-wal")),
        )?;
    }
    sync_directory_durable(target_dir)?;
    sync_directory_durable(&staging)?;
    if fs::read_dir(&staging)?.next().transpose()?.is_none() {
        fs::remove_dir(&staging)?;
        sync_directory_durable(target_dir)?;
    }
    Ok(replaced_dir)
}

pub fn finalize_data_dir_migration(
    _control_dir: &Path,
    journal: &PendingDataDirMigration,
) -> Result<DataDirMigrationFinalizeOutcome> {
    journal.validate()?;
    if journal.phase != DataDirMigrationJournalPhase::Switched {
        return Err(Error::InvalidData(
            "Only a switched data directory migration can be finalized.".into(),
        ));
    }
    let source_dir = Path::new(&journal.source_dir);
    let target_dir = Path::new(&journal.target_dir);
    let mut warnings = Vec::new();

    if let Err(error) = copy_optional_file(
        &source_dir.join(PROFILE_CONFIG_FILE),
        &target_dir.join(PROFILE_CONFIG_FILE),
    ) {
        tracing::warn!(error = %error, "failed to copy migrated profile configuration");
        warnings.push(DataDirMigrationWarning::ConfigCopyFailed);
    }
    if let Err(error) = copy_gallery_data(source_dir, target_dir) {
        tracing::warn!(error = %error, "failed to copy migrated screenshot gallery data");
        warnings.push(DataDirMigrationWarning::GalleryCopyFailed);
    }
    if let Err(error) = remove_old_pure_caches(source_dir) {
        tracing::warn!(error = %error, "failed to remove one or more old data directory caches");
        warnings.push(DataDirMigrationWarning::CacheCleanupFailed);
    }

    let cleanup_pending = DataDirCleanupPending {
        old_dir: journal.source_dir.clone(),
        bytes: cleanup_manifest_size(source_dir)?,
        migrated_at: journal.requested_at.clone(),
        last_prompted_at: None,
        dismissed: false,
        replaced_dir: journal.replaced_dir.clone(),
    };
    Ok(DataDirMigrationFinalizeOutcome {
        cleanup_pending,
        warnings,
    })
}

pub fn cleanup_migrated_data(
    control_dir: &Path,
    current_dir: &Path,
    pending: &DataDirCleanupPending,
) -> Result<DataDirCleanupReport> {
    let old_dir = PathBuf::from(&pending.old_dir);
    if paths_match(&old_dir, current_dir) {
        return Err(Error::InvalidData(
            "The active data directory cannot be cleaned as migrated data.".into(),
        ));
    }
    let mut report = DataDirCleanupReport {
        freed_bytes: 0,
        skipped: Vec::new(),
    };
    remove_cleanup_manifest(&old_dir, &mut report)?;
    if let Some(replaced_dir) = pending.replaced_dir.as_deref() {
        remove_replaced_directory(Path::new(replaced_dir), current_dir, &mut report);
    }
    match fs::remove_dir(&old_dir) {
        Ok(()) => {}
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
            ) => {}
        Err(error) => report
            .skipped
            .push(format!("{}: {error}", old_dir.display())),
    }
    if report.skipped.is_empty() {
        super::journal::remove_data_dir_cleanup_pending(control_dir)?;
    }
    Ok(report)
}

pub fn cleanup_manifest_size(old_dir: &Path) -> Result<u64> {
    let mut total = path_size(&old_dir.join(PROFILE_DATABASE_FILE))?;
    for name in CLEANUP_FILES {
        total = total
            .checked_add(path_size(&old_dir.join(name))?)
            .ok_or_else(|| Error::InvalidData("Cleanup size overflowed.".into()))?;
    }
    for name in [
        METADATA_CACHE_FILE,
        "metadataCache.db-wal",
        "metadataCache.db-shm",
    ] {
        total = total
            .checked_add(path_size(&old_dir.join(name))?)
            .ok_or_else(|| Error::InvalidData("Cleanup size overflowed.".into()))?;
    }
    for name in CLEANUP_DIRECTORIES {
        total = total
            .checked_add(path_size(&old_dir.join(name))?)
            .ok_or_else(|| Error::InvalidData("Cleanup size overflowed.".into()))?;
    }
    if let Ok(entries) = fs::read_dir(old_dir) {
        for entry in entries.flatten() {
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with(DATA_DIR_MIGRATION_REPLACED_PREFIX)
            {
                total = total
                    .checked_add(path_size(&entry.path())?)
                    .ok_or_else(|| Error::InvalidData("Cleanup size overflowed.".into()))?;
            }
        }
    }
    Ok(total)
}

fn copy_file_with_hash(
    source: &Path,
    destination: &Path,
    progress_offset: u64,
    progress_total: u64,
    progress: &mut impl FnMut(u64, u64) -> bool,
) -> Result<(String, u64)> {
    let mut input = File::open(source)?;
    let mut output = create_private_file(destination)?;
    let mut hasher = Sha256::new();
    let mut copied = 0_u64;
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        output.write_all(&buffer[..read])?;
        hasher.update(&buffer[..read]);
        copied = copied
            .checked_add(read as u64)
            .ok_or_else(|| Error::InvalidData("Migration copy size overflowed.".into()))?;
        ensure_copy_continues(progress(
            progress_offset.saturating_add(copied),
            progress_total,
        ))?;
    }
    output.sync_all()?;
    Ok((crate::profile_backup::sha256_hex(hasher.finalize()), copied))
}

fn ensure_copy_continues(continue_copying: bool) -> Result<()> {
    if continue_copying {
        Ok(())
    } else {
        Err(Error::InvalidData(
            "Data directory migration copy was cancelled.".into(),
        ))
    }
}

fn move_existing_profile_to_replaced_directory(target_dir: &Path) -> Result<Option<PathBuf>> {
    let mut entries = Vec::new();
    for name in [
        PROFILE_DATABASE_FILE,
        "VRCX-0.sqlite3-wal",
        "VRCX-0.sqlite3-shm",
        PROFILE_CONFIG_FILE,
        METADATA_CACHE_FILE,
        "metadataCache.db-wal",
        "metadataCache.db-shm",
        SCREENSHOT_THUMBS_DIRECTORY,
    ] {
        let path = target_dir.join(name);
        if path.exists() {
            entries.push((path, name));
        }
    }
    if entries.is_empty() {
        return Ok(None);
    }
    let base_name = format!(
        "{DATA_DIR_MIGRATION_REPLACED_PREFIX}{}",
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    );
    let mut replaced_dir = target_dir.join(&base_name);
    let mut suffix = 1_u32;
    while replaced_dir.exists() {
        replaced_dir = target_dir.join(format!("{base_name}-{suffix}"));
        suffix = suffix.saturating_add(1);
    }
    create_private_directory(&replaced_dir)?;
    for (source, name) in entries {
        fs::rename(source, replaced_dir.join(name))?;
    }
    sync_directory_durable(&replaced_dir)?;
    sync_directory_durable(target_dir)?;
    Ok(Some(replaced_dir))
}

fn copy_gallery_data(source_dir: &Path, target_dir: &Path) -> Result<()> {
    for name in [
        METADATA_CACHE_FILE,
        "metadataCache.db-wal",
        "metadataCache.db-shm",
    ] {
        copy_optional_file(&source_dir.join(name), &target_dir.join(name))?;
    }
    let source_thumbs = source_dir.join(SCREENSHOT_THUMBS_DIRECTORY);
    if source_thumbs.exists() {
        copy_directory(
            &source_thumbs,
            &target_dir.join(SCREENSHOT_THUMBS_DIRECTORY),
        )?;
    }
    Ok(())
}

fn copy_optional_file(source: &Path, destination: &Path) -> Result<()> {
    if !source.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(source)?;
    if !metadata.file_type().is_file() {
        return Err(Error::InvalidData(format!(
            "Migration source is not a regular file: {}",
            source.display()
        )));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = destination.with_extension("migrate-copy.tmp");
    if temporary.exists() {
        fs::remove_file(&temporary)?;
    }
    let mut input = File::open(source)?;
    let mut output = create_private_file(&temporary)?;
    std::io::copy(&mut input, &mut output)?;
    output.sync_all()?;
    drop(output);
    if destination.exists() {
        fs::remove_file(destination)?;
    }
    fs::rename(&temporary, destination)?;
    if let Some(parent) = destination.parent() {
        sync_directory_durable(parent)?;
    }
    Ok(())
}

fn copy_directory(source: &Path, destination: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(source)?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(Error::InvalidData(format!(
            "Migration source is not a regular directory: {}",
            source.display()
        )));
    }
    create_private_directory(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = destination.join(entry.file_name());
        if file_type.is_file() {
            copy_optional_file(&entry.path(), &target)?;
        } else if file_type.is_dir() && !file_type.is_symlink() {
            copy_directory(&entry.path(), &target)?;
        } else {
            return Err(Error::InvalidData(format!(
                "Unsupported screenshot thumbnail entry: {}",
                entry.path().display()
            )));
        }
    }
    sync_directory_durable(destination)
}

fn remove_old_pure_caches(source_dir: &Path) -> Result<()> {
    let mut first_error = None;
    for name in PURE_CACHE_ENTRIES {
        if let Err(error) = remove_known_path(&source_dir.join(name)) {
            first_error.get_or_insert(error);
        }
    }
    if let Some(error) = first_error {
        return Err(error);
    }
    sync_directory_durable(source_dir)
}

fn remove_cleanup_manifest(old_dir: &Path, report: &mut DataDirCleanupReport) -> Result<()> {
    if !old_dir.exists() {
        return Ok(());
    }
    for name in [PROFILE_DATABASE_FILE]
        .into_iter()
        .chain(CLEANUP_FILES)
        .chain([
            METADATA_CACHE_FILE,
            "metadataCache.db-wal",
            "metadataCache.db-shm",
        ])
        .chain(CLEANUP_DIRECTORIES)
    {
        remove_for_cleanup(&old_dir.join(name), report);
    }
    if let Ok(entries) = fs::read_dir(old_dir) {
        for entry in entries.flatten() {
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with(DATA_DIR_MIGRATION_REPLACED_PREFIX)
            {
                remove_for_cleanup(&entry.path(), report);
            }
        }
    }
    sync_directory_durable(old_dir)
}

fn remove_replaced_directory(path: &Path, current_dir: &Path, report: &mut DataDirCleanupReport) {
    let valid_name = path.file_name().is_some_and(|name| {
        name.to_string_lossy()
            .starts_with(DATA_DIR_MIGRATION_REPLACED_PREFIX)
    });
    let valid_parent = path
        .parent()
        .is_some_and(|parent| paths_match(parent, current_dir));
    if !valid_name || !valid_parent {
        report
            .skipped
            .push(format!("{}: invalid replaced directory", path.display()));
        return;
    }
    remove_for_cleanup(path, report);
}

fn remove_for_cleanup(path: &Path, report: &mut DataDirCleanupReport) {
    let bytes = path_size(path).unwrap_or(0);
    match remove_known_path(path) {
        Ok(()) => {
            report.freed_bytes = report.freed_bytes.saturating_add(bytes);
        }
        Err(error) => report.skipped.push(format!("{}: {error}", path.display())),
    }
}

fn remove_known_path(path: &Path) -> Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(Error::Io(error)),
    };
    if metadata.file_type().is_symlink() || metadata.file_type().is_file() {
        fs::remove_file(path)?;
    } else if metadata.file_type().is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        return Err(Error::InvalidData(format!(
            "Cleanup entry has an unsupported file type: {}",
            path.display()
        )));
    }
    Ok(())
}

fn path_size(path: &Path) -> Result<u64> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(Error::Io(error)),
    };
    if metadata.file_type().is_symlink() {
        return Ok(0);
    }
    if metadata.file_type().is_file() {
        return Ok(metadata.len());
    }
    if !metadata.file_type().is_dir() {
        return Ok(0);
    }
    let mut total = 0_u64;
    for entry in fs::read_dir(path)? {
        total = total
            .checked_add(path_size(&entry?.path())?)
            .ok_or_else(|| Error::InvalidData("Directory size overflowed.".into()))?;
    }
    Ok(total)
}

fn create_private_directory(path: &Path) -> Result<()> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path)?;
        if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
            return Ok(());
        }
        return Err(Error::InvalidData(format!(
            "Migration directory path is not a regular directory: {}",
            path.display()
        )));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700);
        builder.create(path)?;
    }
    #[cfg(not(unix))]
    {
        fs::create_dir(path)?;
    }
    Ok(())
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
