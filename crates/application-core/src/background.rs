use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::task_supervisor::{TaskStopToken, TaskSupervisor};
use chrono::{Duration as ChronoDuration, Utc};
use serde::Serialize;
use vrcx_0_core::time::{iso_millis, now_iso};
use vrcx_0_persistence::DatabaseService;

const DATABASE_OPTIMIZE_JOB: &str = "databaseOptimize";
const DATABASE_OPTIMIZE_INITIAL_DELAY_SECONDS: u64 = 3_600;
const DATABASE_OPTIMIZE_INTERVAL_SECONDS: u64 = 86_400;
const CANCELLABLE_SLEEP_CHUNK_SECONDS: u64 = 5;

pub async fn sleep_until_due_or_stopped(total: Duration, stop_token: &TaskStopToken) -> bool {
    let mut remaining = total;
    while !remaining.is_zero() {
        if stop_token.is_stop_requested() {
            return false;
        }
        let chunk = remaining.min(Duration::from_secs(CANCELLABLE_SLEEP_CHUNK_SECONDS));
        tokio::time::sleep(chunk).await;
        remaining = remaining.saturating_sub(chunk);
    }
    !stop_token.is_stop_requested()
}

fn future_iso(seconds: u64) -> String {
    iso_millis(Utc::now() + ChronoDuration::seconds(seconds as i64))
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBackgroundJobSnapshot {
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
pub struct RuntimeBackgroundJobs {
    inner: Arc<Mutex<BTreeMap<String, RuntimeBackgroundJobSnapshot>>>,
    database_optimize_started: Arc<AtomicBool>,
}

#[derive(Default)]
struct JobStatusTiming {
    started_at: Option<String>,
    finished_at: Option<String>,
    next_run_at: Option<String>,
}

impl RuntimeBackgroundJobs {
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
                    .or_insert_with(|| RuntimeBackgroundJobSnapshot {
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
            Err(error) => tracing::warn!("failed to lock runtime background jobs: {error}"),
        }
    }

    pub fn register_frontend_job_catalog(&self) {
        self.register_job(
            "startupMaintenance",
            "frontend",
            None,
            "scheduled",
            "Startup maintenance is initiated by the frontend bootstrap because it may open UI.",
        );
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

    pub fn snapshot(&self) -> Vec<RuntimeBackgroundJobSnapshot> {
        match self.inner.lock() {
            Ok(jobs) => jobs.values().cloned().collect(),
            Err(error) => {
                tracing::warn!("failed to lock runtime background jobs: {error}");
                Vec::new()
            }
        }
    }

    pub fn start_database_optimize_loop(&self, db: Arc<DatabaseService>, tasks: TaskSupervisor) {
        if !tasks.has_executor() {
            self.register_job(
                DATABASE_OPTIMIZE_JOB,
                "rust",
                Some(DATABASE_OPTIMIZE_INTERVAL_SECONDS),
                "unavailable",
                "Scheduled PRAGMA optimize needs a host task executor.",
            );
            return;
        }

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
            "Scheduled PRAGMA optimize is owned by the Rust runtime.",
        );

        let jobs = self.clone();
        tasks.spawn_cancellable(move |stop_token| async move {
            jobs.mark_scheduled(
                DATABASE_OPTIMIZE_JOB,
                "Initial PRAGMA optimize is waiting for startup idle time.",
                DATABASE_OPTIMIZE_INITIAL_DELAY_SECONDS,
            );
            if !sleep_until_due_or_stopped(
                Duration::from_secs(DATABASE_OPTIMIZE_INITIAL_DELAY_SECONDS),
                &stop_token,
            )
            .await
            {
                jobs.mark_scheduled(
                    DATABASE_OPTIMIZE_JOB,
                    "Scheduled PRAGMA optimize loop stopped.",
                    DATABASE_OPTIMIZE_INTERVAL_SECONDS,
                );
                return;
            }
            loop {
                if stop_token.is_stop_requested() {
                    jobs.mark_scheduled(
                        DATABASE_OPTIMIZE_JOB,
                        "Scheduled PRAGMA optimize loop stopped.",
                        DATABASE_OPTIMIZE_INTERVAL_SECONDS,
                    );
                    return;
                }
                jobs.mark_running(DATABASE_OPTIMIZE_JOB, "Running PRAGMA optimize.");
                let db_for_task = Arc::clone(&db);
                match tokio::task::spawn_blocking(move || {
                    vrcx_0_persistence::optimize_database(&db_for_task)
                })
                .await
                {
                    Ok(Ok(_)) => {
                        jobs.mark_completed(DATABASE_OPTIMIZE_JOB, "PRAGMA optimize finished.")
                    }
                    Ok(Err(error)) => {
                        tracing::warn!("runtime database optimize failed: {error}");
                        jobs.mark_failed(DATABASE_OPTIMIZE_JOB, error.to_string());
                    }
                    Err(error) => {
                        tracing::warn!("runtime database optimize task failed: {error}");
                        jobs.mark_failed(DATABASE_OPTIMIZE_JOB, error.to_string());
                    }
                }
                jobs.mark_scheduled(
                    DATABASE_OPTIMIZE_JOB,
                    "Next PRAGMA optimize run is scheduled.",
                    DATABASE_OPTIMIZE_INTERVAL_SECONDS,
                );
                if !sleep_until_due_or_stopped(
                    Duration::from_secs(DATABASE_OPTIMIZE_INTERVAL_SECONDS),
                    &stop_token,
                )
                .await
                {
                    jobs.mark_scheduled(
                        DATABASE_OPTIMIZE_JOB,
                        "Scheduled PRAGMA optimize loop stopped.",
                        DATABASE_OPTIMIZE_INTERVAL_SECONDS,
                    );
                    return;
                }
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
                        .or_insert_with(|| RuntimeBackgroundJobSnapshot {
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
            Err(error) => tracing::warn!("failed to lock runtime background jobs: {error}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_job_failure_records_last_error_and_retry_state() {
        let jobs = RuntimeBackgroundJobs::new();
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
