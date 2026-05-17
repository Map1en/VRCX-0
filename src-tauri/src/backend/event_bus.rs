use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;

use crate::backend::realtime::types::RealtimeWsStatusPayload;
use vrcx_0_runtime::game_log::runtime_state::GameLogProjection;
use vrcx_0_runtime::realtime::types::{
    FriendProjection, RealtimeCurrentUserProjection, RealtimeInstanceClosedProjection,
    RealtimeNotificationProjection,
};
use vrcx_0_runtime::session::HostSessionProjection;
use vrcx_0_store::game_log::GameLogWriteBatch;

pub trait BackendEventSink: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
}

#[cfg(test)]
#[derive(Clone, Debug)]
pub struct BackendEventForTest {
    pub name: String,
    pub payload: Value,
}

#[derive(Clone, Default)]
pub struct BackendEventBus {
    sink: Arc<Mutex<Option<Arc<dyn BackendEventSink>>>>,
    #[cfg(test)]
    events: Arc<Mutex<Vec<BackendEventForTest>>>,
}

impl BackendEventBus {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_sink<S>(&self, sink: S)
    where
        S: BackendEventSink + 'static,
    {
        *self.sink.lock().unwrap() = Some(Arc::new(sink));
    }

    pub fn emit<T: Serialize>(&self, event: &str, payload: T) {
        match serde_json::to_value(payload) {
            Ok(value) => self.emit_value(event, value),
            Err(error) => {
                tracing::warn!(event, error = %error, "failed to serialize backend event payload");
            }
        }
    }

    fn emit_value(&self, event: &str, payload: Value) {
        #[cfg(test)]
        {
            self.events.lock().unwrap().push(BackendEventForTest {
                name: event.to_string(),
                payload: payload.clone(),
            });
        }

        let sink = self.sink.lock().unwrap().clone();
        if let Some(sink) = sink {
            sink.emit(event, payload);
        }
    }

    #[cfg(test)]
    pub fn take_events_for_test(&self) -> Vec<BackendEventForTest> {
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

    pub fn emit_backend_game_log_event(&self, raw: Vec<String>) {
        self.emit(
            "addGameLogEvent",
            serde_json::json!({
                "backendPersisted": true,
                "raw": raw,
            }),
        );
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
        // write the batch as a fallback for backend-originated GameLog events.
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

    pub fn emit_backend_worker_error(&self, worker: &str, message: &str) {
        self.emit(
            "backendWorkerError",
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

    pub fn emit_realtime_friend_projection(&self, payload: FriendProjection) {
        self.emit("realtimeFriendProjection", payload);
    }

    pub fn emit_realtime_notification_projection(&self, payload: RealtimeNotificationProjection) {
        self.emit("realtimeNotificationProjection", payload);
    }

    pub fn emit_realtime_current_user_projection(&self, payload: RealtimeCurrentUserProjection) {
        self.emit("realtimeCurrentUserProjection", payload);
    }

    pub fn emit_realtime_instance_closed_projection(
        &self,
        payload: RealtimeInstanceClosedProjection,
    ) {
        self.emit("realtimeInstanceClosedProjection", payload);
    }
}
