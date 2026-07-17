use std::fs::{self, File};
use std::io::{BufReader, Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::database::schema::VRCX0_SCHEMA_VERSION;
use crate::Error;

use super::super::archive::{parse_app_version, sha256_hex};
use super::super::{
    ProfileBackupManifest, ProfileRestoreAppVersionCheck, ProfileRestoreArchiveCheck,
    ProfileRestoreDatabaseCheck, ProfileRestoreDatabaseVersionCheck, ProfileRestoreFailureCode,
    ProfileRestoreManifestSummary, ProfileRestoreValidation, ProfileRestoreValidationOutcome,
    DATABASE_FILE_NAME, MANIFEST_FILE_NAME, MAX_PROFILE_DATABASE_BYTES, RESTORE_PENDING_DIRECTORY,
};
use super::artifacts::has_pending_profile_restore;
use super::filesystem::{
    create_private_file, hash_file_with_progress, remove_directory_if_exists,
    remove_file_if_exists, source_file_name, sync_directory,
};

const STAGED_ARCHIVE_FILE_NAME: &str = "profile-restore-package.vrcx0backup";
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const TAR_BLOCK_BYTES: usize = 512;
pub(super) const MAX_RESTORE_ARCHIVE_BYTES: u64 = MAX_PROFILE_DATABASE_BYTES + 16 * 1024 * 1024;
pub(super) const RESTORE_FREE_SPACE_RESERVE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProfileRestoreWorkPhase {
    CopyArchive,
    ExtractDatabase,
    CheckDatabase,
    VerifyStaging,
}

pub fn validate_and_stage_profile_restore(
    source: &Path,
    app_data: &Path,
    current_app_version: &str,
) -> Result<ProfileRestoreValidationOutcome, Error> {
    validate_and_stage_profile_restore_with_progress(
        source,
        app_data,
        current_app_version,
        |_, _, _| {},
    )
}

pub fn validate_and_stage_profile_restore_with_progress(
    source: &Path,
    app_data: &Path,
    current_app_version: &str,
    mut progress: impl FnMut(ProfileRestoreWorkPhase, u64, Option<u64>),
) -> Result<ProfileRestoreValidationOutcome, Error> {
    let path = Some(source.to_string_lossy().into_owned());
    if has_pending_profile_restore(app_data) {
        return Ok(ProfileRestoreValidationOutcome::rejected(
            ProfileRestoreFailureCode::PendingRestore,
            path,
        ));
    }

    let pending_dir = app_data.join(RESTORE_PENDING_DIRECTORY);
    remove_directory_if_exists(&pending_dir)?;
    fs::create_dir_all(&pending_dir)?;
    let staged_archive = pending_dir.join(STAGED_ARCHIVE_FILE_NAME);
    let staged_db = pending_dir.join(DATABASE_FILE_NAME);

    let result = (|| {
        copy_archive_with_budget(source, &staged_archive, &pending_dir, &mut progress)?;
        validate_archive_streaming(
            &staged_archive,
            &staged_db,
            current_app_version,
            source_file_name(source),
            &mut progress,
        )
    })();

    match result {
        Ok(validation) => {
            remove_file_if_exists(&staged_archive)?;
            sync_directory(&pending_dir);
            Ok(ProfileRestoreValidationOutcome::accepted(validation))
        }
        Err(code) => {
            if let Err(error) = remove_directory_if_exists(&pending_dir) {
                tracing::warn!("Failed to clear rejected profile restore staging: {error}");
            }
            Ok(ProfileRestoreValidationOutcome::rejected(code, path))
        }
    }
}

struct StreamedDatabase {
    sha256: String,
    bytes: u64,
}

fn validate_archive_streaming(
    archive_path: &Path,
    staged_db: &Path,
    current_app_version: &str,
    source_file_name: String,
    progress: &mut impl FnMut(ProfileRestoreWorkPhase, u64, Option<u64>),
) -> Result<ProfileRestoreValidation, ProfileRestoreFailureCode> {
    let mut archive_file = File::open(archive_path).map_err(|_| ProfileRestoreFailureCode::Io)?;
    let temporary_db = staged_db.with_extension("sqlite3.tmp");
    remove_file_if_exists(&temporary_db).map_err(|_| ProfileRestoreFailureCode::Io)?;
    let streamed = read_streamed_restore_entries(&mut archive_file, &temporary_db, progress);
    let (manifest_bytes, database) = match streamed {
        Ok(value) => value,
        Err(code) => {
            let _ = remove_file_if_exists(&temporary_db);
            return Err(code);
        }
    };
    let manifest: ProfileBackupManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| ProfileRestoreFailureCode::InvalidArchive)?;
    validate_manifest_compatibility(&manifest, current_app_version)?;
    let content = &manifest.contents[0];
    if database.bytes != content.bytes {
        let _ = remove_file_if_exists(&temporary_db);
        return Err(ProfileRestoreFailureCode::ContentSizeMismatch);
    }
    if database.sha256 != content.sha256.to_ascii_lowercase() {
        let _ = remove_file_if_exists(&temporary_db);
        return Err(ProfileRestoreFailureCode::ContentHashMismatch);
    }
    remove_file_if_exists(staged_db).map_err(|_| ProfileRestoreFailureCode::Io)?;
    fs::rename(&temporary_db, staged_db).map_err(|_| ProfileRestoreFailureCode::Io)?;
    progress(ProfileRestoreWorkPhase::CheckDatabase, 0, None);
    validate_profile_database(staged_db, manifest.db_version)?;
    let (staged_sha256, staged_bytes) = hash_file_with_progress(staged_db, |processed, total| {
        progress(
            ProfileRestoreWorkPhase::VerifyStaging,
            processed,
            Some(total),
        );
    })
    .map_err(|_| ProfileRestoreFailureCode::Io)?;
    if staged_sha256 != database.sha256 || staged_bytes != database.bytes {
        return Err(ProfileRestoreFailureCode::StagingCorrupted);
    }

    Ok(ProfileRestoreValidation {
        manifest: ProfileRestoreManifestSummary {
            app_version: manifest.app_version,
            db_version: manifest.db_version,
            created_at: manifest.created_at,
            platform: manifest.platform,
            kind: manifest.kind,
        },
        source_file_name,
        staged_sha256: content.sha256.to_ascii_lowercase(),
        staged_bytes: content.bytes,
        archive: ProfileRestoreArchiveCheck::Valid,
        app_version: ProfileRestoreAppVersionCheck::Compatible,
        database_version: ProfileRestoreDatabaseVersionCheck::Compatible,
        database: ProfileRestoreDatabaseCheck::Valid,
    })
}

