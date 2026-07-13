use std::cell::Cell;
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

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AutomaticProfileBackupCompletionIssue {
    LastSuccessPersistenceFailed,
    RetentionCleanupFailed,
    LastSuccessPersistenceAndRetentionCleanupFailed,
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
    pub cancel_allowed: bool,
    pub cancel_requested: bool,
    pub started_at: Option<String>,
    pub updated_at: Option<String>,
    pub finished_at: Option<String>,
    pub result: Option<ProfileBackupResult>,
    pub last_error: Option<String>,
    pub automatic_completion_issue: Option<AutomaticProfileBackupCompletionIssue>,
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

struct AutomaticProfileBackupCompletion {
    issue: Option<AutomaticProfileBackupCompletionIssue>,
    warning: Option<String>,
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
            cancel_allowed: true,
            cancel_requested: false,
            started_at: Some(now.clone()),
            updated_at: Some(now),
            finished_at: None,
            result: None,
            last_error: None,
            automatic_completion_issue: None,
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
            if !inner.status.cancel_allowed {
                return Ok(inner.status.clone());
            }
            if let Some(cancel_flag) = &inner.cancel_flag {
                cancel_flag.store(true, Ordering::Release);
            }
            inner.status.state = ProfileBackupJobState::Cancelling;
            inner.status.cancel_allowed = false;
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

        let publish_started = Cell::new(false);
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
            || {
                let control = self.begin_publish(
                    job.job_id,
                    &job.cancel_flag,
                    stop_token.is_stop_requested(),
                );
                if control == ProfileBackupControl::Continue {
                    publish_started.set(true);
                }
                control
            },
        );

        match result {
            Ok(artifact) => {
                let completion = job
                    .automatic
                    .as_ref()
                    .map(|automatic| complete_automatic_backup(&artifact, automatic))
                    .unwrap_or(AutomaticProfileBackupCompletion {
                        issue: None,
                        warning: None,
                    });
                self.finish_completed(job.job_id, artifact, completion);
            }
            Err(_)
                if !publish_started.get()
                    && (job.cancel_flag.load(Ordering::Acquire)
                        || stop_token.is_stop_requested()) =>
            {
                self.finish_cancelled(job.job_id)
            }
            Err(error) => self.finish_failed(job.job_id, error),
        }
    }

    fn begin_publish(
        &self,
        job_id: u64,
        cancel_flag: &AtomicBool,
        stop_requested: bool,
    ) -> ProfileBackupControl {
        let status = {
            let Ok(mut inner) = self.inner.lock() else {
                return ProfileBackupControl::Cancel;
            };
            if inner.status.job_id != job_id
                || inner.status.state != ProfileBackupJobState::Running
                || !inner.status.cancel_allowed
                || cancel_flag.load(Ordering::Acquire)
                || stop_requested
            {
                return ProfileBackupControl::Cancel;
            }
            inner.status.cancel_allowed = false;
            inner.status.progress = Some(ProfileBackupProgress {
                stage: ProfileBackupStage::Publishing,
                completed: 0,
                total: 1,
            });
            inner.status.updated_at = Some(now_iso());
            inner.last_emitted_stage = Some(ProfileBackupStage::Publishing);
            inner.last_emitted_percent = Some(0);
            inner.status.clone()
        };
        self.emit_status(status);
        ProfileBackupControl::Continue
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
        completion: AutomaticProfileBackupCompletion,
    ) {
        let result = ProfileBackupResult {
            path: artifact.path.to_string_lossy().into_owned(),
            manifest: artifact.manifest,
        };
        self.finish(
            job_id,
            ProfileBackupJobState::Completed,
            Some(result),
            completion.warning,
            completion.issue,
        );
    }

    fn finish_cancelled(&self, job_id: u64) {
        self.finish(job_id, ProfileBackupJobState::Cancelled, None, None, None);
    }

    fn finish_failed(&self, job_id: u64, error: Error) {
        self.finish(
            job_id,
            ProfileBackupJobState::Failed,
            None,
            Some(error.to_string()),
            None,
        );
    }

    fn finish(
        &self,
        job_id: u64,
        state: ProfileBackupJobState,
        result: Option<ProfileBackupResult>,
        last_error: Option<String>,
        automatic_completion_issue: Option<AutomaticProfileBackupCompletionIssue>,
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
            inner.status.cancel_allowed = false;
            inner.status.updated_at = Some(now.clone());
            inner.status.finished_at = Some(now);
            inner.status.result = result;
            inner.status.last_error = last_error;
            inner.status.automatic_completion_issue = automatic_completion_issue;
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
) -> AutomaticProfileBackupCompletion {
    let mut errors = Vec::new();
    let persistence_failed = if let Err(error) = automatic.config_repository.set_string(
        PROFILE_BACKUP_LAST_AUTOMATIC_AT_CONFIG_KEY,
        &artifact.manifest.created_at,
    ) {
        errors.push(format!(
            "Automatic backup was created, but its completion time could not be saved: {error}"
        ));
        true
    } else {
        false
    };
    let retention_failed = match prune_automatic_profile_backups(
        artifact.path.parent().unwrap_or_else(|| Path::new(".")),
        automatic.retention_count,
    ) {
        Ok(retention) => {
            let failed = !retention.errors.is_empty();
            errors.extend(retention.errors);
            failed
        }
        Err(error) => {
            errors.push(format!(
                "Automatic backup was created, but retention cleanup failed: {error}"
            ));
            true
        }
    };
    let issue = automatic_completion_issue(persistence_failed, retention_failed);
    AutomaticProfileBackupCompletion {
        issue,
        warning: (!errors.is_empty()).then(|| errors.join("; ")),
    }
}

