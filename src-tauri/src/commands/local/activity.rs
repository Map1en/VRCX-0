#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_application_activity::activity_page::{ActivityPageBuildInput, ActivityPageView};
use vrcx_0_contracts::activity_page::{
    ActivityJourneyDayInput, ActivityJourneyDaysInput, ActivityJourneyVisit,
};
use vrcx_0_contracts::activity_view::{
    ActivityOverlapViewBuildInput, ActivityOverlapViewOutput, ActivityViewBuildInput,
    ActivityViewOutput,
};

#[tauri::command]
#[specta::specta]
pub async fn app__activity_overlap_view(
    state: State<'_, AppState>,
    input: ActivityOverlapViewBuildInput,
) -> Result<ActivityOverlapViewOutput, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    tauri::async_runtime::spawn_blocking(move || local_data.activity_overlap_view(input))
        .await
        .map_err(|error| AppError::Custom(format!("activity overlap view task: {error}")))?
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__activity_view(
    state: State<'_, AppState>,
    input: ActivityViewBuildInput,
) -> Result<ActivityViewOutput, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    tauri::async_runtime::spawn_blocking(move || local_data.activity_view(input))
        .await
        .map_err(|error| AppError::Custom(format!("activity view task: {error}")))?
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__activity_page_view(
    state: State<'_, AppState>,
    input: ActivityPageBuildInput,
) -> Result<ActivityPageView, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    tauri::async_runtime::spawn_blocking(move || local_data.activity_page_view(input))
        .await
        .map_err(|error| AppError::Custom(format!("activity page view task: {error}")))?
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__activity_journey_visits(
    state: State<'_, AppState>,
    input: ActivityJourneyDayInput,
) -> Result<Vec<ActivityJourneyVisit>, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    tauri::async_runtime::spawn_blocking(move || local_data.activity_journey_visits(input))
        .await
        .map_err(|error| AppError::Custom(format!("activity journey visits task: {error}")))?
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__activity_journey_days(
    state: State<'_, AppState>,
    input: ActivityJourneyDaysInput,
) -> Result<Vec<String>, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    tauri::async_runtime::spawn_blocking(move || local_data.activity_journey_days(input))
        .await
        .map_err(|error| AppError::Custom(format!("activity journey days task: {error}")))?
        .map_err(AppError::from)
}
