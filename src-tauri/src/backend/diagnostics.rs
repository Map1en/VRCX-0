use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use chrono::{SecondsFormat, Utc};
use serde::Serialize;

const MAX_COMMAND_OBSERVATIONS: usize = 100;

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendCommandGroupSnapshot {
    pub name: String,
    pub boundary: String,
    pub command_count: usize,
    pub examples: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendCommandObservation {
    pub command: String,
    pub status: String,
    pub detail: String,
    pub observed_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendDiagnosticsSnapshot {
    pub generic_sql_enabled: bool,
    pub frontend_ws_parsing_enabled: bool,
    pub command_groups: Vec<BackendCommandGroupSnapshot>,
    pub recent_commands: Vec<BackendCommandObservation>,
    pub notes: Vec<String>,
}

#[derive(Clone, Default)]
pub struct BackendDiagnostics {
    recent_commands: Arc<Mutex<VecDeque<BackendCommandObservation>>>,
}

impl BackendDiagnostics {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_command(
        &self,
        command: impl Into<String>,
        status: impl Into<String>,
        detail: impl Into<String>,
    ) {
        match self.recent_commands.lock() {
            Ok(mut commands) => {
                commands.push_back(BackendCommandObservation {
                    command: command.into(),
                    status: status.into(),
                    detail: detail.into(),
                    observed_at: now_iso(),
                });
                while commands.len() > MAX_COMMAND_OBSERVATIONS {
                    commands.pop_front();
                }
            }
            Err(error) => tracing::warn!("failed to lock backend diagnostics: {error}"),
        }
    }

    pub fn snapshot(&self) -> BackendDiagnosticsSnapshot {
        let recent_commands = match self.recent_commands.lock() {
            Ok(commands) => commands.iter().cloned().collect(),
            Err(error) => {
                tracing::warn!("failed to lock backend diagnostics: {error}");
                Vec::new()
            }
        };
        BackendDiagnosticsSnapshot {
            generic_sql_enabled: false,
            frontend_ws_parsing_enabled: false,
            command_groups: command_groups(),
            recent_commands,
            notes: vec![
                "Production SQL access is restricted to typed Rust commands.".into(),
                "Realtime WebSocket frames are parsed and persisted by Rust backend modules."
                    .into(),
                "Tauri host adapters are outside src-tauri/src/backend.".into(),
            ],
        }
    }
}

fn command_groups() -> Vec<BackendCommandGroupSnapshot> {
    vec![
        BackendCommandGroupSnapshot {
            name: "runtime".into(),
            boundary: "backend-owned runtime, diagnostics, sync and background snapshots".into(),
            command_count: 5,
            examples: vec![
                "app__backend_app_snapshot_get".into(),
                "app__backend_diagnostics_get".into(),
                "app__backend_sync_snapshot_get".into(),
            ],
        },
        BackendCommandGroupSnapshot {
            name: "local-data".into(),
            boundary: "typed Rust read/write access to the local SQLite model".into(),
            command_count: 98,
            examples: vec![
                "app__feed_rows_query".into(),
                "app__notification_add_v2".into(),
                "app__friend_log_history_add".into(),
            ],
        },
        BackendCommandGroupSnapshot {
            name: "vrchat-api".into(),
            boundary: "typed Rust API gateway commands grouped by business domain".into(),
            command_count: 18,
            examples: vec![
                "app__vrchat_auth_execute".into(),
                "app__vrchat_friend_execute".into(),
                "app__vrchat_world_execute".into(),
            ],
        },
        BackendCommandGroupSnapshot {
            name: "runtime-ingest".into(),
            boundary: "Rust-owned GameLog, GameClient and Realtime ingestion".into(),
            command_count: 11,
            examples: vec![
                "app__start_realtime_transport".into(),
                "app__sync_realtime_friend_snapshot".into(),
                "app__set_game_client_runtime_state".into(),
            ],
        },
    ]
}
