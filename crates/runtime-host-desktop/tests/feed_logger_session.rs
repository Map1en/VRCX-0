mod support;

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};
use support::{feed_logger_desktop, FeedLoggerDesktop, TestDir, SAVED_RECORDER};
use vrcx_0_application_core::{
    RuntimeEventBus, RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle, TaskSupervisor,
};
use vrcx_0_contracts::feed::{FeedQueryMode, FeedRowsQueryInput};
use vrcx_0_integrations::feed_logger::FeedLoggerClientError;
use vrcx_0_logger_protocol::wire::{
    FrameKind, HelloResponse, PresenceRequest, PresenceResponse, SnapshotPayload, WireFrame,
    CAPTURE_FORMAT_VERSION, PROTOCOL_VERSION,
};
use vrcx_0_persistence::feed::feed_rows_query;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_runtime_host_desktop::feed_logger::{
    DesktopFeedLoggerRuntime, FeedLoggerError, PresenceTicker, RecorderConnector, RecorderTransport,
};

const SELF: &str = "usr_self";

type AckProbe = Box<dyn Fn() -> i64 + Send + Sync>;

#[derive(Default)]
struct FakeRecorder {
    responses: Mutex<HashMap<String, Value>>,
    calls: Mutex<Vec<String>>,
    on_ack: Mutex<Option<AckProbe>>,
    rows_at_ack: Mutex<Vec<i64>>,
}

impl FakeRecorder {
    fn respond(&self, path: &str, response: Value) {
        self.responses
            .lock()
            .unwrap()
            .insert(path.to_string(), response);
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
}

#[async_trait]
impl RecorderTransport for FakeRecorder {
    async fn call_value(
        &self,
        path: &str,
        _request: Value,
    ) -> Result<Value, FeedLoggerClientError> {
        self.calls.lock().unwrap().push(path.to_string());
        if path == "/ack" {
            if let Some(probe) = self.on_ack.lock().unwrap().as_ref() {
                self.rows_at_ack.lock().unwrap().push(probe());
            }
        }
        self.responses
            .lock()
            .unwrap()
            .get(path)
            .cloned()
            .ok_or_else(|| FeedLoggerClientError::Rejected(format!("unexpected {path}")))
    }

    async fn presence(
        &self,
        request: &PresenceRequest,
    ) -> Result<PresenceResponse, FeedLoggerClientError> {
        self.calls.lock().unwrap().push(format!(
            "presence {} leaving={}",
            request.account_id, request.leaving
        ));
        Ok(PresenceResponse {
            server_time_ms: 0,
            resumed: false,
        })
    }

