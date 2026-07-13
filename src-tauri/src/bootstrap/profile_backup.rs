use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::Utc;
use tauri::Manager;
use vrcx_0_application::{
    prune_automatic_profile_backups, AutomaticProfileBackupCompletionIssue,
    AutomaticProfileBackupPolicy, AutomaticProfileBackupRequest, ProfileBackupJobState,
    ProfileBackupKind, TaskStopToken,
};

use crate::state::AppState;

const AUTOMATIC_PROFILE_BACKUP_JOB: &str = "profileBackupAutomatic";
const RETENTION_CLEANUP_TASK: &str = "profile-backup-retention-cleanup";
const INITIAL_DELAY: Duration = Duration::from_secs(5 * 60);
const CHECK_INTERVAL: Duration = Duration::from_secs(60);
const RETRY_DELAY: Duration = Duration::from_secs(60 * 60);
const SLEEP_CHUNK: Duration = Duration::from_secs(5);

#[derive(Default)]
struct AutomaticProfileBackupSchedulerState {
    active_backup: Option<ActiveAutomaticBackup>,
    active_cleanup: Option<ActiveRetentionCleanup>,
    retry: Option<PendingAutomaticBackupRetry>,
}

struct ActiveAutomaticBackup {
    job_id: u64,
    target_directory: PathBuf,
}

struct ActiveRetentionCleanup {
    target_directory: PathBuf,
    result: RetentionCleanupResultSlot,
}

type RetentionCleanupResultSlot = Arc<Mutex<Option<Result<usize, String>>>>;

#[derive(Clone, Debug, PartialEq, Eq)]
enum AutomaticProfileBackupRetryKind {
    FullBackup,
    RetentionCleanup { target_directory: PathBuf },
}

struct PendingAutomaticBackupRetry {
    kind: AutomaticProfileBackupRetryKind,
    not_before: Instant,
}

impl AutomaticProfileBackupSchedulerState {
    fn schedule_retry(&mut self, kind: AutomaticProfileBackupRetryKind) {
        self.retry = Some(PendingAutomaticBackupRetry {
            kind,
            not_before: Instant::now() + RETRY_DELAY,
        });
    }

    fn discard_stale_cleanup(&mut self, policy: &AutomaticProfileBackupPolicy) {
        let cleanup_target_is_current = |target: &Path| {
            policy.enabled && policy.is_configured() && target == policy.target_directory
        };
        if self.retry.as_ref().is_some_and(|retry| {
            matches!(
                &retry.kind,
                AutomaticProfileBackupRetryKind::RetentionCleanup { target_directory }
                    if !cleanup_target_is_current(target_directory)
            )
        }) {
            self.retry = None;
        }
        if self
            .active_cleanup
            .as_ref()
            .is_some_and(|cleanup| !cleanup_target_is_current(&cleanup.target_directory))
        {
            self.active_cleanup = None;
        }
    }
}

pub(super) fn start_automatic_profile_backup_scheduler(app: &tauri::AppHandle, state: &AppState) {
    let background_jobs = state.runtime_context.background_jobs.clone();
    background_jobs.register_job(
        AUTOMATIC_PROFILE_BACKUP_JOB,
        "tauri-host",
        Some(CHECK_INTERVAL.as_secs()),
        "scheduled",
        "Automatic profile backup scheduler is waiting for startup idle time.",
    );
    background_jobs.mark_scheduled(
        AUTOMATIC_PROFILE_BACKUP_JOB,
        "Automatic profile backup scheduler is waiting for startup idle time.",
        INITIAL_DELAY.as_secs(),
    );

    let app = app.clone();
    state
        .runtime_context
        .tasks
        .spawn_cancellable(move |stop_token| async move {
            if !sleep_or_stop(INITIAL_DELAY, &stop_token).await {
                return;
            }

            let mut scheduler = AutomaticProfileBackupSchedulerState::default();
            loop {
                if stop_token.is_stop_requested() {
                    return;
                }
                run_scheduler_tick(&app, &mut scheduler);
                if !sleep_or_stop(CHECK_INTERVAL, &stop_token).await {
                    return;
                }
            }
        });
}

