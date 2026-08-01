use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use vrcx_0_core::time::now_iso;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::time::{sleep, Instant};
use vrcx_0_persistence::mutual_graph::{
    MutualGraphMetaInput, MutualGraphSnapshotEntryInput, MutualGraphSnapshotOutput,
};
use vrcx_0_persistence::DatabaseService;

use crate::{
    Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeEventBus, TaskSupervisor,
    WebClient,
};
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
    pub revision: u64,
    pub status: MutualGraphFetchState,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MutualGraphFetchState {
    Idle,
    Running,
    Cancelling,
    Completed,
    Cancelled,
    Error,
}

impl MutualGraphFetchState {
    pub fn is_active(self) -> bool {
        matches!(self, Self::Running | Self::Cancelling)
    }
}

#[derive(Clone)]
pub struct MutualGraphFetchRuntime {
    inner: Arc<Mutex<MutualGraphFetchInner>>,
    next_run_id: Arc<AtomicU64>,
    event_bus: RuntimeEventBus,
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
    auth_scope: RuntimeAuthScope,
    expected_scope: RuntimeAuthScopeSnapshot,
    cancel_flag: Arc<AtomicBool>,
}

struct MutualGraphFetchContext<'a> {
    web: &'a WebClient,
    db: &'a DatabaseService,
    endpoint: &'a str,
    cancel_flag: &'a AtomicBool,
    auth_scope: &'a RuntimeAuthScope,
    expected_scope: &'a RuntimeAuthScopeSnapshot,
    last_request_at: Option<Instant>,
}

impl Default for MutualGraphFetchRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl MutualGraphFetchRuntime {
    pub fn new() -> Self {
        Self::with_event_bus(RuntimeEventBus::new())
    }

