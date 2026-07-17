#[cfg(panic = "unwind")]
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

use vrcx_0_persistence::{DatabaseService, VRCX0_SCHEMA_VERSION};

use crate::database_upgrade::{
    database_upgrade_preflight, run_database_upgrade_with_progress, DatabaseUpgradePreflight,
    DatabaseUpgradePreflightStatus, DatabaseUpgradeRunResult, DatabaseUpgradeRunStatus,
    DatabaseUpgradeStage,
};
use crate::{Error, RuntimeBackgroundJobs, RuntimeDiagnostics};

const COMMAND: &str = "app__database_upgrade_run";
const JOB: &str = "databaseUpgrade";

#[derive(Clone)]
pub struct DatabaseUpgradeRuntime {
    db: Arc<DatabaseService>,
    shared: Arc<DatabaseUpgradeRuntimeShared>,
    diagnostics: RuntimeDiagnostics,
    background_jobs: RuntimeBackgroundJobs,
}

struct DatabaseUpgradeRuntimeShared {
    state: Mutex<DatabaseUpgradeRuntimeState>,
    changed: Condvar,
}

enum DatabaseUpgradeRuntimeState {
    Idle,
    Running {
        from_version: i64,
        to_version: i64,
        stage: DatabaseUpgradeStage,
    },
    Finished(DatabaseUpgradeRunResult),
}

impl DatabaseUpgradeRuntime {
    pub fn new(
        db: Arc<DatabaseService>,
        diagnostics: RuntimeDiagnostics,
        background_jobs: RuntimeBackgroundJobs,
    ) -> Self {
        Self {
            db,
            shared: Arc::new(DatabaseUpgradeRuntimeShared {
                state: Mutex::new(DatabaseUpgradeRuntimeState::Idle),
                changed: Condvar::new(),
            }),
            diagnostics,
            background_jobs,
        }
    }

    pub fn preflight(&self) -> Result<DatabaseUpgradePreflight, Error> {
        let state = self.lock_state();
        match &*state {
            DatabaseUpgradeRuntimeState::Idle => database_upgrade_preflight(&self.db),
            DatabaseUpgradeRuntimeState::Running {
                from_version,
                to_version,
                stage,
            } => Ok(DatabaseUpgradePreflight {
                status: DatabaseUpgradePreflightStatus::Running,
                from_version: *from_version,
                to_version: *to_version,
                stage: Some(*stage),
                result: None,
                failed_upgrade: None,
            }),
            DatabaseUpgradeRuntimeState::Finished(result) => Ok(DatabaseUpgradePreflight {
                status: DatabaseUpgradePreflightStatus::Finished,
                from_version: result.from_version,
                to_version: result.to_version,
                stage: result.failed_stage,
                result: Some(result.clone()),
                failed_upgrade: result.failed_upgrade.clone(),
            }),
        }
    }

    pub fn run(&self) -> DatabaseUpgradeRunResult {
        self.run_with(|db, on_stage| run_database_upgrade_with_progress(db, on_stage))
    }

    fn run_with(
        &self,
        execute: impl FnOnce(
            &DatabaseService,
            &mut dyn FnMut(DatabaseUpgradeStage),
        ) -> DatabaseUpgradeRunResult,
    ) -> DatabaseUpgradeRunResult {
        let (from_version, to_version) = loop {
            let mut state = self.lock_state();
            match &*state {
                DatabaseUpgradeRuntimeState::Idle => {
                    let (from_version, to_version) = database_upgrade_preflight(&self.db)
                        .map(|preflight| (preflight.from_version, preflight.to_version))
                        .unwrap_or((0, VRCX0_SCHEMA_VERSION));
                    *state = DatabaseUpgradeRuntimeState::Running {
                        from_version,
                        to_version,
                        stage: DatabaseUpgradeStage::Preflight,
                    };
                    break (from_version, to_version);
                }
                DatabaseUpgradeRuntimeState::Running { .. } => {
                    state = self
                        .shared
                        .changed
                        .wait(state)
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    drop(state);
                }
                DatabaseUpgradeRuntimeState::Finished(result) => return result.clone(),
            }
        };

        self.record_running();
        #[cfg(panic = "abort")]
        let _ = (from_version, to_version);
        #[cfg(panic = "unwind")]
        let mut current_stage = DatabaseUpgradeStage::Preflight;
        let mut on_stage = |next_stage| {
            #[cfg(panic = "unwind")]
            {
                current_stage = next_stage;
            }
            self.set_stage(next_stage);
        };
        #[cfg(panic = "unwind")]
        let result = match catch_unwind(AssertUnwindSafe(|| execute(&self.db, &mut on_stage))) {
            Ok(result) => result,
            Err(_) => self.recover_unwind(from_version, to_version, current_stage),
        };
        #[cfg(panic = "abort")]
        let result = execute(&self.db, &mut on_stage);

        let mut state = self.lock_state();
        *state = DatabaseUpgradeRuntimeState::Finished(result.clone());
        self.shared.changed.notify_all();
        drop(state);
        self.record_result(&result);
        result
    }

