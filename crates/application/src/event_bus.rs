use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;

use crate::game_log::GameLogProjection;
use crate::overlay_activity::OverlayActivitySnapshot;
use crate::realtime::{
    FriendProjection, RealtimeCurrentUserProjection, RealtimeInstanceClosedProjection,
    RealtimeInstanceQueueProjection, RealtimeNotificationProjection,
};
use crate::session::HostSessionProjection;
use vrcx_0_core::realtime::RealtimeWsStatusPayload;
use vrcx_0_persistence::game_log::GameLogWriteBatch;

pub trait RuntimeEventSink: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
}

#[cfg(any(test, feature = "test-utils"))]
#[derive(Clone, Debug)]
pub struct RuntimeEventForTest {
    pub name: String,
    pub payload: Value,
}

#[derive(Clone, Default)]
pub struct RuntimeEventBus {
    sink: Arc<Mutex<Option<Arc<dyn RuntimeEventSink>>>>,
    #[cfg(any(test, feature = "test-utils"))]
    events: Arc<Mutex<Vec<RuntimeEventForTest>>>,
}

impl RuntimeEventBus {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_sink<S>(&self, sink: S)
    where
        S: RuntimeEventSink + 'static,
    {
        *self.sink.lock().unwrap() = Some(Arc::new(sink));
    }

    pub fn emit<T: Serialize>(&self, event: &str, payload: T) {
        match serde_json::to_value(payload) {
            Ok(value) => self.emit_value(event, value),
            Err(error) => {
                tracing::warn!(event, error = %error, "failed to serialize runtime event payload");
            }
        }
    }

    fn emit_value(&self, event: &str, payload: Value) {
        #[cfg(any(test, feature = "test-utils"))]
        {
            self.events.lock().unwrap().push(RuntimeEventForTest {
                name: event.to_string(),
                payload: payload.clone(),
            });
        }

        let sink = self.sink.lock().unwrap().clone();
        if let Some(sink) = sink {
            sink.emit(event, payload);
        }
    }

    #[cfg(any(test, feature = "test-utils"))]
    pub fn take_events_for_test(&self) -> Vec<RuntimeEventForTest> {
        std::mem::take(&mut *self.events.lock().unwrap())
    }

    pub fn emit_game_log_side_effect(&self, kind: &str, payload: Value) {
        self.emit(
            "gameLogSideEffect",
            serde_json::json!({
                "kind": kind,
                "payload": payload,
            }),
        );
    }

    pub fn emit_game_client_event(&self, kind: &str, payload: Value) {
        self.emit(
            "gameClientEvent",
            serde_json::json!({
                "kind": kind,
                "payload": payload,
            }),
        );
    }

    pub fn emit_runtime_game_log_event(&self, raw: Vec<String>) {
        self.emit(
            "runtimeGameLogEvent",
            serde_json::json!({
                "runtimePersisted": true,
                "raw": raw,
            }),
        );
    }

    pub fn emit_game_log_persisted(&self, count: u64) {
        self.emit_backend_runtime_telemetry(serde_json::json!({
            "kind": "gameLogPersisted",
            "count": count,
        }));
    }

    pub fn emit_ws_persisted(&self, count: u64) {
        self.emit_backend_runtime_telemetry(serde_json::json!({
            "kind": "wsPersisted",
            "count": count,
        }));
    }

    pub fn emit_game_log_projection(&self, projection: GameLogProjection) {
        self.emit("gameLogProjection", projection);
    }

    pub fn emit_game_log_persistence_fallback(
        &self,
        batch: &GameLogWriteBatch,
        raw_rows: Vec<Vec<String>>,
        error: &str,
    ) {
        // Compatibility event name. This is telemetry-only; the WebView must not
        // write the batch as a fallback for runtime-originated GameLog events.
        self.emit(
            "gameLogPersistenceFallback",
            serde_json::json!({
                "batch": batch,
                "rawRows": raw_rows,
                "error": error,
            }),
        );
    }

    pub fn emit_ipc_event(&self, packet: &str) {
        self.emit("ipcEvent", packet.to_string());
    }

    pub fn emit_runtime_worker_error(&self, worker: &str, message: &str) {
        self.emit(
            "runtimeWorkerError",
            serde_json::json!({
                "worker": worker,
                "message": message,
            }),
        );
    }

    pub fn emit_game_process_status(&self, payload: HostSessionProjection) {
        self.emit("updateIsGameRunning", payload);
    }

    pub fn emit_realtime_ws_status(&self, payload: RealtimeWsStatusPayload) {
        self.emit("realtimeWsStatus", payload);
    }

    pub fn emit_backend_runtime_telemetry(&self, payload: Value) {
        self.emit("backendRuntimeTelemetry", payload);
    }

    pub fn emit_realtime_friend_projection(&self, payload: FriendProjection) {
        self.emit("realtimeFriendProjection", payload);
    }

    pub fn emit_realtime_notification_projection(&self, payload: RealtimeNotificationProjection) {
        self.emit("realtimeNotificationProjection", payload);
    }

    pub fn emit_realtime_current_user_projection(&self, payload: RealtimeCurrentUserProjection) {
        self.emit("realtimeCurrentUserProjection", payload);
    }

    pub fn emit_runtime_group_instances_projection(&self, payload: Value) {
        self.emit("runtimeGroupInstancesProjection", payload);
    }

    pub fn emit_realtime_instance_closed_projection(
        &self,
        payload: RealtimeInstanceClosedProjection,
    ) {
        self.emit("realtimeInstanceClosedProjection", payload);
    }

    pub fn emit_realtime_instance_queue_projection(
        &self,
        payload: RealtimeInstanceQueueProjection,
    ) {
        self.emit("realtimeInstanceQueueProjection", payload);
    }

    pub fn emit_overlay_activity_snapshot(&self, payload: OverlayActivitySnapshot) {
        self.emit("overlayActivitySnapshot", payload);
    }
}
