#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_runtime_host::telemetry::TelemetryClientEvent;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn app__telemetry_record_event(
    state: State<'_, AppState>,
    event: TelemetryClientEvent,
) -> Result<(), AppError> {
    state.telemetry.record_event(event);
    Ok(())
}