fn run_scheduler_tick(
    app: &tauri::AppHandle,
    scheduler: &mut AutomaticProfileBackupSchedulerState,
) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let background_jobs = &state.runtime_context.background_jobs;
    let backup_status = state.runtime_context.profile_backup.status();

    if !vrcx_0_application::automatic_profile_backups_allowed(&state.paths.app_data) {
        background_jobs.mark_scheduled(
            AUTOMATIC_PROFILE_BACKUP_JOB,
            "Automatic profile backup is paused while profile restore is pending confirmation.",
            CHECK_INTERVAL.as_secs(),
        );
        return;
    }

    if let Some(active_backup) = scheduler.active_backup.take() {
        if backup_status.job_id == active_backup.job_id {
            match backup_status.state {
                ProfileBackupJobState::Running | ProfileBackupJobState::Cancelling => {
                    scheduler.active_backup = Some(active_backup);
                    background_jobs.mark_running(
                        AUTOMATIC_PROFILE_BACKUP_JOB,
                        "Automatic profile backup is running.",
                    );
                    return;
                }
                ProfileBackupJobState::Completed => {
                    if let Some(warning) = backup_status.last_error.as_deref() {
                        background_jobs.mark_failed(AUTOMATIC_PROFILE_BACKUP_JOB, warning);
                    } else {
                        background_jobs.mark_completed(
                            AUTOMATIC_PROFILE_BACKUP_JOB,
                            "Automatic profile backup completed.",
                        );
                    }
                    if let Some(retry_kind) = retry_after_terminal_backup(
                        backup_status.state,
                        backup_status.automatic_completion_issue,
                        active_backup.target_directory,
                    ) {
                        scheduler.schedule_retry(retry_kind);
                    } else {
                        scheduler.retry = None;
                    }
                }
                ProfileBackupJobState::Failed => {
                    background_jobs.mark_failed(
                        AUTOMATIC_PROFILE_BACKUP_JOB,
                        backup_status
                            .last_error
                            .as_deref()
                            .unwrap_or("Automatic profile backup failed."),
                    );
                    scheduler.schedule_retry(AutomaticProfileBackupRetryKind::FullBackup);
                }
                ProfileBackupJobState::Cancelled => {
                    background_jobs.mark_failed(
                        AUTOMATIC_PROFILE_BACKUP_JOB,
                        "Automatic profile backup was cancelled and will be retried.",
                    );
                    scheduler.schedule_retry(AutomaticProfileBackupRetryKind::FullBackup);
                }
                ProfileBackupJobState::Idle => {
                    scheduler.schedule_retry(AutomaticProfileBackupRetryKind::FullBackup);
                }
            }
        } else {
            scheduler.schedule_retry(AutomaticProfileBackupRetryKind::FullBackup);
        }
    }

    let policy = match AutomaticProfileBackupPolicy::load(state.runtime_context.config()) {
        Ok(policy) => policy,
        Err(error) => {
            background_jobs.mark_failed(AUTOMATIC_PROFILE_BACKUP_JOB, error.to_string());
            if scheduler.retry.is_none() && scheduler.active_cleanup.is_none() {
                scheduler.schedule_retry(AutomaticProfileBackupRetryKind::FullBackup);
            }
            return;
        }
    };
    scheduler.discard_stale_cleanup(&policy);
    if !policy.enabled {
        background_jobs.register_job(
            AUTOMATIC_PROFILE_BACKUP_JOB,
            "tauri-host",
            Some(CHECK_INTERVAL.as_secs()),
            "disabled",
            "Automatic profile backups are disabled.",
        );
        return;
    }
    if !policy.is_configured() {
        background_jobs.register_job(
            AUTOMATIC_PROFILE_BACKUP_JOB,
            "tauri-host",
            Some(CHECK_INTERVAL.as_secs()),
            "waiting",
            "Automatic profile backups need a backup folder.",
        );
        return;
    }

    if poll_retention_cleanup(scheduler, background_jobs) {
        return;
    }

    if let Some(retry) = scheduler.retry.as_ref() {
        if Instant::now() < retry.not_before {
            let delay = retry.not_before.saturating_duration_since(Instant::now());
            let detail = match retry.kind {
                AutomaticProfileBackupRetryKind::FullBackup => {
                    "Automatic profile backup retry is waiting."
                }
                AutomaticProfileBackupRetryKind::RetentionCleanup { .. } => {
                    "Automatic profile backup retention cleanup retry is waiting."
                }
            };
            background_jobs.mark_scheduled(
                AUTOMATIC_PROFILE_BACKUP_JOB,
                detail,
                delay.as_secs().max(1),
            );
            return;
        }

        if matches!(
            backup_status.state,
            ProfileBackupJobState::Running | ProfileBackupJobState::Cancelling
        ) {
            background_jobs.mark_scheduled(
                AUTOMATIC_PROFILE_BACKUP_JOB,
                "Automatic profile backup retry is waiting for the active backup to finish.",
                CHECK_INTERVAL.as_secs(),
            );
            return;
        }

        if let AutomaticProfileBackupRetryKind::RetentionCleanup { target_directory } = &retry.kind
        {
            if let Err(error) = state
                .host_file_access
                .ensure_write_allowed(target_directory, &state.paths)
            {
                background_jobs.mark_failed(AUTOMATIC_PROFILE_BACKUP_JOB, error.to_string());
                scheduler.schedule_retry(AutomaticProfileBackupRetryKind::RetentionCleanup {
                    target_directory: target_directory.clone(),
                });
                return;
            }
            start_retention_cleanup(
                scheduler,
                target_directory.clone(),
                policy.retention_count,
                &state.runtime_context.tasks,
            );
            background_jobs.mark_running(
                AUTOMATIC_PROFILE_BACKUP_JOB,
                "Automatic profile backup retention cleanup is running.",
            );
            return;
        }
    }

    let retrying_full_backup = scheduler
        .retry
        .as_ref()
        .is_some_and(|retry| retry.kind == AutomaticProfileBackupRetryKind::FullBackup);
    let now = Utc::now();
    if !retrying_full_backup && !policy.is_due_at(now) {
        background_jobs.mark_scheduled(
            AUTOMATIC_PROFILE_BACKUP_JOB,
            "Automatic profile backup is not due yet.",
            policy.seconds_until_due_at(now).max(1),
        );
        return;
    }
    if matches!(
        backup_status.state,
        ProfileBackupJobState::Running | ProfileBackupJobState::Cancelling
    ) {
        background_jobs.mark_scheduled(
            AUTOMATIC_PROFILE_BACKUP_JOB,
            "Automatic profile backup is waiting for the active backup to finish.",
            CHECK_INTERVAL.as_secs(),
        );
        return;
    }
    if let Err(error) = state
        .host_file_access
        .ensure_write_allowed(&policy.target_directory, &state.paths)
    {
        background_jobs.mark_failed(AUTOMATIC_PROFILE_BACKUP_JOB, error.to_string());
        scheduler.schedule_retry(AutomaticProfileBackupRetryKind::FullBackup);
        return;
    }

    let target_directory = policy.target_directory.clone();
    match state
        .runtime_context
        .profile_backup
        .start_automatic(AutomaticProfileBackupRequest {
            target_directory: policy.target_directory,
            database: state.db.clone(),
            config: state.storage.get_all(),
            app_version: app.package_info().version.to_string(),
            config_repository: state.runtime_context.config().clone(),
            retention_count: policy.retention_count,
            tasks: state.runtime_context.tasks.clone(),
        }) {
        Ok(status) => {
            scheduler.active_backup = Some(ActiveAutomaticBackup {
                job_id: status.job_id,
                target_directory,
            });
            scheduler.retry = None;
            background_jobs.mark_running(
                AUTOMATIC_PROFILE_BACKUP_JOB,
                "Automatic profile backup is running.",
            );
        }
        Err(error) => {
            if state.runtime_context.profile_backup.status().kind
                == Some(ProfileBackupKind::Automatic)
            {
                scheduler.schedule_retry(AutomaticProfileBackupRetryKind::FullBackup);
            }
            background_jobs.mark_scheduled(
                AUTOMATIC_PROFILE_BACKUP_JOB,
                format!("Automatic profile backup is waiting: {error}"),
                CHECK_INTERVAL.as_secs(),
            );
        }
    }
}

