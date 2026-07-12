use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use age::secrecy::SecretString;
use age::{Decryptor, Encryptor, Identity};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use vrcx_0_persistence::{verify_database_file, DatabaseService};
use vrcx_0_persistence::{LEGACY_SCHEMA_VERSION, VRCX0_SCHEMA_VERSION};

use crate::{Error, Result};

pub const CLOUD_BACKUP_DEFAULT_DIRECTORY: &str = "VRCX-0";
pub const CLOUD_BACKUP_FILE_NAME: &str = "latest.vrcx0backup";
pub const CLOUD_BACKUP_PROGRESS_EVENT: &str = "cloudBackupProgress";

const FORMAT_VERSION: u32 = 1;
const MANIFEST_FILE: &str = "manifest.json";
const DATABASE_FILE: &str = "VRCX-0.sqlite3";
const CONFIG_FILE: &str = "VRCX-0.json";
const RESTORE_ROOT: &str = "cloud-restore";
const STAGING_DIR: &str = "staging";
const ROLLBACK_DIR: &str = "rollback";
const PENDING_FILE: &str = "pending.json";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_CONFIG_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DATABASE_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MAX_TAR_TRAILING_ZERO_BYTES: usize = 1024 * 1024;
pub const MAX_BACKUP_ARCHIVE_BYTES: u64 = 20 * 1024 * 1024 * 1024;
const DISK_SAFETY_MARGIN_BYTES: u64 = 256 * 1024 * 1024;
const ZSTD_LEVEL: i32 = 3;
const AGE_HEADER: &[u8] = b"age-encryption.org/v1";
const ZSTD_MAGIC: &[u8] = &[0x28, 0xb5, 0x2f, 0xfd];

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSchemaInfo {
    pub current_version: i64,
    pub legacy_version: i64,
}

