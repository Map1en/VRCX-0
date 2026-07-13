use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::Builder as TempFileBuilder;
use vrcx_0_persistence::{DatabaseBackupProgress, DatabaseService};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::{Error, Result};

pub const PROFILE_BACKUP_EXTENSION: &str = "vrcx0backup";
pub const PROFILE_BACKUP_DIRECTORY_CONFIG_KEY: &str = "profileBackupDirectory";
const PROFILE_BACKUP_FORMAT_VERSION: u32 = 1;
pub(crate) const PROFILE_DATABASE_FILE: &str = "VRCX-0.sqlite3";
pub(crate) const PROFILE_CONFIG_FILE: &str = "VRCX-0.json";
const PROFILE_MANIFEST_FILE: &str = "manifest.json";
const COPY_BUFFER_BYTES: usize = 1024 * 1024;
const DEFLATE_COMPRESSION_LEVEL: i64 = 1;
const CANCELLED_MESSAGE: &str = "Profile backup was cancelled.";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileBackupKind {
    Manual,
    Automatic,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileBackupStage {
    DatabaseSnapshot,
    Hashing,
    Packaging,
    Validating,
    Publishing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProfileBackupControl {
    Continue,
    Cancel,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupProgress {
    pub stage: ProfileBackupStage,
    pub completed: u64,
    pub total: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupEntryManifest {
    pub file_name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupManifest {
    pub format_version: u32,
    pub created_at: String,
    pub app_version: String,
    pub backup_kind: ProfileBackupKind,
    pub database_schema_version: i64,
    pub database: ProfileBackupEntryManifest,
    pub config: ProfileBackupEntryManifest,
}

pub struct ProfileBackupRequest<'a> {
    pub database: &'a DatabaseService,
    pub config: &'a HashMap<String, String>,
    pub target_directory: &'a Path,
    pub created_at: DateTime<Utc>,
    pub app_version: &'a str,
    pub kind: ProfileBackupKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProfileBackupArtifact {
    pub path: PathBuf,
    pub manifest: ProfileBackupManifest,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProfileBackupRetentionResult {
    pub removed_count: usize,
    pub errors: Vec<String>,
}

pub fn create_profile_backup(
    request: ProfileBackupRequest<'_>,
    mut on_progress: impl FnMut(ProfileBackupProgress) -> ProfileBackupControl,
) -> Result<ProfileBackupArtifact> {
    ensure_target_directory(request.target_directory)?;
    let final_path = request
        .target_directory
        .join(backup_file_name(request.created_at));
    if final_path.exists() {
        return Err(Error::Custom(format!(
            "Backup file already exists: {}",
            final_path.display()
        )));
    }

    let database_temp = TempFileBuilder::new()
        .prefix(".VRCX-0-database-")
        .suffix(".sqlite3.tmp")
        .tempfile_in(request.target_directory)?
        .into_temp_path();
    request.database.backup_online(&database_temp, |progress| {
        database_progress_control(progress, &mut on_progress)
    })?;

    let config_bytes = serialize_config_snapshot(request.config)?;
    let database_entry = hash_file_entry(
        &database_temp,
        PROFILE_DATABASE_FILE,
        ProfileBackupStage::Hashing,
        &mut on_progress,
    )?;
    let config_entry = ProfileBackupEntryManifest {
        file_name: PROFILE_CONFIG_FILE.into(),
        size: config_bytes.len() as u64,
        sha256: sha256_bytes(&config_bytes),
    };
    let manifest = ProfileBackupManifest {
        format_version: PROFILE_BACKUP_FORMAT_VERSION,
        created_at: request
            .created_at
            .to_rfc3339_opts(SecondsFormat::Secs, true),
        app_version: request.app_version.to_string(),
        backup_kind: request.kind,
        database_schema_version: request.database.vrcx0_schema_version()?,
        database: database_entry,
        config: config_entry,
    };

    let mut archive_temp = TempFileBuilder::new()
        .prefix(".VRCX-0-backup-")
        .suffix(".vrcx0backup.tmp")
        .tempfile_in(request.target_directory)?;
    write_archive(
        archive_temp.as_file_mut(),
        &manifest,
        &database_temp,
        &config_bytes,
        &mut on_progress,
    )?;
    archive_temp.as_file().sync_all()?;

    validate_profile_backup_with_progress(archive_temp.path(), &mut on_progress)?;
    ensure_continue(
        &mut on_progress,
        ProfileBackupProgress {
            stage: ProfileBackupStage::Publishing,
            completed: 0,
            total: 1,
        },
    )?;
    match archive_temp.persist_noclobber(&final_path) {
        Ok(file) => {
            file.sync_all()?;
        }
        Err(error) => {
            let io_error = error.error;
            drop(error.file);
            return Err(Error::Io(io_error));
        }
    }
    let _ = on_progress(ProfileBackupProgress {
        stage: ProfileBackupStage::Publishing,
        completed: 1,
        total: 1,
    });

    Ok(ProfileBackupArtifact {
        path: final_path,
        manifest,
    })
}

pub fn validate_profile_backup(path: &Path) -> Result<ProfileBackupManifest> {
    validate_profile_backup_with_progress(path, &mut |_| ProfileBackupControl::Continue)
}

pub(crate) fn extract_validated_profile_backup(
    archive_path: &Path,
    database_path: &Path,
    config_path: &Path,
) -> Result<ProfileBackupManifest> {
    let file = File::open(archive_path)?;
    let mut archive = ZipArchive::new(file).map_err(zip_error)?;
    let manifest = read_manifest_from_archive(&mut archive)?;
    extract_validated_archive_entry(&mut archive, &manifest.database, database_path)?;
    extract_validated_archive_entry(&mut archive, &manifest.config, config_path)?;
    Ok(manifest)
}

pub fn prune_automatic_profile_backups(
    target_directory: &Path,
    retention_count: usize,
) -> Result<ProfileBackupRetentionResult> {
    ensure_target_directory(target_directory)?;
    let mut automatic_backups = Vec::new();
    let mut result = ProfileBackupRetentionResult::default();

    for entry in fs::read_dir(target_directory)? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                result.errors.push(error.to_string());
                continue;
            }
        };
        let path = entry.path();
        if !path.is_file() || !has_profile_backup_extension(&path) {
            continue;
        }
        let manifest = match read_profile_backup_manifest(&path) {
            Ok(manifest) if manifest.backup_kind == ProfileBackupKind::Automatic => manifest,
            Ok(_) => continue,
            Err(error) => {
                tracing::warn!(path = %path.display(), "ignoring unreadable backup during automatic retention: {error}");
                continue;
            }
        };
        let Ok(created_at) = DateTime::parse_from_rfc3339(&manifest.created_at) else {
            tracing::warn!(path = %path.display(), "ignoring backup with invalid creation time during automatic retention");
            continue;
        };
        automatic_backups.push((created_at.with_timezone(&Utc), path));
    }

    automatic_backups
        .sort_by(|left, right| right.0.cmp(&left.0).then_with(|| right.1.cmp(&left.1)));
    for (_, path) in automatic_backups.into_iter().skip(retention_count) {
        match fs::remove_file(&path) {
            Ok(()) => result.removed_count += 1,
            Err(error) => result
                .errors
                .push(format!("Failed to remove '{}': {error}", path.display())),
        }
    }

    Ok(result)
}

fn validate_profile_backup_with_progress(
    path: &Path,
    on_progress: &mut impl FnMut(ProfileBackupProgress) -> ProfileBackupControl,
) -> Result<ProfileBackupManifest> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file).map_err(zip_error)?;
    let manifest = read_manifest_from_archive(&mut archive)?;

    let total = manifest.database.size.saturating_add(manifest.config.size);
    let mut completed = 0_u64;
    validate_archive_entry(
        &mut archive,
        &manifest.database,
        total,
        &mut completed,
        on_progress,
    )?;
    validate_archive_entry(
        &mut archive,
        &manifest.config,
        total,
        &mut completed,
        on_progress,
    )?;
    Ok(manifest)
}

fn read_profile_backup_manifest(path: &Path) -> Result<ProfileBackupManifest> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file).map_err(zip_error)?;
    read_manifest_from_archive(&mut archive)
}

