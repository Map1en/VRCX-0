use serde::{Deserialize, Serialize};

pub const BACKUP_STAGING_DIRECTORY: &str = ".backup-staging";
pub const DATABASE_FILE_NAME: &str = "VRCX-0.sqlite3";
pub const MANIFEST_FILE_NAME: &str = "manifest.json";
pub(crate) const MAX_PROFILE_DATABASE_BYTES: u64 = 16 * 1024 * 1024 * 1024;
pub const RESTORE_JOURNAL_FILE_NAME: &str = "pending_profile_restore.json";
pub const RESTORE_PENDING_DIRECTORY: &str = ".restore-pending";
pub const RESTORE_RESULT_FILE_NAME: &str = "last_profile_restore_result.json";
pub const RESTORE_ROLLBACK_DIRECTORY: &str = ".restore-rollback";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileBackupKind {
    Auto,
    Manual,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupContent {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupManifest {
    pub manifest_version: u32,
    pub app_version: String,
    pub db_version: i64,
    pub created_at: String,
    pub platform: String,
    pub kind: ProfileBackupKind,
    pub contents: Vec<ProfileBackupContent>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProfileBackupManifestMetadata {
    pub app_version: String,
    pub db_version: i64,
    pub created_at: String,
    pub platform: String,
    pub kind: ProfileBackupKind,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreArchiveCheck {
    Valid,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreAppVersionCheck {
    Compatible,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreDatabaseVersionCheck {
    Compatible,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreDatabaseCheck {
    Valid,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreManifestSummary {
    pub app_version: String,
    pub db_version: i64,
    pub created_at: String,
    pub platform: String,
    pub kind: ProfileBackupKind,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreValidation {
    pub manifest: ProfileRestoreManifestSummary,
    pub source_file_name: String,
    pub staged_sha256: String,
    pub staged_bytes: u64,
    pub archive: ProfileRestoreArchiveCheck,
    pub app_version: ProfileRestoreAppVersionCheck,
    pub database_version: ProfileRestoreDatabaseVersionCheck,
    pub database: ProfileRestoreDatabaseCheck,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreFailureCode {
    OperationBusy,
    PendingRestore,
    InvalidArchive,
    InvalidEntries,
    UnsupportedManifestVersion,
    InvalidAppVersion,
    NewerAppVersion,
    NewerDatabaseVersion,
    ContentSizeMismatch,
    ContentHashMismatch,
    ValidationExpired,
    DatabaseCheckFailed,
    NotProfileDatabase,
    DatabaseVersionMismatch,
    StagingCorrupted,
    DatabaseOpenFailed,
    Io,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreFailure {
    pub code: ProfileRestoreFailureCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreValidationOutcome {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<ProfileRestoreValidation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<ProfileRestoreFailure>,
}

impl ProfileRestoreValidationOutcome {
    pub(crate) fn accepted(validation: ProfileRestoreValidation) -> Self {
        Self {
            validation: Some(validation),
            failure: None,
        }
    }

    pub(crate) fn rejected(code: ProfileRestoreFailureCode, path: Option<String>) -> Self {
        Self {
            validation: None,
            failure: Some(ProfileRestoreFailure { code, path }),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreResultStatus {
    Succeeded,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreDataDisposition {
    Replaced,
    RolledBack,
    Unchanged,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreResult {
    pub status: ProfileRestoreResultStatus,
    pub data_disposition: ProfileRestoreDataDisposition,
    pub source_file_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<ProfileRestoreFailure>,
}
