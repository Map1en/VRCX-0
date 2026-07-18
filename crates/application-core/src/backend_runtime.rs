use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::events::FriendProfileLoadStatusPayload;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BackendRuntimeMode {
    #[default]
    Foreground,
    Background,
    Headless,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BackendRuntimePhase {
    #[default]
    Idle,
    Starting,
    Authenticating,
    Running,
    Stopping,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackendRuntimeSnapshot {
    pub mode: BackendRuntimeMode,
    pub phase: BackendRuntimePhase,
    pub auth_status: String,
    pub auth_user_id: String,
    pub auth_display_name: String,
    pub ws_status: String,
    pub game_log_status: String,
    pub process_status: String,
    pub ws_message_counts: BTreeMap<String, u64>,
    pub ws_persisted_count: u64,
    pub game_log_persisted_count: u64,
    pub last_error: Option<String>,
    pub updated_at: String,
    pub friend_profile_load: FriendProfileLoadStatusPayload,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackendRuntimeTelemetry {
    pub kind: String,
    pub detail: String,
    pub snapshot: BackendRuntimeSnapshot,
}

#[derive(Clone, Debug)]
struct BackendRuntimeState {
    mode: BackendRuntimeMode,
    phase: BackendRuntimePhase,
    auth_status: String,
    auth_user_id: String,
    auth_display_name: String,
    ws_status: String,
    game_log_status: String,
    process_status: String,
    ws_message_counts: BTreeMap<String, u64>,
    ws_persisted_count: u64,
    game_log_persisted_count: u64,
    last_error: Option<String>,
    updated_at: String,
    friend_profile_load: FriendProfileLoadStatusPayload,
}

impl Default for BackendRuntimeState {
    fn default() -> Self {
        Self {
            mode: BackendRuntimeMode::Foreground,
            phase: BackendRuntimePhase::Idle,
            auth_status: "unknown".into(),
            auth_user_id: String::new(),
            auth_display_name: String::new(),
            ws_status: "idle".into(),
            game_log_status: "idle".into(),
            process_status: "unknown".into(),
            ws_message_counts: BTreeMap::new(),
            ws_persisted_count: 0,
            game_log_persisted_count: 0,
            last_error: None,
            updated_at: now_iso(),
            friend_profile_load: FriendProfileLoadStatusPayload::default(),
        }
    }
}

#[derive(Clone, Default)]
pub struct BackendRuntime {
    state: Arc<Mutex<BackendRuntimeState>>,
}

impl BackendRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_mode(&self, mode: BackendRuntimeMode) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.mode = mode;
        })
    }

    pub fn set_phase(&self, phase: BackendRuntimePhase) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.phase = phase;
            if phase != BackendRuntimePhase::Error {
                state.last_error = None;
            }
        })
    }

    pub fn set_error(&self, message: impl Into<String>) -> BackendRuntimeSnapshot {
        let message = message.into();
        self.update(|state| {
            state.phase = BackendRuntimePhase::Error;
            state.last_error = Some(message);
        })
    }

    pub fn set_authenticating(&self) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.phase = BackendRuntimePhase::Authenticating;
            state.auth_status = "authenticating".into();
            state.last_error = None;
        })
    }

    pub fn set_auth_success(
        &self,
        user_id: impl Into<String>,
        display_name: impl Into<String>,
    ) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.auth_status = "authenticated".into();
            state.auth_user_id = user_id.into();
            state.auth_display_name = display_name.into();
            state.last_error = None;
        })
    }

    pub fn set_auth_interaction_required(
        &self,
        reason: impl Into<String>,
    ) -> BackendRuntimeSnapshot {
        let reason = reason.into();
        self.update(|state| {
            state.phase = BackendRuntimePhase::Error;
            state.auth_status = "interactionRequired".into();
            state.last_error = Some(reason);
        })
    }

    pub fn set_auth_error(&self, reason: impl Into<String>) -> BackendRuntimeSnapshot {
        let reason = reason.into();
        self.update(|state| {
            state.phase = BackendRuntimePhase::Error;
            state.auth_status = "error".into();
            state.last_error = Some(reason);
        })
    }

    pub fn clear_authentication(&self) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.phase = BackendRuntimePhase::Idle;
            state.auth_status = "signedOut".into();
            state.auth_user_id.clear();
            state.auth_display_name.clear();
            state.ws_status = "idle".into();
            state.last_error = None;
        })
    }

    pub fn set_ws_status(&self, status: impl Into<String>) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.ws_status = status.into();
        })
    }

    pub fn record_ws_message(&self, message_type: impl Into<String>) -> BackendRuntimeSnapshot {
        let message_type = message_type.into();
        self.update(|state| {
            *state.ws_message_counts.entry(message_type).or_insert(0) += 1;
        })
    }

    pub fn add_ws_persisted(&self, count: u64) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.ws_persisted_count = state.ws_persisted_count.saturating_add(count);
        })
    }

    pub fn set_game_log_status(&self, status: impl Into<String>) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.game_log_status = status.into();
        })
    }

    pub fn add_game_log_persisted(&self, count: u64) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.game_log_status = "persisted".into();
            state.game_log_persisted_count = state.game_log_persisted_count.saturating_add(count);
        })
    }

    pub fn set_process_status(&self, status: impl Into<String>) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.process_status = status.into();
        })
    }

    pub fn set_friend_profile_load_state(
        &self,
        payload: FriendProfileLoadStatusPayload,
    ) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.friend_profile_load = payload;
        })
    }

    pub fn observe_runtime_event(
        &self,
        event: &str,
        payload: &Value,
    ) -> Option<BackendRuntimeTelemetry> {
        match event {
            "realtimeWsStatus" => {
                let status = string_field(payload, "status").unwrap_or_else(|| "unknown".into());
                let snapshot = self.set_ws_status(status.clone());
                Some(BackendRuntimeTelemetry {
                    kind: "wsStatus".into(),
                    detail: status,
                    snapshot,
                })
            }
            "runtimeGameLogEvent" => None,
            "friendProfileLoadStatus" => {
                if let Ok(status) =
                    serde_json::from_value::<FriendProfileLoadStatusPayload>(payload.clone())
                {
                    self.set_friend_profile_load_state(status);
                }
                None
            }
            "updateIsGameRunning" => {
                let running = payload
                    .get("isGameRunning")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let status = if running {
                    "vrchatRunning"
                } else {
                    "vrchatStopped"
                };
                let snapshot = self.set_process_status(status);
                Some(BackendRuntimeTelemetry {
                    kind: "processStatus".into(),
                    detail: status.into(),
                    snapshot,
                })
            }
            "backendRuntimeTelemetry" => {
                let kind = string_field(payload, "kind").unwrap_or_default();
                match kind.as_str() {
                    "wsMessage" => {
                        let message_type = string_field(payload, "messageType")
                            .unwrap_or_else(|| "unknown".into());
                        let snapshot = self.record_ws_message(message_type.clone());
                        Some(BackendRuntimeTelemetry {
                            kind,
                            detail: message_type,
                            snapshot,
                        })
                    }
                    "gameLogWatcher" => {
                        let status =
                            string_field(payload, "status").unwrap_or_else(|| "unknown".into());
                        let snapshot = self.set_game_log_status(status.clone());
                        Some(BackendRuntimeTelemetry {
                            kind,
                            detail: status,
                            snapshot,
                        })
                    }
                    "gameLogPersisted" => {
                        let count = u64_field(payload, "count")
                            .or_else(|| {
                                string_field(payload, "detail")
                                    .and_then(|value| value.parse::<u64>().ok())
                            })
                            .unwrap_or(0);
                        let snapshot = self.add_game_log_persisted(count);
                        Some(BackendRuntimeTelemetry {
                            kind,
                            detail: count.to_string(),
                            snapshot,
                        })
                    }
                    "wsPersisted" => {
                        let count = u64_field(payload, "count")
                            .or_else(|| {
                                string_field(payload, "detail")
                                    .and_then(|value| value.parse::<u64>().ok())
                            })
                            .unwrap_or(0);
                        let snapshot = self.add_ws_persisted(count);
                        Some(BackendRuntimeTelemetry {
                            kind,
                            detail: count.to_string(),
                            snapshot,
                        })
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    pub fn snapshot(&self) -> BackendRuntimeSnapshot {
        self.state_to_snapshot(&self.lock_state())
    }

    fn update(&self, update: impl FnOnce(&mut BackendRuntimeState)) -> BackendRuntimeSnapshot {
        let mut state = self.lock_state();
        update(&mut state);
        state.updated_at = now_iso();
        self.state_to_snapshot(&state)
    }

    fn state_to_snapshot(&self, state: &BackendRuntimeState) -> BackendRuntimeSnapshot {
        BackendRuntimeSnapshot {
            mode: state.mode,
            phase: state.phase,
            auth_status: state.auth_status.clone(),
            auth_user_id: state.auth_user_id.clone(),
            auth_display_name: state.auth_display_name.clone(),
            ws_status: state.ws_status.clone(),
            game_log_status: state.game_log_status.clone(),
            process_status: state.process_status.clone(),
            ws_message_counts: state.ws_message_counts.clone(),
            ws_persisted_count: state.ws_persisted_count,
            game_log_persisted_count: state.game_log_persisted_count,
            last_error: state.last_error.clone(),
            updated_at: state.updated_at.clone(),
            friend_profile_load: state.friend_profile_load.clone(),
        }
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, BackendRuntimeState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

fn string_field(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn u64_field(payload: &Value, key: &str) -> Option<u64> {
    payload.get(key).and_then(Value::as_u64)
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