fn read_manifest_from_archive(archive: &mut ZipArchive<File>) -> Result<ProfileBackupManifest> {
    let expected_names = [
        PROFILE_MANIFEST_FILE,
        PROFILE_DATABASE_FILE,
        PROFILE_CONFIG_FILE,
    ];
    if archive.len() != expected_names.len() {
        return Err(Error::Custom(
            "Profile backup must contain exactly three files.".into(),
        ));
    }
    let mut names = HashSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(zip_error)?;
        if entry.is_dir()
            || !expected_names.contains(&entry.name())
            || !names.insert(entry.name().to_string())
            || entry.compression() != CompressionMethod::Deflated
        {
            return Err(Error::Custom(
                "Profile backup contains an invalid ZIP entry.".into(),
            ));
        }
    }
    if names.len() != expected_names.len() {
        return Err(Error::Custom(
            "Profile backup is missing a required file.".into(),
        ));
    }

    let manifest = {
        let mut entry = archive.by_name(PROFILE_MANIFEST_FILE).map_err(zip_error)?;
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes)?;
        serde_json::from_slice::<ProfileBackupManifest>(&bytes)?
    };
    validate_manifest_contract(&manifest)?;
    Ok(manifest)
}

fn write_archive(
    file: &mut File,
    manifest: &ProfileBackupManifest,
    database_path: &Path,
    config_bytes: &[u8],
    on_progress: &mut impl FnMut(ProfileBackupProgress) -> ProfileBackupControl,
) -> Result<()> {
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(DEFLATE_COMPRESSION_LEVEL))
        .unix_permissions(0o600);
    let manifest_bytes = serde_json::to_vec_pretty(manifest)?;
    archive
        .start_file(PROFILE_MANIFEST_FILE, options)
        .map_err(zip_error)?;
    archive.write_all(&manifest_bytes)?;

    let total = manifest.database.size.saturating_add(manifest.config.size);
    let mut completed = 0_u64;
    archive
        .start_file(PROFILE_DATABASE_FILE, options.large_file(true))
        .map_err(zip_error)?;
    let mut database = File::open(database_path)?;
    copy_with_progress(
        &mut database,
        &mut archive,
        total,
        &mut completed,
        ProfileBackupStage::Packaging,
        on_progress,
    )?;

    archive
        .start_file(PROFILE_CONFIG_FILE, options)
        .map_err(zip_error)?;
    let mut config_reader = config_bytes;
    copy_with_progress(
        &mut config_reader,
        &mut archive,
        total,
        &mut completed,
        ProfileBackupStage::Packaging,
        on_progress,
    )?;
    archive.finish().map_err(zip_error)?;
    Ok(())
}