fn retry_after_terminal_backup(
    state: ProfileBackupJobState,
    issue: Option<AutomaticProfileBackupCompletionIssue>,
    target_directory: PathBuf,
) -> Option<AutomaticProfileBackupRetryKind> {
    match (state, issue) {
        (ProfileBackupJobState::Completed, None) => None,
        (
            ProfileBackupJobState::Completed,
            Some(AutomaticProfileBackupCompletionIssue::RetentionCleanupFailed),
        ) => Some(AutomaticProfileBackupRetryKind::RetentionCleanup { target_directory }),
        (ProfileBackupJobState::Completed, Some(_))
        | (ProfileBackupJobState::Failed, _)
        | (ProfileBackupJobState::Cancelled, _)
        | (ProfileBackupJobState::Idle, _) => Some(AutomaticProfileBackupRetryKind::FullBackup),
        (ProfileBackupJobState::Running | ProfileBackupJobState::Cancelling, _) => None,
    }
}

fn start_retention_cleanup(
    scheduler: &mut AutomaticProfileBackupSchedulerState,
    target_directory: PathBuf,
    retention_count: usize,
    tasks: &vrcx_0_application::TaskSupervisor,
) {
    let result = Arc::new(Mutex::new(None));
    let task_result = Arc::clone(&result);
    let task_target_directory = target_directory.clone();
    tasks.spawn_cancellable_thread(RETENTION_CLEANUP_TASK, move |stop_token| {
        if stop_token.is_stop_requested() {
            return;
        }
        let cleanup_result = run_retention_cleanup(&task_target_directory, retention_count);
        if let Ok(mut result) = task_result.lock() {
            *result = Some(cleanup_result);
        }
    });
    scheduler.retry = None;
    scheduler.active_cleanup = Some(ActiveRetentionCleanup {
        target_directory,
        result,
    });
}

