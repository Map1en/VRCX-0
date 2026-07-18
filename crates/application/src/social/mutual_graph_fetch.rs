use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::time::{sleep, Instant};
use vrcx_0_persistence::mutual_graph::{MutualGraphMetaInput, MutualGraphSnapshotEntryInput};
use vrcx_0_persistence::DatabaseService;

use crate::{Error, Result, TaskSupervisor, WebClient};
use vrcx_0_application_core::vrchat_api::users::user_mutual_friends_get_input;
use vrcx_0_application_core::vrchat_api::VrchatScope;

const MUTUAL_GRAPH_PAGE_SIZE: i64 = 100;
const MUTUAL_GRAPH_REQUEST_INTERVAL_MS: u64 = 200;
const MUTUAL_GRAPH_MAX_RETRIES: usize = 4;
const MUTUAL_GRAPH_EMPTY_USER_ID: &str = "usr_00000000-0000-0000-0000-000000000000";

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphFetchStartInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub friend_ids: Vec<String>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphFetchCancelInput {
    #[serde(default)]
    pub owner_user_id: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphFetchStatus {
    pub run_id: u64,
    pub status: String,
    pub owner_user_id: String,
    pub total_friends: usize,
    pub processed_friends: usize,
    pub current_friend_id: String,
    pub fetched_friends: usize,
    pub opted_out_friends: usize,
    pub failed_friends: usize,
    pub cancel_requested: bool,
    pub started_at: String,
    pub updated_at: String,
    pub finished_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone)]
pub struct MutualGraphFetchRuntime {
    inner: Arc<Mutex<MutualGraphFetchInner>>,
    next_run_id: Arc<AtomicU64>,
}

struct MutualGraphFetchInner {
    status: MutualGraphFetchStatus,
    cancel_flag: Option<Arc<AtomicBool>>,
}

struct MutualGraphFetchJob {
    run_id: u64,
    owner_user_id: String,
    endpoint: String,
    friend_ids: Vec<String>,
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
    cancel_flag: Arc<AtomicBool>,
}