fn validate_archive_entry(
    archive: &mut ZipArchive<File>,
    expected: &ProfileBackupEntryManifest,
    total: u64,
    completed: &mut u64,
    on_progress: &mut impl FnMut(ProfileBackupProgress) -> ProfileBackupControl,
) -> Result<()> {
    let mut entry = archive.by_name(&expected.file_name).map_err(zip_error)?;
    if entry.size() != expected.size {
        return Err(Error::Custom(format!(
            "Backup entry size does not match manifest: {}",
            expected.file_name
        )));
    }
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    loop {
        let read = entry.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        *completed = completed.saturating_add(read as u64);
        ensure_continue(
            on_progress,
            ProfileBackupProgress {
                stage: ProfileBackupStage::Validating,
                completed: *completed,
                total,
            },
        )?;
    }
    let actual_hash = hex_digest(hasher.finalize());
    if actual_hash != expected.sha256 {
        return Err(Error::Custom(format!(
            "Backup entry hash does not match manifest: {}",
            expected.file_name
        )));
    }
    Ok(())
}

fn extract_validated_archive_entry(
    archive: &mut ZipArchive<File>,
    expected: &ProfileBackupEntryManifest,
    destination: &Path,
) -> Result<()> {
    let mut entry = archive.by_name(&expected.file_name).map_err(zip_error)?;
    if entry.size() != expected.size {
        return Err(Error::Custom(format!(
            "Backup entry size does not match manifest: {}",
            expected.file_name
        )));
    }
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    let mut hasher = Sha256::new();
    let mut copied = 0_u64;
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    loop {
        let read = entry.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        output.write_all(&buffer[..read])?;
        hasher.update(&buffer[..read]);
        copied = copied.saturating_add(read as u64);
    }
    output.sync_all()?;
    if copied != expected.size || hex_digest(hasher.finalize()) != expected.sha256 {
        return Err(Error::Custom(format!(
            "Backup entry hash does not match manifest: {}",
            expected.file_name
        )));
    }
    Ok(())
}

