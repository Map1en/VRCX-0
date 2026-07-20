use serde::{Deserialize, Serialize};

pub use vrcx_0_persistence::profile_backup::{
    ProfileBackupKind, ProfileRestoreDataDisposition, ProfileRestoreFailure,
    ProfileRestoreFailureCode, ProfileRestoreResult, ProfileRestoreResultStatus,
    ProfileRestoreValidation, ProfileRestoreValidationOutcome,
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupSettings {
    pub auto_enabled: bool,
    pub auto_interval_days: u8,
    pub auto_retain_extra: u8,
    pub auto_target_dir: String,
    pub last_auto_at: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileBackupState {
    Idle,
    Running,
    Retryable,
    Error,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileBackupPhase {
    Snapshot,
    Package,
    Deliver,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileBackupErrorCode {
    OperationBusy,
    DeliveryPending,
    PendingRestore,
    PendingDataDirMigration,
    DirectoryUnavailable,
    PermissionDenied,
    LocalDiskFull,
    TargetDiskFull,
    DeviceRemoved,
    AlreadyExists,
    ArtifactMissing,
    SnapshotFailed,
    PackageFailed,
    Io,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupError {
    pub code: ProfileBackupErrorCode,
    pub path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupOutcome {
    pub revision: u64,
    pub kind: ProfileBackupKind,
    pub succeeded: bool,
    pub file_name: Option<String>,
    pub error_code: Option<ProfileBackupErrorCode>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupStatus {
    pub revision: u64,
    pub state: ProfileBackupState,
    pub kind: Option<ProfileBackupKind>,
    pub phase: Option<ProfileBackupPhase>,
    pub percent: Option<u8>,
    pub error: Option<ProfileBackupError>,
    pub last_outcome: Option<ProfileBackupOutcome>,
}

impl Default for ProfileBackupStatus {
    fn default() -> Self {
        Self {
            revision: 0,
            state: ProfileBackupState::Idle,
            kind: None,
            phase: None,
            percent: None,
            error: None,
            last_outcome: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupActionOutcome {
    pub accepted: bool,
    pub status: ProfileBackupStatus,
    pub error: Option<ProfileBackupError>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreProgressOperation {
    Validate,
    Prepare,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreProgressPhase {
    CopyArchive,
    ExtractDatabase,
    CheckDatabase,
    VerifyStaging,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreProgress {
    pub revision: u64,
    pub operation: ProfileRestoreProgressOperation,
    pub phase: ProfileRestoreProgressPhase,
    pub processed_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<u8>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreRollbackState {
    pub count: u32,
    pub cleanup_allowed: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreRollbackCleanupOutcome {
    pub accepted: bool,
    pub state: ProfileRestoreRollbackState,
    pub error: Option<ProfileBackupError>,
}
