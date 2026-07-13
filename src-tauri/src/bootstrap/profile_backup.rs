use std::time::{Duration, Instant};

use chrono::Utc;
use tauri::Manager;
use vrcx_0_application::{
    AutomaticProfileBackupPolicy, AutomaticProfileBackupRequest, ProfileBackupJobState,
    ProfileBackupKind, TaskStopToken,
};

use crate::state::AppState;

const AUTOMATIC_PROFILE_BACKUP_JOB: &str = "profileBackupAutomatic";
const INITIAL_DELAY: Duration = Duration::from_secs(5 * 60);
const CHECK_INTERVAL: Duration = Duration::from_secs(60);
const RETRY_DELAY: Duration = Duration::from_secs(60 * 60);
const SLEEP_CHUNK: Duration = Duration::from_secs(5);

#[derive(Default)]
struct AutomaticProfileBackupSchedulerState {
    active_job_id: Option<u64>,
    retry_not_before: Option<Instant>,
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

    if let Some(active_job_id) = scheduler.active_job_id {
        if backup_status.job_id == active_job_id {
            match backup_status.state {
                ProfileBackupJobState::Running | ProfileBackupJobState::Cancelling => {
                    background_jobs.mark_running(
                        AUTOMATIC_PROFILE_BACKUP_JOB,
                        "Automatic profile backup is running.",
                    );
                    return;
                }
                ProfileBackupJobState::Completed => {
                    if let Some(warning) = backup_status.last_error.as_deref() {
                        background_jobs.mark_failed(AUTOMATIC_PROFILE_BACKUP_JOB, warning);
                        scheduler.retry_not_before = Some(Instant::now() + RETRY_DELAY);
                    } else {
                        background_jobs.mark_completed(
                            AUTOMATIC_PROFILE_BACKUP_JOB,
                            "Automatic profile backup completed.",
                        );
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
                    scheduler.retry_not_before = Some(Instant::now() + RETRY_DELAY);
                }
                ProfileBackupJobState::Cancelled => {
                    background_jobs.mark_completed(
                        AUTOMATIC_PROFILE_BACKUP_JOB,
                        "Automatic profile backup was cancelled.",
                    );
                    scheduler.retry_not_before = Some(Instant::now() + RETRY_DELAY);
                }
                ProfileBackupJobState::Idle => {}
            }
        }
        scheduler.active_job_id = None;
    }

    let policy = match AutomaticProfileBackupPolicy::load(state.runtime_context.config()) {
        Ok(policy) => policy,
        Err(error) => {
            background_jobs.mark_failed(AUTOMATIC_PROFILE_BACKUP_JOB, error.to_string());
            scheduler.retry_not_before = Some(Instant::now() + RETRY_DELAY);
            return;
        }
    };
    if !policy.enabled {
        scheduler.retry_not_before = None;
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
    let now = Utc::now();
    if !policy.is_due_at(now) {
        background_jobs.mark_scheduled(
            AUTOMATIC_PROFILE_BACKUP_JOB,
            "Automatic profile backup is not due yet.",
            policy.seconds_until_due_at(now).max(1),
        );
        return;
    }
    if scheduler
        .retry_not_before
        .is_some_and(|retry_not_before| Instant::now() < retry_not_before)
    {
        let delay = scheduler
            .retry_not_before
            .map(|retry_not_before| retry_not_before.saturating_duration_since(Instant::now()))
            .unwrap_or(RETRY_DELAY);
        background_jobs.mark_scheduled(
            AUTOMATIC_PROFILE_BACKUP_JOB,
            "Automatic profile backup retry is waiting.",
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
        scheduler.retry_not_before = Some(Instant::now() + RETRY_DELAY);
        return;
    }

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
            scheduler.active_job_id = Some(status.job_id);
            scheduler.retry_not_before = None;
            background_jobs.mark_running(
                AUTOMATIC_PROFILE_BACKUP_JOB,
                "Automatic profile backup is running.",
            );
        }
        Err(error) => {
            if state.runtime_context.profile_backup.status().kind
                == Some(ProfileBackupKind::Automatic)
            {
                scheduler.retry_not_before = Some(Instant::now() + RETRY_DELAY);
            }
            background_jobs.mark_scheduled(
                AUTOMATIC_PROFILE_BACKUP_JOB,
                format!("Automatic profile backup is waiting: {error}"),
                CHECK_INTERVAL.as_secs(),
            );
        }
    }
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