fn hash_file_entry(
    path: &Path,
    file_name: &str,
    stage: ProfileBackupStage,
    on_progress: &mut impl FnMut(ProfileBackupProgress) -> ProfileBackupControl,
) -> Result<ProfileBackupEntryManifest> {
    let mut file = File::open(path)?;
    let total = file.metadata()?.len();
    let mut completed = 0_u64;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        completed = completed.saturating_add(read as u64);
        ensure_continue(
            on_progress,
            ProfileBackupProgress {
                stage,
                completed,
                total,
            },
        )?;
    }
    Ok(ProfileBackupEntryManifest {
        file_name: file_name.into(),
        size: total,
        sha256: hex_digest(hasher.finalize()),
    })
}

fn copy_with_progress(
    reader: &mut impl Read,
    writer: &mut impl Write,
    total: u64,
    completed: &mut u64,
    stage: ProfileBackupStage,
    on_progress: &mut impl FnMut(ProfileBackupProgress) -> ProfileBackupControl,
) -> Result<()> {
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read])?;
        *completed = completed.saturating_add(read as u64);
        ensure_continue(
            on_progress,
            ProfileBackupProgress {
                stage,
                completed: *completed,
                total,
            },
        )?;
    }
    Ok(())
}

fn database_progress_control(
    progress: DatabaseBackupProgress,
    on_progress: &mut impl FnMut(ProfileBackupProgress) -> ProfileBackupControl,
) -> bool {
    on_progress(ProfileBackupProgress {
        stage: ProfileBackupStage::DatabaseSnapshot,
        completed: u64::try_from(progress.copied_pages).unwrap_or_default(),
        total: u64::try_from(progress.total_pages).unwrap_or_default(),
    }) == ProfileBackupControl::Continue
}

fn serialize_config_snapshot(config: &HashMap<String, String>) -> Result<Vec<u8>> {
    let ordered = config
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<BTreeMap<_, _>>();
    serde_json::to_vec_pretty(&ordered).map_err(Error::from)
}

fn validate_manifest_contract(manifest: &ProfileBackupManifest) -> Result<()> {
    if manifest.format_version != PROFILE_BACKUP_FORMAT_VERSION {
        return Err(Error::Custom(format!(
            "Unsupported profile backup format version: {}",
            manifest.format_version
        )));
    }
    if manifest.database.file_name != PROFILE_DATABASE_FILE
        || manifest.config.file_name != PROFILE_CONFIG_FILE
    {
        return Err(Error::Custom(
            "Profile backup manifest contains invalid file names.".into(),
        ));
    }
    Ok(())
}

fn ensure_target_directory(path: &Path) -> Result<()> {
    if !path.is_dir() {
        return Err(Error::Custom(format!(
            "Backup directory is not available: {}",
            path.display()
        )));
    }
    Ok(())
}

fn has_profile_backup_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(PROFILE_BACKUP_EXTENSION))
}

fn ensure_continue(
    on_progress: &mut impl FnMut(ProfileBackupProgress) -> ProfileBackupControl,
    progress: ProfileBackupProgress,
) -> Result<()> {
    match on_progress(progress) {
        ProfileBackupControl::Continue => Ok(()),
        ProfileBackupControl::Cancel => Err(Error::Custom(CANCELLED_MESSAGE.into())),
    }
}

