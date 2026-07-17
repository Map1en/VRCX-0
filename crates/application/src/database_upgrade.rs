use serde::Serialize;
use vrcx_0_persistence::maintenance::{database_maintenance_run, DatabaseMaintenanceTask};
use vrcx_0_persistence::{
    prepare_vrcx0_schema_version, write_database_schema_versions, DatabaseService,
    DatabaseUpgradeStatus, VRCX0_SCHEMA_VERSION,
};

use crate::Error;

const LEGACY_SCHEMA_VERSION: i64 = 16;
const COPRESENCE_DURATION_REPAIR_KEY: &str = "copresenceDurationRepairV1Done";
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
    DatabaseMaintenanceTask::AddLegacyPerformanceIndexes,
    DatabaseMaintenanceTask::Vacuum,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseUpgradePreflightStatus {
    Current,
    UpgradeRequired,
    Running,
    Finished,
    Blocked,
    NewerSchema,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseUpgradePreflight {
    pub status: DatabaseUpgradePreflightStatus,
    pub from_version: i64,
    pub to_version: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<DatabaseUpgradeStage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<DatabaseUpgradeRunResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_upgrade: Option<DatabaseUpgradeStatus>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseUpgradeRunStatus {
    Current,
    Upgraded,
    Blocked,
    NewerSchema,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseUpgradeStage {
    Preflight,
    InitializeSchema,
    CreateWorkCopy,
    LegacyDataCleanup,
    LegacySchemaMigration,
    PerformanceIndexes,
    Optimize,
    WriteVersion,
    Commit,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseUpgradeRunResult {
    pub status: DatabaseUpgradeRunStatus,
    pub from_version: i64,
    pub to_version: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_stage: Option<DatabaseUpgradeStage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_upgrade: Option<DatabaseUpgradeStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repair_warning: Option<String>,
}

struct UpgradeFailure {
    from_version: i64,
    stage: DatabaseUpgradeStage,
    error: Error,
    upgrade_started: bool,
}

impl UpgradeFailure {
    fn before_upgrade(
        from_version: i64,
        stage: DatabaseUpgradeStage,
        error: impl Into<Error>,
    ) -> Self {
        Self {
            from_version,
            stage,
            error: error.into(),
            upgrade_started: false,
        }
    }

    fn during_upgrade(
        from_version: i64,
        stage: DatabaseUpgradeStage,
        error: impl Into<Error>,
    ) -> Self {
        Self {
            from_version,
            stage,
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
            stage: None,
            result: None,
            failed_upgrade: Some(failed_upgrade),
        });
    }

    let from_version = prepare_vrcx0_schema_version(db)?;
    let status = match from_version.cmp(&VRCX0_SCHEMA_VERSION) {
        std::cmp::Ordering::Less => DatabaseUpgradePreflightStatus::UpgradeRequired,
        std::cmp::Ordering::Equal => DatabaseUpgradePreflightStatus::Current,
        std::cmp::Ordering::Greater => DatabaseUpgradePreflightStatus::NewerSchema,
    };

    Ok(DatabaseUpgradePreflight {
        status,
        from_version,
        to_version: VRCX0_SCHEMA_VERSION,
        stage: None,
        result: None,
        failed_upgrade: None,
    })
}

pub fn run_database_upgrade(db: &DatabaseService) -> DatabaseUpgradeRunResult {
    run_database_upgrade_with_progress(db, |_| {})
}

pub(crate) fn run_database_upgrade_with_progress(
    db: &DatabaseService,
    mut on_stage: impl FnMut(DatabaseUpgradeStage),
) -> DatabaseUpgradeRunResult {
    match run_database_upgrade_inner(db, &mut on_stage) {
        Ok(mut result) => {
            if matches!(
                result.status,
                DatabaseUpgradeRunStatus::Current | DatabaseUpgradeRunStatus::Upgraded
            ) {
                result.repair_warning = run_copresence_duration_repair_once(db).err();
            }
            result
        }
        Err(failure) => recover_failed_upgrade(db, failure),
    }
}

fn run_database_upgrade_inner(
    db: &DatabaseService,
    on_stage: &mut impl FnMut(DatabaseUpgradeStage),
) -> Result<DatabaseUpgradeRunResult, UpgradeFailure> {
    on_stage(DatabaseUpgradeStage::Preflight);
    let preflight = database_upgrade_preflight(db).map_err(|error| {
        let from_version = prepare_vrcx0_schema_version(db).unwrap_or(0);
        UpgradeFailure::before_upgrade(from_version, DatabaseUpgradeStage::Preflight, error)
    })?;
    let from_version = preflight.from_version;

    match preflight.status {
        DatabaseUpgradePreflightStatus::Blocked => {
            let Some(failed_upgrade) = preflight.failed_upgrade else {
                return Err(UpgradeFailure::before_upgrade(
                    from_version,
                    DatabaseUpgradeStage::Preflight,
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
                to_version: VRCX0_SCHEMA_VERSION,
                failed_stage: None,
                error: Some(format!(
                    "Database schema version {from_version} is newer than this application supports ({}).",
                    VRCX0_SCHEMA_VERSION
                )),
                failed_upgrade: None,
                repair_warning: None,
            });
        }
        DatabaseUpgradePreflightStatus::Current => {
            on_stage(DatabaseUpgradeStage::InitializeSchema);
            run_task(db, DatabaseMaintenanceTask::InitGlobalTables).map_err(|error| {
                UpgradeFailure::before_upgrade(
                    from_version,
                    DatabaseUpgradeStage::InitializeSchema,
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
                Error::Custom(
                    "Runtime-only database upgrade state reached the static runner.".into(),
                ),
            ));
        }
    }

    on_stage(DatabaseUpgradeStage::CreateWorkCopy);
    db.begin_upgrade(from_version, VRCX0_SCHEMA_VERSION)
        .map_err(|error| {
            UpgradeFailure::before_upgrade(
                from_version,
                DatabaseUpgradeStage::CreateWorkCopy,
                error,
            )
        })?;

    on_stage(DatabaseUpgradeStage::InitializeSchema);
    run_task(db, DatabaseMaintenanceTask::InitGlobalTables).map_err(|error| {
        UpgradeFailure::during_upgrade(from_version, DatabaseUpgradeStage::InitializeSchema, error)
    })?;

    if from_version < LEGACY_SCHEMA_VERSION {
        on_stage(DatabaseUpgradeStage::LegacyDataCleanup);
        for &task in LEGACY_DATA_CLEANUP_TASKS {
            run_task(db, task).map_err(|error| {
                UpgradeFailure::during_upgrade(
                    from_version,
                    DatabaseUpgradeStage::LegacyDataCleanup,
                    error,
                )
            })?;
        }

        on_stage(DatabaseUpgradeStage::LegacySchemaMigration);
        for &task in LEGACY_SCHEMA_MIGRATION_TASKS {
            run_task(db, task).map_err(|error| {
                UpgradeFailure::during_upgrade(
                    from_version,
                    DatabaseUpgradeStage::LegacySchemaMigration,
                    error,
                )
            })?;
        }
    }

    on_stage(DatabaseUpgradeStage::PerformanceIndexes);
    run_task(db, DatabaseMaintenanceTask::AddV17PerformanceIndexes).map_err(|error| {
        UpgradeFailure::during_upgrade(
            from_version,
            DatabaseUpgradeStage::PerformanceIndexes,
            error,
        )
    })?;
    on_stage(DatabaseUpgradeStage::Optimize);
    run_task(db, DatabaseMaintenanceTask::Optimize).map_err(|error| {
        UpgradeFailure::during_upgrade(from_version, DatabaseUpgradeStage::Optimize, error)
    })?;
    on_stage(DatabaseUpgradeStage::WriteVersion);
    write_database_schema_versions(db, VRCX0_SCHEMA_VERSION).map_err(|error| {
        UpgradeFailure::during_upgrade(from_version, DatabaseUpgradeStage::WriteVersion, error)
    })?;
    on_stage(DatabaseUpgradeStage::Commit);
    db.commit_upgrade().map_err(|error| {
        UpgradeFailure::during_upgrade(from_version, DatabaseUpgradeStage::Commit, error)
    })?;

    Ok(success_result(
        DatabaseUpgradeRunStatus::Upgraded,
        from_version,
    ))
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
    let mut error = failure.error.to_string();
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

fn run_copresence_duration_repair_once(db: &DatabaseService) -> Result<(), String> {
    let done = vrcx_0_persistence::config::get_string(db, COPRESENCE_DURATION_REPAIR_KEY, "")
        .map_err(|error| error.to_string())?;
    if done == "1" {
        return Ok(());
    }

    run_task(db, DatabaseMaintenanceTask::RepairZeroCopresenceDurations)
        .map_err(|error| error.to_string())?;
    vrcx_0_persistence::config::set_string(db, COPRESENCE_DURATION_REPAIR_KEY, "1")
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn database(&self) -> DatabaseService {
            DatabaseService::new(&self.path.join("VRCX-0.sqlite3")).unwrap()
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn set_version(db: &DatabaseService, version: i64) {
        write_database_schema_versions(db, version).unwrap();
    }

    fn install_failing_repair_fixture(db: &DatabaseService) {
        database_maintenance_run(db, DatabaseMaintenanceTask::InitGlobalTables).unwrap();
        let conn = rusqlite::Connection::open(db.db_path()).unwrap();
        conn.execute_batch(
            "INSERT INTO gamelog_join_leave
                 (created_at, type, display_name, location, user_id, time)
             VALUES
                 ('2026-01-01T00:00:00Z', 'OnPlayerJoined', 'Test', 'wrld_test:1', 'usr_test', 0),
                 ('2026-01-01T00:01:00Z', 'OnPlayerLeft', 'Test', 'wrld_test:1', 'usr_test', 0);
             CREATE TRIGGER reject_copresence_repair
             BEFORE UPDATE OF time ON gamelog_join_leave
             BEGIN
                 SELECT RAISE(FAIL, 'repair should not run');
             END;",
        )
        .unwrap();
    }

    #[test]
    fn preflight_reports_current_upgrade_and_newer_spans() {
        for (version, expected) in [
            (0, DatabaseUpgradePreflightStatus::UpgradeRequired),
            (16, DatabaseUpgradePreflightStatus::UpgradeRequired),
            (17, DatabaseUpgradePreflightStatus::UpgradeRequired),
            (18, DatabaseUpgradePreflightStatus::Current),
            (19, DatabaseUpgradePreflightStatus::NewerSchema),
        ] {
            let dir = TestDir::new(&format!("database-upgrade-preflight-{version}"));
            let db = dir.database();
            if version > 0 {
                set_version(&db, version);
            }

            let preflight = database_upgrade_preflight(&db).unwrap();

            assert_eq!(preflight.status, expected);
            assert_eq!(preflight.from_version, version);
            assert_eq!(preflight.to_version, VRCX0_SCHEMA_VERSION);
        }
    }

    #[test]
    fn upgrades_every_supported_old_version_span_and_is_idempotent() {
        for version in [0, 15, 16, 17] {
            let dir = TestDir::new(&format!("database-upgrade-span-{version}"));
            let db = dir.database();
            if version > 0 {
                set_version(&db, version);
            }

            let upgraded = run_database_upgrade(&db);

            assert_eq!(upgraded.status, DatabaseUpgradeRunStatus::Upgraded);
            assert_eq!(upgraded.from_version, version);
            assert_eq!(
                prepare_vrcx0_schema_version(&db).unwrap(),
                VRCX0_SCHEMA_VERSION
            );
            assert_eq!(
                vrcx_0_persistence::config::get_string(&db, "databaseVersion", "0").unwrap(),
                VRCX0_SCHEMA_VERSION.to_string()
            );
            assert_eq!(
                vrcx_0_persistence::config::get_string(&db, COPRESENCE_DURATION_REPAIR_KEY, "")
                    .unwrap(),
                "1"
            );

            let repeated = run_database_upgrade(&db);
            assert_eq!(repeated.status, DatabaseUpgradeRunStatus::Current);
            assert_eq!(repeated.from_version, VRCX0_SCHEMA_VERSION);
        }
    }

    #[test]
    fn preserves_failed_work_copy_and_blocks_reentry() {
        let dir = TestDir::new("database-upgrade-failed-copy");
        let db = dir.database();
        set_version(&db, 17);
        vrcx_0_persistence::game_log::ensure_game_log_tables(&db).unwrap();
        let conn = rusqlite::Connection::open(db.db_path()).unwrap();
        conn.execute_batch(
            "DROP TABLE gamelog_location;
             CREATE TABLE gamelog_location (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        drop(conn);

        let failed = run_database_upgrade(&db);

        assert_eq!(failed.status, DatabaseUpgradeRunStatus::Failed);
        assert_eq!(
            failed.failed_stage,
            Some(DatabaseUpgradeStage::InitializeSchema)
        );
        let failed_upgrade = failed.failed_upgrade.expect("failed upgrade status");
        assert!(std::path::Path::new(&failed_upgrade.work_db_path).exists());
        assert!(db.is_main_mode());
        assert_eq!(prepare_vrcx0_schema_version(&db).unwrap(), 17);

        let blocked = run_database_upgrade(&db);
        assert_eq!(blocked.status, DatabaseUpgradeRunStatus::Blocked);
        assert_eq!(blocked.from_version, 17);
        assert_eq!(blocked.to_version, VRCX0_SCHEMA_VERSION);
    }

    #[test]
    fn refuses_to_modify_a_newer_schema() {
        let dir = TestDir::new("database-upgrade-newer-schema");
        let db = dir.database();
        set_version(&db, VRCX0_SCHEMA_VERSION + 1);

        let result = run_database_upgrade(&db);

        assert_eq!(result.status, DatabaseUpgradeRunStatus::NewerSchema);
        assert_eq!(
            prepare_vrcx0_schema_version(&db).unwrap(),
            VRCX0_SCHEMA_VERSION + 1
        );
        assert!(db.get_failed_upgrade().unwrap().is_none());
    }

    #[test]
    fn one_time_repair_uses_its_own_marker_and_retries_non_fatal_failures() {
        let skipped_dir = TestDir::new("database-upgrade-repair-skipped");
        let skipped_db = skipped_dir.database();
        set_version(&skipped_db, VRCX0_SCHEMA_VERSION);
        install_failing_repair_fixture(&skipped_db);
        vrcx_0_persistence::config::set_string(&skipped_db, COPRESENCE_DURATION_REPAIR_KEY, "1")
            .unwrap();

        let skipped = run_database_upgrade(&skipped_db);

        assert_eq!(skipped.status, DatabaseUpgradeRunStatus::Current);
        assert!(skipped.repair_warning.is_none());

        let retry_dir = TestDir::new("database-upgrade-repair-retry");
        let retry_db = retry_dir.database();
        set_version(&retry_db, VRCX0_SCHEMA_VERSION);
        install_failing_repair_fixture(&retry_db);

        let retry = run_database_upgrade(&retry_db);

        assert_eq!(retry.status, DatabaseUpgradeRunStatus::Current);
        assert!(retry
            .repair_warning
            .as_deref()
            .is_some_and(|warning| warning.contains("repair should not run")));
        assert_eq!(
            vrcx_0_persistence::config::get_string(&retry_db, COPRESENCE_DURATION_REPAIR_KEY, "")
                .unwrap(),
            ""
        );
    }
}