fn run_retention_cleanup(target_directory: &Path, retention_count: usize) -> Result<usize, String> {
    match prune_automatic_profile_backups(target_directory, retention_count) {
        Ok(result) if result.errors.is_empty() => Ok(result.removed_count),
        Ok(result) => Err(result.errors.join("; ")),
        Err(error) => Err(error.to_string()),
    }
}

fn poll_retention_cleanup(
    scheduler: &mut AutomaticProfileBackupSchedulerState,
    background_jobs: &vrcx_0_application::RuntimeBackgroundJobs,
) -> bool {
    let Some(active_cleanup) = scheduler.active_cleanup.take() else {
        return false;
    };
    let cleanup_result = match active_cleanup.result.lock() {
        Ok(mut result) => result.take(),
        Err(error) => Some(Err(format!(
            "Automatic profile backup retention cleanup result lock failed: {error}"
        ))),
    };
    match cleanup_result {
        None => {
            scheduler.active_cleanup = Some(active_cleanup);
            background_jobs.mark_running(
                AUTOMATIC_PROFILE_BACKUP_JOB,
                "Automatic profile backup retention cleanup is running.",
            );
        }
        Some(Ok(removed_count)) => {
            scheduler.retry = None;
            background_jobs.mark_completed(
                AUTOMATIC_PROFILE_BACKUP_JOB,
                format!(
                    "Automatic profile backup retention cleanup completed; removed {removed_count} backup(s)."
                ),
            );
        }
        Some(Err(error)) => {
            background_jobs.mark_failed(AUTOMATIC_PROFILE_BACKUP_JOB, &error);
            scheduler.schedule_retry(AutomaticProfileBackupRetryKind::RetentionCleanup {
                target_directory: active_cleanup.target_directory,
            });
        }
    }
    true
}

