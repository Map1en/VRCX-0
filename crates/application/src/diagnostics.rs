use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use chrono::{SecondsFormat, Utc};
use serde::Serialize;

const MAX_COMMAND_OBSERVATIONS: usize = 100;

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCommandGroupSnapshot {
    pub name: String,
    pub boundary: String,
    pub command_count: usize,
    pub examples: Vec<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCommandObservation {
    pub command: String,
    pub status: String,
    pub detail: String,
    pub observed_at: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiagnosticsSnapshot {
    pub generic_sql_enabled: bool,
    pub frontend_ws_parsing_enabled: bool,
    pub command_groups: Vec<RuntimeCommandGroupSnapshot>,
    pub recent_commands: Vec<RuntimeCommandObservation>,
    pub notes: Vec<String>,
}

#[derive(Clone, Default)]
pub struct RuntimeDiagnostics {
    recent_commands: Arc<Mutex<VecDeque<RuntimeCommandObservation>>>,
}

impl RuntimeDiagnostics {
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
                commands.push_back(RuntimeCommandObservation {
                    command: command.into(),
                    status: status.into(),
                    detail: detail.into(),
                    observed_at: now_iso(),
                });
                while commands.len() > MAX_COMMAND_OBSERVATIONS {
                    commands.pop_front();
                }
            }
            Err(error) => tracing::warn!("failed to lock runtime diagnostics: {error}"),
        }
    }

    pub fn snapshot(&self) -> RuntimeDiagnosticsSnapshot {
        let recent_commands = match self.recent_commands.lock() {
            Ok(commands) => commands.iter().cloned().collect(),
            Err(error) => {
                tracing::warn!("failed to lock runtime diagnostics: {error}");
                Vec::new()
            }
        };
        RuntimeDiagnosticsSnapshot {
            generic_sql_enabled: false,
            frontend_ws_parsing_enabled: false,
            command_groups: command_groups(),
            recent_commands,
            notes: vec![
                "Production SQL access is restricted to typed Rust commands.".into(),
                "Realtime WebSocket frames are parsed and persisted by Rust runtime modules."
                    .into(),
                "Tauri host adapters are outside src-tauri/src/adapters.".into(),
            ],
        }
    }
}

fn command_groups() -> Vec<RuntimeCommandGroupSnapshot> {
    vec![
        RuntimeCommandGroupSnapshot {
            name: "runtime".into(),
            boundary: "runtime-owned runtime, diagnostics, sync and background snapshots".into(),
            command_count: 5,
            examples: vec![
                "app__runtime_app_snapshot_get".into(),
                "app__runtime_diagnostics_get".into(),
                "app__runtime_sync_snapshot_get".into(),
            ],
        },
        RuntimeCommandGroupSnapshot {
            name: "local-data".into(),
            boundary: "typed Rust read/write access to the local SQLite model".into(),
            command_count: 98,
            examples: vec![
                "app__feed_rows_query".into(),
                "app__notification_add_v2".into(),
                "app__friend_log_history_add".into(),
            ],
        },
        RuntimeCommandGroupSnapshot {
            name: "vrchat-api".into(),
            boundary: "typed Rust API and API-backed local actions grouped by business domain"
                .into(),
            command_count: 149,
            examples: vec![
                "app__runtime_auth_scope_current_user_get".into(),
                "app__vrchat_search_worlds_get".into(),
                "app__vrchat_tools_calendars_get".into(),
                "app__vrchat_media_files_get".into(),
                "app__vrchat_media_inventory_items_get".into(),
                "app__vrchat_favorites_get".into(),
                "app__vrchat_favorite_add".into(),
                "app__vrchat_friends_get".into(),
                "app__vrchat_user_get".into(),
                "app__vrchat_notification_mark_seen".into(),
                "app__vrchat_avatar_get".into(),
                "app__vrchat_avatar_save".into(),
                "app__vrchat_group_members_get".into(),
                "app__vrchat_group_join".into(),
                "app__user_group_quick_moderation_get".into(),
                "app__social_friend_roster_baseline_get".into(),
                "app__vrchat_world_get".into(),
            ],
        },
        RuntimeCommandGroupSnapshot {
            name: "external-api".into(),
            boundary: "typed Rust access to allowed non-VRChat HTTP integrations".into(),
            command_count: 6,
            examples: vec![
                "app__external_api_avatar_search_get".into(),
                "app__external_api_translation_request".into(),
                "app__external_api_vrc_status_json_get".into(),
            ],
        },
        RuntimeCommandGroupSnapshot {
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
