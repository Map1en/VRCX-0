use vrcx_0_persistence::maintenance::{
    database_maintenance_run, ensure_required_database_schema, DatabaseMaintenanceTask,
};
use vrcx_0_persistence::migration::{
    preview as preview_migrations, run as run_schema_migrations, NoopProgress, Preview,
    PreviewStatus,
};
use vrcx_0_persistence::migrations::migrations;
use vrcx_0_persistence::{
    read_upstream_schema_version, read_vrcx0_schema_version, write_upstream_schema_version,
    write_vrcx0_schema_version, DatabaseService, SqliteErrorCategory, VRCX0_SCHEMA_VERSION,
};

use vrcx_0_application::profile::{
    DatabaseUpgradePreflight, DatabaseUpgradePreflightStatus, DatabaseUpgradeProgress,
    DatabaseUpgradeRunResult, DatabaseUpgradeRunStatus, DatabaseUpgradeStage, DatabaseUpgradeStore,
};
use vrcx_0_application_core::Error;
use vrcx_0_contracts::{LegacyMigrationPaths, LegacyMigrationProgress, LegacyVrcxSource};

pub struct LocalDatabaseUpgradeStore {
    db: std::sync::Arc<DatabaseService>,
}

impl LocalDatabaseUpgradeStore {
    pub fn new(db: std::sync::Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl DatabaseUpgradeStore for LocalDatabaseUpgradeStore {
    fn schema_version(&self) -> i64 {
        VRCX0_SCHEMA_VERSION
    }

    fn preflight(&self) -> vrcx_0_application_core::Result<DatabaseUpgradePreflight> {
        database_upgrade_preflight(&self.db)
    }

    fn run(
        &self,
        on_progress: &mut dyn FnMut(DatabaseUpgradeProgress),
    ) -> DatabaseUpgradeRunResult {
        run_database_upgrade_with_progress(&self.db, on_progress)
    }

    fn discard_failed_upgrade(&self) -> vrcx_0_application_core::Result<()> {
        self.db.discard_failed_upgrade().map_err(crate::Error::from)
    }

    fn archive_main_database_and_create_fresh_database(
        &self,
    ) -> vrcx_0_application_core::Result<std::path::PathBuf> {
        self.db
            .archive_main_database_and_create_fresh_database()
            .map_err(crate::Error::from)
    }

    fn prepare_legacy_migration(
        &self,
        paths: &LegacyMigrationPaths,
        source: &LegacyVrcxSource,
        on_progress: &mut dyn FnMut(LegacyMigrationProgress),
    ) -> vrcx_0_application_core::Result<()> {
        vrcx_0_persistence::legacy_vrcx::validate_legacy_source(source)
            .map_err(vrcx_0_application_core::Error::Custom)?;
        vrcx_0_persistence::legacy_migration::prepare_legacy_migration(paths, source, on_progress)
            .map_err(crate::Error::from)
    }
}

const UPSTREAM_CLEANUP_SCHEMA_VERSION: i64 = 16;
const COPRESENCE_DURATION_REPAIR_KEY: &str = "copresenceDurationRepairV1Done";
const EMPTY_LEAVE_LOCATION_REPAIR_KEY: &str = "emptyLeaveLocationRepairV1Done";
const EXPIRED_NOTIFICATION_SEEN_REPAIR_KEY: &str = "expiredNotificationSeenRepairV1Done";
const ONE_TIME_DATA_REPAIRS: &[(&str, DatabaseMaintenanceTask)] = &[
    (
        EMPTY_LEAVE_LOCATION_REPAIR_KEY,
        DatabaseMaintenanceTask::RepairEmptyLeaveLocations,
    ),
    (
        COPRESENCE_DURATION_REPAIR_KEY,
        DatabaseMaintenanceTask::RepairZeroCopresenceDurations,
    ),
    (
        EXPIRED_NOTIFICATION_SEEN_REPAIR_KEY,
        DatabaseMaintenanceTask::RepairExpiredNotificationsSeen,
    ),
];
const LEGACY_DATA_CLEANUP_TASKS: &[DatabaseMaintenanceTask] = &[
    DatabaseMaintenanceTask::CleanLegendFromFriendLog,
    DatabaseMaintenanceTask::FixGameLogTraveling,
    DatabaseMaintenanceTask::FixNegativeGPS,
    DatabaseMaintenanceTask::FixBrokenLeaveEntries,
    DatabaseMaintenanceTask::FixBrokenGroupInvites,
    DatabaseMaintenanceTask::FixBrokenNotifications,
    DatabaseMaintenanceTask::FixBrokenGroupChange,
    DatabaseMaintenanceTask::FixCancelFriendRequestTypo,
    DatabaseMaintenanceTask::FixBrokenGameLogDisplayNames,
];
const LEGACY_SCHEMA_MIGRATION_TASKS: &[DatabaseMaintenanceTask] = &[
    DatabaseMaintenanceTask::UpdateTableForGroupNames,
    DatabaseMaintenanceTask::AddFriendLogFriendNumber,
    DatabaseMaintenanceTask::UpdateTableForAvatarHistory,
];

struct UpgradeFailure {
    from_version: i64,
    stage: DatabaseUpgradeStage,
    operation: String,
    error: Error,
    upgrade_started: bool,
}

impl UpgradeFailure {
    fn before_upgrade(
        from_version: i64,
        stage: DatabaseUpgradeStage,
        operation: impl Into<String>,
        error: impl Into<Error>,
    ) -> Self {
        Self {
            from_version,
            stage,
            operation: operation.into(),
            error: error.into(),
            upgrade_started: false,
        }
    }

    fn during_upgrade(
        from_version: i64,
        stage: DatabaseUpgradeStage,
        operation: impl Into<String>,
        error: impl Into<Error>,
    ) -> Self {
        Self {
            from_version,
            stage,
            operation: operation.into(),
            error: error.into(),
            upgrade_started: true,
        }
    }
}

pub fn database_upgrade_preflight(db: &DatabaseService) -> Result<DatabaseUpgradePreflight, Error> {
    if let Some(failed_upgrade) = db.get_failed_upgrade()? {
        return Ok(DatabaseUpgradePreflight {
            status: DatabaseUpgradePreflightStatus::Blocked,
            from_version: failed_upgrade.from_version,
            to_version: failed_upgrade.to_version,
            repair_pending: false,
            stage: None,
            result: None,
            failed_upgrade: Some(failed_upgrade),
        });
    }

    let schema_version = read_vrcx0_schema_version(db)?;
    let migrations = migration_preview(db)?;
    let (from_version, to_version) = if schema_version <= VRCX0_SCHEMA_VERSION
        && migrations.status == PreviewStatus::NewerSchema
    {
        (migrations.current_version, migrations.target_version)
    } else {
        (schema_version, VRCX0_SCHEMA_VERSION)
    };
    let status = if schema_version > VRCX0_SCHEMA_VERSION
        || migrations.status == PreviewStatus::NewerSchema
    {
        DatabaseUpgradePreflightStatus::NewerSchema
    } else if schema_version < VRCX0_SCHEMA_VERSION || migrations.status == PreviewStatus::Pending {
        DatabaseUpgradePreflightStatus::UpgradeRequired
    } else {
        DatabaseUpgradePreflightStatus::Current
    };

    Ok(DatabaseUpgradePreflight {
        status,
        from_version,
        to_version,
        repair_pending: !pending_data_repairs(db)?.is_empty(),
        stage: None,
        result: None,
        failed_upgrade: None,
    })
}

fn migration_preview(db: &DatabaseService) -> Result<Preview, Error> {
    Ok(preview_migrations(db, &migrations())?)
}

#[cfg(test)]
fn run_database_upgrade(db: &DatabaseService) -> DatabaseUpgradeRunResult {
    run_database_upgrade_with_progress(db, |_| {})
}

pub(super) fn run_database_upgrade_with_progress(
    db: &DatabaseService,
    mut on_progress: impl FnMut(DatabaseUpgradeProgress),
) -> DatabaseUpgradeRunResult {
    match run_database_upgrade_inner(db, &mut on_progress) {
        Ok(mut result) => {
            if matches!(
                result.status,
                DatabaseUpgradeRunStatus::Current | DatabaseUpgradeRunStatus::Upgraded
            ) {
                result.repair_warning = run_data_repairs_once(db, &mut on_progress);
            }
            result
        }
        Err(failure) => recover_failed_upgrade(db, failure),
    }
}

fn run_database_upgrade_inner(
    db: &DatabaseService,
    on_progress: &mut impl FnMut(DatabaseUpgradeProgress),
) -> Result<DatabaseUpgradeRunResult, UpgradeFailure> {
    report_stage(
        db,
        on_progress,
        DatabaseUpgradeStage::Preflight,
        "database_upgrade_preflight",
    );
    let preflight = database_upgrade_preflight(db).map_err(|error| {
        let from_version = read_vrcx0_schema_version(db).unwrap_or(0);
        UpgradeFailure::before_upgrade(
            from_version,
            DatabaseUpgradeStage::Preflight,
            "database_upgrade_preflight",
            error,
        )
    })?;
    let from_version = preflight.from_version;
    let to_version = preflight.to_version;
    let schema_version = read_vrcx0_schema_version(db).map_err(|error| {
        UpgradeFailure::before_upgrade(
            from_version,
            DatabaseUpgradeStage::Preflight,
            "read_vrcx0_schema_version",
            error,
        )
    })?;

    match preflight.status {
        DatabaseUpgradePreflightStatus::Blocked => {
            let Some(failed_upgrade) = preflight.failed_upgrade else {
                return Err(UpgradeFailure::before_upgrade(
                    from_version,
                    DatabaseUpgradeStage::Preflight,
                    "database_upgrade_preflight",
                    Error::Custom("Blocked database upgrade has no failure status.".into()),
                ));
            };
            return Ok(DatabaseUpgradeRunResult {
                status: DatabaseUpgradeRunStatus::Blocked,
                from_version: failed_upgrade.from_version,
                to_version: failed_upgrade.to_version,
                failed_stage: None,
                error: failed_upgrade.reason.clone(),
                failed_upgrade: Some(failed_upgrade),
                repair_warning: None,
            });
        }
        DatabaseUpgradePreflightStatus::NewerSchema => {
            return Ok(DatabaseUpgradeRunResult {
                status: DatabaseUpgradeRunStatus::NewerSchema,
                from_version,
                to_version,
                failed_stage: None,
                error: Some(format!(
                    "Database version {from_version} is newer than this application supports ({to_version})."
                )),
                failed_upgrade: None,
                repair_warning: None,
            });
        }
        DatabaseUpgradePreflightStatus::Current => {
            report_stage(
                db,
                on_progress,
                DatabaseUpgradeStage::InitializeSchema,
                "ensure_required_database_schema",
            );
            ensure_required_database_schema(db).map_err(|error| {
                UpgradeFailure::before_upgrade(
                    from_version,
                    DatabaseUpgradeStage::InitializeSchema,
                    "ensure_required_database_schema",
                    error,
                )
            })?;
            return Ok(success_result(
                DatabaseUpgradeRunStatus::Current,
                from_version,
            ));
        }
        DatabaseUpgradePreflightStatus::UpgradeRequired => {}
        DatabaseUpgradePreflightStatus::Running | DatabaseUpgradePreflightStatus::Finished => {
            return Err(UpgradeFailure::before_upgrade(
                from_version,
                DatabaseUpgradeStage::Preflight,
                "database_upgrade_preflight",
                Error::Custom(
                    "Runtime-only database upgrade state reached the static runner.".into(),
                ),
            ));
        }
    }

    report_stage(
        db,
        on_progress,
        DatabaseUpgradeStage::CreateWorkCopy,
        "begin_upgrade_with_progress",
    );
    let create_work_copy_stage = stage_label(DatabaseUpgradeStage::CreateWorkCopy);
    db.begin_upgrade_with_progress(
        schema_version,
        VRCX0_SCHEMA_VERSION,
        Some(env!("CARGO_PKG_VERSION")),
        Some(&create_work_copy_stage),
        Some("begin_upgrade_with_progress"),
        |completed, total| {
            on_progress(DatabaseUpgradeProgress::determinate(
                DatabaseUpgradeStage::CreateWorkCopy,
                completed,
                total,
            ));
        },
    )
    .map_err(|error| {
        UpgradeFailure::before_upgrade(
            from_version,
            DatabaseUpgradeStage::CreateWorkCopy,
            "begin_upgrade_with_progress",
            error,
        )
    })?;

    report_stage(
        db,
        on_progress,
        DatabaseUpgradeStage::InitializeSchema,
        "ensure_required_database_schema",
    );
    ensure_required_database_schema(db).map_err(|error| {
        UpgradeFailure::during_upgrade(
            from_version,
            DatabaseUpgradeStage::InitializeSchema,
            "ensure_required_database_schema",
            error,
        )
    })?;

    normalize_upstream_layout(db, on_progress, from_version)?;
    if schema_version == 0 {
        run_optional_task(
            db,
            on_progress,
            DatabaseUpgradeStage::LegacySchemaMigration,
            DatabaseMaintenanceTask::ImportUpstreamHmdNotificationSettings,
        );
    }

    run_required_task(
        db,
        on_progress,
        from_version,
        DatabaseUpgradeStage::LegacyPerformanceIndexes,
        DatabaseMaintenanceTask::AddLegacyPerformanceIndexes,
    )?;
    run_required_task(
        db,
        on_progress,
        from_version,
        DatabaseUpgradeStage::GlobalPerformanceIndexes,
        DatabaseMaintenanceTask::AddV17GlobalPerformanceIndexes,
    )?;
    run_required_task(
        db,
        on_progress,
        from_version,
        DatabaseUpgradeStage::NotificationPerformanceIndexes,
        DatabaseMaintenanceTask::AddNotificationPerformanceIndexes,
    )?;

    report_stage(
        db,
        on_progress,
        DatabaseUpgradeStage::SchemaMigrations,
        "run_schema_migrations",
    );
    run_schema_migrations(db, &migrations(), &NoopProgress).map_err(|error| {
        UpgradeFailure::during_upgrade(
            from_version,
            DatabaseUpgradeStage::SchemaMigrations,
            "run_schema_migrations",
            error,
        )
    })?;

    run_optional_task(
        db,
        on_progress,
        DatabaseUpgradeStage::Optimize,
        DatabaseMaintenanceTask::Optimize,
    );
    report_stage(
        db,
        on_progress,
        DatabaseUpgradeStage::WriteVersion,
        "write_vrcx0_schema_version",
    );
    write_vrcx0_schema_version(db, VRCX0_SCHEMA_VERSION).map_err(|error| {
        UpgradeFailure::during_upgrade(
            from_version,
            DatabaseUpgradeStage::WriteVersion,
            "write_vrcx0_schema_version",
            error,
        )
    })?;
    report_stage(
        db,
        on_progress,
        DatabaseUpgradeStage::Commit,
        "commit_upgrade",
    );
    db.commit_upgrade().map_err(|error| {
        UpgradeFailure::during_upgrade(
            from_version,
            DatabaseUpgradeStage::Commit,
            "commit_upgrade",
            error,
        )
    })?;

    Ok(success_result(
        DatabaseUpgradeRunStatus::Upgraded,
        from_version,
    ))
}

fn report_stage(
    db: &DatabaseService,
    on_progress: &mut impl FnMut(DatabaseUpgradeProgress),
    stage: DatabaseUpgradeStage,
    operation: &str,
) {
    persist_upgrade_context(db, stage, operation);
    on_progress(DatabaseUpgradeProgress::indeterminate(stage));
}

fn persist_upgrade_context(db: &DatabaseService, stage: DatabaseUpgradeStage, operation: &str) {
    if let Err(error) = db.set_upgrade_context(&stage_label(stage), operation) {
        tracing::debug!(?stage, operation, error = %error, "database upgrade context not persisted");
    }
}

fn stage_label(stage: DatabaseUpgradeStage) -> String {
    match serde_json::to_value(stage) {
        Ok(serde_json::Value::String(label)) => label,
        _ => format!("{stage:?}"),
    }
}

fn run_optional_task(
    db: &DatabaseService,
    on_progress: &mut impl FnMut(DatabaseUpgradeProgress),
    stage: DatabaseUpgradeStage,
    task: DatabaseMaintenanceTask,
) {
    let operation = maintenance_operation(task);
    report_stage(db, on_progress, stage, &operation);
    if let Err(error) = run_task(db, task) {
        tracing::warn!(?stage, error = %error, "optional database upgrade task failed");
    }
}

fn normalize_upstream_layout(
    db: &DatabaseService,
    on_progress: &mut impl FnMut(DatabaseUpgradeProgress),
    from_version: i64,
) -> Result<(), UpgradeFailure> {
    let stage = DatabaseUpgradeStage::LegacySchemaMigration;
    let upstream_version = read_upstream_schema_version(db).map_err(|error| {
        UpgradeFailure::during_upgrade(from_version, stage, "read_upstream_schema_version", error)
    })?;
    if upstream_version < UPSTREAM_CLEANUP_SCHEMA_VERSION {
        for &task in LEGACY_DATA_CLEANUP_TASKS
            .iter()
            .chain(LEGACY_SCHEMA_MIGRATION_TASKS)
        {
            run_required_task(db, on_progress, from_version, stage, task)?;
        }
        write_upstream_schema_version(db, UPSTREAM_CLEANUP_SCHEMA_VERSION).map_err(|error| {
            UpgradeFailure::during_upgrade(
                from_version,
                stage,
                "write_upstream_schema_version",
                error,
            )
        })?;
    }
    run_required_task(
        db,
        on_progress,
        from_version,
        stage,
        DatabaseMaintenanceTask::ImportUpstreamPrintFavorites,
    )
}

fn run_required_task(
    db: &DatabaseService,
    on_progress: &mut impl FnMut(DatabaseUpgradeProgress),
    from_version: i64,
    stage: DatabaseUpgradeStage,
    task: DatabaseMaintenanceTask,
) -> Result<(), UpgradeFailure> {
    let operation = maintenance_operation(task);
    report_stage(db, on_progress, stage, &operation);
    run_task(db, task)
        .map_err(|error| UpgradeFailure::during_upgrade(from_version, stage, operation, error))
}

fn maintenance_operation(task: DatabaseMaintenanceTask) -> String {
    format!("database_maintenance_run:{}", task.as_str())
}

fn run_task(db: &DatabaseService, task: DatabaseMaintenanceTask) -> Result<(), Error> {
    database_maintenance_run(db, task).map_err(Error::from)
}

fn success_result(status: DatabaseUpgradeRunStatus, from_version: i64) -> DatabaseUpgradeRunResult {
    DatabaseUpgradeRunResult {
        status,
        from_version,
        to_version: VRCX0_SCHEMA_VERSION,
        failed_stage: None,
        error: None,
        failed_upgrade: None,
        repair_warning: None,
    }
}

fn recover_failed_upgrade(
    db: &DatabaseService,
    failure: UpgradeFailure,
) -> DatabaseUpgradeRunResult {
    let operation = failure.operation.clone();
    let sqlite_category = sqlite_category_label(&failure.error);
    let telemetry_reason = failure.error.to_string();
    let active_upgrade = failure
        .upgrade_started
        .then(|| db.get_failed_upgrade().ok().flatten())
        .flatten();
    let started_app_version = active_upgrade
        .as_ref()
        .and_then(|status| status.app_version.as_deref())
        .filter(|version| !version.is_empty())
        .unwrap_or(env!("CARGO_PKG_VERSION"));
    let telemetry_from_version = active_upgrade
        .as_ref()
        .map(|status| status.from_version)
        .unwrap_or(failure.from_version);
    let telemetry_to_version = active_upgrade
        .as_ref()
        .map(|status| status.to_version)
        .unwrap_or(VRCX0_SCHEMA_VERSION);
    log_database_upgrade_failure(
        failure.stage,
        &operation,
        sqlite_category,
        telemetry_from_version,
        telemetry_to_version,
        started_app_version,
        &telemetry_reason,
    );
    let mut error = telemetry_reason.clone();
    if failure.upgrade_started {
        if let Err(recovery_error) = db.fail_upgrade(error.clone()) {
            error = format!(
                "{error} Failed to preserve the database upgrade work copy: {recovery_error}"
            );
        }
    }

    let failed_upgrade = match db.get_failed_upgrade() {
        Ok(status) => status,
        Err(status_error) => {
            error = format!("{error} Failed to read database upgrade status: {status_error}");
            None
        }
    };

    DatabaseUpgradeRunResult {
        status: DatabaseUpgradeRunStatus::Failed,
        from_version: failure.from_version,
        to_version: VRCX0_SCHEMA_VERSION,
        failed_stage: Some(failure.stage),
        error: Some(error),
        failed_upgrade,
        repair_warning: None,
    }
}

fn sqlite_category_label(error: &Error) -> &'static str {
    match error {
        Error::Sqlite {
            category: Some(SqliteErrorCategory::Malformed),
            ..
        } => "malformed",
        Error::Sqlite {
            category: Some(SqliteErrorCategory::DiskFull),
            ..
        } => "disk_full",
        Error::Sqlite {
            category: Some(SqliteErrorCategory::Locked),
            ..
        } => "locked",
        Error::Sqlite {
            category: Some(SqliteErrorCategory::IoError),
            ..
        } => "io_error",
        Error::Sqlite { category: None, .. } => "unclassified",
        _ => "none",
    }
}

pub(super) fn log_database_upgrade_failure(
    stage: DatabaseUpgradeStage,
    operation: &str,
    sqlite_category: &str,
    from_version: i64,
    to_version: i64,
    started_app_version: &str,
    reason: &str,
) {
    let stage = stage_label(stage);
    tracing::error!(
        "database upgrade failure [status=failed stage={stage} operation={operation} sqliteCategory={sqlite_category} from={from_version} to={to_version} appVersion={started_app_version}]: {reason}"
    );
}

fn pending_data_repairs(
    db: &DatabaseService,
) -> Result<Vec<(&'static str, DatabaseMaintenanceTask)>, vrcx_0_persistence::Error> {
    let mut pending = Vec::new();
    for &(key, task) in ONE_TIME_DATA_REPAIRS {
        if vrcx_0_persistence::config::get_string(db, key, "")? != "1" {
            pending.push((key, task));
        }
    }
    Ok(pending)
}

fn run_data_repairs_once(
    db: &DatabaseService,
    on_progress: &mut impl FnMut(DatabaseUpgradeProgress),
) -> Option<String> {
    let pending = match pending_data_repairs(db) {
        Ok(pending) => pending,
        Err(error) => return Some(error.to_string()),
    };
    if pending.is_empty() {
        return None;
    }
    on_progress(DatabaseUpgradeProgress::indeterminate(
        DatabaseUpgradeStage::RepairData,
    ));
    pending
        .into_iter()
        .filter_map(|(key, task)| {
            database_maintenance_run(db, task)
                .and_then(|()| vrcx_0_persistence::config::set_string(db, key, "1"))
                .err()
                .map(|error| error.to_string())
        })
        .reduce(|first, next| format!("{first}; {next}"))
}

#[cfg(test)]
mod tests;