    fn clock_offset_ms(&self) -> i64 {
        0
    }
}

struct FakeConnector {
    recorder: Arc<FakeRecorder>,
    connects: AtomicUsize,
}

#[async_trait]
impl RecorderConnector for FakeConnector {
    async fn connect(
        &self,
        _address: &str,
        _password: &str,
    ) -> Result<(Arc<dyn RecorderTransport>, HelloResponse), FeedLoggerError> {
        self.connects.fetch_add(1, Ordering::Relaxed);
        Ok((
            Arc::clone(&self.recorder) as Arc<dyn RecorderTransport>,
            HelloResponse {
                protocol_version: PROTOCOL_VERSION,
                min_client_protocol_version: PROTOCOL_VERSION,
                capture_format_version: CAPTURE_FORMAT_VERSION,
                logger_version: "1.0.0".into(),
                server_time: 0,
            },
        ))
    }
}

#[derive(Default)]
struct QueuedTasks {
    tasks: Mutex<Vec<RuntimeTask>>,
}

struct QueuedHandle;

impl RuntimeTaskHandle for QueuedHandle {
    fn abort(&self) {}
    fn is_finished(&self) -> bool {
        true
    }
    fn join_or_abort(&mut self, _timeout: Duration) {}
}

impl RuntimeTaskExecutor for QueuedTasks {
    fn spawn(&self, task: RuntimeTask) -> Box<dyn RuntimeTaskHandle> {
        self.tasks.lock().unwrap().push(task);
        Box::new(QueuedHandle)
    }
}

impl QueuedTasks {
    async fn run_all(&self) {
        loop {
            let tasks = std::mem::take(&mut *self.tasks.lock().unwrap());
            if tasks.is_empty() {
                return;
            }
            for task in tasks {
                task.await;
            }
        }
    }
}

struct Session {
    _dir: TestDir,
    db: Arc<DatabaseService>,
    event_bus: RuntimeEventBus,
    runtime: Arc<DesktopFeedLoggerRuntime>,
    recorder: Arc<FakeRecorder>,
    connector: Arc<FakeConnector>,
    queued: Arc<QueuedTasks>,
    tasks: TaskSupervisor,
}

fn session(settings: Option<&str>) -> Session {
    let FeedLoggerDesktop {
        dir,
        db,
        event_bus,
        auth_scope,
        runtime,
    } = feed_logger_desktop(settings);
    auth_scope.set(SELF, "https://api.vrchat.cloud/api/1");
    let recorder = Arc::new(FakeRecorder::default());
    let connector = Arc::new(FakeConnector {
        recorder: Arc::clone(&recorder),
        connects: AtomicUsize::new(0),
    });
    let runtime =
        Arc::new(runtime.with_connector(Arc::clone(&connector) as Arc<dyn RecorderConnector>));
    let queued = Arc::new(QueuedTasks::default());
    let tasks = TaskSupervisor::with_executor(Arc::clone(&queued) as Arc<dyn RuntimeTaskExecutor>);
    Session {
        _dir: dir,
        db,
        event_bus,
        runtime,
        recorder,
        connector,
        queued,
        tasks,
    }
}

fn status(account_id: &str, unsynced_frames: u64) -> Value {
    json!({
        "loggerVersion": "1.0.0",
        "protocolVersion": PROTOCOL_VERSION,
        "startedAt": 0,
        "serverTime": 0,
        "session": { "state": "recording" },
        "accountId": account_id,
        "passwordSaved": false,
        "lastLoginAt": null,
        "lastError": null,
        "storageError": null,
        "reloginAttempts": 0,
        "unsyncedFrames": unsynced_frames,
        "desktopPresent": true,
        "databaseBytes": 0,
        "droppedUnsyncedFrames": 0,
        "droppedAfterPasswordChange": 0,
        "webhookConfigured": false,
    })
}

fn frame(seq: i64, kind: FrameKind, payload: Value) -> WireFrame {
    WireFrame {
        seq,
        kind,
        received_at: format!("2026-10-28T00:00:{:02}Z", seq),
        account_id: SELF.into(),
        payload: payload.to_string(),
    }
}

fn friend_moved_frames() -> Value {
    json!({
        "frames": [
            frame(1, FrameKind::Snapshot, serde_json::to_value(SnapshotPayload {
                after_seq: Some(0),
                current_user: json!({
                    "id": SELF,
                    "friends": ["usr_a"],
                    "onlineFriends": ["usr_a"],
                    "offlineFriends": [],
                }),
                online_friends: vec![json!({
                    "id": "usr_a",
                    "displayName": "A",
                    "location": "wrld_x:1",
                    "status": "active",
                })],
                offline_friends: Vec::new(),
            }).unwrap()),
            frame(2, FrameKind::Message, json!({
                "type": "friend-location",
                "content": {
                    "userId": "usr_a",
                    "location": "wrld_y:2",
                    "user": { "id": "usr_a", "displayName": "A", "location": "wrld_y:2" },
                },
            })),
        ],
        "hasMore": false,
    })
}

fn gps_rows(db: &DatabaseService) -> i64 {
    feed_rows_query(
        db,
        FeedRowsQueryInput {
            user_id: SELF.into(),
            mode: FeedQueryMode::Lookup,
            search: String::new(),
            filters: Vec::new(),
            vip_list: Vec::new(),
            scoped_user_ids: Vec::new(),
            excluded_user_ids: Vec::new(),
            location_hidden_user_ids: Vec::new(),
            max_entries: 100,
            date_from: String::new(),
            date_to: String::new(),
            cursor: None,
        },
    )
    .map(|rows| rows.len() as i64)
    .unwrap_or(0)
}

#[tokio::test]
async fn a_recorder_that_followed_a_different_account_is_logged_out() {
    let session = session(Some(SAVED_RECORDER));
    session
        .recorder
        .respond("/credentials", json!({ "state": "recording" }));
    session.recorder.respond("/status", status("usr_other", 0));
    session.recorder.respond("/unpair", json!({}));

    let result = session
        .runtime
        .push_credentials("user".into(), "password".into(), false)
        .await;

    assert!(matches!(result, Err(FeedLoggerError::AccountMismatch)));
    assert!(session.recorder.calls().contains(&"/unpair".to_string()));
}

#[tokio::test]
async fn a_resumed_session_stores_each_recorded_segment_before_acknowledging_it() {
    let session = session(Some(SAVED_RECORDER));
    session.recorder.respond("/status", status(SELF, 2));
    session.recorder.respond("/frames", friend_moved_frames());
    session.recorder.respond("/ack", json!({}));
    let db = Arc::clone(&session.db);
    *session.recorder.on_ack.lock().unwrap() = Some(Box::new(move || gps_rows(&db)));

    let mut ticker = PresenceTicker::default();
    session
        .runtime
        .presence_tick(&mut ticker, SELF.into(), true, &session.tasks)
        .await;
    session.queued.run_all().await;

    assert_eq!(*session.recorder.rows_at_ack.lock().unwrap(), vec![1]);
}

#[tokio::test]
async fn frames_of_another_account_are_never_pulled() {
    let session = session(Some(SAVED_RECORDER));
    session.recorder.respond("/status", status("usr_other", 5));

    let mut ticker = PresenceTicker::default();
    session
        .runtime
        .presence_tick(&mut ticker, SELF.into(), true, &session.tasks)
        .await;
    session.queued.run_all().await;

    assert!(!session.recorder.calls().contains(&"/frames".to_string()));
    assert_eq!(gps_rows(&session.db), 0);
}

#[tokio::test]
async fn switching_accounts_leaves_the_previous_account_before_announcing_the_next() {
    let session = session(Some(SAVED_RECORDER));
    session.recorder.respond("/status", status(SELF, 0));
    let mut ticker = PresenceTicker::default();
    session
        .runtime
        .presence_tick(&mut ticker, "usr_first".into(), true, &session.tasks)
        .await;
    session.queued.run_all().await;
    session.recorder.calls.lock().unwrap().clear();

    session
        .runtime
        .presence_tick(&mut ticker, "usr_second".into(), true, &session.tasks)
        .await;

    let presence = session
        .recorder
        .calls()
        .into_iter()
        .filter(|call| call.starts_with("presence"))
        .collect::<Vec<_>>();
    assert_eq!(
        presence,
        vec![
            "presence usr_first leaving=true".to_string(),
            "presence usr_second leaving=false".to_string(),
        ]
    );
}

#[tokio::test]
async fn without_a_recorder_the_presence_loop_stays_idle() {
    let session = session(None);
    session.event_bus.take_events_for_test();

    let mut ticker = PresenceTicker::default();
    session
        .runtime
        .presence_tick(&mut ticker, SELF.into(), true, &session.tasks)
        .await;
    session.queued.run_all().await;

    assert!(session.recorder.calls().is_empty());
    assert_eq!(session.connector.connects.load(Ordering::Relaxed), 0);
    assert!(session.event_bus.take_events_for_test().is_empty());
}