    fn set_stage(&self, stage: DatabaseUpgradeStage) {
        let mut state = self.lock_state();
        if let DatabaseUpgradeRuntimeState::Running {
            stage: current_stage,
            ..
        } = &mut *state
        {
            *current_stage = stage;
        }
    }

    #[cfg(panic = "unwind")]
    fn recover_unwind(
        &self,
        from_version: i64,
        to_version: i64,
        stage: DatabaseUpgradeStage,
    ) -> DatabaseUpgradeRunResult {
        let mut error = "Database upgrade runtime panicked.".to_string();
        if let Err(recovery_error) = self.db.fail_upgrade(error.clone()) {
            error = format!("{error} Failed to preserve the work database: {recovery_error}");
        }
        let failed_upgrade = match self.db.get_failed_upgrade() {
            Ok(status) => status,
            Err(status_error) => {
                error = format!("{error} Failed to read database upgrade status: {status_error}");
                None
            }
        };
        DatabaseUpgradeRunResult {
            status: DatabaseUpgradeRunStatus::Failed,
            from_version,
            to_version,
            failed_stage: Some(stage),
            error: Some(error),
            failed_upgrade,
            repair_warning: None,
        }
    }

    fn record_running(&self) {
        self.diagnostics.record_command(
            COMMAND,
            "running",
            "Running database upgrade orchestration.",
        );
        self.background_jobs.register_job(
            JOB,
            "rust-runtime",
            None,
            "running",
            "Running database upgrade orchestration.",
        );
    }

    fn record_result(&self, result: &DatabaseUpgradeRunResult) {
        match result.status {
            DatabaseUpgradeRunStatus::Current | DatabaseUpgradeRunStatus::Upgraded => {
                self.diagnostics.record_command(
                    COMMAND,
                    "ok",
                    format!(
                        "status={:?}, from={}, to={}",
                        result.status, result.from_version, result.to_version
                    ),
                );
                self.background_jobs.mark_completed(
                    JOB,
                    format!(
                        "Database upgrade orchestration finished with status {:?}.",
                        result.status
                    ),
                );
            }
            _ => {
                let detail = result.error.clone().unwrap_or_else(|| {
                    format!("Database upgrade stopped with status {:?}.", result.status)
                });
                self.diagnostics
                    .record_command(COMMAND, "error", detail.clone());
                self.background_jobs.mark_failed(JOB, detail);
            }
        }
    }

    fn lock_state(&self) -> MutexGuard<'_, DatabaseUpgradeRuntimeState> {
        self.shared
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::mpsc;

    use super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-database-upgrade-runtime-{}-{nonce}",
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

    fn success_result() -> DatabaseUpgradeRunResult {
        DatabaseUpgradeRunResult {
            status: DatabaseUpgradeRunStatus::Upgraded,
            from_version: 17,
            to_version: VRCX0_SCHEMA_VERSION,
            failed_stage: None,
            error: None,
            failed_upgrade: None,
            repair_warning: None,
        }
    }

    #[test]
    fn rebuilt_frontend_observes_and_joins_the_active_run() {
        let dir = TestDir::new();
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
        let background_jobs = RuntimeBackgroundJobs::new();
        let runtime =
            DatabaseUpgradeRuntime::new(db, RuntimeDiagnostics::new(), background_jobs.clone());
        let leader_runtime = runtime.clone();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let leader = std::thread::spawn(move || {
            leader_runtime.run_with(|_, on_stage| {
                on_stage(DatabaseUpgradeStage::Optimize);
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                success_result()
            })
        });
        started_rx.recv().unwrap();

        let preflight = runtime.preflight().unwrap();
        assert_eq!(preflight.status, DatabaseUpgradePreflightStatus::Running);
        assert_eq!(preflight.stage, Some(DatabaseUpgradeStage::Optimize));

        let waiter_runtime = runtime.clone();
        let waiter = std::thread::spawn(move || waiter_runtime.run());
        release_tx.send(()).unwrap();

        assert_eq!(
            leader.join().unwrap().status,
            DatabaseUpgradeRunStatus::Upgraded
        );
        assert_eq!(
            waiter.join().unwrap().status,
            DatabaseUpgradeRunStatus::Upgraded
        );
        let finished = runtime.preflight().unwrap();
        assert_eq!(finished.status, DatabaseUpgradePreflightStatus::Finished);
        assert_eq!(
            finished.result.unwrap().status,
            DatabaseUpgradeRunStatus::Upgraded
        );
        let job = background_jobs
            .snapshot()
            .into_iter()
            .find(|job| job.name == JOB)
            .expect("database upgrade background job");
        assert_eq!(job.status, "idle");
        assert!(job.last_finished_at.is_some());
        assert!(job.last_detail.contains("Upgraded"));
    }
}
