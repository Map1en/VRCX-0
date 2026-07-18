use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;

use super::process_monitor::{GameProcessEvent, GameProcessEventSink};
use crate::event_bus::RuntimeEventBus;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GameProcessStatus {
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
    pub changed_at: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RealtimeSessionContext {
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
}

#[derive(Clone, Debug, Default)]
pub struct BackgroundCapabilitySession {
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
    pub current_user_snapshot: Value,
}

impl RealtimeSessionContext {
    pub fn new(current_user_id: String, endpoint: String, websocket: String) -> Self {
        Self {
            current_user_id: current_user_id.trim().to_string(),
            endpoint: endpoint.trim().to_string(),
            websocket: websocket.trim().to_string(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HostSessionSnapshot {
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
    pub last_game_started_at: Option<String>,
    pub last_game_state_changed_at: Option<String>,
    pub generation: u64,
    pub realtime_generation: u64,
    pub realtime_context: Option<RealtimeSessionContext>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostSessionProjection {
    pub is_game_running: bool,
    #[serde(rename = "isSteamVRRunning")]
    pub is_steamvr_running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_game_started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_game_state_changed_at: Option<String>,
    pub generation: u64,
    pub game_changed: bool,
    pub steamvr_changed: bool,
    pub changed_at: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct HostSessionState {
    is_game_running: bool,
    is_steamvr_running: bool,
    last_game_started_at: Option<String>,
    last_game_state_changed_at: Option<String>,
    generation: u64,
    realtime_generation: u64,
    realtime_context: Option<RealtimeSessionContext>,
}

#[derive(Clone, Debug, Default)]
pub struct HostSessionRuntime {
    state: Arc<Mutex<HostSessionState>>,
}

impl HostSessionRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn apply_game_process_status(&self, status: GameProcessStatus) -> HostSessionProjection {
        let mut state = self.lock_state();
        let game_changed = state.is_game_running != status.is_game_running;
        let steamvr_changed = state.is_steamvr_running != status.is_steamvr_running;
        if game_changed || steamvr_changed {
            state.generation = state.generation.saturating_add(1);
            state.last_game_state_changed_at = Some(status.changed_at.clone());
        }
        if game_changed && status.is_game_running {
            state.last_game_started_at = Some(status.changed_at.clone());
        }
        state.is_game_running = status.is_game_running;
        state.is_steamvr_running = status.is_steamvr_running;

        HostSessionProjection {
            is_game_running: state.is_game_running,
            is_steamvr_running: state.is_steamvr_running,
            last_game_started_at: state.last_game_started_at.clone(),
            last_game_state_changed_at: state.last_game_state_changed_at.clone(),
            generation: state.generation,
            game_changed,
            steamvr_changed,
            changed_at: status.changed_at,
        }
    }

    pub fn snapshot(&self) -> HostSessionSnapshot {
        let state = self.lock_state();
        HostSessionSnapshot {
            is_game_running: state.is_game_running,
            is_steamvr_running: state.is_steamvr_running,
            last_game_started_at: state.last_game_started_at.clone(),
            last_game_state_changed_at: state.last_game_state_changed_at.clone(),
            generation: state.generation,
            realtime_generation: state.realtime_generation,
            realtime_context: state.realtime_context.clone(),
        }
    }

    pub fn set_realtime_context(&self, context: RealtimeSessionContext) -> u64 {
        let mut state = self.lock_state();
        state.realtime_generation = state.realtime_generation.saturating_add(1);
        state.realtime_context = Some(context);
        state.realtime_generation
    }

    pub fn clear_realtime_context(&self) -> u64 {
        let mut state = self.lock_state();
        state.realtime_generation = state.realtime_generation.saturating_add(1);
        state.realtime_context = None;
        state.realtime_generation
    }

    pub fn clear_realtime_context_if_generation(&self, generation: u64) -> bool {
        let mut state = self.lock_state();
        if state.realtime_generation != generation {
            return false;
        }
        state.realtime_generation = state.realtime_generation.saturating_add(1);
        state.realtime_context = None;
        true
    }

    pub fn is_realtime_generation_active(&self, generation: u64) -> bool {
        let state = self.lock_state();
        state.realtime_generation == generation && state.realtime_context.is_some()
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, HostSessionState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

#[derive(Clone)]
pub struct SessionHostRuntime {
    session: HostSessionRuntime,
    event_bus: RuntimeEventBus,
}

impl SessionHostRuntime {
    pub fn new(session: HostSessionRuntime, event_bus: RuntimeEventBus) -> Self {
        Self { session, event_bus }
    }
}

impl GameProcessEventSink for SessionHostRuntime {
    fn on_game_process_event(&self, event: GameProcessEvent) -> crate::Result<()> {
        let projection = self.session.apply_game_process_status(GameProcessStatus {
            is_game_running: event.is_game_running,
            is_steamvr_running: event.is_steamvr_running,
            changed_at: chrono::Utc::now()
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string(),
        });

        if projection.game_changed || projection.steamvr_changed {
            self.event_bus.emit_game_process_status(projection);
        }

        Ok(())
    }
}
