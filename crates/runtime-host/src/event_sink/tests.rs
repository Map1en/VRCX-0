use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use vrcx_0_application_core::{BackendRuntime, BackendRuntimeTelemetry, RuntimeEventSink};

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

#[derive(Default)]
struct RecordingProfileExtension {
    now_playing: Mutex<Value>,
}

impl RecordingProfileExtension {
    fn now_playing(&self) -> Value {
        self.now_playing.lock().unwrap().clone()
    }
}

impl RuntimeHostProfileExtension for RecordingProfileExtension {
    fn observe_runtime_event(&self, event: &str, payload: &Value) {
        if event == "gameLogSideEffect"
            && payload.get("kind").and_then(Value::as_str) == Some("nowPlaying")
        {
            *self.now_playing.lock().unwrap() = payload["payload"].clone();
        }
    }
}

#[test]
fn ordinary_event_is_forwarded_unchanged_before_one_derived_telemetry_event() {
    let backend_runtime = BackendRuntime::new();
    let recording = RecordingSink::default();
    let sink = RuntimeHostEventSink::new(backend_runtime, None, recording.clone());
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
fn typed_backend_runtime_telemetry_passes_through_without_observation() {
    let backend_runtime = BackendRuntime::new();
    let recording = RecordingSink::default();
    let sink = RuntimeHostEventSink::new(backend_runtime.clone(), None, recording.clone());
    let payload = serde_json::to_value(BackendRuntimeTelemetry {
        kind: "runtimeStarted".into(),
        detail: "ready".into(),
        snapshot: backend_runtime.snapshot(),
    })
    .unwrap();

    sink.emit("backendRuntimeTelemetry", payload.clone());

    assert_eq!(
        recording.events(),
        vec![RecordedEvent {
            name: "backendRuntimeTelemetry".into(),
            payload,
        }]
    );
}

#[test]
fn telemetry_with_invalid_snapshot_is_normalized_without_observation() {
    let backend_runtime = BackendRuntime::new();
    let recording = RecordingSink::default();
    let sink = RuntimeHostEventSink::new(backend_runtime.clone(), None, recording.clone());
    let payload = json!({
        "kind": "wsMessage",
        "messageType": "notification",
        "snapshot": { "source": "upstream" }
    });

    sink.emit("backendRuntimeTelemetry", payload);

    let events = recording.events();
    assert_eq!(events.len(), 1);
    let event = &events[0];
    assert_eq!(event.name, "backendRuntimeTelemetry");
    assert_eq!(event.payload["kind"], "wsMessage");
    assert_eq!(event.payload["detail"], "notification");
    assert_eq!(event.payload["snapshot"]["wsMessageCounts"], json!({}));
    assert!(backend_runtime.snapshot().ws_message_counts.is_empty());
}

#[test]
fn telemetry_without_snapshot_is_normalized_when_observer_has_no_output() {
    let backend_runtime = BackendRuntime::new();
    let recording = RecordingSink::default();
    let sink = RuntimeHostEventSink::new(backend_runtime, None, recording.clone());
    let payload = json!({ "kind": "runtimeStarted", "detail": "ready" });

    sink.emit("backendRuntimeTelemetry", payload);

    let events = recording.events();
    assert_eq!(events.len(), 1);
    let event = &events[0];
    assert_eq!(event.name, "backendRuntimeTelemetry");
    assert_eq!(event.payload["kind"], "runtimeStarted");
    assert_eq!(event.payload["detail"], "ready");
    assert!(event.payload["snapshot"].is_object());
}

#[test]
fn event_is_observed_by_context_and_forwarded() {
    let context = Arc::new(RecordingProfileExtension::default());
    let recording = RecordingSink::default();
    let sink = RuntimeHostEventSink::new(
        BackendRuntime::new(),
        Some(context.clone()),
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