impl Default for MutualGraphFetchRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl MutualGraphFetchRuntime {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(MutualGraphFetchInner {
                status: idle_status(),
                cancel_flag: None,
            })),
            next_run_id: Arc::new(AtomicU64::new(1)),
        }
    }

    pub fn status(&self) -> MutualGraphFetchStatus {
        self.inner
            .lock()
            .map(|inner| inner.status.clone())
            .unwrap_or_else(|_| idle_status())
    }

    pub fn start(
        &self,
        input: MutualGraphFetchStartInput,
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        tasks: TaskSupervisor,
    ) -> Result<MutualGraphFetchStatus> {
        let owner_user_id = normalize_id(&input.owner_user_id);
        if owner_user_id.is_empty() {
            return Err(Error::Custom(
                "MutualGraphFetchStart requires ownerUserId.".into(),
            ));
        }

        let friend_ids = normalize_friend_ids(input.friend_ids);
        if friend_ids.is_empty() {
            return Err(Error::Custom(
                "MutualGraphFetchStart requires at least one friend id.".into(),
            ));
        }

        let endpoint = input.endpoint.trim().to_string();
        let cancel_flag = Arc::new(AtomicBool::new(false));
        let run_id = self.next_run_id.fetch_add(1, Ordering::AcqRel);
        let now = now_iso();
        let status = MutualGraphFetchStatus {
            run_id,
            status: "running".into(),
            owner_user_id: owner_user_id.clone(),
            total_friends: friend_ids.len(),
            processed_friends: 0,
            current_friend_id: String::new(),
            fetched_friends: 0,
            opted_out_friends: 0,
            failed_friends: 0,
            cancel_requested: false,
            started_at: now.clone(),
            updated_at: now,
            finished_at: None,
            last_error: None,
        };

        {
            let mut inner = self.inner.lock().map_err(|error| {
                Error::Custom(format!("mutual graph fetch lock poisoned: {error}"))
            })?;
            if is_active_status(&inner.status.status) {
                if inner.status.owner_user_id == owner_user_id {
                    return Ok(inner.status.clone());
                }
                return Err(Error::Custom(
                    "A mutual graph fetch is already running.".into(),
                ));
            }
            inner.status = status.clone();
            inner.cancel_flag = Some(Arc::clone(&cancel_flag));
        }

        let runtime = self.clone();
        tasks.spawn(async move {
            runtime
                .run_fetch_job(MutualGraphFetchJob {
                    run_id,
                    owner_user_id,
                    endpoint,
                    friend_ids,
                    db,
                    web,
                    cancel_flag,
                })
                .await;
        });

        Ok(status)
    }

    pub fn cancel(&self, input: MutualGraphFetchCancelInput) -> Result<MutualGraphFetchStatus> {
        let owner_user_id = normalize_id(&input.owner_user_id);
        let mut inner = self
            .inner
            .lock()
            .map_err(|error| Error::Custom(format!("mutual graph fetch lock poisoned: {error}")))?;
        if !is_active_status(&inner.status.status) {
            return Ok(inner.status.clone());
        }
        if !owner_user_id.is_empty() && inner.status.owner_user_id != owner_user_id {
            return Ok(inner.status.clone());
        }
        if let Some(cancel_flag) = &inner.cancel_flag {
            cancel_flag.store(true, Ordering::Release);
        }
        inner.status.status = "cancelling".into();
        inner.status.cancel_requested = true;
        inner.status.updated_at = now_iso();
        Ok(inner.status.clone())
    }

    async fn run_fetch_job(&self, job: MutualGraphFetchJob) {
        let MutualGraphFetchJob {
            run_id,
            owner_user_id,
            endpoint,
            friend_ids,
            db,
            web,
            cancel_flag,
        } = job;
        let mut entries = Vec::new();
        let mut meta_entries = Vec::new();
        let mut processed_friends = 0usize;
        let mut fetched_friends = 0usize;
        let mut opted_out_friends = 0usize;
        let mut failed_friends = 0usize;
        let mut last_error = None;
        let mut last_request_at = None;

        for friend_id in friend_ids {
            if cancel_flag.load(Ordering::Acquire) {
                self.finish_run(run_id, "cancelled", None);
                return;
            }

            self.update_current_friend(run_id, &friend_id);
            match fetch_friend_mutuals(
                web.as_ref(),
                db.as_ref(),
                &endpoint,
                &friend_id,
                &cancel_flag,
                &mut last_request_at,
            )
            .await
            {
                FriendFetchResult::MutualIds(mutual_ids) => {
                    entries.push(MutualGraphSnapshotEntryInput {
                        friend_id: friend_id.clone(),
                        mutual_ids,
                    });
                    meta_entries.push(MutualGraphMetaInput {
                        friend_id: friend_id.clone(),
                        last_fetched_at: String::new(),
                        opted_out: false,
                    });
                    fetched_friends += 1;
                }
                FriendFetchResult::OptedOut => {
                    meta_entries.push(MutualGraphMetaInput {
                        friend_id: friend_id.clone(),
                        last_fetched_at: String::new(),
                        opted_out: true,
                    });
                    opted_out_friends += 1;
                }
                FriendFetchResult::Cancelled => {
                    self.finish_run(run_id, "cancelled", None);
                    return;
                }
                FriendFetchResult::Failed(error) => {
                    failed_friends += 1;
                    last_error = Some(error);
                }
            }

            processed_friends += 1;
            self.update_progress(
                run_id,
                processed_friends,
                fetched_friends,
                opted_out_friends,
                failed_friends,
                last_error.clone(),
            );
        }

        if cancel_flag.load(Ordering::Acquire) {
            self.finish_run(run_id, "cancelled", None);
            return;
        }

        if failed_friends > 0 {
            self.finish_run(
                run_id,
                "error",
                Some(last_error.unwrap_or_else(|| {
                    format!("{failed_friends} mutual graph friend fetches failed.")
                })),
            );
            return;
        }

        match vrcx_0_persistence::mutual_graph::mutual_graph_snapshot_commit(
            db.as_ref(),
            owner_user_id,
            entries,
            meta_entries,
        ) {
            Ok(()) => {
                self.finish_run(run_id, "completed", None);
            }
            Err(error) => {
                self.finish_run(run_id, "error", Some(error.to_string()));
            }
        }
    }

    fn update_current_friend(&self, run_id: u64, friend_id: &str) {
        self.update_status(run_id, |status| {
            status.current_friend_id = friend_id.to_string();
        });
    }

    fn update_progress(
        &self,
        run_id: u64,
        processed_friends: usize,
        fetched_friends: usize,
        opted_out_friends: usize,
        failed_friends: usize,
        last_error: Option<String>,
    ) {
        self.update_status(run_id, |status| {
            status.processed_friends = processed_friends;
            status.fetched_friends = fetched_friends;
            status.opted_out_friends = opted_out_friends;
            status.failed_friends = failed_friends;
            status.last_error = last_error;
        });
    }

    fn finish_run(
        &self,
        run_id: u64,
        status_name: &str,
        last_error: Option<String>,
    ) -> MutualGraphFetchStatus {
        let now = now_iso();
        let mut output = idle_status();
        if let Ok(mut inner) = self.inner.lock() {
            if inner.status.run_id == run_id {
                inner.status.status = status_name.to_string();
                inner.status.cancel_requested = false;
                inner.status.current_friend_id.clear();
                inner.status.updated_at = now.clone();
                inner.status.finished_at = Some(now);
                inner.status.last_error = last_error;
                inner.cancel_flag = None;
            }
            output = inner.status.clone();
        }
        output
    }

    fn update_status<F>(&self, run_id: u64, mutate: F)
    where
        F: FnOnce(&mut MutualGraphFetchStatus),
    {
        if let Ok(mut inner) = self.inner.lock() {
            if inner.status.run_id != run_id {
                return;
            }
            mutate(&mut inner.status);
            inner.status.updated_at = now_iso();
        }
    }
}