fn read_streamed_restore_entries(
    archive_file: &mut File,
    temporary_db: &Path,
    progress: &mut impl FnMut(ProfileRestoreWorkPhase, u64, Option<u64>),
) -> Result<(Vec<u8>, StreamedDatabase), ProfileRestoreFailureCode> {
    let reader = BufReader::new(archive_file);
    let mut decoder = zstd::stream::read::Decoder::with_buffer(reader)
        .map_err(|_| ProfileRestoreFailureCode::InvalidArchive)?
        .single_frame();
    let mut manifest = None;
    let mut database = None;

    {
        let mut archive = tar::Archive::new(&mut decoder);
        let mut entries = archive
            .entries()
            .map_err(|_| ProfileRestoreFailureCode::InvalidArchive)?
            .raw(true);
        for _ in 0..2 {
            let mut entry = entries
                .next()
                .ok_or(ProfileRestoreFailureCode::InvalidEntries)?
                .map_err(|_| ProfileRestoreFailureCode::InvalidArchive)?;
            if entry.header().entry_type() != tar::EntryType::Regular {
                return Err(ProfileRestoreFailureCode::InvalidEntries);
            }
            let size = entry.size();
            match entry.path_bytes().as_ref() {
                name if name == MANIFEST_FILE_NAME.as_bytes() => {
                    if manifest.is_some() {
                        return Err(ProfileRestoreFailureCode::InvalidEntries);
                    }
                    manifest = Some(read_manifest_entry(&mut entry, size)?);
                }
                name if name == DATABASE_FILE_NAME.as_bytes() => {
                    if database.is_some() {
                        return Err(ProfileRestoreFailureCode::InvalidEntries);
                    }
                    database = Some(read_database_entry(
                        &mut entry,
                        size,
                        temporary_db,
                        progress,
                    )?);
                }
                _ => return Err(ProfileRestoreFailureCode::InvalidEntries),
            }
        }
        match entries.next() {
            None => {}
            Some(Ok(_)) => return Err(ProfileRestoreFailureCode::InvalidEntries),
            Some(Err(_)) => return Err(ProfileRestoreFailureCode::InvalidArchive),
        }
    }

    ensure_second_tar_end_block(&mut decoder)?;
    ensure_stream_eof(&mut decoder)?;
    let mut compressed_reader = decoder.finish();
    ensure_stream_eof(&mut compressed_reader)?;

    Ok((
        manifest.ok_or(ProfileRestoreFailureCode::InvalidEntries)?,
        database.ok_or(ProfileRestoreFailureCode::InvalidEntries)?,
    ))
}

