use serde::{Deserialize, Serialize};
use vrcx_0_application_core::RuntimeEventPayload;
use vrcx_0_persistence::data_dir_migration::DataDirMigrationTargetState;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataDirMigrationPlan {
    pub target_path: String,
    pub required_bytes: u64,
    pub available_bytes: u64,
    pub target_state: DataDirMigrationTargetState,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DataDirMigrationMode {
    Migrate,
    AdoptExisting,
    FreshStart,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DataDirMigrationState {
    Idle,
    Running,
    Cancelling,
    Completed,
    Cancelled,
    Error,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DataDirMigrationPhase {
    Preparing,
    Freezing,
    Copying,
    Verifying,
    Committing,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DataDirMigrationErrorCode {
    OperationBusy,
    DatabaseUnavailable,
    PendingRestore,
    PendingLegacyMigration,
    PendingMigration,
    CleanupConflict,
    InsufficientSpace,
    InvalidAdoptionTarget,
    InvalidFreshStartTarget,
    CopyFailed,
    CommitFailed,
    PointerCommitFailed,
    Io,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataDirMigrationError {
    pub code: DataDirMigrationErrorCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataDirMigrationStatus {
    pub revision: u64,
    pub state: DataDirMigrationState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<DataDirMigrationPhase>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<DataDirMigrationError>,
}

impl Default for DataDirMigrationStatus {
    fn default() -> Self {
        Self {
            revision: 0,
            state: DataDirMigrationState::Idle,
            phase: None,
            percent: None,
            source_dir: None,
            target_dir: None,
            error: None,
        }
    }
}

impl RuntimeEventPayload for DataDirMigrationStatus {
    const EVENT_NAME: &'static str = "dataDirMigration";
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataDirMigrationActionOutcome {
    pub accepted: bool,
    pub status: DataDirMigrationStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<DataDirMigrationError>,
}