enum FriendFetchResult {
    MutualIds(Vec<String>),
    OptedOut,
    Cancelled,
    Failed(String),
}

async fn fetch_friend_mutuals(
    web: &WebClient,
    db: &DatabaseService,
    endpoint: &str,
    friend_id: &str,
    cancel_flag: &AtomicBool,
    last_request_at: &mut Option<Instant>,
) -> FriendFetchResult {
    let mut collected = Vec::new();
    let mut seen = HashSet::new();
    let mut offset = 0;

    loop {
        if cancel_flag.load(Ordering::Acquire) {
            return FriendFetchResult::Cancelled;
        }

        match fetch_mutual_page(
            web,
            db,
            endpoint,
            friend_id,
            offset,
            cancel_flag,
            last_request_at,
        )
        .await
        {
            PageFetchResult::Rows(rows) => {
                let page_len = rows.len();
                for row in rows {
                    if let Some(id) = mutual_id_from_value(&row) {
                        if seen.insert(id.clone()) {
                            collected.push(id);
                        }
                    }
                }
                if page_len < MUTUAL_GRAPH_PAGE_SIZE as usize {
                    return FriendFetchResult::MutualIds(collected);
                }
                offset += page_len as i64;
            }
            PageFetchResult::OptedOut => return FriendFetchResult::OptedOut,
            PageFetchResult::Cancelled => return FriendFetchResult::Cancelled,
            PageFetchResult::Failed(error) => return FriendFetchResult::Failed(error),
        }
    }
}

enum PageFetchResult {
    Rows(Vec<Value>),
    OptedOut,
    Cancelled,
    Failed(String),
}

