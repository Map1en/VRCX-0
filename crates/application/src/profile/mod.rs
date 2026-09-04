mod app_update;
mod background_image;
mod community_theme;
mod config_mutation;
mod data_dir_migration;
mod database_upgrade;
mod database_upgrade_runtime;
mod ports;
mod profile_backup;
mod secret_startup;
#[cfg(test)]
mod test_support;
mod vrc_status;

pub use app_update::{
    AppUpdateBuildInfo, AppUpdateCatalogAsset, AppUpdateCatalogRelease, AppUpdateChannel,
    AppUpdateDownloadPhase, AppUpdateDownloadProgressPayload, AppUpdateDownloadStatusSnapshot,
    AppUpdateInstalledPayload, AppUpdateReleaseCatalogFuture, AppUpdateReleaseCatalogPort,
    AppUpdateReleaseSnapshot, AppUpdateRuntime, AppUpdateRuntimeDeps, AppUpdateStatusSnapshot,
    AppUpdateTargetResolver,
};
pub use background_image::{
    BackgroundImageConfigureInput, BackgroundImageCustomSource, BackgroundImageCustomSourceKind,
    BackgroundImageFileResolver, BackgroundImageMode, BackgroundImageProjection,
    BackgroundImageProviderId, BackgroundImageRemote, BackgroundImageRemoteFuture,
    BackgroundImageService, BackgroundImageSnapshot, UnavailableBackgroundImageFileResolver,
};
pub use community_theme::{
    CommunityThemeAuthor, CommunityThemeCatalog, CommunityThemeConfigureInput,
    CommunityThemeInstallMetadata, CommunityThemeManifest, CommunityThemeProjection,
    CommunityThemeRemote, CommunityThemeRemoteFuture, CommunityThemeService,
    CommunityThemeStatsById, CommunityThemeStatsEntry,
};
pub use config_mutation::{list_config_values, remove_config_value, set_config_values};
pub use data_dir_migration::{
    build_data_dir_migration_plan, DataDirMigrationActionOutcome, DataDirMigrationError,
    DataDirMigrationErrorCode, DataDirMigrationMode, DataDirMigrationPhase, DataDirMigrationPlan,
    DataDirMigrationPort, DataDirMigrationRuntime, DataDirMigrationState, DataDirMigrationStatus,
    DataDirPointerCommitter,
};
pub use database_upgrade::{
    database_upgrade_preflight, run_database_upgrade, DatabaseUpgradePreflight,
    DatabaseUpgradePreflightStatus, DatabaseUpgradeProgress, DatabaseUpgradeRunResult,
    DatabaseUpgradeRunStatus, DatabaseUpgradeStage, DatabaseUpgradeStore,
};
pub use database_upgrade_runtime::DatabaseUpgradeRuntime;
pub use ports::ProfileConfigStore;
pub use profile_backup::{OperationGuard, ProfileBackupPort, ProfileOperationGate};
pub use profile_backup::{
    ProfileBackupActionOutcome, ProfileBackupError, ProfileBackupErrorCode, ProfileBackupKind,
    ProfileBackupOutcome, ProfileBackupPhase, ProfileBackupRuntime, ProfileBackupSettings,
    ProfileBackupState, ProfileBackupStatus, ProfileRestoreDataDisposition, ProfileRestoreFailure,
    ProfileRestoreFailureCode, ProfileRestoreProgress, ProfileRestoreProgressOperation,
    ProfileRestoreProgressPhase, ProfileRestoreResult, ProfileRestoreResultStatus,
    ProfileRestoreRollbackCleanupOutcome, ProfileRestoreRollbackState, ProfileRestoreValidation,
    ProfileRestoreValidationOutcome,
};
pub use secret_startup::{run_secret_startup, SecretStartupActions};
pub use vrc_status::{VrcStatusRemote, VrcStatusRemoteFuture, VrcStatusService};
pub use vrcx_0_contracts::{ConfigReadEntry, ConfigWriteEntry};