    pub fn with_event_bus(event_bus: RuntimeEventBus) -> Self {
        Self {
            inner: Arc::new(Mutex::new(MutualGraphFetchInner {
                status: idle_status(),
                cancel_flag: None,
            })),
            next_run_id: Arc::new(AtomicU64::new(1)),
            event_bus,
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
        auth_scope: RuntimeAuthScope,
        tasks: TaskSupervisor,
    ) -> Result<MutualGraphFetchStatus> {
        let (owner_user_id, endpoint, expected_scope) = resolve_fetch_scope(&input, &auth_scope)?;

        let friend_ids = normalize_friend_ids(input.friend_ids);
        if friend_ids.is_empty() {
            return Err(Error::Custom(
                "MutualGraphFetchStart requires at least one friend id.".into(),
            ));
        }

        let cancel_flag = Arc::new(AtomicBool::new(false));
        let run_id = self.next_run_id.fetch_add(1, Ordering::AcqRel);
        let status = {
            let mut inner = self.inner.lock().map_err(|error| {
                Error::Custom(format!("mutual graph fetch lock poisoned: {error}"))
            })?;
            if inner.status.status.is_active() {
                if inner.status.owner_user_id == owner_user_id {
                    return Ok(inner.status.clone());
                }
                return Err(Error::Custom(
                    "A mutual graph fetch is already running.".into(),
                ));
            }
            let now = now_iso();
            let status = MutualGraphFetchStatus {
                run_id,
                revision: 1,
                status: MutualGraphFetchState::Running,
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
            inner.status = status.clone();
            inner.cancel_flag = Some(Arc::clone(&cancel_flag));
            status
        };
        self.emit_status(status.clone());

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
                    auth_scope,
                    expected_scope,
                    cancel_flag,
                })
                .await;
        });

        Ok(status)
    }

    pub fn cancel(&self, input: MutualGraphFetchCancelInput) -> Result<MutualGraphFetchStatus> {
        let owner_user_id = normalize_id(&input.owner_user_id);
        let status = {
            let mut inner = self.inner.lock().map_err(|error| {
                Error::Custom(format!("mutual graph fetch lock poisoned: {error}"))
            })?;
            if !inner.status.status.is_active() {
                return Ok(inner.status.clone());
            }
            if !owner_user_id.is_empty() && inner.status.owner_user_id != owner_user_id {
                return Ok(inner.status.clone());
            }
            if let Some(cancel_flag) = &inner.cancel_flag {
                cancel_flag.store(true, Ordering::Release);
            }
            inner.status.status = MutualGraphFetchState::Cancelling;
            inner.status.cancel_requested = true;
            inner.status.updated_at = now_iso();
            inner.status.revision += 1;
            inner.status.clone()
        };
        self.emit_status(status.clone());
        Ok(status)
    }

    pub fn cancel_active(&self) -> Result<MutualGraphFetchStatus> {
        self.cancel(MutualGraphFetchCancelInput {
            owner_user_id: String::new(),
        })
    }

    async fn run_fetch_job(&self, job: MutualGraphFetchJob) {
        let MutualGraphFetchJob {
            run_id,
            owner_user_id,
            endpoint,
            friend_ids,
            db,
            web,
            auth_scope,
            expected_scope,
            cancel_flag,
        } = job;
        let mut entries = Vec::new();
        let mut meta_entries = Vec::new();
        let mut processed_friends = 0usize;
        let mut fetched_friends = 0usize;
        let mut opted_out_friends = 0usize;
        let mut failed_friends = 0usize;
        let mut failed_friend_ids = HashSet::new();
        let mut last_error = None;
        let mut fetch_context = MutualGraphFetchContext {
            web: web.as_ref(),
            db: db.as_ref(),
            endpoint: &endpoint,
            cancel_flag: &cancel_flag,
            auth_scope: &auth_scope,
            expected_scope: &expected_scope,
            last_request_at: None,
        };

        for friend_id in friend_ids {
            if fetch_should_cancel(&cancel_flag, &auth_scope, &expected_scope) {
                self.finish_run(run_id, MutualGraphFetchState::Cancelled, None);
                return;
            }

            self.update_current_friend(run_id, &friend_id);
            match fetch_friend_mutuals(&mut fetch_context, &friend_id).await {
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
                    self.finish_run(run_id, MutualGraphFetchState::Cancelled, None);
                    return;
                }
                FriendFetchResult::Failed(error) => {
                    failed_friends += 1;
                    failed_friend_ids.insert(friend_id.clone());
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

        if fetch_should_cancel(&cancel_flag, &auth_scope, &expected_scope) {
            self.finish_run(run_id, MutualGraphFetchState::Cancelled, None);
            return;
        }

        if failed_friends > 0 && fetched_friends + opted_out_friends == 0 {
            self.finish_run(
                run_id,
                MutualGraphFetchState::Error,
                Some(last_error.unwrap_or_else(|| {
                    format!("{failed_friends} mutual graph friend fetches failed.")
                })),
            );
            return;
        }

        if !failed_friend_ids.is_empty() {
            match vrcx_0_persistence::mutual_graph::mutual_graph_snapshot_get(
                db.as_ref(),
                owner_user_id.clone(),
            ) {
                Ok(cached) => preserve_failed_friend_cache(
                    &mut entries,
                    &mut meta_entries,
                    &failed_friend_ids,
                    cached,
                ),
                Err(error) => {
                    self.finish_run(
                        run_id,
                        MutualGraphFetchState::Error,
                        Some(error.to_string()),
                    );
                    return;
                }
            }
        }

        if fetch_should_cancel(&cancel_flag, &auth_scope, &expected_scope) {
            self.finish_run(run_id, MutualGraphFetchState::Cancelled, None);
            return;
        }

        match vrcx_0_persistence::mutual_graph::mutual_graph_snapshot_commit(
            db.as_ref(),
            owner_user_id,
            entries,
            meta_entries,
        ) {
            Ok(()) => {
                self.finish_run(run_id, MutualGraphFetchState::Completed, last_error);
            }
            Err(error) => {
                self.finish_run(
                    run_id,
                    MutualGraphFetchState::Error,
                    Some(error.to_string()),
                );
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
        state: MutualGraphFetchState,
        last_error: Option<String>,
    ) -> MutualGraphFetchStatus {
        let now = now_iso();
        let mut output = idle_status();
        let mut emitted = None;
        if let Ok(mut inner) = self.inner.lock() {
            if inner.status.run_id == run_id {
                inner.status.status = state;
                inner.status.cancel_requested = false;
                inner.status.current_friend_id.clear();
                inner.status.updated_at = now.clone();
                inner.status.finished_at = Some(now);
                inner.status.last_error = last_error;
                inner.status.revision += 1;
                inner.cancel_flag = None;
                emitted = Some(inner.status.clone());
            }
            output = inner.status.clone();
        }
        if let Some(status) = emitted {
            self.emit_status(status);
        }
        output
    }

    fn update_status<F>(&self, run_id: u64, mutate: F)
    where
        F: FnOnce(&mut MutualGraphFetchStatus),
    {
        let status = if let Ok(mut inner) = self.inner.lock() {
            if inner.status.run_id != run_id {
                return;
            }
            mutate(&mut inner.status);
            inner.status.updated_at = now_iso();
            inner.status.revision += 1;
            Some(inner.status.clone())
        } else {
            None
        };
        if let Some(status) = status {
            self.emit_status(status);
        }
    }

    fn emit_status(&self, status: MutualGraphFetchStatus) {
        self.event_bus.emit(status);
    }
}

enum FriendFetchResult {
    MutualIds(Vec<String>),
    OptedOut,
    Cancelled,
    Failed(String),
}

async fn fetch_friend_mutuals(
    context: &mut MutualGraphFetchContext<'_>,
    friend_id: &str,
) -> FriendFetchResult {
    let mut collected = Vec::new();
    let mut seen = HashSet::new();
    let mut offset = 0;

    loop {
        if fetch_should_cancel(
            context.cancel_flag,
            context.auth_scope,
            context.expected_scope,
        ) {
            return FriendFetchResult::Cancelled;
        }

        match fetch_mutual_page(context, friend_id, offset).await {
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
    context: &mut MutualGraphFetchContext<'_>,
    friend_id: &str,
    offset: i64,
) -> PageFetchResult {
    let mut attempt = 0usize;
    loop {
        if fetch_should_cancel(
            context.cancel_flag,
            context.auth_scope,
            context.expected_scope,
        ) {
            return PageFetchResult::Cancelled;
        }

        wait_for_rate_limit(&mut context.last_request_at).await;
        if fetch_should_cancel(
            context.cancel_flag,
            context.auth_scope,
            context.expected_scope,
        ) {
            return PageFetchResult::Cancelled;
        }

        let request = match user_mutual_friends_get_input(
            context.endpoint.to_string(),
            friend_id.to_string(),
            MUTUAL_GRAPH_PAGE_SIZE,
            offset,
            true,
        ) {
            Ok((_, request)) => request,
            Err(error) => return PageFetchResult::Failed(error.to_string()),
        };
        let response = match context
            .web
            .execute_api(request, VrchatScope::Vrchat, context.db)
            .await
        {
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

fn resolve_fetch_scope(
    input: &MutualGraphFetchStartInput,
    auth_scope: &RuntimeAuthScope,
) -> Result<(String, String, RuntimeAuthScopeSnapshot)> {
    let owner_user_id = normalize_id(&input.owner_user_id);
    if owner_user_id.is_empty() {
        return Err(Error::Custom(
            "MutualGraphFetchStart requires ownerUserId.".into(),
        ));
    }
    let expected_scope = auth_scope.snapshot();
    if !expected_scope.active || expected_scope.current_user_id != owner_user_id {
        return Err(Error::Custom(
            "Mutual graph fetch requires the active authenticated user.".into(),
        ));
    }
    Ok((
        expected_scope.current_user_id.clone(),
        expected_scope.endpoint.clone(),
        expected_scope,
    ))
}

fn fetch_should_cancel(
    cancel_flag: &AtomicBool,
    auth_scope: &RuntimeAuthScope,
    expected_scope: &RuntimeAuthScopeSnapshot,
) -> bool {
    cancel_flag.load(Ordering::Acquire) || !auth_scope.snapshot().generation_matches(expected_scope)
}

fn preserve_failed_friend_cache(
    entries: &mut Vec<MutualGraphSnapshotEntryInput>,
    meta_entries: &mut Vec<MutualGraphMetaInput>,
    failed_friend_ids: &HashSet<String>,
    cached: MutualGraphSnapshotOutput,
) {
    let mut mutual_ids_by_friend: HashMap<String, Vec<String>> = HashMap::new();
    for link in cached.links {
        if failed_friend_ids.contains(&link.friend_id) {
            mutual_ids_by_friend
                .entry(link.friend_id)
                .or_default()
                .push(link.mutual_id);
        }
    }
    for friend_id in cached.friend_ids {
        if failed_friend_ids.contains(&friend_id) {
            entries.push(MutualGraphSnapshotEntryInput {
                mutual_ids: mutual_ids_by_friend.remove(&friend_id).unwrap_or_default(),
                friend_id,
            });
        }
    }
    for meta in cached.meta {
        if failed_friend_ids.contains(&meta.friend_id) {
            meta_entries.push(MutualGraphMetaInput {
                friend_id: meta.friend_id,
                last_fetched_at: meta.last_fetched_at,
                opted_out: meta.opted_out,
            });
        }
    }
}

fn idle_status() -> MutualGraphFetchStatus {
    MutualGraphFetchStatus {
        run_id: 0,
        revision: 0,
        status: MutualGraphFetchState::Idle,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{RuntimeEventSink, RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle};
    use serde_json::json;
    use std::sync::Condvar;
    use vrcx_0_persistence::mutual_graph::{MutualGraphLinkOutput, MutualGraphMetaOutput};
    use vrcx_0_persistence::storage::StorageService;

    #[derive(Clone)]
    struct DropTaskExecutor;

    struct FinishedTaskHandle;

    impl RuntimeTaskExecutor for DropTaskExecutor {
        fn spawn(&self, _task: RuntimeTask) -> Box<dyn RuntimeTaskHandle> {
            Box::new(FinishedTaskHandle)
        }
    }

    impl RuntimeTaskHandle for FinishedTaskHandle {
        fn abort(&self) {}

        fn is_finished(&self) -> bool {
            true
        }

        fn join_or_abort(&mut self, _timeout: Duration) {}
    }

    struct TestDir {
        path: std::path::PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-mutual-graph-events-{}-{nonce}",
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

    #[derive(Default)]
    struct ReorderedDeliveryState {
        cancelling_entered: (Mutex<bool>, Condvar),
        cancelled_delivered: (Mutex<bool>, Condvar),
        delivered: Mutex<Vec<Value>>,
    }

    #[derive(Clone, Default)]
    struct ReorderedDeliverySink {
        state: Arc<ReorderedDeliveryState>,
    }

    impl ReorderedDeliverySink {
        fn wait_for_cancelling(&self) {
            let (entered, ready) = &self.state.cancelling_entered;
            let mut entered = entered.lock().unwrap();
            while !*entered {
                entered = ready.wait(entered).unwrap();
            }
        }

        fn delivered(&self) -> Vec<Value> {
            self.state.delivered.lock().unwrap().clone()
        }
    }

    impl RuntimeEventSink for ReorderedDeliverySink {
        fn emit(&self, event: &str, payload: Value) {
            if event != "mutualGraphFetchStatus" {
                return;
            }
            if payload["status"] == "cancelling" {
                let (entered, ready) = &self.state.cancelling_entered;
                *entered.lock().unwrap() = true;
                ready.notify_all();

                let (delivered, ready) = &self.state.cancelled_delivered;
                let mut delivered = delivered.lock().unwrap();
                while !*delivered {
                    delivered = ready.wait(delivered).unwrap();
                }
            }

            self.state.delivered.lock().unwrap().push(payload.clone());
            if payload["status"] == "cancelled" {
                let (delivered, ready) = &self.state.cancelled_delivered;
                *delivered.lock().unwrap() = true;
                ready.notify_all();
            }
        }
    }

    #[test]
    fn auth_scope_change_cancels_the_fetch_guard() {
        let auth_scope = RuntimeAuthScope::new();
        let expected_scope = auth_scope.set("usr_owner", "");
        let cancel_flag = AtomicBool::new(false);

        assert!(!fetch_should_cancel(
            &cancel_flag,
            &auth_scope,
            &expected_scope
        ));

        auth_scope.set("usr_other", "");

        assert!(fetch_should_cancel(
            &cancel_flag,
            &auth_scope,
            &expected_scope
        ));
    }

    #[test]
    fn fetch_scope_uses_the_authenticated_owner_and_endpoint() {
        let auth_scope = RuntimeAuthScope::new();
        let expected = auth_scope.set("usr_owner", "https://api.example.test/api/1");
        let input = MutualGraphFetchStartInput {
            owner_user_id: "usr_owner".into(),
            endpoint: "https://stale.example.test/api/1".into(),
            friend_ids: vec!["usr_friend".into()],
        };

        let (owner_user_id, endpoint, scope) = resolve_fetch_scope(&input, &auth_scope).unwrap();

        assert_eq!(owner_user_id, expected.current_user_id);
        assert_eq!(endpoint, expected.endpoint);
        assert_eq!(scope.generation, expected.generation);
    }

    #[test]
    fn fetch_scope_rejects_a_different_owner() {
        let auth_scope = RuntimeAuthScope::new();
        auth_scope.set("usr_owner", "");
        let input = MutualGraphFetchStartInput {
            owner_user_id: "usr_other".into(),
            endpoint: String::new(),
            friend_ids: vec!["usr_friend".into()],
        };

        assert!(resolve_fetch_scope(&input, &auth_scope).is_err());
    }

    #[test]
    fn start_emits_a_running_status_before_the_job_is_spawned() {
        let dir = TestDir::new();
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
        let storage = StorageService::new(&dir.path.join("VRCX-0.json")).unwrap();
        let web = Arc::new(
            WebClient::new(&storage, db.as_ref(), "https://app.example".into(), "test").unwrap(),
        );
        let auth_scope = RuntimeAuthScope::new();
        auth_scope.set("usr_owner", "https://api.example.test/api/1");
        let event_bus = RuntimeEventBus::new();
        let runtime = MutualGraphFetchRuntime::with_event_bus(event_bus.clone());
        let tasks = TaskSupervisor::new();
        tasks.set_executor(DropTaskExecutor);

        let started = runtime
            .start(
                MutualGraphFetchStartInput {
                    owner_user_id: "usr_owner".into(),
                    endpoint: String::new(),
                    friend_ids: vec!["usr_friend".into()],
                },
                db,
                web,
                auth_scope,
                tasks.clone(),
            )
            .unwrap();

        assert_eq!(started.status, MutualGraphFetchState::Running);
        assert_eq!(started.revision, 1);
        let events = event_bus.take_events_for_test();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].name, "mutualGraphFetchStatus");
        assert_eq!(events[0].payload["status"], json!("running"));
        assert_eq!(events[0].payload["revision"], json!(1));
        tasks.stop_all();
    }

    #[test]
    fn cancel_active_marks_the_running_fetch_as_cancelling() {
        let event_bus = RuntimeEventBus::new();
        let runtime = MutualGraphFetchRuntime::with_event_bus(event_bus.clone());
        let cancel_flag = Arc::new(AtomicBool::new(false));
        {
            let mut inner = runtime.inner.lock().unwrap();
            inner.status = MutualGraphFetchStatus {
                run_id: 7,
                revision: 1,
                status: MutualGraphFetchState::Running,
                owner_user_id: "usr_owner".into(),
                total_friends: 2,
                ..idle_status()
            };
            inner.cancel_flag = Some(Arc::clone(&cancel_flag));
        }

        let status = runtime.cancel_active().unwrap();

        assert_eq!(status.status, MutualGraphFetchState::Cancelling);
        assert_eq!(status.revision, 2);
        assert!(status.cancel_requested);
        assert!(cancel_flag.load(Ordering::Acquire));
        let events = event_bus.take_events_for_test();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].name, "mutualGraphFetchStatus");
        assert_eq!(events[0].payload["status"], json!("cancelling"));
        assert_eq!(events[0].payload["revision"], json!(2));
    }

    #[test]
    fn progress_and_terminal_transitions_emit_typed_status_events() {
        let event_bus = RuntimeEventBus::new();
        let runtime = MutualGraphFetchRuntime::with_event_bus(event_bus.clone());
        {
            let mut inner = runtime.inner.lock().unwrap();
            inner.status = MutualGraphFetchStatus {
                run_id: 7,
                revision: 1,
                status: MutualGraphFetchState::Running,
                owner_user_id: "usr_owner".into(),
                total_friends: 2,
                ..idle_status()
            };
        }

        runtime.update_current_friend(7, "usr_friend");
        runtime.update_progress(7, 1, 1, 0, 0, None);
        runtime.finish_run(7, MutualGraphFetchState::Completed, None);

        let events = event_bus.take_events_for_test();
        assert_eq!(events.len(), 3);
        assert!(events
            .iter()
            .all(|event| event.name == "mutualGraphFetchStatus"));
        assert_eq!(events[0].payload["currentFriendId"], json!("usr_friend"));
        assert_eq!(events[0].payload["revision"], json!(2));
        assert_eq!(events[1].payload["processedFriends"], json!(1));
        assert_eq!(events[1].payload["revision"], json!(3));
        assert_eq!(events[2].payload["status"], json!("completed"));
        assert_eq!(events[2].payload["revision"], json!(4));
        assert!(events[2].payload["finishedAt"].is_string());
    }

    #[test]
    fn delayed_cancelling_event_has_an_older_revision_than_cancelled() {
        let event_bus = RuntimeEventBus::new();
        let sink = ReorderedDeliverySink::default();
        event_bus.set_sink(sink.clone());
        let runtime = MutualGraphFetchRuntime::with_event_bus(event_bus);
        let cancel_flag = Arc::new(AtomicBool::new(false));
        {
            let mut inner = runtime.inner.lock().unwrap();
            inner.status = MutualGraphFetchStatus {
                run_id: 7,
                revision: 1,
                status: MutualGraphFetchState::Running,
                owner_user_id: "usr_owner".into(),
                total_friends: 1,
                ..idle_status()
            };
            inner.cancel_flag = Some(cancel_flag);
        }

        let cancelling_runtime = runtime.clone();
        let cancelling = std::thread::spawn(move || cancelling_runtime.cancel_active().unwrap());
        sink.wait_for_cancelling();
        let cancelled = runtime.finish_run(7, MutualGraphFetchState::Cancelled, None);
        let cancelling = cancelling.join().unwrap();

        assert_eq!(cancelling.revision, 2);
        assert_eq!(cancelled.revision, 3);
        let delivered = sink.delivered();
        assert_eq!(delivered.len(), 2);
        assert_eq!(delivered[0]["status"], json!("cancelled"));
        assert_eq!(delivered[0]["revision"], json!(3));
        assert_eq!(delivered[1]["status"], json!("cancelling"));
        assert_eq!(delivered[1]["revision"], json!(2));
        assert_eq!(runtime.status().revision, 3);
    }

    #[test]
    fn failed_friends_keep_their_cached_snapshot_entries() {
        let mut entries = vec![MutualGraphSnapshotEntryInput {
            friend_id: "usr_ok".into(),
            mutual_ids: vec!["usr_mutual_new".into()],
        }];
        let mut meta_entries = vec![MutualGraphMetaInput {
            friend_id: "usr_ok".into(),
            last_fetched_at: "new".into(),
            opted_out: false,
        }];
        let failed_friend_ids = HashSet::from(["usr_failed".to_string()]);
        let cached = MutualGraphSnapshotOutput {
            friend_ids: vec!["usr_failed".into(), "usr_removed".into()],
            links: vec![
                MutualGraphLinkOutput {
                    friend_id: "usr_failed".into(),
                    mutual_id: "usr_mutual_old".into(),
                },
                MutualGraphLinkOutput {
                    friend_id: "usr_removed".into(),
                    mutual_id: "usr_removed_mutual".into(),
                },
            ],
            meta: vec![
                MutualGraphMetaOutput {
                    friend_id: "usr_failed".into(),
                    last_fetched_at: "old".into(),
                    opted_out: false,
                },
                MutualGraphMetaOutput {
                    friend_id: "usr_removed".into(),
                    last_fetched_at: "removed".into(),
                    opted_out: false,
                },
            ],
        };

        preserve_failed_friend_cache(&mut entries, &mut meta_entries, &failed_friend_ids, cached);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].friend_id, "usr_failed");
        assert_eq!(entries[1].mutual_ids, vec!["usr_mutual_old"]);
        assert_eq!(meta_entries.len(), 2);
        assert_eq!(meta_entries[1].friend_id, "usr_failed");
        assert_eq!(meta_entries[1].last_fetched_at, "old");
    }
}