fn ensure_second_tar_end_block(reader: &mut impl Read) -> Result<(), ProfileRestoreFailureCode> {
    let mut block = [0_u8; TAR_BLOCK_BYTES];
    reader
        .read_exact(&mut block)
        .map_err(|_| ProfileRestoreFailureCode::InvalidArchive)?;
    if block.iter().all(|byte| *byte == 0) {
        Ok(())
    } else {
        Err(ProfileRestoreFailureCode::InvalidArchive)
    }
}

fn ensure_stream_eof(reader: &mut impl Read) -> Result<(), ProfileRestoreFailureCode> {
    let mut probe = [0_u8; 1];
    if reader
        .read(&mut probe)
        .map_err(|_| ProfileRestoreFailureCode::InvalidArchive)?
        == 0
    {
        Ok(())
    } else {
        Err(ProfileRestoreFailureCode::InvalidArchive)
    }
}

fn read_manifest_entry<R: Read>(
    entry: &mut R,
    expected_size: u64,
) -> Result<Vec<u8>, ProfileRestoreFailureCode> {
    if expected_size > MAX_MANIFEST_BYTES {
        return Err(ProfileRestoreFailureCode::InvalidArchive);
    }
    let mut bytes = Vec::with_capacity(expected_size as usize);
    read_entry_to_vec(entry, expected_size, MAX_MANIFEST_BYTES, &mut bytes)?;
    if bytes.len() as u64 != expected_size {
        return Err(ProfileRestoreFailureCode::InvalidArchive);
    }
    Ok(bytes)
}

fn read_entry_to_vec<R: Read>(
    entry: &mut R,
    expected_size: u64,
    limit: u64,
    output: &mut Vec<u8>,
) -> Result<(), ProfileRestoreFailureCode> {
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = entry
            .read(&mut buffer)
            .map_err(|_| ProfileRestoreFailureCode::InvalidArchive)?;
        if read == 0 {
            return Ok(());
        }
        let next = (output.len() as u64)
            .checked_add(read as u64)
            .ok_or(ProfileRestoreFailureCode::InvalidArchive)?;
        if next > expected_size || next > limit {
            return Err(ProfileRestoreFailureCode::InvalidArchive);
        }
        output.extend_from_slice(&buffer[..read]);
    }
}