impl Default for DatabaseSchemaInfo {
    fn default() -> Self {
        Self {
            current_version: VRCX0_SCHEMA_VERSION,
            legacy_version: LEGACY_SCHEMA_VERSION,
        }
    }
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", tag = "action")]
pub enum CloudBackupPasswordUpdate {
    Keep,
    Set { password: String },
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CloudBackupSettingsInput {
    pub server_url: String,
    pub remote_directory: String,
    pub username: String,
    pub password_update: CloudBackupPasswordUpdate,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CredentialState {
    pub available: bool,
    pub stored: bool,
    pub session_only: bool,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CloudBackupSettings {
    pub server_url: String,
    pub remote_directory: String,
    pub username: String,
    pub credential: CredentialState,
    pub pending_restore_phase: Option<String>,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CloudBackupUploadInput {
    pub backup_passphrase: Option<String>,
    pub confirm_unencrypted: bool,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CloudBackupRestorePrepareInput {
    pub backup_passphrase: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBackupStatus {
    pub exists: bool,
    pub content_length: Option<u64>,
    pub last_modified: Option<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub created_at: String,
    pub app_version: String,
    pub database_schema_version: i64,
    pub encrypted: bool,
    pub archive_size: u64,
    pub database_size: u64,
    pub config_size: u64,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CloudBackupRestoreProbe {
    pub encrypted: bool,
    pub remote: RemoteBackupStatus,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    pub restore_id: String,
    pub created_at: String,
    pub app_version: String,
    pub database_schema_version: i64,
    pub encrypted: bool,
    pub archive_size: u64,
    pub database_size: u64,
    pub config_size: u64,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CloudBackupProgress {
    pub phase: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupFileRecord {
    name: String,
    size: u64,
    sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupFiles {
    database: BackupFileRecord,
    config: BackupFileRecord,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    format_version: u32,
    created_at: String,
    app_version: String,
    database_schema_version: i64,
    files: BackupFiles,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum PendingRestorePhase {
    Staged,
    Applying,
    Applied,
    RollbackPending,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingRestore {
    format_version: u32,
    restore_id: String,
    phase: PendingRestorePhase,
    staged_database_sha256: String,
    staged_config_sha256: String,
    rollback_database_sha256: String,
    rollback_config_sha256: String,
}

#[derive(Debug)]
pub struct CreatedBackupArchive {
    pub path: PathBuf,
    pub summary: BackupSummary,
}

fn invalid(code: &str, detail: impl AsRef<str>) -> Error {
    Error::Custom(format!("cloud_backup.{code}: {}", detail.as_ref()))
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

pub fn ensure_cloud_backup_disk_space(path: &Path, required_bytes: u64) -> Result<()> {
    let available = fs2::available_space(path)?;
    let required = required_bytes.saturating_add(DISK_SAFETY_MARGIN_BYTES);
    if available < required {
        return Err(invalid(
            "insufficient_disk_space",
            format!(
                "At least {required} bytes are required, but only {available} bytes are available."
            ),
        ));
    }
    Ok(())
}

fn estimated_live_database_size(db: &DatabaseService) -> u64 {
    let database_size = fs::metadata(db.db_path())
        .map(|value| value.len())
        .unwrap_or(0);
    let wal_path = PathBuf::from(format!("{}-wal", db.db_path().to_string_lossy()));
    database_size.saturating_add(fs::metadata(wal_path).map(|value| value.len()).unwrap_or(0))
}

fn file_record(name: &str, path: &Path) -> Result<BackupFileRecord> {
    Ok(BackupFileRecord {
        name: name.into(),
        size: fs::metadata(path)?.len(),
        sha256: sha256_file(path)?,
    })
}

pub fn create_backup_archive(
    db: &DatabaseService,
    config_json: &str,
    app_version: &str,
    workspace: &Path,
    passphrase: Option<&str>,
) -> Result<CreatedBackupArchive> {
    create_backup_archive_with_progress(db, config_json, app_version, workspace, passphrase, |_| {})
}

pub fn create_backup_archive_with_progress<F>(
    db: &DatabaseService,
    config_json: &str,
    app_version: &str,
    workspace: &Path,
    passphrase: Option<&str>,
    on_phase: F,
) -> Result<CreatedBackupArchive>
where
    F: Fn(&str),
{
    fs::create_dir_all(workspace)?;
    if config_json.len() as u64 > MAX_CONFIG_BYTES {
        return Err(invalid(
            "archive_too_large",
            "The profile config exceeds its backup size limit.",
        ));
    }
    let estimated_source_size =
        estimated_live_database_size(db).saturating_add(config_json.len() as u64);
    ensure_cloud_backup_disk_space(workspace, estimated_source_size.saturating_mul(3))?;
    let database_path = workspace.join(DATABASE_FILE);
    let config_path = workspace.join(CONFIG_FILE);
    let manifest_path = workspace.join(MANIFEST_FILE);
    let compressed_path = workspace.join("backup.tar.zst");
    let output_path = workspace.join(CLOUD_BACKUP_FILE_NAME);

    on_phase("snapshot");
    db.backup_to(&database_path)?;
    let schema_version = verify_database_file(&database_path)?;
    if schema_version > VRCX0_SCHEMA_VERSION {
        return Err(invalid(
            "newer_schema",
            "The database schema is newer than this application supports.",
        ));
    }

    on_phase("package");
    let _: HashMap<String, String> = serde_json::from_str(config_json)
        .map_err(|error| invalid("invalid_config", error.to_string()))?;
    write_synced(&config_path, config_json.as_bytes())?;

    let database = file_record(DATABASE_FILE, &database_path)?;
    let config = file_record(CONFIG_FILE, &config_path)?;
    if database.size > MAX_DATABASE_BYTES || config.size > MAX_CONFIG_BYTES {
        return Err(invalid(
            "archive_too_large",
            "A profile file exceeds its backup size limit.",
        ));
    }
    let manifest = BackupManifest {
        format_version: FORMAT_VERSION,
        created_at: Utc::now().to_rfc3339(),
        app_version: app_version.trim().to_string(),
        database_schema_version: schema_version,
        files: BackupFiles { database, config },
    };
    write_synced(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest)?.as_slice(),
    )?;

    on_phase("compress");
    let compressed_file = BufWriter::new(File::create(&compressed_path)?);
    let encoder = zstd::Encoder::new(compressed_file, ZSTD_LEVEL)
        .map_err(|error| invalid("archive_failed", error.to_string()))?;
    let mut archive = tar::Builder::new(encoder);
    archive.append_path_with_name(&manifest_path, MANIFEST_FILE)?;
    archive.append_path_with_name(&database_path, DATABASE_FILE)?;
    archive.append_path_with_name(&config_path, CONFIG_FILE)?;
    let encoder = archive.into_inner()?;
    let mut compressed_file = encoder
        .finish()
        .map_err(|error| invalid("archive_failed", error.to_string()))?;
    compressed_file.flush()?;
    compressed_file.get_ref().sync_all()?;

    let encrypted = passphrase.is_some();
    if let Some(passphrase) = passphrase {
        on_phase("encrypt");
        if passphrase.is_empty() {
            return Err(invalid("empty_passphrase", "Backup passphrase is empty."));
        }
        let encryptor = Encryptor::with_user_passphrase(SecretString::from(passphrase.to_owned()));
        let output = BufWriter::new(File::create(&output_path)?);
        let mut encrypted_writer = encryptor
            .wrap_output(output)
            .map_err(|error| invalid("encryption_failed", error.to_string()))?;
        let mut compressed = BufReader::new(File::open(&compressed_path)?);
        std::io::copy(&mut compressed, &mut encrypted_writer)?;
        let mut output = encrypted_writer
            .finish()
            .map_err(|error| invalid("encryption_failed", error.to_string()))?;
        output.flush()?;
        output.get_ref().sync_all()?;
    } else {
        fs::copy(&compressed_path, &output_path)?;
    }

    let archive_size = fs::metadata(&output_path)?.len();
    if archive_size > MAX_BACKUP_ARCHIVE_BYTES {
        return Err(invalid(
            "archive_too_large",
            "The completed backup exceeds its archive size limit.",
        ));
    }
    Ok(CreatedBackupArchive {
        path: output_path,
        summary: BackupSummary {
            created_at: manifest.created_at,
            app_version: manifest.app_version,
            database_schema_version: manifest.database_schema_version,
            encrypted,
            archive_size,
            database_size: manifest.files.database.size,
            config_size: manifest.files.config.size,
        },
    })
}

pub fn detect_backup_encryption(prefix: &[u8]) -> Result<bool> {
    if prefix.starts_with(AGE_HEADER) {
        return Ok(true);
    }
    if prefix.starts_with(ZSTD_MAGIC) {
        return Ok(false);
    }
    Err(invalid(
        "invalid_archive",
        "Remote file is neither an age-encrypted nor a plain VRCX-0 backup.",
    ))
}

fn restore_root(app_data: &Path) -> PathBuf {
    app_data.join(RESTORE_ROOT)
}

fn staging_path(app_data: &Path, restore_id: &str) -> Result<PathBuf> {
    let parsed = Uuid::parse_str(restore_id)
        .map_err(|_| invalid("invalid_restore_id", "Restore identifier is invalid."))?;
    Ok(restore_root(app_data)
        .join(STAGING_DIR)
        .join(parsed.hyphenated().to_string()))
}

fn pending_path(app_data: &Path) -> PathBuf {
    restore_root(app_data).join(PENDING_FILE)
}

fn decrypt_archive(source: &Path, destination: &Path, passphrase: &str) -> Result<()> {
    let input = BufReader::new(File::open(source)?);
    let decryptor = Decryptor::new_buffered(input)
        .map_err(|error| invalid("invalid_archive", error.to_string()))?;
    if !decryptor.is_scrypt() {
        return Err(invalid(
            "unsupported_encryption",
            "The age file is not encrypted with a user passphrase.",
        ));
    }
    let identity = age::scrypt::Identity::new(SecretString::from(passphrase.to_owned()));
    let identities: [&dyn Identity; 1] = [&identity];
    let mut reader = decryptor
        .decrypt(identities.into_iter())
        .map_err(|_| invalid("wrong_passphrase", "Unable to decrypt the backup."))?;
    let mut output = BufWriter::new(File::create(destination)?);
    std::io::copy(&mut reader, &mut output)
        .map_err(|_| invalid("wrong_passphrase", "Unable to decrypt the backup."))?;
    output.flush()?;
    output.get_ref().sync_all()?;
    Ok(())
}

fn extract_entry<R: Read>(entry: &mut tar::Entry<'_, R>, path: &Path, limit: u64) -> Result<()> {
    if entry.size() > limit {
        return Err(invalid(
            "archive_too_large",
            "A backup entry exceeds its size limit.",
        ));
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    ensure_cloud_backup_disk_space(parent, entry.size())?;
    let mut output = BufWriter::new(File::create(path)?);
    let copied = std::io::copy(entry, &mut output)?;
    if copied != entry.size() || copied > limit {
        return Err(invalid(
            "invalid_archive",
            "A backup entry has an invalid size.",
        ));
    }
    output.flush()?;
    output.get_ref().sync_all()?;
    Ok(())
}

fn unpack_archive(compressed: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)?;
    let decoder = zstd::Decoder::new(BufReader::new(File::open(compressed)?))
        .map_err(|error| invalid("invalid_archive", error.to_string()))?;
    let mut archive = tar::Archive::new(decoder);
    let mut seen = HashSet::new();

    let entries = archive
        .entries()
        .map_err(|error| invalid("invalid_archive", error.to_string()))?;
    for entry in entries {
        let mut entry = entry.map_err(|error| invalid("invalid_archive", error.to_string()))?;
        if !entry.header().entry_type().is_file() {
            return Err(invalid(
                "invalid_archive",
                "Backup entries must be regular files.",
            ));
        }
        let path = entry
            .path()
            .map_err(|error| invalid("invalid_archive", error.to_string()))?
            .into_owned();
        let Some(name) = path.to_str() else {
            return Err(invalid(
                "invalid_archive",
                "Backup entry path is not valid UTF-8.",
            ));
        };
        if path.components().count() != 1 || !seen.insert(name.to_string()) {
            return Err(invalid(
                "invalid_archive",
                "Backup contains an unsafe or duplicate path.",
            ));
        }
        match name {
            MANIFEST_FILE => {
                extract_entry(&mut entry, &destination.join(name), MAX_MANIFEST_BYTES)?
            }
            DATABASE_FILE => {
                extract_entry(&mut entry, &destination.join(name), MAX_DATABASE_BYTES)?
            }
            CONFIG_FILE => extract_entry(&mut entry, &destination.join(name), MAX_CONFIG_BYTES)?,
            _ => {
                return Err(invalid(
                    "invalid_archive",
                    "Backup contains an unexpected file.",
                ))
            }
        }
    }

    let mut decoder = archive.into_inner();
    let mut trailing = [0_u8; 8192];
    let mut trailing_size = 0_usize;
    loop {
        let count = decoder
            .read(&mut trailing)
            .map_err(|error| invalid("invalid_archive", error.to_string()))?;
        if count == 0 {
            break;
        }
        trailing_size = trailing_size.saturating_add(count);
        if trailing_size > MAX_TAR_TRAILING_ZERO_BYTES
            || trailing[..count].iter().any(|byte| *byte != 0)
        {
            return Err(invalid(
                "invalid_archive",
                "Backup contains data after the tar end marker.",
            ));
        }
    }

    if seen.len() != 3
        || !seen.contains(MANIFEST_FILE)
        || !seen.contains(DATABASE_FILE)
        || !seen.contains(CONFIG_FILE)
    {
        return Err(invalid(
            "invalid_archive",
            "Backup is missing required files.",
        ));
    }
    Ok(())
}

fn read_manifest(directory: &Path) -> Result<BackupManifest> {
    let bytes = fs::read(directory.join(MANIFEST_FILE))?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(invalid(
            "archive_too_large",
            "Backup manifest is too large.",
        ));
    }
    serde_json::from_slice(&bytes).map_err(|error| invalid("invalid_archive", error.to_string()))
}

fn validate_staged_directory(directory: &Path) -> Result<BackupManifest> {
    let manifest = read_manifest(directory)?;
    if manifest.format_version != FORMAT_VERSION {
        return Err(invalid(
            "unsupported_format",
            format!(
                "Unsupported backup format version {}.",
                manifest.format_version
            ),
        ));
    }
    if manifest.files.database.name != DATABASE_FILE || manifest.files.config.name != CONFIG_FILE {
        return Err(invalid(
            "invalid_archive",
            "Backup manifest file names are invalid.",
        ));
    }
    if manifest.database_schema_version > VRCX0_SCHEMA_VERSION {
        return Err(invalid(
            "newer_schema",
            format!(
                "Backup schema {} is newer than supported schema {}.",
                manifest.database_schema_version, VRCX0_SCHEMA_VERSION
            ),
        ));
    }

    let database_path = directory.join(DATABASE_FILE);
    let config_path = directory.join(CONFIG_FILE);
    let database_record = file_record(DATABASE_FILE, &database_path)?;
    let config_record = file_record(CONFIG_FILE, &config_path)?;
    if database_record.size != manifest.files.database.size
        || database_record.sha256 != manifest.files.database.sha256
        || config_record.size != manifest.files.config.size
        || config_record.sha256 != manifest.files.config.sha256
    {
        return Err(invalid(
            "checksum_mismatch",
            "Backup file checksum validation failed.",
        ));
    }

    let schema_version = verify_database_file(&database_path)
        .map_err(|error| invalid("invalid_database", error.to_string()))?;
    if schema_version != manifest.database_schema_version {
        return Err(invalid(
            "schema_mismatch",
            "Database schema does not match the backup manifest.",
        ));
    }
    let _: HashMap<String, String> = serde_json::from_slice(&fs::read(config_path)?)
        .map_err(|error| invalid("invalid_config", error.to_string()))?;
    Ok(manifest)
}

pub fn prepare_restore_archive(
    archive_path: &Path,
    app_data: &Path,
    passphrase: Option<&str>,
) -> Result<RestorePreview> {
    if read_pending(app_data)?.is_some() {
        return Err(invalid(
            "restore_pending",
            "A restore is already pending finalization or rollback.",
        ));
    }
    let archive_size = fs::metadata(archive_path)?.len();
    if archive_size > MAX_BACKUP_ARCHIVE_BYTES {
        return Err(invalid(
            "archive_too_large",
            "The backup archive exceeds its size limit.",
        ));
    }
    let mut prefix = [0_u8; 32];
    let prefix_len = File::open(archive_path)?.read(&mut prefix)?;
    let encrypted = detect_backup_encryption(&prefix[..prefix_len])?;
    if encrypted && passphrase.filter(|value| !value.is_empty()).is_none() {
        return Err(invalid(
            "passphrase_required",
            "This backup requires a passphrase.",
        ));
    }

    let restore_id = Uuid::new_v4().hyphenated().to_string();
    let staging_root = restore_root(app_data).join(STAGING_DIR);
    if staging_root.exists() {
        fs::remove_dir_all(&staging_root)?;
    }
    let directory = staging_path(app_data, &restore_id)?;
    if directory.exists() {
        fs::remove_dir_all(&directory)?;
    }
    fs::create_dir_all(&directory)?;
    ensure_cloud_backup_disk_space(&directory, archive_size)?;
    let compressed = directory.join("payload.tar.zst");
    let result = (|| {
        if encrypted {
            decrypt_archive(archive_path, &compressed, passphrase.unwrap_or_default())?;
        } else {
            fs::copy(archive_path, &compressed)?;
        }
        unpack_archive(&compressed, &directory)?;
        let manifest = validate_staged_directory(&directory)?;
        let _ = fs::remove_file(&compressed);
        Ok(RestorePreview {
            restore_id: restore_id.clone(),
            created_at: manifest.created_at,
            app_version: manifest.app_version,
            database_schema_version: manifest.database_schema_version,
            encrypted,
            archive_size,
            database_size: manifest.files.database.size,
            config_size: manifest.files.config.size,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&directory);
    }
    result
}

fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    write_synced(&temporary, serde_json::to_vec_pretty(value)?.as_slice())?;
    atomic_replace_file(&temporary, path)?;
    Ok(())
}

#[cfg(not(windows))]
fn sync_directory(path: &Path) -> Result<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(windows)]
fn sync_directory(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(not(windows))]
fn atomic_replace_file(source: &Path, destination: &Path) -> Result<()> {
    fs::rename(source, destination)?;
    if let Some(parent) = destination.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(windows)]
fn atomic_replace_file(source: &Path, destination: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

fn read_pending(app_data: &Path) -> Result<Option<PendingRestore>> {
    let path = pending_path(app_data);
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_slice(&fs::read(path)?)?))
}

pub fn pending_restore_phase(app_data: &Path) -> Result<Option<String>> {
    Ok(read_pending(app_data)?.map(|pending| {
        match pending.phase {
            PendingRestorePhase::Staged => "staged",
            PendingRestorePhase::Applying => "applying",
            PendingRestorePhase::Applied => "applied",
            PendingRestorePhase::RollbackPending => "rollbackPending",
        }
        .to_string()
    }))
}

pub fn discard_prepared_cloud_restore(app_data: &Path, restore_id: &str) -> Result<bool> {
    if read_pending(app_data)?.is_some() {
        return Ok(false);
    }
    let staged = staging_path(app_data, restore_id)?;
    if !staged.exists() {
        return Ok(false);
    }
    fs::remove_dir_all(staged)?;
    Ok(true)
}

pub fn commit_prepared_restore(
    db: &DatabaseService,
    config_json: &str,
    app_data: &Path,
    restore_id: &str,
) -> Result<()> {
    if read_pending(app_data)?.is_some() {
        return Err(invalid(
            "restore_pending",
            "A restore is already pending finalization or rollback.",
        ));
    }
    let staged = staging_path(app_data, restore_id)?;
    let _ = validate_staged_directory(&staged)?;
    let root = restore_root(app_data);
    let rollback = root.join(ROLLBACK_DIR);
    if rollback.exists() {
        fs::remove_dir_all(&rollback)?;
    }
    fs::create_dir_all(&rollback)?;
    let live_database_size = estimated_live_database_size(db);
    let live_config_size = config_json.len() as u64;
    let staged_database_size = fs::metadata(staged.join(DATABASE_FILE))?.len();
    let staged_config_size = fs::metadata(staged.join(CONFIG_FILE))?.len();
    let rollback_size = live_database_size.saturating_add(live_config_size);
    let replacement_size = live_database_size
        .max(staged_database_size)
        .saturating_add(live_config_size.max(staged_config_size));
    ensure_cloud_backup_disk_space(&rollback, rollback_size.saturating_add(replacement_size))?;
    let rollback_database = rollback.join(DATABASE_FILE);
    let rollback_config = rollback.join(CONFIG_FILE);
    db.backup_to(&rollback_database)?;
    write_synced(&rollback_config, config_json.as_bytes())?;
    sync_directory(&staged)?;
    sync_directory(&rollback)?;

    let pending = PendingRestore {
        format_version: FORMAT_VERSION,
        restore_id: restore_id.into(),
        phase: PendingRestorePhase::Staged,
        staged_database_sha256: sha256_file(&staged.join(DATABASE_FILE))?,
        staged_config_sha256: sha256_file(&staged.join(CONFIG_FILE))?,
        rollback_database_sha256: sha256_file(&rollback_database)?,
        rollback_config_sha256: sha256_file(&rollback_config)?,
    };
    atomic_write_json(&pending_path(app_data), &pending)
}

fn remove_sqlite_sidecars(database: &Path) -> Result<()> {
    for suffix in ["wal", "shm"] {
        let sidecar = PathBuf::from(format!("{}-{suffix}", database.to_string_lossy()));
        if sidecar.exists() {
            fs::remove_file(sidecar)?;
        }
    }
    Ok(())
}

fn replace_from(source: &Path, destination: &Path) -> Result<()> {
    let temporary = PathBuf::from(format!(
        "{}.cloud-restore-new",
        destination.to_string_lossy()
    ));
    if temporary.exists() {
        fs::remove_file(&temporary)?;
    }
    fs::copy(source, &temporary)?;
    File::options().write(true).open(&temporary)?.sync_all()?;
    atomic_replace_file(&temporary, destination)
}

fn rollback_files(app_data: &Path, pending: &PendingRestore) -> Result<()> {
    let rollback = restore_root(app_data).join(ROLLBACK_DIR);
    let database = rollback.join(DATABASE_FILE);
    let config = rollback.join(CONFIG_FILE);
    if sha256_file(&database)? != pending.rollback_database_sha256
        || sha256_file(&config)? != pending.rollback_config_sha256
    {
        return Err(invalid(
            "rollback_corrupt",
            "Local restore rollback files are corrupt.",
        ));
    }
    let live_database = app_data.join("VRCX-0.sqlite3");
    remove_sqlite_sidecars(&live_database)
        .map_err(|error| invalid("rollback_failed", format!("remove sidecars: {error}")))?;
    replace_from(&database, &live_database)
        .map_err(|error| invalid("rollback_failed", format!("replace database: {error}")))?;
    replace_from(&config, &app_data.join("VRCX-0.json"))
        .map_err(|error| invalid("rollback_failed", format!("replace config: {error}")))?;
    let _ = verify_database_file(&live_database)
        .map_err(|error| invalid("rollback_failed", format!("verify database: {error}")))?;
    let upgrade_dir = app_data.join("db-upgrade");
    if upgrade_dir.exists() {
        fs::remove_dir_all(upgrade_dir)?;
    }
    Ok(())
}

pub fn apply_pending_cloud_restore(app_data: &Path) -> Result<bool> {
    let Some(mut pending) = read_pending(app_data)? else {
        let root = restore_root(app_data);
        if root.exists() {
            fs::remove_dir_all(root)?;
        }
        return Ok(false);
    };
    let legacy_migration_flag = app_data.join("pending_vrcx_migration");
    if legacy_migration_flag.exists() {
        fs::remove_file(legacy_migration_flag)?;
    }
    if pending.format_version != FORMAT_VERSION {
        return Err(invalid(
            "unsupported_format",
            "Pending restore format is unsupported.",
        ));
    }
    if pending.phase == PendingRestorePhase::Applied {
        return Ok(false);
    }
    if pending.phase == PendingRestorePhase::RollbackPending {
        rollback_files(app_data, &pending)?;
        fs::remove_dir_all(restore_root(app_data))?;
        return Ok(true);
    }

    let staged = staging_path(app_data, &pending.restore_id)?;
    let apply_result = (|| {
        let _ = validate_staged_directory(&staged)?;
        if sha256_file(&staged.join(DATABASE_FILE))? != pending.staged_database_sha256
            || sha256_file(&staged.join(CONFIG_FILE))? != pending.staged_config_sha256
        {
            return Err(invalid(
                "checksum_mismatch",
                "Staged restore files changed.",
            ));
        }
        pending.phase = PendingRestorePhase::Applying;
        atomic_write_json(&pending_path(app_data), &pending).map_err(|error| {
            invalid(
                "restore_apply_failed",
                format!("write applying marker: {error}"),
            )
        })?;

        let live_database = app_data.join("VRCX-0.sqlite3");
        remove_sqlite_sidecars(&live_database).map_err(|error| {
            invalid("restore_apply_failed", format!("remove sidecars: {error}"))
        })?;
        replace_from(&staged.join(DATABASE_FILE), &live_database).map_err(|error| {
            invalid("restore_apply_failed", format!("replace database: {error}"))
        })?;
        replace_from(&staged.join(CONFIG_FILE), &app_data.join("VRCX-0.json"))
            .map_err(|error| invalid("restore_apply_failed", format!("replace config: {error}")))?;
        let _ = verify_database_file(&live_database).map_err(|error| {
            invalid("restore_apply_failed", format!("verify database: {error}"))
        })?;
        let _: HashMap<String, String> =
            serde_json::from_slice(&fs::read(app_data.join("VRCX-0.json"))?)
                .map_err(|error| invalid("invalid_config", error.to_string()))?;
        let upgrade_dir = app_data.join("db-upgrade");
        if upgrade_dir.exists() {
            fs::remove_dir_all(upgrade_dir)?;
        }
        pending.phase = PendingRestorePhase::Applied;
        atomic_write_json(&pending_path(app_data), &pending).map_err(|error| {
            invalid(
                "restore_apply_failed",
                format!("write applied marker: {error}"),
            )
        })?;
        Ok(())
    })();

    if let Err(error) = apply_result {
        if let Err(rollback_error) = rollback_files(app_data, &pending) {
            return Err(invalid(
                "rollback_failed",
                format!("restore error: {error}; rollback error: {rollback_error}"),
            ));
        }
        fs::remove_dir_all(restore_root(app_data))?;
        tracing::error!(error = %error, "cloud restore failed and the original profile was restored");
        return Ok(false);
    }
    Ok(true)
}

pub fn finalize_pending_cloud_restore(app_data: &Path) -> Result<bool> {
    let Some(pending) = read_pending(app_data)? else {
        return Ok(false);
    };
    if pending.phase != PendingRestorePhase::Applied {
        return Ok(false);
    }
    fs::remove_dir_all(restore_root(app_data))?;
    Ok(true)
}

pub fn request_pending_cloud_restore_rollback(app_data: &Path) -> Result<bool> {
    let Some(mut pending) = read_pending(app_data)? else {
        return Ok(false);
    };
    if pending.phase != PendingRestorePhase::Applied {
        return Ok(false);
    }
    pending.phase = PendingRestorePhase::RollbackPending;
    atomic_write_json(&pending_path(app_data), &pending)?;
    Ok(true)
}

pub fn rollback_pending_cloud_restore(app_data: &Path) -> Result<bool> {
    let Some(pending) = read_pending(app_data)? else {
        return Ok(false);
    };
    if pending.phase != PendingRestorePhase::Staged {
        rollback_files(app_data, &pending)?;
    }
    fs::remove_dir_all(restore_root(app_data))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use vrcx_0_persistence::config;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-cloud-{name}-{}-{}",
                std::process::id(),
                Uuid::new_v4()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn database(path: &Path) -> DatabaseService {
        let db = DatabaseService::new(path).unwrap();
        config::set_string(
            &db,
            "VRCX_0_databaseVersion",
            &VRCX0_SCHEMA_VERSION.to_string(),
        )
        .unwrap();
        db
    }

    fn write_test_archive(path: &Path, headers: Vec<tar::Header>) {
        let output = BufWriter::new(File::create(path).unwrap());
        let encoder = zstd::Encoder::new(output, ZSTD_LEVEL).unwrap();
        let mut archive = tar::Builder::new(encoder);
        for header in headers {
            archive.append(&header, std::io::empty()).unwrap();
        }
        let encoder = archive.into_inner().unwrap();
        encoder.finish().unwrap();
    }

    fn empty_regular_header(path: &str) -> tar::Header {
        let mut header = tar::Header::new_gnu();
        header.set_path(path).unwrap();
        header.set_mode(0o600);
        header.set_size(0);
        header.set_cksum();
        header
    }

    #[test]
    fn plain_and_encrypted_archives_round_trip() {
        for passphrase in [None, Some("correct horse battery staple")] {
            let dir = TestDir::new(if passphrase.is_some() {
                "encrypted"
            } else {
                "plain"
            });
            let db = database(&dir.0.join("VRCX-0.sqlite3"));
            let workspace = dir.0.join("workspace");
            let created =
                create_backup_archive(&db, r#"{"theme":"dark"}"#, "test", &workspace, passphrase)
                    .unwrap();
            let preview = prepare_restore_archive(&created.path, &dir.0, passphrase).unwrap();
            assert_eq!(preview.encrypted, passphrase.is_some());
            assert_eq!(preview.database_schema_version, VRCX0_SCHEMA_VERSION);
        }
    }

    #[test]
    fn wrong_passphrase_does_not_leave_staging_data() {
        let dir = TestDir::new("wrong-password");
        let db = database(&dir.0.join("VRCX-0.sqlite3"));
        let created =
            create_backup_archive(&db, "{}", "test", &dir.0.join("workspace"), Some("right"))
                .unwrap();
        let error = prepare_restore_archive(&created.path, &dir.0, Some("wrong")).unwrap_err();
        assert!(error.to_string().contains("wrong_passphrase"));
    }

    #[test]
    fn rejects_tampered_and_unexpected_archive_content() {
        let dir = TestDir::new("tampered");
        let db = database(&dir.0.join("VRCX-0.sqlite3"));
        let created =
            create_backup_archive(&db, "{}", "test", &dir.0.join("workspace"), None).unwrap();
        let mut bytes = fs::read(&created.path).unwrap();
        let midpoint = bytes.len() / 2;
        bytes[midpoint] ^= 0x5a;
        let tampered = dir.0.join("tampered.vrcx0backup");
        fs::write(&tampered, bytes).unwrap();
        assert!(prepare_restore_archive(&tampered, &dir.0, None).is_err());

        let unexpected = dir.0.join("unexpected.vrcx0backup");
        let output = BufWriter::new(File::create(&unexpected).unwrap());
        let encoder = zstd::Encoder::new(output, ZSTD_LEVEL).unwrap();
        let mut archive = tar::Builder::new(encoder);
        let payload = b"unexpected";
        let mut header = tar::Header::new_gnu();
        header.set_mode(0o600);
        header.set_size(payload.len() as u64);
        header.set_cksum();
        archive
            .append_data(&mut header, "extra.txt", &payload[..])
            .unwrap();
        let encoder = archive.into_inner().unwrap();
        encoder.finish().unwrap();
        let error = prepare_restore_archive(&unexpected, &dir.0, None).unwrap_err();
        assert!(error.to_string().contains("invalid_archive"));
    }

    #[test]
    fn strict_unpack_rejects_links_traversal_and_duplicate_paths() {
        let dir = TestDir::new("strict-unpack");

        let mut link = tar::Header::new_gnu();
        link.set_path(MANIFEST_FILE).unwrap();
        link.set_entry_type(tar::EntryType::Symlink);
        link.set_link_name("outside").unwrap();
        link.set_mode(0o600);
        link.set_size(0);
        link.set_cksum();
        let symlink_archive = dir.0.join("symlink.vrcx0backup");
        write_test_archive(&symlink_archive, vec![link]);
        assert!(prepare_restore_archive(&symlink_archive, &dir.0, None).is_err());

        let mut traversal = empty_regular_header("safe");
        traversal.as_mut_bytes()[..100].fill(0);
        traversal.as_mut_bytes()[..7].copy_from_slice(b"../evil");
        traversal.set_cksum();
        let traversal_archive = dir.0.join("traversal.vrcx0backup");
        write_test_archive(&traversal_archive, vec![traversal]);
        assert!(prepare_restore_archive(&traversal_archive, &dir.0, None).is_err());

        let duplicate_archive = dir.0.join("duplicate.vrcx0backup");
        write_test_archive(
            &duplicate_archive,
            vec![
                empty_regular_header(MANIFEST_FILE),
                empty_regular_header(MANIFEST_FILE),
            ],
        );
        assert!(prepare_restore_archive(&duplicate_archive, &dir.0, None).is_err());
    }

    #[test]
    fn rejects_backup_from_a_future_database_schema() {
        let dir = TestDir::new("future-schema");
        let db = database(&dir.0.join("VRCX-0.sqlite3"));
        config::set_string(
            &db,
            "VRCX_0_databaseVersion",
            &(VRCX0_SCHEMA_VERSION + 1).to_string(),
        )
        .unwrap();
        let error =
            create_backup_archive(&db, "{}", "test", &dir.0.join("workspace"), None).unwrap_err();
        assert!(error.to_string().contains("newer_schema"));
    }

    #[test]
    fn restore_state_machine_replaces_and_finalizes_the_profile() {
        let source = TestDir::new("restore-source");
        let source_db = database(&source.0.join("VRCX-0.sqlite3"));
        config::set_string(&source_db, "restoreMarker", "new").unwrap();
        let archive = create_backup_archive(
            &source_db,
            r#"{"theme":"new"}"#,
            "test",
            &source.0.join("workspace"),
            Some("restore-passphrase"),
        )
        .unwrap();

        let live = TestDir::new("restore-live");
        let live_db = database(&live.0.join("VRCX-0.sqlite3"));
        config::set_string(&live_db, "restoreMarker", "old").unwrap();
        fs::write(live.0.join("VRCX-0.json"), r#"{"theme":"old"}"#).unwrap();
        let preview =
            prepare_restore_archive(&archive.path, &live.0, Some("restore-passphrase")).unwrap();
        commit_prepared_restore(&live_db, r#"{"theme":"old"}"#, &live.0, &preview.restore_id)
            .unwrap();
        drop(live_db);

        let mut pending = read_pending(&live.0).unwrap().unwrap();
        pending.phase = PendingRestorePhase::Applying;
        atomic_write_json(&pending_path(&live.0), &pending).unwrap();

        assert!(apply_pending_cloud_restore(&live.0).unwrap());
        let restored_db = DatabaseService::new(&live.0.join("VRCX-0.sqlite3")).unwrap();
        assert_eq!(
            config::get_string(&restored_db, "restoreMarker", "").unwrap(),
            "new"
        );
        drop(restored_db);
        let restored_config: serde_json::Value =
            serde_json::from_slice(&fs::read(live.0.join("VRCX-0.json")).unwrap()).unwrap();
        assert_eq!(restored_config["theme"], "new");
        assert!(finalize_pending_cloud_restore(&live.0).unwrap());
        assert!(!restore_root(&live.0).exists());
    }

    #[test]
    fn applied_restore_can_roll_back_to_the_original_profile() {
        let source = TestDir::new("rollback-source");
        let source_db = database(&source.0.join("VRCX-0.sqlite3"));
        config::set_string(&source_db, "restoreMarker", "new").unwrap();
        let archive = create_backup_archive(
            &source_db,
            r#"{"theme":"new"}"#,
            "test",
            &source.0.join("workspace"),
            None,
        )
        .unwrap();

        let live = TestDir::new("rollback-live");
        let live_db = database(&live.0.join("VRCX-0.sqlite3"));
        config::set_string(&live_db, "restoreMarker", "old").unwrap();
        fs::write(live.0.join("VRCX-0.json"), r#"{"theme":"old"}"#).unwrap();
        let preview = prepare_restore_archive(&archive.path, &live.0, None).unwrap();
        commit_prepared_restore(&live_db, r#"{"theme":"old"}"#, &live.0, &preview.restore_id)
            .unwrap();
        drop(live_db);

        assert!(apply_pending_cloud_restore(&live.0).unwrap());
        assert!(request_pending_cloud_restore_rollback(&live.0).unwrap());
        assert!(apply_pending_cloud_restore(&live.0).unwrap());

        let restored_db = DatabaseService::new(&live.0.join("VRCX-0.sqlite3")).unwrap();
        assert_eq!(
            config::get_string(&restored_db, "restoreMarker", "").unwrap(),
            "old"
        );
        drop(restored_db);
        let restored_config: serde_json::Value =
            serde_json::from_slice(&fs::read(live.0.join("VRCX-0.json")).unwrap()).unwrap();
        assert_eq!(restored_config["theme"], "old");
        assert!(!restore_root(&live.0).exists());
    }
}
