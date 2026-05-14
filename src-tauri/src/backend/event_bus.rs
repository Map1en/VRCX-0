use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Default)]
pub struct BackendEventBus {
    app_handle: Arc<Mutex<Option<AppHandle>>>,
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
        let Some(app_handle) = self.app_handle() else {
            return;
        };
        let _ = app_handle.emit(event, payload);
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
}
