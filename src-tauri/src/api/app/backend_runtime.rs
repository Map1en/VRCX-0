#![allow(non_snake_case)]

use serde::Serialize;
use tauri::State;

use crate::backend::background::BackendBackgroundJobSnapshot;
use crate::backend::diagnostics::BackendDiagnosticsSnapshot;
use crate::backend::runtime::BackendRuntimeSnapshot;
use crate::backend::sync::BackendSyncSnapshot;
use crate::state::AppState;
use vrcx_0_runtime::game_log::runtime_state::{
    PlayerState, RuntimeSnapshot as GameLogRuntimeSnapshot,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAppSnapshot {
    pub runtime: BackendRuntimeSnapshot,
    pub background_jobs: Vec<BackendBackgroundJobSnapshot>,
    pub sync: BackendSyncSnapshot,
    pub diagnostics: BackendDiagnosticsSnapshot,
    pub game_log: BackendGameLogRuntimeSnapshot,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGameLogRuntimeSnapshot {
    pub location: String,
    pub world_name: String,
    pub destination: String,
    pub players: Vec<PlayerState>,
}

impl From<GameLogRuntimeSnapshot> for BackendGameLogRuntimeSnapshot {
    fn from(snapshot: GameLogRuntimeSnapshot) -> Self {
        Self {
            location: snapshot.location,
            world_name: snapshot.world_name,
            destination: snapshot.destination,
            players: snapshot.players,
        }
    }
}

#[tauri::command]
pub fn app__backend_runtime_snapshot_get(state: State<'_, AppState>) -> BackendRuntimeSnapshot {
    state.backend_context.runtime.snapshot()
}

#[tauri::command]
pub fn app__backend_background_jobs_snapshot_get(
    state: State<'_, AppState>,
) -> Vec<BackendBackgroundJobSnapshot> {
    state.backend_context.background_jobs.snapshot()
}

#[tauri::command]
pub fn app__backend_sync_snapshot_get(state: State<'_, AppState>) -> BackendSyncSnapshot {
    state.backend_context.sync.snapshot()
}

#[tauri::command]
pub fn app__backend_diagnostics_get(state: State<'_, AppState>) -> BackendDiagnosticsSnapshot {
    state.backend_context.diagnostics.snapshot()
}

#[tauri::command]
pub fn app__backend_app_snapshot_get(state: State<'_, AppState>) -> BackendAppSnapshot {
    BackendAppSnapshot {
        runtime: state.backend_context.runtime.snapshot(),
        background_jobs: state.backend_context.background_jobs.snapshot(),
        sync: state.backend_context.sync.snapshot(),
        diagnostics: state.backend_context.diagnostics.snapshot(),
        game_log: state.backend_context.game_log_snapshot().into(),
    }
}