fn backup_file_name(created_at: DateTime<Utc>) -> String {
    format!(
        "VRCX-0-backup-{}.{}",
        created_at.format("%Y%m%d-%H%M%S"),
        PROFILE_BACKUP_EXTENSION
    )
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex_digest(hasher.finalize())
}

fn hex_digest(bytes: impl AsRef<[u8]>) -> String {
    bytes
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn zip_error(error: zip::result::ZipError) -> Error {
    Error::Custom(format!("ZIP error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-profile-backup-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn test_database(path: &Path) -> DatabaseService {
        let db = DatabaseService::new(path).unwrap();
        vrcx_0_persistence::config::set_string(&db, "VRCX_0_databaseVersion", "18").unwrap();
        db
    }

    fn request<'a>(
        database: &'a DatabaseService,
        config: &'a HashMap<String, String>,
        target_directory: &'a Path,
    ) -> ProfileBackupRequest<'a> {
        ProfileBackupRequest {
            database,
            config,
            target_directory,
            created_at: DateTime::parse_from_rfc3339("2026-07-13T15:30:00Z")
                .unwrap()
                .with_timezone(&Utc),
            app_version: "2.12.1",
            kind: ProfileBackupKind::Manual,
        }
    }

    fn read_test_archive(path: &Path) -> Vec<(String, Vec<u8>)> {
        let mut archive = ZipArchive::new(File::open(path).unwrap()).unwrap();
        (0..archive.len())
            .map(|index| {
                let mut entry = archive.by_index(index).unwrap();
                let name = entry.name().to_string();
                let mut bytes = Vec::new();
                entry.read_to_end(&mut bytes).unwrap();
                (name, bytes)
            })
            .collect()
    }

    fn write_test_archive(
        path: &Path,
        entries: &[(String, Vec<u8>)],
        compression: CompressionMethod,
    ) {
        let mut archive = ZipWriter::new(File::create(path).unwrap());
        let options = SimpleFileOptions::default().compression_method(compression);
        for (name, bytes) in entries {
            archive.start_file(name, options).unwrap();
            archive.write_all(bytes).unwrap();
        }
        archive.finish().unwrap();
    }

    fn replace_zip_entry_name(path: &Path, from: &str, to: &str) {
        assert_eq!(from.len(), to.len());
        let mut bytes = fs::read(path).unwrap();
        let mut replacements = 0;
        for offset in 0..=bytes.len() - from.len() {
            if &bytes[offset..offset + from.len()] == from.as_bytes() {
                bytes[offset..offset + to.len()].copy_from_slice(to.as_bytes());
                replacements += 1;
            }
        }
        assert_eq!(replacements, 2);
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn creates_valid_deflated_profile_backup_with_exact_entries() {
        let dir = TestDir::new("format");
        let backup_dir = dir.path.join("backups");
        std::fs::create_dir(&backup_dir).unwrap();
        let db = test_database(&dir.path.join(PROFILE_DATABASE_FILE));
        vrcx_0_persistence::config::set_string(&db, "example", "value").unwrap();
        let config = HashMap::from([
            ("VRCX_CloseToTray".into(), "true".into()),
            ("secret".into(), "cookie-value".into()),
        ]);

        let artifact = create_profile_backup(request(&db, &config, &backup_dir), |_| {
            ProfileBackupControl::Continue
        })
        .unwrap();

        assert_eq!(
            artifact.path.file_name().unwrap(),
            "VRCX-0-backup-20260713-153000.vrcx0backup"
        );
        assert_eq!(artifact.manifest.format_version, 1);
        assert_eq!(artifact.manifest.database_schema_version, 18);
        assert_eq!(
            validate_profile_backup(&artifact.path).unwrap(),
            artifact.manifest
        );

        let mut archive = ZipArchive::new(File::open(&artifact.path).unwrap()).unwrap();
        let mut names = Vec::new();
        for index in 0..archive.len() {
            let entry = archive.by_index(index).unwrap();
            assert_eq!(entry.compression(), CompressionMethod::Deflated);
            names.push(entry.name().to_string());
        }
        assert_eq!(
            names,
            vec![
                PROFILE_MANIFEST_FILE,
                PROFILE_DATABASE_FILE,
                PROFILE_CONFIG_FILE
            ]
        );
    }

    #[test]
    fn rejects_noncanonical_zip_entry_sets_and_compression() {
        let dir = TestDir::new("invalid-entries");
        let backup_dir = dir.path.join("backups");
        std::fs::create_dir(&backup_dir).unwrap();
        let db = test_database(&dir.path.join(PROFILE_DATABASE_FILE));
        let artifact = create_profile_backup(request(&db, &HashMap::new(), &backup_dir), |_| {
            ProfileBackupControl::Continue
        })
        .unwrap();
        let entries = read_test_archive(&artifact.path);

        let mut extra = entries.clone();
        extra.push(("extra.txt".into(), b"extra".to_vec()));
        let missing = entries
            .iter()
            .filter(|(name, _)| name != PROFILE_CONFIG_FILE)
            .cloned()
            .collect::<Vec<_>>();

        for (name, invalid_entries, compression) in [
            ("extra", extra, CompressionMethod::Deflated),
            ("missing", missing, CompressionMethod::Deflated),
            ("stored", entries.clone(), CompressionMethod::Stored),
        ] {
            let path = backup_dir.join(format!("{name}.vrcx0backup"));
            write_test_archive(&path, &invalid_entries, compression);
            assert!(validate_profile_backup(&path).is_err(), "{name}");
        }

        let placeholder_name = "original.json";
        let mut duplicate = entries;
        duplicate
            .iter_mut()
            .find(|(name, _)| name == PROFILE_CONFIG_FILE)
            .unwrap()
            .0 = placeholder_name.into();
        let duplicate_path = backup_dir.join("duplicate.vrcx0backup");
        write_test_archive(&duplicate_path, &duplicate, CompressionMethod::Deflated);
        replace_zip_entry_name(&duplicate_path, placeholder_name, PROFILE_MANIFEST_FILE);
        assert!(validate_profile_backup(&duplicate_path).is_err());
    }

    #[test]
    fn rejects_invalid_format_version_and_entry_hash() {
        let dir = TestDir::new("invalid-manifest");
        let backup_dir = dir.path.join("backups");
        std::fs::create_dir(&backup_dir).unwrap();
        let db = test_database(&dir.path.join(PROFILE_DATABASE_FILE));
        let artifact = create_profile_backup(request(&db, &HashMap::new(), &backup_dir), |_| {
            ProfileBackupControl::Continue
        })
        .unwrap();
        let entries = read_test_archive(&artifact.path);

        let mut unsupported_format = entries.clone();
        let manifest_entry = unsupported_format
            .iter_mut()
            .find(|(name, _)| name == PROFILE_MANIFEST_FILE)
            .unwrap();
        let mut manifest: ProfileBackupManifest =
            serde_json::from_slice(&manifest_entry.1).unwrap();
        manifest.format_version += 1;
        manifest_entry.1 = serde_json::to_vec(&manifest).unwrap();
        let unsupported_path = backup_dir.join("unsupported-format.vrcx0backup");
        write_test_archive(
            &unsupported_path,
            &unsupported_format,
            CompressionMethod::Deflated,
        );
        assert!(validate_profile_backup(&unsupported_path).is_err());

        let mut invalid_hash = entries;
        let config_entry = invalid_hash
            .iter_mut()
            .find(|(name, _)| name == PROFILE_CONFIG_FILE)
            .unwrap();
        config_entry.1.push(b' ');
        let invalid_hash_path = backup_dir.join("invalid-hash.vrcx0backup");
        write_test_archive(
            &invalid_hash_path,
            &invalid_hash,
            CompressionMethod::Deflated,
        );
        assert!(validate_profile_backup(&invalid_hash_path).is_err());
    }

    #[test]
    fn online_snapshot_allows_writes_through_main_database_service() {
        let dir = TestDir::new("concurrent-write");
        let db = Arc::new(test_database(&dir.path.join(PROFILE_DATABASE_FILE)));
        vrcx_0_persistence::config::set_string(
            db.as_ref(),
            "backupLargeFixture",
            &"x".repeat(6 * 1024 * 1024),
        )
        .unwrap();
        let backup_path = dir.path.join("snapshot.sqlite3");
        let writer_db = Arc::clone(&db);
        let mut wrote_during_backup = false;
        let mut snapshot_steps = 0;

        db.backup_online(&backup_path, |_| {
            snapshot_steps += 1;
            if !wrote_during_backup {
                vrcx_0_persistence::config::set_string(
                    writer_db.as_ref(),
                    "backupConcurrentWrite",
                    "completed",
                )
                .unwrap();
                wrote_during_backup = true;
            }
            true
        })
        .unwrap();

        assert!(wrote_during_backup);
        assert!(snapshot_steps > 1);
        let snapshot = rusqlite::Connection::open(&backup_path).unwrap();
        let check: String = snapshot
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(check, "ok");
    }

    #[test]
    fn cancellation_removes_all_temporary_files() {
        let dir = TestDir::new("cancel");
        let backup_dir = dir.path.join("backups");
        std::fs::create_dir(&backup_dir).unwrap();
        let db = test_database(&dir.path.join(PROFILE_DATABASE_FILE));
        let config = HashMap::new();

        let result = create_profile_backup(request(&db, &config, &backup_dir), |progress| {
            if progress.stage == ProfileBackupStage::Packaging {
                ProfileBackupControl::Cancel
            } else {
                ProfileBackupControl::Continue
            }
        });

        assert!(result.is_err());
        assert!(std::fs::read_dir(&backup_dir).unwrap().next().is_none());
    }

    #[test]
    fn existing_final_file_is_never_overwritten() {
        let dir = TestDir::new("no-clobber");
        let backup_dir = dir.path.join("backups");
        std::fs::create_dir(&backup_dir).unwrap();
        let existing = backup_dir.join("VRCX-0-backup-20260713-153000.vrcx0backup");
        std::fs::write(&existing, b"keep-me").unwrap();
        let db = test_database(&dir.path.join(PROFILE_DATABASE_FILE));
        let config = HashMap::new();

        assert!(
            create_profile_backup(request(&db, &config, &backup_dir), |_| {
                ProfileBackupControl::Continue
            })
            .is_err()
        );
        assert_eq!(std::fs::read(existing).unwrap(), b"keep-me");
    }

    #[test]
    fn automatic_retention_removes_only_the_oldest_automatic_backups() {
        let dir = TestDir::new("automatic-retention");
        let backup_dir = dir.path.join("backups");
        std::fs::create_dir(&backup_dir).unwrap();
        let db = test_database(&dir.path.join(PROFILE_DATABASE_FILE));
        let config = HashMap::new();
        let created_at = [
            "2026-07-10T15:30:00Z",
            "2026-07-11T15:30:00Z",
            "2026-07-12T15:30:00Z",
        ];
        let mut automatic_paths = Vec::new();
        for created_at in created_at {
            let mut backup_request = request(&db, &config, &backup_dir);
            backup_request.created_at = DateTime::parse_from_rfc3339(created_at)
                .unwrap()
                .with_timezone(&Utc);
            backup_request.kind = ProfileBackupKind::Automatic;
            automatic_paths.push(
                create_profile_backup(backup_request, |_| ProfileBackupControl::Continue)
                    .unwrap()
                    .path,
            );
        }

        let mut manual_request = request(&db, &config, &backup_dir);
        manual_request.created_at = DateTime::parse_from_rfc3339("2026-07-09T15:30:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let manual_path = create_profile_backup(manual_request, |_| ProfileBackupControl::Continue)
            .unwrap()
            .path;
        let unreadable_path = backup_dir.join("unreadable.vrcx0backup");
        std::fs::write(&unreadable_path, b"not-a-backup").unwrap();

        let retention = prune_automatic_profile_backups(&backup_dir, 2).unwrap();

        assert_eq!(retention.removed_count, 1);
        assert!(retention.errors.is_empty());
        assert!(!automatic_paths[0].exists());
        assert!(automatic_paths[1].exists());
        assert!(automatic_paths[2].exists());
        assert!(manual_path.exists());
        assert!(unreadable_path.exists());
    }
}
