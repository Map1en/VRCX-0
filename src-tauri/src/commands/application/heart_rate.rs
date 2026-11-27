#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_game::heart_rate::{
    HeartRateParameters, HeartRateParametersEditor, HeartRateStatus,
};

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn app__heart_rate_status_get(state: State<'_, AppState>) -> HeartRateStatus {
    state.runtime_host().heart_rate().refreshed_status()
}

#[tauri::command]
#[specta::specta]
pub async fn app__heart_rate_connected_set(
    state: State<'_, AppState>,
    connected: bool,
) -> Result<HeartRateStatus, AppError> {
    let heart_rate = state.runtime_host().heart_rate();
    run_blocking("heart rate connection", move || {
        heart_rate.set_connected(connected)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__heart_rate_send_parameters_set(
    state: State<'_, AppState>,
    send_parameters: bool,
) -> Result<HeartRateStatus, AppError> {
    let heart_rate = state.runtime_host().heart_rate();
    run_blocking("heart rate send parameters", move || {
        heart_rate.set_send_parameters(send_parameters)
    })
    .await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__heart_rate_parameters_get(state: State<'_, AppState>) -> HeartRateParametersEditor {
    state.runtime_host().heart_rate().parameters_editor()
}

#[tauri::command]
#[specta::specta]
pub async fn app__heart_rate_parameters_set(
    state: State<'_, AppState>,
    parameters: HeartRateParameters,
) -> Result<HeartRateParameters, AppError> {
    let heart_rate = state.runtime_host().heart_rate();
    run_blocking("heart rate parameters", move || {
        heart_rate.set_parameters(parameters)
    })
    .await
}