fn read_database_entry<R: Read>(
    entry: &mut R,
    expected_size: u64,
    temporary_db: &Path,
    progress: &mut impl FnMut(ProfileRestoreWorkPhase, u64, Option<u64>),
) -> Result<StreamedDatabase, ProfileRestoreFailureCode> {
    if expected_size > MAX_PROFILE_DATABASE_BYTES {
        return Err(ProfileRestoreFailureCode::InvalidArchive);
    }
    let mut output =
        create_private_file(temporary_db).map_err(|_| ProfileRestoreFailureCode::Io)?;
    let mut hasher = Sha256::new();
    let mut bytes = 0_u64;
    let mut buffer = [0_u8; 128 * 1024];
    progress(
        ProfileRestoreWorkPhase::ExtractDatabase,
        0,
        Some(expected_size),
    );
    loop {
        let read = entry
            .read(&mut buffer)
            .map_err(|_| ProfileRestoreFailureCode::InvalidArchive)?;
        if read == 0 {
            break;
        }
        let next = bytes
            .checked_add(read as u64)
            .ok_or(ProfileRestoreFailureCode::InvalidArchive)?;
        if next > expected_size || next > MAX_PROFILE_DATABASE_BYTES {
            return Err(ProfileRestoreFailureCode::InvalidArchive);
        }
        output
            .write_all(&buffer[..read])
            .map_err(|_| ProfileRestoreFailureCode::Io)?;
        hasher.update(&buffer[..read]);
        bytes = next;
        progress(
            ProfileRestoreWorkPhase::ExtractDatabase,
            bytes,
            Some(expected_size),
        );
    }
    output
        .sync_all()
        .map_err(|_| ProfileRestoreFailureCode::Io)?;
    if bytes != expected_size {
        return Err(ProfileRestoreFailureCode::InvalidArchive);
    }
    Ok(StreamedDatabase {
        sha256: sha256_hex(hasher.finalize()),
        bytes,
    })
}

fn validate_manifest_compatibility(
    manifest: &ProfileBackupManifest,
    current_app_version: &str,
) -> Result<(), ProfileRestoreFailureCode> {
    if manifest.manifest_version != 1 {
        return Err(ProfileRestoreFailureCode::UnsupportedManifestVersion);
    }
    if manifest.contents.len() != 1 || manifest.contents[0].path != DATABASE_FILE_NAME {
        return Err(ProfileRestoreFailureCode::InvalidEntries);
    }
    let current_version = parse_app_version(current_app_version)
        .ok_or(ProfileRestoreFailureCode::InvalidAppVersion)?;
    let backup_version = parse_app_version(&manifest.app_version)
        .ok_or(ProfileRestoreFailureCode::InvalidAppVersion)?;
    if current_version < backup_version {
        return Err(ProfileRestoreFailureCode::NewerAppVersion);
    }
    if manifest.db_version < 0 || manifest.db_version > VRCX0_SCHEMA_VERSION {
        return Err(ProfileRestoreFailureCode::NewerDatabaseVersion);
    }
    Ok(())
}

pub(super) fn ensure_restore_archive_copy_budget(
    archive_bytes: u64,
    available_bytes: u64,
) -> Result<(), ProfileRestoreFailureCode> {
    if archive_bytes > MAX_RESTORE_ARCHIVE_BYTES {
        return Err(ProfileRestoreFailureCode::InvalidArchive);
    }
    let required = archive_bytes
        .checked_add(RESTORE_FREE_SPACE_RESERVE_BYTES)
        .ok_or(ProfileRestoreFailureCode::InvalidArchive)?;
    if available_bytes < required {
        return Err(ProfileRestoreFailureCode::Io);
    }
    Ok(())
}

fn copy_archive_with_budget(
    source: &Path,
    destination: &Path,
    space_path: &Path,
    progress: &mut impl FnMut(ProfileRestoreWorkPhase, u64, Option<u64>),
) -> Result<(), ProfileRestoreFailureCode> {
    let path_metadata = fs::metadata(source).map_err(|_| ProfileRestoreFailureCode::Io)?;
    if !path_metadata.file_type().is_file() {
        return Err(ProfileRestoreFailureCode::InvalidArchive);
    }
    let mut input = File::open(source).map_err(|_| ProfileRestoreFailureCode::Io)?;
    let metadata = input
        .metadata()
        .map_err(|_| ProfileRestoreFailureCode::Io)?;
    if !metadata.file_type().is_file() {
        return Err(ProfileRestoreFailureCode::InvalidArchive);
    }
    let available = fs4::available_space(space_path).map_err(|_| ProfileRestoreFailureCode::Io)?;
    copy_open_archive_with_budget_and_progress(
        &mut input,
        metadata.len(),
        available,
        destination,
        |processed, total| {
            progress(ProfileRestoreWorkPhase::CopyArchive, processed, Some(total));
        },
    )
}

#[cfg(test)]
pub(super) fn copy_open_archive_with_budget(
    input: &mut File,
    initial_len: u64,
    available_bytes: u64,
    destination: &Path,
) -> Result<(), ProfileRestoreFailureCode> {
    copy_open_archive_with_budget_and_progress(
        input,
        initial_len,
        available_bytes,
        destination,
        |_, _| {},
    )
}