fn automatic_completion_issue(
    persistence_failed: bool,
    retention_failed: bool,
) -> Option<AutomaticProfileBackupCompletionIssue> {
    match (persistence_failed, retention_failed) {
        (true, true) => Some(
            AutomaticProfileBackupCompletionIssue::LastSuccessPersistenceAndRetentionCleanupFailed,
        ),
        (true, false) => Some(AutomaticProfileBackupCompletionIssue::LastSuccessPersistenceFailed),
        (false, true) => Some(AutomaticProfileBackupCompletionIssue::RetentionCleanupFailed),
        (false, false) => None,
    }
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
        cancel_allowed: false,
        cancel_requested: false,
        started_at: None,
        updated_at: None,
        finished_at: None,
        result: None,
        last_error: None,
        automatic_completion_issue: None,
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
    use serde_json::Value;
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::time::{Duration, Instant};

    struct BlockingPublishSink {
        publishing: Sender<()>,
        release: Mutex<Receiver<()>>,
    }

    impl crate::RuntimeEventSink for BlockingPublishSink {
        fn emit(&self, event: &str, payload: Value) {
            if event == PROFILE_BACKUP_JOB_STATUS_EVENT
                && payload.get("state").and_then(Value::as_str) == Some("running")
                && payload.get("cancelAllowed").and_then(Value::as_bool) == Some(false)
                && payload
                    .get("progress")
                    .and_then(|progress| progress.get("stage"))
                    .and_then(Value::as_str)
                    == Some("publishing")
                && payload
                    .get("progress")
                    .and_then(|progress| progress.get("completed"))
                    .and_then(Value::as_u64)
                    == Some(0)
            {
                self.publishing.send(()).unwrap();
                self.release.lock().unwrap().recv().unwrap();
            }
        }
    }

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

    fn prepare_running_job(runtime: &ProfileBackupRuntime, job_id: u64) -> Arc<AtomicBool> {
        let cancel_flag = Arc::new(AtomicBool::new(false));
        let mut inner = runtime.inner.lock().unwrap();
        inner.status = idle_status();
        inner.status.job_id = job_id;
        inner.status.state = ProfileBackupJobState::Running;
        inner.status.kind = Some(ProfileBackupKind::Manual);
        inner.status.cancel_allowed = true;
        inner.cancel_flag = Some(Arc::clone(&cancel_flag));
        cancel_flag
    }

    #[test]
    fn cancellation_wins_publish_gate_when_it_acquires_runtime_lock_first() {
        let runtime = ProfileBackupRuntime::default();
        let cancel_flag = prepare_running_job(&runtime, 41);

        let cancelling = runtime.cancel(41).unwrap();
        let publish = runtime.begin_publish(41, &cancel_flag, false);

        assert_eq!(cancelling.state, ProfileBackupJobState::Cancelling);
        assert!(!cancelling.cancel_allowed);
        assert_eq!(publish, ProfileBackupControl::Cancel);
    }

    #[test]
    fn publish_gate_makes_later_cancellation_a_no_op() {
        let runtime = ProfileBackupRuntime::default();
        let cancel_flag = prepare_running_job(&runtime, 42);

        let publish = runtime.begin_publish(42, &cancel_flag, false);
        let after_cancel = runtime.cancel(42).unwrap();

        assert_eq!(publish, ProfileBackupControl::Continue);
        assert_eq!(after_cancel.state, ProfileBackupJobState::Running);
        assert!(!after_cancel.cancel_allowed);
        assert!(!after_cancel.cancel_requested);
        assert!(!cancel_flag.load(Ordering::Acquire));
    }

    #[test]
    fn cancellation_after_publish_gate_completes_with_final_file() {
        let dir = TestDir::new("publish-then-cancel");
        let backup_dir = dir.path.join("backups");
        std::fs::create_dir(&backup_dir).unwrap();
        let (publishing_sender, publishing_receiver) = mpsc::channel();
        let (release_sender, release_receiver) = mpsc::channel();
        let event_bus = RuntimeEventBus::new();
        event_bus.set_sink(BlockingPublishSink {
            publishing: publishing_sender,
            release: Mutex::new(release_receiver),
        });
        let runtime = ProfileBackupRuntime::new(event_bus);
        let started = runtime
            .start_manual(
                backup_dir,
                database(&dir.path.join("VRCX-0.sqlite3"), false),
                HashMap::new(),
                "2.12.1".into(),
                TaskSupervisor::new(),
            )
            .unwrap();
        publishing_receiver
            .recv_timeout(Duration::from_secs(10))
            .unwrap();

        let after_cancel = runtime.cancel(started.job_id).unwrap();
        assert_eq!(after_cancel.state, ProfileBackupJobState::Running);
        assert!(!after_cancel.cancel_allowed);
        release_sender.send(()).unwrap();

        let finished = wait_for_terminal(&runtime);
        assert_eq!(finished.state, ProfileBackupJobState::Completed);
        assert!(finished
            .result
            .as_ref()
            .is_some_and(|result| PathBuf::from(&result.path).is_file()));
    }

    #[test]
    fn automatic_completion_issues_preserve_failure_category() {
        assert_eq!(
            automatic_completion_issue(true, false),
            Some(AutomaticProfileBackupCompletionIssue::LastSuccessPersistenceFailed)
        );
        assert_eq!(
            automatic_completion_issue(false, true),
            Some(AutomaticProfileBackupCompletionIssue::RetentionCleanupFailed)
        );
        assert_eq!(
            automatic_completion_issue(true, true),
            Some(
                AutomaticProfileBackupCompletionIssue::LastSuccessPersistenceAndRetentionCleanupFailed
            )
        );
        assert_eq!(automatic_completion_issue(false, false), None);
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
