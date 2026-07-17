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
pub struct RuntimeCommandObservation {
    pub command: String,
    pub status: String,
    pub detail: String,
    pub observed_at: String,
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
}