pub(super) fn copy_open_archive_with_budget_and_progress(
    input: &mut File,
    initial_len: u64,
    available_bytes: u64,
    destination: &Path,
    mut progress: impl FnMut(u64, u64),
) -> Result<(), ProfileRestoreFailureCode> {
    ensure_restore_archive_copy_budget(initial_len, available_bytes)?;
    let copy_limit = initial_len
        .min(MAX_RESTORE_ARCHIVE_BYTES)
        .min(available_bytes.saturating_sub(RESTORE_FREE_SPACE_RESERVE_BYTES));
    input
        .seek(SeekFrom::Start(0))
        .map_err(|_| ProfileRestoreFailureCode::Io)?;
    let mut output = create_private_file(destination).map_err(|_| ProfileRestoreFailureCode::Io)?;
    progress(0, initial_len);
    let copy_result = (|| {
        let mut copied = 0_u64;
        let mut buffer = [0_u8; 128 * 1024];
        while copied < copy_limit {
            let read_limit = usize::try_from((copy_limit - copied).min(buffer.len() as u64))
                .map_err(|_| ProfileRestoreFailureCode::InvalidArchive)?;
            let read = input
                .read(&mut buffer[..read_limit])
                .map_err(|_| ProfileRestoreFailureCode::Io)?;
            if read == 0 {
                break;
            }
            output
                .write_all(&buffer[..read])
                .map_err(|_| ProfileRestoreFailureCode::Io)?;
            copied = copied
                .checked_add(read as u64)
                .ok_or(ProfileRestoreFailureCode::InvalidArchive)?;
            progress(copied, initial_len);
        }
        if copied != initial_len {
            return Err(ProfileRestoreFailureCode::InvalidArchive);
        }
        let mut probe = [0_u8; 1];
        if input
            .read(&mut probe)
            .map_err(|_| ProfileRestoreFailureCode::Io)?
            != 0
        {
            return Err(ProfileRestoreFailureCode::InvalidArchive);
        }
        output.sync_all().map_err(|_| ProfileRestoreFailureCode::Io)
    })();
    if copy_result.is_err() {
        let _ = remove_file_if_exists(destination);
    }
    copy_result
}

pub fn read_profile_database_version(db_path: &Path) -> Result<i64, Error> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| Error::Database(error.to_string()))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|error| Error::Database(error.to_string()))?;
    let version: Option<String> = conn
        .query_row(
            "SELECT value FROM configs WHERE key = 'config:vrcx_0_databaseversion' LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| Error::Database(error.to_string()))?;
    version
        .and_then(|value| value.parse::<i64>().ok())
        .ok_or_else(|| {
            Error::InvalidData("The snapshot does not contain a profile database version.".into())
        })
}

fn validate_profile_database(
    db_path: &Path,
    manifest_db_version: i64,
) -> Result<(), ProfileRestoreFailureCode> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| ProfileRestoreFailureCode::DatabaseCheckFailed)?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|_| ProfileRestoreFailureCode::DatabaseCheckFailed)?;
    let quick_check: String = conn
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|_| ProfileRestoreFailureCode::DatabaseCheckFailed)?;
    if quick_check != "ok" {
        return Err(ProfileRestoreFailureCode::DatabaseCheckFailed);
    }
    let has_configs: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'configs')",
            [],
            |row| row.get(0),
        )
        .map_err(|_| ProfileRestoreFailureCode::NotProfileDatabase)?;
    if !has_configs {
        return Err(ProfileRestoreFailureCode::NotProfileDatabase);
    }
    let version: Option<String> = conn
        .query_row(
            "SELECT value FROM configs WHERE key = 'config:vrcx_0_databaseversion' LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| ProfileRestoreFailureCode::NotProfileDatabase)?;
    let version = version
        .and_then(|value| value.parse::<i64>().ok())
        .ok_or(ProfileRestoreFailureCode::NotProfileDatabase)?;
    if version != manifest_db_version {
        return Err(ProfileRestoreFailureCode::DatabaseVersionMismatch);
    }
    Ok(())
}