async fn sleep_or_stop(duration: Duration, stop_token: &TaskStopToken) -> bool {
    let mut remaining = duration;
    while !remaining.is_zero() {
        if stop_token.is_stop_requested() {
            return false;
        }
        let chunk = remaining.min(SLEEP_CHUNK);
        tokio::time::sleep(chunk).await;
        remaining = remaining.saturating_sub(chunk);
    }
    !stop_token.is_stop_requested()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(target_directory: &str) -> AutomaticProfileBackupPolicy {
        AutomaticProfileBackupPolicy {
            enabled: true,
            target_directory: PathBuf::from(target_directory),
            interval_days: 7,
            retention_count: 3,
            last_success_at: Some(Utc::now()),
        }
    }

    #[test]
    fn retention_failure_retries_cleanup_without_scheduling_full_backup() {
        let retry = retry_after_terminal_backup(
            ProfileBackupJobState::Completed,
            Some(AutomaticProfileBackupCompletionIssue::RetentionCleanupFailed),
            PathBuf::from("backups"),
        );

        assert_eq!(
            retry,
            Some(AutomaticProfileBackupRetryKind::RetentionCleanup {
                target_directory: PathBuf::from("backups")
            })
        );
    }

    #[test]
    fn persistence_failure_retries_the_full_backup() {
        for issue in [
            AutomaticProfileBackupCompletionIssue::LastSuccessPersistenceFailed,
            AutomaticProfileBackupCompletionIssue::LastSuccessPersistenceAndRetentionCleanupFailed,
        ] {
            assert_eq!(
                retry_after_terminal_backup(
                    ProfileBackupJobState::Completed,
                    Some(issue),
                    PathBuf::from("backups"),
                ),
                Some(AutomaticProfileBackupRetryKind::FullBackup)
            );
        }
    }

    #[test]
    fn cleanup_retry_is_discarded_when_configuration_no_longer_matches() {
        let mut scheduler = AutomaticProfileBackupSchedulerState::default();
        scheduler.schedule_retry(AutomaticProfileBackupRetryKind::RetentionCleanup {
            target_directory: PathBuf::from("old-backups"),
        });

        scheduler.discard_stale_cleanup(&policy("new-backups"));

        assert!(scheduler.retry.is_none());
    }

    #[test]
    fn cleanup_retry_is_discarded_when_automatic_backup_is_disabled_or_unconfigured() {
        for mut configured_policy in [policy("backups"), policy("")] {
            configured_policy.enabled = !configured_policy.is_configured();
            let mut scheduler = AutomaticProfileBackupSchedulerState::default();
            scheduler.schedule_retry(AutomaticProfileBackupRetryKind::RetentionCleanup {
                target_directory: PathBuf::from("backups"),
            });

            scheduler.discard_stale_cleanup(&configured_policy);

            assert!(scheduler.retry.is_none());
        }
    }

    #[test]
    fn cleanup_failure_is_delayed_again_and_success_clears_retry() {
        let background_jobs = vrcx_0_application::RuntimeBackgroundJobs::new();
        let target_directory = PathBuf::from("backups");
        let mut scheduler = AutomaticProfileBackupSchedulerState {
            active_cleanup: Some(ActiveRetentionCleanup {
                target_directory: target_directory.clone(),
                result: Arc::new(Mutex::new(Some(Err("cleanup failed".into())))),
            }),
            ..Default::default()
        };

        assert!(poll_retention_cleanup(&mut scheduler, &background_jobs));
        assert!(scheduler.retry.as_ref().is_some_and(|retry| {
            retry.kind
                == AutomaticProfileBackupRetryKind::RetentionCleanup {
                    target_directory: target_directory.clone(),
                }
                && retry.not_before > Instant::now()
        }));

        scheduler.active_cleanup = Some(ActiveRetentionCleanup {
            target_directory,
            result: Arc::new(Mutex::new(Some(Ok(1)))),
        });
        assert!(poll_retention_cleanup(&mut scheduler, &background_jobs));
        assert!(scheduler.retry.is_none());
    }

    #[test]
    fn full_backup_retry_survives_directory_changes() {
        let mut scheduler = AutomaticProfileBackupSchedulerState::default();
        scheduler.schedule_retry(AutomaticProfileBackupRetryKind::FullBackup);

        scheduler.discard_stale_cleanup(&policy("new-backups"));

        assert!(scheduler
            .retry
            .is_some_and(|retry| { retry.kind == AutomaticProfileBackupRetryKind::FullBackup }));
    }
}
