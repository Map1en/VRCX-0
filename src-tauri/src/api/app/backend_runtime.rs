#![allow(non_snake_case)]

use serde::{Deserialize, Serialize};
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendBackgroundJobRecordInput {
    pub name: String,
    #[serde(default = "default_frontend_owner")]
    pub owner: String,
    #[serde(default)]
    pub cadence_seconds: Option<u64>,
    pub status: String,
    #[serde(default)]
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendBackgroundFrontendJobDeferInput {
    pub name: String,
    pub delay_seconds: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendBackgroundFrontendJobDueClaimInput {
    pub name: String,
    pub cadence_seconds: u64,
    #[serde(default)]
    pub initial_delay_seconds: u64,
}

fn default_frontend_owner() -> String {
    "frontend".into()
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
pub fn app__backend_background_frontend_due_jobs_get(state: State<'_, AppState>) -> Vec<String> {
    state.backend_context.background_jobs.due_frontend_jobs()
}

#[tauri::command]
pub fn app__backend_background_frontend_job_defer(
    state: State<'_, AppState>,
    input: BackendBackgroundFrontendJobDeferInput,
) -> bool {
    state
        .backend_context
        .background_jobs
        .defer_frontend_job(&input.name, input.delay_seconds)
}

#[tauri::command]
pub fn app__backend_background_frontend_job_due_claim(
    state: State<'_, AppState>,
    input: BackendBackgroundFrontendJobDueClaimInput,
) -> bool {
    state
        .backend_context
        .background_jobs
        .claim_frontend_job_due(
            &input.name,
            input.cadence_seconds,
            input.initial_delay_seconds,
        )
}

#[tauri::command]
pub fn app__backend_background_frontend_schedules_reset(state: State<'_, AppState>) {
    state
        .backend_context
        .background_jobs
        .reset_frontend_schedules();
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

#[tauri::command]
pub fn app__backend_background_job_record(
    state: State<'_, AppState>,
    input: BackendBackgroundJobRecordInput,
) {
    let name = input.name.trim();
    if name.is_empty() {
        return;
    }

    let detail = input.detail.trim();
    state.backend_context.background_jobs.register_job(
        name,
        input.owner.trim(),
        input.cadence_seconds,
        input.status.trim(),
        detail,
    );
    match input.status.trim() {
        "running" => state
            .backend_context
            .background_jobs
            .mark_running(name, detail),
        "completed" | "idle" => state
            .backend_context
            .background_jobs
            .mark_completed(name, detail),
        "error" => state
            .backend_context
            .background_jobs
            .mark_failed(name, detail),
        status => state.backend_context.background_jobs.register_job(
            name,
            input.owner.trim(),
            input.cadence_seconds,
            status,
            detail,
        ),
    }
}
