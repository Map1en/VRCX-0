use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use chrono::{SecondsFormat, Utc};
use serde::Serialize;

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePhaseSnapshot {
    pub name: String,
    pub status: String,
    pub detail: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLifecycleSnapshot {
    pub started_at: String,
    pub host_services_started: bool,
    pub phases: Vec<RuntimePhaseSnapshot>,
}

#[derive(Default)]
struct RuntimeLifecycleState {
    host_services_started: bool,
    phases: BTreeMap<String, RuntimePhaseSnapshot>,
}

#[derive(Clone)]
pub struct RuntimeLifecycle {
    started_at: String,
    inner: Arc<Mutex<RuntimeLifecycleState>>,
}

impl RuntimeLifecycle {
    pub fn new() -> Self {
        Self {
            started_at: now_iso(),
            inner: Arc::new(Mutex::new(RuntimeLifecycleState::default())),
        }
    }

    pub fn record_phase(
        &self,
        name: impl Into<String>,
        status: impl Into<String>,
        detail: impl Into<String>,
    ) {
        let name = name.into();
        let status = status.into();
        let detail = detail.into();
        match self.inner.lock() {
            Ok(mut state) => {
                state.phases.insert(
                    name.clone(),
                    RuntimePhaseSnapshot {
                        name,
                        status,
                        detail,
                        updated_at: now_iso(),
                    },
                );
            }
            Err(error) => tracing::warn!("failed to lock runtime lifecycle: {error}"),
        }
    }

    pub fn set_host_services_started(&self, started: bool, detail: impl Into<String>) {
        match self.inner.lock() {
            Ok(mut state) => {
                state.host_services_started = started;
            }
            Err(error) => tracing::warn!("failed to lock runtime lifecycle: {error}"),
        }
        self.record_phase(
            "hostServices",
            if started { "completed" } else { "pending" },
            detail,
        );
    }

    pub fn snapshot(&self) -> RuntimeLifecycleSnapshot {
        match self.inner.lock() {
            Ok(state) => RuntimeLifecycleSnapshot {
                started_at: self.started_at.clone(),
                host_services_started: state.host_services_started,
                phases: state.phases.values().cloned().collect(),
            },
            Err(error) => {
                tracing::warn!("failed to lock runtime lifecycle: {error}");
                RuntimeLifecycleSnapshot {
                    started_at: self.started_at.clone(),
                    host_services_started: false,
                    phases: Vec::new(),
                }
            }
        }
    }
}

impl Default for RuntimeLifecycle {
    fn default() -> Self {
        Self::new()
    }
}
