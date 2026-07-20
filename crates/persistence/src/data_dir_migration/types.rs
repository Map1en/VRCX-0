use serde::{Deserialize, Serialize};

pub const DATA_DIR_MIGRATION_JOURNAL_FILE_NAME: &str = "pending-data-dir-migration.json";
pub const DATA_DIR_MIGRATION_RESULT_FILE_NAME: &str = "last-data-dir-migration-result.json";
pub const DATA_DIR_CLEANUP_PENDING_FILE_NAME: &str = "data-dir-cleanup-pending.json";
pub const DATA_DIR_MIGRATION_STAGING_DIRECTORY: &str = ".migrate-staging";
pub const DATA_DIR_MIGRATION_REPLACED_PREFIX: &str = ".migrate-replaced-";
pub const DATA_DIR_MIGRATION_JOURNAL_VERSION: u32 = 1;
pub const DATA_DIR_MIGRATION_SPACE_MARGIN_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DataDirMigrationTargetState {
    Empty,
    ExistingProfile,
    ForeignContent,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DataDirMigrationJournalPhase {
    Copying,
    Switched,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingDataDirMigration {
    pub journal_version: u32,
    pub phase: DataDirMigrationJournalPhase,
    pub source_dir: String,
    pub target_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub db_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub db_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wal_bytes: Option<u64>,
    pub requested_at: String,
    #[serde(default)]
    pub replace_existing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replaced_dir: Option<String>,
}

impl PendingDataDirMigration {
    pub fn copying(
        source_dir: String,
        target_dir: String,
        requested_at: String,
        replace_existing: bool,
    ) -> Self {
        Self {
            journal_version: DATA_DIR_MIGRATION_JOURNAL_VERSION,
            phase: DataDirMigrationJournalPhase::Copying,
            source_dir,
            target_dir,
            db_sha256: None,
            db_bytes: None,
            wal_bytes: None,
            requested_at,
            replace_existing,
            replaced_dir: None,
        }
    }

    pub fn mark_switched(&mut self, copied: &StagedDataDirMigration, replaced_dir: Option<String>) {
        self.phase = DataDirMigrationJournalPhase::Switched;
        self.db_sha256 = Some(copied.db_sha256.clone());
        self.db_bytes = Some(copied.db_bytes);
        self.wal_bytes = copied.wal_bytes;
        self.replaced_dir = replaced_dir;
    }

    pub fn validate(&self) -> crate::Result<()> {
        if self.journal_version != DATA_DIR_MIGRATION_JOURNAL_VERSION {
            return Err(crate::Error::InvalidData(format!(
                "Unsupported data directory migration journal version: {}",
                self.journal_version
            )));
        }
        if self.source_dir.trim().is_empty() || self.target_dir.trim().is_empty() {
            return Err(crate::Error::InvalidData(
                "Data directory migration journal paths must not be empty.".into(),
            ));
        }
        if self.phase == DataDirMigrationJournalPhase::Switched
            && (self.db_sha256.as_deref().is_none_or(str::is_empty) || self.db_bytes.is_none())
        {
            return Err(crate::Error::InvalidData(
                "Switched data directory migration journal is incomplete.".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StagedDataDirMigration {
    pub db_sha256: String,
    pub db_bytes: u64,
    pub wal_bytes: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DataDirMigrationResultStatus {
    Succeeded,
    Interrupted,
    DatabaseOpenFailed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DataDirMigrationWarning {
    ConfigCopyFailed,
    GalleryCopyFailed,
    CacheCleanupFailed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataDirMigrationResult {
    pub status: DataDirMigrationResultStatus,
    pub source_dir: String,
    pub target_dir: String,
    pub warnings: Vec<DataDirMigrationWarning>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataDirCleanupPending {
    pub old_dir: String,
    pub bytes: u64,
    pub migrated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_prompted_at: Option<String>,
    pub dismissed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replaced_dir: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DataDirMigrationFinalizeOutcome {
    pub cleanup_pending: DataDirCleanupPending,
    pub warnings: Vec<DataDirMigrationWarning>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataDirCleanupReport {
    pub freed_bytes: u64,
    pub skipped: Vec<String>,
}
