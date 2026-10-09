use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use vrcx_0_application_core::{
    DatabaseCheckpointKind, DatabaseCheckpointResult, DatabaseMaintenancePort,
    RuntimeOperationStatus,
};
use vrcx_0_persistence::{DatabaseService, WalCheckpointResult};

use super::RuntimeHostState;

struct RuntimeDatabaseMaintenanceAdapter {
    db: Arc<DatabaseService>,
    cache_dir: Option<PathBuf>,
}

const DATABASE_MAINTENANCE_CACHE_DIR: &str = "database-maintenance";
const DATABASE_CHECKPOINT_LAST_ATTEMPT_FILE: &str = "wal-checkpoint-last-attempt.txt";
const DATABASE_WAL_TRUNCATE_LAST_ATTEMPT_FILE: &str = "wal-truncate-last-attempt.txt";

fn checkpoint_attempt_file(kind: DatabaseCheckpointKind) -> &'static str {
    match kind {
        DatabaseCheckpointKind::WalWriteBack => DATABASE_CHECKPOINT_LAST_ATTEMPT_FILE,
        DatabaseCheckpointKind::WalTruncate => DATABASE_WAL_TRUNCATE_LAST_ATTEMPT_FILE,
    }
}

fn map_checkpoint_result(result: WalCheckpointResult) -> DatabaseCheckpointResult {
    DatabaseCheckpointResult {
        busy: result.busy,
        log_frames: result.log_frames,
        checkpointed_frames: result.checkpointed_frames,
    }
}

impl DatabaseMaintenancePort for RuntimeDatabaseMaintenanceAdapter {
    fn optimize(&self) -> vrcx_0_application_core::Result<()> {
        vrcx_0_persistence::optimize_database(self.db.as_ref())
            .map(|_| ())
            .map_err(Into::into)
    }

    fn checkpoint_wal_passive(&self) -> vrcx_0_application_core::Result<DatabaseCheckpointResult> {
        self.db
            .checkpoint_wal_passive()
            .map(map_checkpoint_result)
            .map_err(Into::into)
    }

    fn truncate_wal(&self) -> vrcx_0_application_core::Result<DatabaseCheckpointResult> {
        self.db
            .truncate_wal()
            .map(map_checkpoint_result)
            .map_err(Into::into)
    }

    fn last_checkpoint_attempt_at(&self, kind: DatabaseCheckpointKind) -> Option<String> {
        let path = self
            .cache_dir
            .as_ref()?
            .join(DATABASE_MAINTENANCE_CACHE_DIR)
            .join(checkpoint_attempt_file(kind));
        match fs::read_to_string(&path) {
            Ok(value) => Some(value),
            Err(error) if error.kind() == ErrorKind::NotFound => None,
            Err(error) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %error,
                    "failed to read database maintenance cache"
                );
                None
            }
        }
    }

    fn record_checkpoint_attempt_at(&self, kind: DatabaseCheckpointKind, attempted_at: String) {
        let Some(cache_dir) = &self.cache_dir else {
            return;
        };
        let cache_dir = cache_dir.join(DATABASE_MAINTENANCE_CACHE_DIR);
        let path = cache_dir.join(checkpoint_attempt_file(kind));
        if let Err(error) =
            fs::create_dir_all(&cache_dir).and_then(|()| fs::write(&path, attempted_at))
        {
            tracing::warn!(
                path = %path.display(),
                error = %error,
                "failed to write database maintenance cache"
            );
        }
    }
}

impl RuntimeHostState {
    pub fn release_profile_lock(&self) {
        self._profile_lock.release();
    }

    pub fn start_data_services(&self) {
        if self.data_services_started.swap(true, Ordering::AcqRel) {
            return;
        }
        self.runtime_context
            .runtime
            .set_host_services_started(true, "Runtime host services installed.");
        self.runtime_context
            .background_jobs
            .register_frontend_job_catalog();
        self.runtime_context.background_jobs.register_job(
            "startupRecovery",
            "rust-host",
            None,
            RuntimeOperationStatus::Checkpoint,
            "Rust runtime startup recovery checkpoint recorded; no durable recovery queue is configured.",
        );
        self.runtime_context.runtime.record_phase(
            "startupRecovery",
            RuntimeOperationStatus::Checkpoint,
            "Rust runtime startup recovery checkpoint recorded; no durable recovery queue is configured.",
        );
        self.runtime_context.sync.record(
            "startupRecovery",
            RuntimeOperationStatus::Observed,
            "Rust runtime startup recovery checkpoint recorded; no durable recovery queue is configured.",
            0,
        );
        let database_maintenance: Arc<dyn DatabaseMaintenancePort> =
            Arc::new(RuntimeDatabaseMaintenanceAdapter {
                db: Arc::clone(&self.db),
                cache_dir: self.database_maintenance_cache_dir.clone(),
            });
        self.runtime_context
            .background_jobs
            .start_database_optimize_loop(
                Arc::clone(&database_maintenance),
                self.runtime_context.tasks.clone(),
            );
        self.runtime_context
            .background_jobs
            .start_database_checkpoint_loop(
                Arc::clone(&database_maintenance),
                self.runtime_context.tasks.clone(),
            );
        self.runtime_context
            .background_jobs
            .start_database_wal_truncate_loop(
                database_maintenance,
                self.runtime_context.tasks.clone(),
            );
        self.runtime_context
            .vrc_status
            .start_loop(self.runtime_context.tasks.clone());
        self.profile_backup.start_scheduler();
    }
}

#[cfg(test)]
mod tests {
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
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn database_maintenance_attempt_times_use_the_injected_cache_directory() {
        let dir = TestDir::new("database-maintenance-cache");
        let cache_dir = dir.path.join("tauri-cache");
        let adapter = RuntimeDatabaseMaintenanceAdapter {
            db: Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap()),
            cache_dir: Some(cache_dir.clone()),
        };

        assert_eq!(
            adapter.last_checkpoint_attempt_at(DatabaseCheckpointKind::WalWriteBack),
            None
        );
        adapter.record_checkpoint_attempt_at(
            DatabaseCheckpointKind::WalWriteBack,
            "2026-08-23T12:00:00Z".into(),
        );
        adapter.record_checkpoint_attempt_at(
            DatabaseCheckpointKind::WalTruncate,
            "2026-08-01T12:00:00Z".into(),
        );

        assert_eq!(
            adapter
                .last_checkpoint_attempt_at(DatabaseCheckpointKind::WalWriteBack)
                .as_deref(),
            Some("2026-08-23T12:00:00Z")
        );
        assert_eq!(
            adapter
                .last_checkpoint_attempt_at(DatabaseCheckpointKind::WalTruncate)
                .as_deref(),
            Some("2026-08-01T12:00:00Z")
        );
        assert!(cache_dir.join(DATABASE_MAINTENANCE_CACHE_DIR).is_dir());
    }
}
