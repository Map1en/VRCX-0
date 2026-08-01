#![allow(non_snake_case)]

use serde::Deserialize;
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application::{
    AuthenticatedRuntimePhaseSnapshot, AuthenticatedSessionMaintenanceOutcome,
};
use vrcx_0_application_game::DebugLoggingOutcome;

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeJobRecordInput {
    pub name: String,
    #[serde(default = "default_frontend_owner")]
    pub owner: String,
    #[serde(default)]
    pub cadence_seconds: Option<u64>,
    pub status: String,
    #[serde(default)]
    pub detail: String,
}

fn default_frontend_owner() -> String {
    "frontend".into()
}

#[tauri::command]
#[specta::specta]
pub fn app__game_client_debug_logging_status(
    state: State<'_, AppState>,
) -> Option<DebugLoggingOutcome> {
    state.game.game_client_runtime.debug_logging_outcome()
}

#[tauri::command]
#[specta::specta]
pub fn app__authenticated_session_maintenance_run(
    state: State<'_, AppState>,
) -> Result<AuthenticatedSessionMaintenanceOutcome, AppError> {
    Ok(state.authenticated_session_maintenance()?)
}

#[tauri::command]
#[specta::specta]
pub fn app__authenticated_runtime_phase_snapshot_get(
    state: State<'_, AppState>,
) -> AuthenticatedRuntimePhaseSnapshot {
    state.authenticated_runtime.snapshot()
}

#[tauri::command]
#[specta::specta]
pub async fn app__runtime_group_instances_refresh(
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.refresh_runtime_group_instances().await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__runtime_discord_reconcile_request(state: State<'_, AppState>) -> u64 {
    state.request_discord_reconcile()
}

#[tauri::command]
#[specta::specta]
pub fn app__runtime_background_job_record(
    state: State<'_, AppState>,
    input: RuntimeJobRecordInput,
) {
    let name = input.name.trim();
    if name.is_empty() {
        return;
    }

    let detail = input.detail.trim();
    state.runtime_context.background_jobs.register_job(
        name,
        input.owner.trim(),
        input.cadence_seconds,
        input.status.trim(),
        detail,
    );
    match input.status.trim() {
        "running" => state
            .runtime_context
            .background_jobs
            .mark_running(name, detail),
        "completed" | "idle" => state
            .runtime_context
            .background_jobs
            .mark_completed(name, detail),
        "error" => state
            .runtime_context
            .background_jobs
            .mark_failed(name, detail),
        status => state.runtime_context.background_jobs.register_job(
            name,
            input.owner.trim(),
            input.cadence_seconds,
            status,
            detail,
        ),
    }
}