async fn fetch_mutual_page(
    web: &WebClient,
    db: &DatabaseService,
    endpoint: &str,
    friend_id: &str,
    offset: i64,
    cancel_flag: &AtomicBool,
    last_request_at: &mut Option<Instant>,
) -> PageFetchResult {
    let mut attempt = 0usize;
    loop {
        if cancel_flag.load(Ordering::Acquire) {
            return PageFetchResult::Cancelled;
        }

        wait_for_rate_limit(last_request_at).await;
        if cancel_flag.load(Ordering::Acquire) {
            return PageFetchResult::Cancelled;
        }

        let request = match user_mutual_friends_get_input(
            endpoint.to_string(),
            friend_id.to_string(),
            MUTUAL_GRAPH_PAGE_SIZE,
            offset,
            true,
        ) {
            Ok((_, request)) => request,
            Err(error) => return PageFetchResult::Failed(error.to_string()),
        };
        let response = match web.execute_api(request, VrchatScope::Vrchat, db).await {
            Ok(response) => response,
            Err(error) => {
                if attempt < MUTUAL_GRAPH_MAX_RETRIES {
                    sleep(backoff_delay(attempt)).await;
                    attempt += 1;
                    continue;
                }
                return PageFetchResult::Failed(error.to_string());
            }
        };

        if response.status == 403 || response.status == 404 {
            return PageFetchResult::OptedOut;
        }

        if (200..=399).contains(&response.status) {
            let json = match serde_json::from_str::<Value>(&response.data) {
                Ok(value) => value,
                Err(error) => return PageFetchResult::Failed(error.to_string()),
            };
            if json.get("error").is_some() {
                return PageFetchResult::Failed(response.data);
            }
            let rows = json.as_array().cloned().unwrap_or_default();
            return PageFetchResult::Rows(rows);
        }

        if is_retryable_status(response.status) && attempt < MUTUAL_GRAPH_MAX_RETRIES {
            sleep(backoff_delay(attempt)).await;
            attempt += 1;
            continue;
        }

        return PageFetchResult::Failed(format!(
            "VRChat mutual friends request for {friend_id} failed with HTTP {}.",
            response.status
        ));
    }
}

async fn wait_for_rate_limit(last_request_at: &mut Option<Instant>) {
    if let Some(last_request_at) = last_request_at {
        let interval = Duration::from_millis(MUTUAL_GRAPH_REQUEST_INTERVAL_MS);
        let elapsed = last_request_at.elapsed();
        if elapsed < interval {
            sleep(interval - elapsed).await;
        }
    }
    *last_request_at = Some(Instant::now());
}

fn backoff_delay(attempt: usize) -> Duration {
    Duration::from_millis(500 * 2u64.saturating_pow(attempt as u32))
}

fn is_retryable_status(status: i32) -> bool {
    matches!(status, 408 | 409 | 425 | 429 | 500..=599)
}

fn mutual_id_from_value(value: &Value) -> Option<String> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .map(normalize_id)
        .unwrap_or_default();
    if id.is_empty() || id == MUTUAL_GRAPH_EMPTY_USER_ID {
        None
    } else {
        Some(id)
    }
}

fn normalize_friend_ids(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| normalize_id(&value))
        .filter(|value| !value.is_empty() && value != MUTUAL_GRAPH_EMPTY_USER_ID)
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn normalize_id(value: &str) -> String {
    value.trim().to_string()
}

fn is_active_status(status: &str) -> bool {
    matches!(status, "running" | "cancelling")
}

fn idle_status() -> MutualGraphFetchStatus {
    MutualGraphFetchStatus {
        run_id: 0,
        status: "idle".into(),
        owner_user_id: String::new(),
        total_friends: 0,
        processed_friends: 0,
        current_friend_id: String::new(),
        fetched_friends: 0,
        opted_out_friends: 0,
        failed_friends: 0,
        cancel_requested: false,
        started_at: String::new(),
        updated_at: String::new(),
        finished_at: None,
        last_error: None,
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
