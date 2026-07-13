use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use vrcx_0_persistence::{config::ConfigRepository, DatabaseService};

use crate::{
    create_profile_backup, prune_automatic_profile_backups, Error, ProfileBackupArtifact,
    ProfileBackupControl, ProfileBackupKind, ProfileBackupManifest, ProfileBackupProgress,
    ProfileBackupRequest, ProfileBackupStage, Result, RuntimeEventBus, TaskStopToken,
    TaskSupervisor, PROFILE_BACKUP_LAST_AUTOMATIC_AT_CONFIG_KEY,
};

pub const PROFILE_BACKUP_JOB_STATUS_EVENT: &str = "profileBackupJobStatus";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileBackupJobState {
    Idle,
    Running,
    Cancelling,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupResult {
    pub path: String,
    pub manifest: ProfileBackupManifest,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupJobStatus {
    pub job_id: u64,
    pub state: ProfileBackupJobState,
    pub kind: Option<ProfileBackupKind>,
    pub progress: Option<ProfileBackupProgress>,
    pub cancel_requested: bool,
    pub started_at: Option<String>,
    pub updated_at: Option<String>,
    pub finished_at: Option<String>,
    pub result: Option<ProfileBackupResult>,
    pub last_error: Option<String>,
}

#[derive(Clone)]
pub struct ProfileBackupRuntime {
    inner: Arc<Mutex<ProfileBackupRuntimeInner>>,
    next_job_id: Arc<AtomicU64>,
    event_bus: RuntimeEventBus,
}

struct ProfileBackupRuntimeInner {
    status: ProfileBackupJobStatus,
    cancel_flag: Option<Arc<AtomicBool>>,
    last_emitted_stage: Option<ProfileBackupStage>,
    last_emitted_percent: Option<u64>,
}

struct ProfileBackupJob {
    job_id: u64,
    kind: ProfileBackupKind,
    target_directory: PathBuf,
    database: Arc<DatabaseService>,
    config: HashMap<String, String>,
    app_version: String,
    cancel_flag: Arc<AtomicBool>,
    automatic: Option<AutomaticProfileBackupJob>,
}

struct AutomaticProfileBackupJob {
    config_repository: ConfigRepository,
    retention_count: usize,
}

pub struct AutomaticProfileBackupRequest {
    pub target_directory: PathBuf,
    pub database: Arc<DatabaseService>,
    pub config: HashMap<String, String>,
    pub app_version: String,
    pub config_repository: ConfigRepository,
    pub retention_count: usize,
    pub tasks: TaskSupervisor,
}

impl ProfileBackupRuntime {
    pub fn new(event_bus: RuntimeEventBus) -> Self {
        Self {
            inner: Arc::new(Mutex::new(ProfileBackupRuntimeInner {
                status: idle_status(),
                cancel_flag: None,
                last_emitted_stage: None,
                last_emitted_percent: None,
            })),
            next_job_id: Arc::new(AtomicU64::new(1)),
            event_bus,
        }
    }

    pub fn status(&self) -> ProfileBackupJobStatus {
        self.inner
            .lock()
            .map(|inner| inner.status.clone())
            .unwrap_or_else(|_| idle_status())
    }

    pub fn start_manual(
        &self,
        target_directory: PathBuf,
        database: Arc<DatabaseService>,
        config: HashMap<String, String>,
        app_version: String,
        tasks: TaskSupervisor,
    ) -> Result<ProfileBackupJobStatus> {
        self.start_job(
            ProfileBackupKind::Manual,
            target_directory,
            database,
            config,
            app_version,
            None,
            "profile-backup-manual",
            tasks,
        )
    }

    pub fn start_automatic(
        &self,
        request: AutomaticProfileBackupRequest,
    ) -> Result<ProfileBackupJobStatus> {
        self.start_job(
            ProfileBackupKind::Automatic,
            request.target_directory,
            request.database,
            request.config,
            request.app_version,
            Some(AutomaticProfileBackupJob {
                config_repository: request.config_repository,
                retention_count: request.retention_count,
            }),
            "profile-backup-automatic",
            request.tasks,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn start_job(
        &self,
        kind: ProfileBackupKind,
        target_directory: PathBuf,
        database: Arc<DatabaseService>,
        config: HashMap<String, String>,
        app_version: String,
        automatic: Option<AutomaticProfileBackupJob>,
        task_name: &'static str,
        tasks: TaskSupervisor,
    ) -> Result<ProfileBackupJobStatus> {
        let job_id = self.next_job_id.fetch_add(1, Ordering::AcqRel);
        let cancel_flag = Arc::new(AtomicBool::new(false));
        let now = now_iso();
        let status = ProfileBackupJobStatus {
            job_id,
            state: ProfileBackupJobState::Running,
            kind: Some(kind),
            progress: None,
            cancel_requested: false,
            started_at: Some(now.clone()),
            updated_at: Some(now),
            finished_at: None,
            result: None,
            last_error: None,
        };

        {
            let mut inner = self.inner.lock().map_err(lock_error)?;
            if is_active(inner.status.state) {
                return Err(Error::Custom(
                    "A profile backup or restore job is already running.".into(),
                ));
            }
            inner.status = status.clone();
            inner.cancel_flag = Some(Arc::clone(&cancel_flag));
            inner.last_emitted_stage = None;
            inner.last_emitted_percent = None;
        }
        self.emit_status(status.clone());

        let runtime = self.clone();
        tasks.spawn_cancellable_thread(task_name, move |stop_token| {
            runtime.run_job(
                ProfileBackupJob {
                    job_id,
                    kind,
                    target_directory,
                    database,
                    config,
                    app_version,
                    cancel_flag,
                    automatic,
                },
                stop_token,
            );
        });

        Ok(status)
    }

    pub fn cancel(&self, job_id: u64) -> Result<ProfileBackupJobStatus> {
        let status = {
            let mut inner = self.inner.lock().map_err(lock_error)?;
            if !is_active(inner.status.state) {
                return Ok(inner.status.clone());
            }
            if inner.status.job_id != job_id {
                return Err(Error::Custom(format!(
                    "Profile backup job {job_id} is not active."
                )));
            }
            if let Some(cancel_flag) = &inner.cancel_flag {
                cancel_flag.store(true, Ordering::Release);
            }
            inner.status.state = ProfileBackupJobState::Cancelling;
            inner.status.cancel_requested = true;
            inner.status.updated_at = Some(now_iso());
            inner.status.clone()
        };
        self.emit_status(status.clone());
        Ok(status)
    }

    fn run_job(&self, job: ProfileBackupJob, stop_token: TaskStopToken) {
        if job.cancel_flag.load(Ordering::Acquire) || stop_token.is_stop_requested() {
            self.finish_cancelled(job.job_id);
            return;
        }

        let result = create_profile_backup(
            ProfileBackupRequest {
                database: job.database.as_ref(),
                config: &job.config,
                target_directory: &job.target_directory,
                created_at: Utc::now(),
                app_version: &job.app_version,
                kind: job.kind,
            },
            |progress| {
                if job.cancel_flag.load(Ordering::Acquire) || stop_token.is_stop_requested() {
                    return ProfileBackupControl::Cancel;
                }
                self.update_progress(job.job_id, progress);
                ProfileBackupControl::Continue
            },
        );

        match result {
            Ok(artifact) => {
                let warning = job
                    .automatic
                    .as_ref()
                    .and_then(|automatic| complete_automatic_backup(&artifact, automatic));
                self.finish_completed(job.job_id, artifact, warning);
            }
            Err(_) if job.cancel_flag.load(Ordering::Acquire) || stop_token.is_stop_requested() => {
                self.finish_cancelled(job.job_id)
            }
            Err(error) => self.finish_failed(job.job_id, error),
        }
    }

    fn update_progress(&self, job_id: u64, progress: ProfileBackupProgress) {
        let status_to_emit = {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            if inner.status.job_id != job_id || !is_active(inner.status.state) {
                return;
            }
            let progress = inner
                .status
                .progress
                .map(|previous| normalize_progress(previous, progress))
                .unwrap_or(progress);
            inner.status.progress = Some(progress);
            inner.status.updated_at = Some(now_iso());

            let percent = progress_percent(progress);
            let should_emit = inner.last_emitted_stage != Some(progress.stage)
                || inner.last_emitted_percent != Some(percent);
            if !should_emit {
                return;
            }
            inner.last_emitted_stage = Some(progress.stage);
            inner.last_emitted_percent = Some(percent);
            Some(inner.status.clone())
        };
        if let Some(status) = status_to_emit {
            self.emit_status(status);
        }
    }

    fn finish_completed(
        &self,
        job_id: u64,
        artifact: ProfileBackupArtifact,
        warning: Option<String>,
    ) {
        let result = ProfileBackupResult {
            path: artifact.path.to_string_lossy().into_owned(),
            manifest: artifact.manifest,
        };
        self.finish(
            job_id,
            ProfileBackupJobState::Completed,
            Some(result),
            warning,
        );
    }

    fn finish_cancelled(&self, job_id: u64) {
        self.finish(job_id, ProfileBackupJobState::Cancelled, None, None);
    }

    fn finish_failed(&self, job_id: u64, error: Error) {
        self.finish(
            job_id,
            ProfileBackupJobState::Failed,
            None,
            Some(error.to_string()),
        );
    }

    fn finish(
        &self,
        job_id: u64,
        state: ProfileBackupJobState,
        result: Option<ProfileBackupResult>,
        last_error: Option<String>,
    ) {
        let status = {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            if inner.status.job_id != job_id {
                return;
            }
            let now = now_iso();
            inner.status.state = state;
            inner.status.updated_at = Some(now.clone());
            inner.status.finished_at = Some(now);
            inner.status.result = result;
            inner.status.last_error = last_error;
            inner.cancel_flag = None;
            inner.status.clone()
        };
        self.emit_status(status);
    }

    fn emit_status(&self, status: ProfileBackupJobStatus) {
        self.event_bus.emit(PROFILE_BACKUP_JOB_STATUS_EVENT, status);
    }
}

fn complete_automatic_backup(
    artifact: &ProfileBackupArtifact,
    automatic: &AutomaticProfileBackupJob,
) -> Option<String> {
    let mut errors = Vec::new();
    if let Err(error) = automatic.config_repository.set_string(
        PROFILE_BACKUP_LAST_AUTOMATIC_AT_CONFIG_KEY,
        &artifact.manifest.created_at,
    ) {
        errors.push(format!(
            "Automatic backup was created, but its completion time could not be saved: {error}"
        ));
    }
    match prune_automatic_profile_backups(
        artifact.path.parent().unwrap_or_else(|| Path::new(".")),
        automatic.retention_count,
    ) {
        Ok(retention) => errors.extend(retention.errors),
        Err(error) => errors.push(format!(
            "Automatic backup was created, but retention cleanup failed: {error}"
        )),
    }
    (!errors.is_empty()).then(|| errors.join("; "))
}

impl Default for ProfileBackupRuntime {
    fn default() -> Self {
        Self::new(RuntimeEventBus::new())
    }
}

fn idle_status() -> ProfileBackupJobStatus {
    ProfileBackupJobStatus {
        job_id: 0,
        state: ProfileBackupJobState::Idle,
        kind: None,
        progress: None,
        cancel_requested: false,
        started_at: None,
        updated_at: None,
        finished_at: None,
        result: None,
        last_error: None,
    }
}

fn is_active(state: ProfileBackupJobState) -> bool {
    matches!(
        state,
        ProfileBackupJobState::Running | ProfileBackupJobState::Cancelling
    )
}

fn progress_percent(progress: ProfileBackupProgress) -> u64 {
    if progress.total == 0 {
        return 0;
    }
    progress.completed.saturating_mul(100) / progress.total
}

fn normalize_progress(
    previous: ProfileBackupProgress,
    current: ProfileBackupProgress,
) -> ProfileBackupProgress {
    let previous_stage = stage_rank(previous.stage);
    let current_stage = stage_rank(current.stage);
    if current_stage < previous_stage {
        return previous;
    }
    if current_stage > previous_stage {
        return current;
    }

    let total = previous.total.max(current.total);
    let proportional_floor = if previous.total == 0 {
        0
    } else {
        let numerator = u128::from(previous.completed) * u128::from(total);
        let denominator = u128::from(previous.total);
        u64::try_from(numerator.div_ceil(denominator)).unwrap_or(u64::MAX)
    };
    let completed = current
        .completed
        .max(previous.completed)
        .max(proportional_floor);
    ProfileBackupProgress {
        stage: current.stage,
        completed: if total == 0 {
            completed
        } else {
            completed.min(total)
        },
        total,
    }
}

fn stage_rank(stage: ProfileBackupStage) -> usize {
    match stage {
        ProfileBackupStage::DatabaseSnapshot => 0,
        ProfileBackupStage::Hashing => 1,
        ProfileBackupStage::Packaging => 2,
        ProfileBackupStage::Validating => 3,
        ProfileBackupStage::Publishing => 4,
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn lock_error(
    error: std::sync::PoisonError<std::sync::MutexGuard<'_, ProfileBackupRuntimeInner>>,
) -> Error {
    Error::Custom(format!("profile backup job lock poisoned: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-profile-backup-job-{name}-{}-{nonce}",
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

    fn database(path: &std::path::Path, large: bool) -> Arc<DatabaseService> {
        let db = Arc::new(DatabaseService::new(path).unwrap());
        vrcx_0_persistence::config::set_string(db.as_ref(), "VRCX_0_databaseVersion", "18")
            .unwrap();
        if large {
            vrcx_0_persistence::config::set_string(
                db.as_ref(),
                "profileBackupJobLargeFixture",
                &"x".repeat(6 * 1024 * 1024),
            )
            .unwrap();
        }
        db
    }

    fn wait_for_terminal(runtime: &ProfileBackupRuntime) -> ProfileBackupJobStatus {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let status = runtime.status();
            if !is_active(status.state) {
                return status;
            }
            assert!(Instant::now() < deadline, "profile backup job timed out");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn manual_job_completes_and_emits_queryable_progress() {
        let dir = TestDir::new("complete");
        let backup_dir = dir.path.join("backups");
        std::fs::create_dir(&backup_dir).unwrap();
        let event_bus = RuntimeEventBus::new();
        let runtime = ProfileBackupRuntime::new(event_bus.clone());

        let started = runtime
            .start_manual(
                backup_dir,
                database(&dir.path.join("VRCX-0.sqlite3"), false),
                HashMap::from([("VRCX_CloseToTray".into(), "true".into())]),
                "2.12.1".into(),
                TaskSupervisor::new(),
            )
            .unwrap();
        assert_eq!(started.state, ProfileBackupJobState::Running);

        let finished = wait_for_terminal(&runtime);
        assert_eq!(finished.state, ProfileBackupJobState::Completed);
        assert!(finished
            .result
            .as_ref()
            .is_some_and(|result| PathBuf::from(&result.path).is_file()));
        let progress_updates = event_bus
            .take_events_for_test()
            .into_iter()
            .filter(|event| event.name == PROFILE_BACKUP_JOB_STATUS_EVENT)
            .filter_map(|event| {
                serde_json::from_value::<ProfileBackupJobStatus>(event.payload)
                    .ok()?
                    .progress
            })
            .collect::<Vec<_>>();
        assert!(!progress_updates.is_empty());
        for pair in progress_updates.windows(2) {
            let previous = pair[0];
            let current = pair[1];
            let previous_stage = stage_rank(previous.stage);
            let current_stage = stage_rank(current.stage);
            assert!(current_stage >= previous_stage);
            if current_stage == previous_stage {
                assert!(current.completed >= previous.completed);
            }
        }
    }

    #[test]
    fn concurrent_job_is_rejected() {
        let dir = TestDir::new("concurrent");
        let backup_dir = dir.path.join("backups");
        std::fs::create_dir(&backup_dir).unwrap();
        let runtime = ProfileBackupRuntime::default();
        let tasks = TaskSupervisor::new();
        runtime
            .start_manual(
                backup_dir.clone(),
                database(&dir.path.join("VRCX-0.sqlite3"), true),
                HashMap::new(),
                "2.12.1".into(),
                tasks.clone(),
            )
            .unwrap();

        let other_database = database(&dir.path.join("other.sqlite3"), false);
        let second = runtime.start_automatic(AutomaticProfileBackupRequest {
            target_directory: backup_dir,
            database: Arc::clone(&other_database),
            config: HashMap::new(),
            app_version: "2.12.1".into(),
            config_repository: ConfigRepository::new(other_database),
            retention_count: 3,
            tasks,
        });
        assert!(second.is_err());
        wait_for_terminal(&runtime);
    }

    #[test]
    fn cancellation_reaches_terminal_state_without_publishing_file() {
        let dir = TestDir::new("cancel");
        let backup_dir = dir.path.join("backups");
        std::fs::create_dir(&backup_dir).unwrap();
        let runtime = ProfileBackupRuntime::default();
        let started = runtime
            .start_manual(
                backup_dir.clone(),
                database(&dir.path.join("VRCX-0.sqlite3"), true),
                HashMap::new(),
                "2.12.1".into(),
                TaskSupervisor::new(),
            )
            .unwrap();

        let cancelling = runtime.cancel(started.job_id).unwrap();
        assert_eq!(cancelling.state, ProfileBackupJobState::Cancelling);
        let finished = wait_for_terminal(&runtime);
        assert_eq!(finished.state, ProfileBackupJobState::Cancelled);
        assert!(std::fs::read_dir(backup_dir).unwrap().next().is_none());
    }

    #[test]
    fn invalid_target_finishes_with_structured_failure() {
        let dir = TestDir::new("invalid-target");
        let runtime = ProfileBackupRuntime::default();
        runtime
            .start_manual(
                dir.path.join("missing"),
                database(&dir.path.join("VRCX-0.sqlite3"), false),
                HashMap::new(),
                "2.12.1".into(),
                TaskSupervisor::new(),
            )
            .unwrap();

        let finished = wait_for_terminal(&runtime);
        assert_eq!(finished.state, ProfileBackupJobState::Failed);
        assert!(finished.last_error.is_some());
        assert!(finished.result.is_none());
    }

    #[test]
    fn automatic_job_records_kind_and_success_time() {
        let dir = TestDir::new("automatic");
        let backup_dir = dir.path.join("backups");
        std::fs::create_dir(&backup_dir).unwrap();
        let db = database(&dir.path.join("VRCX-0.sqlite3"), false);
        let config_repository = ConfigRepository::new(Arc::clone(&db));
        let runtime = ProfileBackupRuntime::default();

        runtime
            .start_automatic(AutomaticProfileBackupRequest {
                target_directory: backup_dir,
                database: db,
                config: HashMap::new(),
                app_version: "2.12.1".into(),
                config_repository: config_repository.clone(),
                retention_count: 3,
                tasks: TaskSupervisor::new(),
            })
            .unwrap();

        let finished = wait_for_terminal(&runtime);
        assert_eq!(finished.state, ProfileBackupJobState::Completed);
        assert_eq!(finished.kind, Some(ProfileBackupKind::Automatic));
        assert_eq!(
            finished
                .result
                .as_ref()
                .map(|result| result.manifest.backup_kind),
            Some(ProfileBackupKind::Automatic)
        );
        assert_eq!(
            config_repository
                .get_string(PROFILE_BACKUP_LAST_AUTOMATIC_AT_CONFIG_KEY, "")
                .unwrap(),
            finished
                .result
                .as_ref()
                .map(|result| result.manifest.created_at.clone())
                .unwrap()
        );
    }

    #[test]
    fn progress_normalization_prevents_backup_restart_regression() {
        let previous = ProfileBackupProgress {
            stage: ProfileBackupStage::DatabaseSnapshot,
            completed: 75,
            total: 100,
        };
        let restarted = ProfileBackupProgress {
            stage: ProfileBackupStage::DatabaseSnapshot,
            completed: 20,
            total: 120,
        };

        let normalized = normalize_progress(previous, restarted);
        assert_eq!(normalized.completed, 90);
        assert_eq!(normalized.total, 120);
        assert_eq!(progress_percent(normalized), 75);
    }
}
