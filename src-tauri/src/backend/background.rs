use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use vrcx_0_persistence::database::DatabaseService;

use super::task_runtime::BackendTasks;

const DATABASE_OPTIMIZE_JOB: &str = "databaseOptimize";
const DATABASE_OPTIMIZE_INITIAL_DELAY_SECONDS: u64 = 3_600;
const DATABASE_OPTIMIZE_INTERVAL_SECONDS: u64 = 86_400;

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
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
    pub last_detail: String,
    pub failure_count: u64,
}

#[derive(Clone, Default)]
pub struct BackendBackgroundJobs {
    inner: Arc<Mutex<BTreeMap<String, BackendBackgroundJobSnapshot>>>,
    database_optimize_started: Arc<AtomicBool>,
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
                    })
                    .or_insert_with(|| BackendBackgroundJobSnapshot {
                        name,
                        owner,
                        status,
                        cadence_seconds,
                        last_started_at: None,
                        last_finished_at: None,
                        last_detail: detail,
                        failure_count: 0,
                    });
            }
            Err(error) => tracing::warn!("failed to lock backend background jobs: {error}"),
        }
    }

    pub fn mark_running(&self, name: &str, detail: impl Into<String>) {
        self.upsert_status(name, "running", Some(now_iso()), None, detail, false);
    }

    pub fn mark_completed(&self, name: &str, detail: impl Into<String>) {
        self.upsert_status(name, "idle", None, Some(now_iso()), detail, false);
    }

    pub fn mark_failed(&self, name: &str, detail: impl Into<String>) {
        self.upsert_status(name, "error", None, Some(now_iso()), detail, true);
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
                tokio::time::sleep(Duration::from_secs(DATABASE_OPTIMIZE_INTERVAL_SECONDS)).await;
            }
        });
    }

    fn upsert_status(
        &self,
        name: &str,
        status: &str,
        started_at: Option<String>,
        finished_at: Option<String>,
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
                            last_detail: String::new(),
                            failure_count: 0,
                        });
                job.status = status.to_string();
                if let Some(started_at) = started_at {
                    job.last_started_at = Some(started_at);
                }
                if let Some(finished_at) = finished_at {
                    job.last_finished_at = Some(finished_at);
                }
                job.last_detail = detail;
                if failed {
                    job.failure_count = job.failure_count.saturating_add(1);
                }
            }
            Err(error) => tracing::warn!("failed to lock backend background jobs: {error}"),
        }
    }
}
