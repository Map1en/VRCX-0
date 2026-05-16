use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{Duration as ChronoDuration, SecondsFormat, Utc};
use serde::Serialize;
use vrcx_0_persistence::database::DatabaseService;

use super::task_runtime::BackendTasks;

const DATABASE_OPTIMIZE_JOB: &str = "databaseOptimize";
const DATABASE_OPTIMIZE_INITIAL_DELAY_SECONDS: u64 = 3_600;
const DATABASE_OPTIMIZE_INTERVAL_SECONDS: u64 = 86_400;

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn future_iso(seconds: u64) -> String {
    (Utc::now() + ChronoDuration::seconds(seconds as i64))
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendBackgroundJobSnapshot {
    pub name: String,
    pub owner: String,
    pub status: String,
    pub cadence_seconds: Option<u64>,
    pub last_started_at: Option<String>,
    pub last_finished_at: Option<String>,
    pub next_run_at: Option<String>,
    pub last_detail: String,
    pub last_error: Option<String>,
    pub failure_count: u64,
}

#[derive(Clone, Default)]
pub struct BackendBackgroundJobs {
    inner: Arc<Mutex<BTreeMap<String, BackendBackgroundJobSnapshot>>>,
    frontend_schedules: Arc<Mutex<BTreeMap<String, FrontendMaintenanceSchedule>>>,
    frontend_last_tick: Arc<Mutex<Option<Instant>>>,
    database_optimize_started: Arc<AtomicBool>,
}

#[derive(Clone, Debug)]
struct FrontendMaintenanceSchedule {
    cadence_seconds: u64,
    initial_delay_seconds: u64,
    remaining_seconds: i64,
    last_checked: Option<Instant>,
}

#[derive(Default)]
struct JobStatusTiming {
    started_at: Option<String>,
    finished_at: Option<String>,
    next_run_at: Option<String>,
}

impl BackendBackgroundJobs {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_job(
        &self,
        name: impl Into<String>,
        owner: impl Into<String>,
        cadence_seconds: Option<u64>,
        status: impl Into<String>,
        detail: impl Into<String>,
    ) {
        let name = name.into();
        let owner = owner.into();
        let status = status.into();
        let detail = detail.into();
        match self.inner.lock() {
            Ok(mut jobs) => {
                jobs.entry(name.clone())
                    .and_modify(|job| {
                        job.owner = owner.clone();
                        job.cadence_seconds = cadence_seconds;
                        job.status = status.clone();
                        job.last_detail = detail.clone();
                        if job.next_run_at.is_none() {
                            job.next_run_at = cadence_seconds.map(future_iso);
                        }
                    })
                    .or_insert_with(|| BackendBackgroundJobSnapshot {
                        name,
                        owner,
                        status,
                        cadence_seconds,
                        last_started_at: None,
                        last_finished_at: None,
                        next_run_at: cadence_seconds.map(future_iso),
                        last_detail: detail,
                        last_error: None,
                        failure_count: 0,
                    });
            }
            Err(error) => tracing::warn!("failed to lock backend background jobs: {error}"),
        }
    }

    pub fn register_frontend_job_catalog(&self) {
        for (name, cadence_seconds, initial_delay_seconds, detail) in [
            (
                "friendsRefresh",
                Some(3_600),
                3_600,
                "Friend and favorite refresh is scheduled by Rust and executed by the authenticated frontend runtime.",
            ),
            (
                "groupInstanceRefresh",
                Some(300),
                0,
                "Group instance refresh is scheduled by Rust and executed by the authenticated frontend runtime.",
            ),
            (
                "moderationRefresh",
                Some(3_600),
                3_600,
                "Moderation snapshot refresh is scheduled by Rust and executed by the authenticated frontend runtime.",
            ),
            (
                "appUpdateCheck",
                Some(10_800),
                10_800,
                "Update checks are scheduled by Rust and executed by frontend maintenance because they surface UI notifications.",
            ),
            (
                "clearVRCXCacheCheck",
                Some(86_400),
                86_400,
                "Frontend memory/cache cleanup is scheduled by Rust and executed by the frontend runtime.",
            ),
            (
                "discordUpdate",
                Some(3),
                0,
                "Discord presence is scheduled by Rust and executed by the authenticated frontend runtime.",
            ),
            (
                "autoStateChange",
                Some(3),
                0,
                "Presence automation is scheduled by Rust and executed by the authenticated frontend runtime.",
            ),
            (
                "startupMaintenance",
                None,
                0,
                "Startup maintenance is initiated by the frontend bootstrap because it may open UI.",
            ),
        ] {
            self.register_job(name, "frontend", cadence_seconds, "scheduled", detail);
            if let Some(cadence_seconds) = cadence_seconds {
                self.register_frontend_schedule(name, cadence_seconds, initial_delay_seconds);
            }
        }
    }

    fn update_frontend_schedule_due(
        schedule: &mut FrontendMaintenanceSchedule,
        now: Instant,
    ) -> bool {
        let elapsed_seconds = schedule
            .last_checked
            .map(|last_checked| now.saturating_duration_since(last_checked).as_secs())
            .unwrap_or(0) as i64;
        schedule.last_checked = Some(now);
        if elapsed_seconds > 0 {
            schedule.remaining_seconds = schedule.remaining_seconds.saturating_sub(elapsed_seconds);
        }
        if schedule.remaining_seconds <= 0 {
            schedule.remaining_seconds = schedule.cadence_seconds as i64;
            return true;
        }
        false
    }

    pub fn due_frontend_jobs(&self) -> Vec<String> {
        let now = Instant::now();
        let mut due = Vec::new();
        let mut scheduled = Vec::new();
        match self.frontend_schedules.lock() {
            Ok(mut schedules) => {
                for (name, schedule) in schedules.iter_mut() {
                    if Self::update_frontend_schedule_due(schedule, now) {
                        due.push(name.clone());
                        scheduled.push((name.clone(), schedule.cadence_seconds));
                    }
                }
            }
            Err(error) => tracing::warn!("failed to lock frontend maintenance schedules: {error}"),
        }

        for (name, cadence_seconds) in scheduled {
            self.mark_scheduled(
                &name,
                "Next Rust-scheduled frontend maintenance run is waiting.",
                cadence_seconds,
            );
        }
        due
    }

    pub fn claim_frontend_job_due(
        &self,
        name: &str,
        cadence_seconds: u64,
        initial_delay_seconds: u64,
    ) -> bool {
        let name = name.trim();
        if name.is_empty() || cadence_seconds == 0 {
            return false;
        }

        let now = Instant::now();
        let due = match self.frontend_schedules.lock() {
            Ok(mut schedules) => {
                let schedule = schedules.entry(name.to_string()).or_insert_with(|| {
                    FrontendMaintenanceSchedule {
                        cadence_seconds,
                        initial_delay_seconds,
                        remaining_seconds: initial_delay_seconds as i64,
                        last_checked: None,
                    }
                });
                schedule.cadence_seconds = cadence_seconds;
                schedule.initial_delay_seconds = initial_delay_seconds;
                Self::update_frontend_schedule_due(schedule, now)
            }
            Err(error) => {
                tracing::warn!("failed to lock frontend maintenance schedules: {error}");
                false
            }
        };
        if due {
            self.mark_scheduled(
                name,
                "Next claimed Rust-scheduled frontend maintenance run is waiting.",
                cadence_seconds,
            );
        }
        due
    }

    pub fn defer_frontend_job(&self, name: &str, delay_seconds: u64) -> bool {
        let name = name.trim();
        if name.is_empty() {
            return false;
        }

        let updated = match self.frontend_schedules.lock() {
            Ok(mut schedules) => {
                let Some(schedule) = schedules.get_mut(name) else {
                    return false;
                };
                schedule.remaining_seconds = delay_seconds as i64;
                schedule.last_checked = Some(Instant::now());
                true
            }
            Err(error) => {
                tracing::warn!("failed to lock frontend maintenance schedules: {error}");
                false
            }
        };
        if updated {
            self.mark_scheduled(
                name,
                format!("Rust maintenance scheduler deferred {name}."),
                delay_seconds,
            );
        }
        updated
    }

    pub fn reset_frontend_schedules(&self) {
        match self.frontend_schedules.lock() {
            Ok(mut schedules) => {
                for schedule in schedules.values_mut() {
                    schedule.remaining_seconds = schedule.initial_delay_seconds as i64;
                    schedule.last_checked = None;
                }
            }
            Err(error) => tracing::warn!("failed to lock frontend maintenance schedules: {error}"),
        }
        if let Ok(mut last_tick) = self.frontend_last_tick.lock() {
            *last_tick = None;
        }
    }

    fn register_frontend_schedule(
        &self,
        name: &str,
        cadence_seconds: u64,
        initial_delay_seconds: u64,
    ) {
        match self.frontend_schedules.lock() {
            Ok(mut schedules) => {
                schedules
                    .entry(name.to_string())
                    .or_insert_with(|| FrontendMaintenanceSchedule {
                        cadence_seconds,
                        initial_delay_seconds,
                        remaining_seconds: initial_delay_seconds as i64,
                        last_checked: None,
                    });
            }
            Err(error) => tracing::warn!("failed to lock frontend maintenance schedules: {error}"),
        }
    }

    pub fn mark_running(&self, name: &str, detail: impl Into<String>) {
        self.upsert_status(
            name,
            "running",
            JobStatusTiming {
                started_at: Some(now_iso()),
                ..Default::default()
            },
            detail,
            false,
        );
    }

    pub fn mark_completed(&self, name: &str, detail: impl Into<String>) {
        self.upsert_status(
            name,
            "idle",
            JobStatusTiming {
                finished_at: Some(now_iso()),
                ..Default::default()
            },
            detail,
            false,
        );
    }

    pub fn mark_failed(&self, name: &str, detail: impl Into<String>) {
        self.upsert_status(
            name,
            "error",
            JobStatusTiming {
                finished_at: Some(now_iso()),
                ..Default::default()
            },
            detail,
            true,
        );
    }

    pub fn mark_scheduled(&self, name: &str, detail: impl Into<String>, delay_seconds: u64) {
        self.upsert_status(
            name,
            "scheduled",
            JobStatusTiming {
                next_run_at: Some(future_iso(delay_seconds)),
                ..Default::default()
            },
            detail,
            false,
        );
    }

    pub fn snapshot(&self) -> Vec<BackendBackgroundJobSnapshot> {
        match self.inner.lock() {
            Ok(jobs) => jobs.values().cloned().collect(),
            Err(error) => {
                tracing::warn!("failed to lock backend background jobs: {error}");
                Vec::new()
            }
        }
    }

    pub fn start_database_optimize_loop(&self, db: Arc<DatabaseService>, tasks: BackendTasks) {
        if self.database_optimize_started.swap(true, Ordering::AcqRel) {
            self.register_job(
                DATABASE_OPTIMIZE_JOB,
                "rust",
                Some(DATABASE_OPTIMIZE_INTERVAL_SECONDS),
                "scheduled",
                "Scheduled PRAGMA optimize loop is already active.",
            );
            return;
        }

        self.register_job(
            DATABASE_OPTIMIZE_JOB,
            "rust",
            Some(DATABASE_OPTIMIZE_INTERVAL_SECONDS),
            "scheduled",
            "Scheduled PRAGMA optimize is owned by the Rust backend.",
        );

        let jobs = self.clone();
        tasks.spawn(async move {
            jobs.mark_scheduled(
                DATABASE_OPTIMIZE_JOB,
                "Initial PRAGMA optimize is waiting for startup idle time.",
                DATABASE_OPTIMIZE_INITIAL_DELAY_SECONDS,
            );
            tokio::time::sleep(Duration::from_secs(DATABASE_OPTIMIZE_INITIAL_DELAY_SECONDS)).await;
            loop {
                jobs.mark_running(DATABASE_OPTIMIZE_JOB, "Running PRAGMA optimize.");
                let db_for_task = Arc::clone(&db);
                match tokio::task::spawn_blocking(move || {
                    db_for_task.execute_non_query("PRAGMA optimize", &Default::default())
                })
                .await
                {
                    Ok(Ok(_)) => {
                        jobs.mark_completed(DATABASE_OPTIMIZE_JOB, "PRAGMA optimize finished.")
                    }
                    Ok(Err(error)) => {
                        tracing::warn!("backend database optimize failed: {error}");
                        jobs.mark_failed(DATABASE_OPTIMIZE_JOB, error.to_string());
                    }
                    Err(error) => {
                        tracing::warn!("backend database optimize task failed: {error}");
                        jobs.mark_failed(DATABASE_OPTIMIZE_JOB, error.to_string());
                    }
                }
                jobs.mark_scheduled(
                    DATABASE_OPTIMIZE_JOB,
                    "Next PRAGMA optimize run is scheduled.",
                    DATABASE_OPTIMIZE_INTERVAL_SECONDS,
                );
                tokio::time::sleep(Duration::from_secs(DATABASE_OPTIMIZE_INTERVAL_SECONDS)).await;
            }
        });
    }

    fn upsert_status(
        &self,
        name: &str,
        status: &str,
        timing: JobStatusTiming,
        detail: impl Into<String>,
        failed: bool,
    ) {
        let detail = detail.into();
        match self.inner.lock() {
            Ok(mut jobs) => {
                let job =
                    jobs.entry(name.to_string())
                        .or_insert_with(|| BackendBackgroundJobSnapshot {
                            name: name.to_string(),
                            owner: "rust".into(),
                            status: status.to_string(),
                            cadence_seconds: None,
                            last_started_at: None,
                            last_finished_at: None,
                            next_run_at: None,
                            last_detail: String::new(),
                            last_error: None,
                            failure_count: 0,
                        });
                job.status = status.to_string();
                if let Some(started_at) = timing.started_at {
                    job.last_started_at = Some(started_at);
                }
                if let Some(finished_at) = timing.finished_at {
                    job.last_finished_at = Some(finished_at);
                }
                if let Some(next_run_at) = timing.next_run_at {
                    job.next_run_at = Some(next_run_at);
                } else if status == "idle" || status == "error" {
                    if job.next_run_at.is_none() {
                        job.next_run_at = job.cadence_seconds.map(future_iso);
                    }
                } else if status == "running" {
                    job.next_run_at = None;
                }
                job.last_detail = detail;
                if failed {
                    job.last_error = Some(job.last_detail.clone());
                    job.failure_count = job.failure_count.saturating_add(1);
                } else if status == "running" || status == "idle" {
                    job.last_error = None;
                }
            }
            Err(error) => tracing::warn!("failed to lock backend background jobs: {error}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_job_failure_records_last_error_and_retry_state() {
        let jobs = BackendBackgroundJobs::new();
        jobs.register_job("sync", "rust", Some(60), "scheduled", "waiting");
        jobs.mark_failed("sync", "network failed");

        let failed = jobs
            .snapshot()
            .into_iter()
            .find(|job| job.name == "sync")
            .unwrap();
        assert_eq!(failed.status, "error");
        assert_eq!(failed.last_error.as_deref(), Some("network failed"));
        assert_eq!(failed.failure_count, 1);
        assert!(failed.next_run_at.is_some());

        jobs.mark_running("sync", "retrying");
        let retrying = jobs
            .snapshot()
            .into_iter()
            .find(|job| job.name == "sync")
            .unwrap();
        assert_eq!(retrying.status, "running");
        assert!(retrying.last_error.is_none());
        assert!(retrying.next_run_at.is_none());
    }
}
