#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::telemetry::TelemetryClientEvent;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn app__telemetry_record_event(
    state: State<'_, AppState>,
    event: TelemetryClientEvent,
) -> Result<(), AppError> {
    state.runtime_host().record_telemetry_event(event);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__telemetry_submit_feedback(
    state: State<'_, AppState>,
    content: String,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .submit_telemetry_feedback(&content)
        .await
        .map_err(AppError::from)
}
