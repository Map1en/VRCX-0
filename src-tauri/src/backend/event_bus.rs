use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

#[cfg(test)]
#[derive(Clone, Debug)]
pub struct BackendEventForTest {
    pub name: String,
    pub payload: Value,
}

#[derive(Clone, Default)]
pub struct BackendEventBus {
    app_handle: Arc<Mutex<Option<AppHandle>>>,
    #[cfg(test)]
    events: Arc<Mutex<Vec<BackendEventForTest>>>,
}

impl BackendEventBus {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_app_handle(&self, app_handle: AppHandle) {
        *self.app_handle.lock().unwrap() = Some(app_handle);
    }

    pub fn app_handle(&self) -> Option<AppHandle> {
        self.app_handle.lock().unwrap().clone()
    }

    pub fn emit<T: Serialize + Clone>(&self, event: &str, payload: T) {
        #[cfg(test)]
        if let Ok(value) = serde_json::to_value(payload.clone()) {
            self.events.lock().unwrap().push(BackendEventForTest {
                name: event.to_string(),
                payload: value,
            });
        }

        let Some(app_handle) = self.app_handle() else {
            return;
        };
        let _ = app_handle.emit(event, payload);
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
}
