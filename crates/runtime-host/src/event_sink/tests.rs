use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use vrcx_0_application::{BackendRuntime, ImageCache, RuntimeEventSink, WebClient};
use vrcx_0_persistence::{storage::StorageService, DatabaseService};

use super::*;

#[derive(Clone, Debug, PartialEq)]
struct RecordedEvent {
    name: String,
    payload: Value,
}

#[derive(Clone, Default)]
struct RecordingSink {
    events: Arc<Mutex<Vec<RecordedEvent>>>,
}

impl RecordingSink {
    fn events(&self) -> Vec<RecordedEvent> {
        self.events.lock().unwrap().clone()
    }
}

impl RuntimeEventSink for RecordingSink {
    fn emit(&self, event: &str, payload: Value) {
        self.events.lock().unwrap().push(RecordedEvent {
            name: event.to_string(),
            payload,
        });
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
            "vrcx-0-runtime-host-event-sink-{name}-{}-{nonce}",
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

fn test_context(name: &str) -> (TestDir, Arc<RuntimeHostContext>) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    let storage = StorageService::new(&dir.path.join("storage.json")).unwrap();
    let web = Arc::new(
        WebClient::new(
            &storage,
            db.as_ref(),
            "https://app.example".to_string(),
            env!("CARGO_PKG_VERSION"),
        )
        .unwrap(),
    );
    let image_cache = Arc::new(
        ImageCache::new(dir.path.join("ImageCache"), web.image_fetcher().unwrap()).unwrap(),
    );
    let context = Arc::new(RuntimeHostContext::new(db, web, image_cache));
    (dir, context)
}

#[test]
fn ordinary_event_is_forwarded_unchanged_before_one_derived_telemetry_event() {
    let (_dir, context) = test_context("ordinary-event");
    let backend_runtime = BackendRuntime::new();
    let recording = RecordingSink::default();
    let sink = RuntimeHostEventSink::new(backend_runtime, context, recording.clone());
    let payload = json!({ "status": "connected", "attempt": 2 });

    sink.emit("realtimeWsStatus", payload.clone());

    let events = recording.events();
    assert_eq!(events.len(), 2);
    assert_eq!(
        events[0],
        RecordedEvent {
            name: "realtimeWsStatus".to_string(),
            payload,
        }
    );
    assert_eq!(events[1].name, "backendRuntimeTelemetry");
    assert_eq!(events[1].payload["kind"], "wsStatus");
    assert_eq!(events[1].payload["detail"], "connected");
    assert_eq!(events[1].payload["snapshot"]["wsStatus"], "connected");
}

#[test]
fn telemetry_with_snapshot_passes_through_without_observation() {
    let (_dir, context) = test_context("snapshot-telemetry");
    let backend_runtime = BackendRuntime::new();
    let recording = RecordingSink::default();
    let sink = RuntimeHostEventSink::new(backend_runtime.clone(), context, recording.clone());
    let payload = json!({
        "kind": "wsMessage",
        "messageType": "notification",
        "snapshot": { "source": "upstream" }
    });

    sink.emit("backendRuntimeTelemetry", payload.clone());

    assert_eq!(
        recording.events(),
        vec![RecordedEvent {
            name: "backendRuntimeTelemetry".to_string(),
            payload,
        }]
    );
    assert!(backend_runtime.snapshot().ws_message_counts.is_empty());
}

#[test]
fn telemetry_without_snapshot_is_not_dropped_when_observer_has_no_output() {
    let (_dir, context) = test_context("unobserved-telemetry");
    let recording = RecordingSink::default();
    let sink = RuntimeHostEventSink::new(BackendRuntime::new(), context, recording.clone());
    let payload = json!({ "kind": "runtimeStarted", "detail": "ready" });

    sink.emit("backendRuntimeTelemetry", payload.clone());

    assert_eq!(
        recording.events(),
        vec![RecordedEvent {
            name: "backendRuntimeTelemetry".to_string(),
            payload,
        }]
    );
}

#[test]
fn event_is_observed_by_context_and_forwarded() {
    let (_dir, context) = test_context("context-observation");
    let recording = RecordingSink::default();
    let sink = RuntimeHostEventSink::new(
        BackendRuntime::new(),
        Arc::clone(&context),
        recording.clone(),
    );
    let payload = json!({
        "kind": "nowPlaying",
        "payload": {
            "name": "Test Track",
            "position": 42
        }
    });

    sink.emit("gameLogSideEffect", payload.clone());

    assert_eq!(context.now_playing()["name"], "Test Track");
    assert_eq!(context.now_playing()["position"], 42);
    assert_eq!(
        recording.events(),
        vec![RecordedEvent {
            name: "gameLogSideEffect".to_string(),
            payload,
        }]
    );
}
