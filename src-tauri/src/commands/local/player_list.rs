#![allow(non_snake_case)]

use std::collections::HashMap;
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_application::PlayerListSnapshotOutput;
use vrcx_0_persistence::player_list::{
    InstanceActivityRowOutput, PlayerJoinLeaveOutput, PlayerLocationOutput,
};
use vrcx_0_persistence::worlds::WorldSummaryOutput;

#[tauri::command]
#[specta::specta]
pub fn app__player_list_current_snapshot(
    state: State<'_, AppState>,
    current_user_id: String,
    current_location: String,
    current_location_started_at: String,
) -> Result<PlayerListSnapshotOutput, AppError> {
    vrcx_0_application::player_list_current_snapshot(
        state.db.as_ref(),
        &current_user_id,
        &current_location,
        &current_location_started_at,
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__instance_activity_dates_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Vec<String>, AppError> {
    vrcx_0_persistence::player_list::instance_activity_dates_get(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__instance_activity_rows_get(
    state: State<'_, AppState>,
    start_date: String,
    end_date: String,
) -> Result<Vec<InstanceActivityRowOutput>, AppError> {
    vrcx_0_persistence::player_list::instance_activity_rows_get(
        state.db.as_ref(),
        start_date,
        end_date,
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__player_list_join_leave_rows(
    state: State<'_, AppState>,
    location: String,
    started_at: String,
) -> Result<Vec<PlayerJoinLeaveOutput>, AppError> {
    vrcx_0_persistence::player_list::player_list_join_leave_rows(
        state.db.as_ref(),
        location,
        started_at,
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__player_list_latest_location_get(
    state: State<'_, AppState>,
) -> Result<Option<PlayerLocationOutput>, AppError> {
    vrcx_0_persistence::player_list::player_list_latest_location_get(state.db.as_ref())
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__player_list_location_get(
    state: State<'_, AppState>,
    location: String,
) -> Result<Option<PlayerLocationOutput>, AppError> {
    vrcx_0_persistence::player_list::player_list_location_get(state.db.as_ref(), location)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__world_summaries_get(
    state: State<'_, AppState>,
    world_ids: Vec<String>,
) -> Result<HashMap<String, WorldSummaryOutput>, AppError> {
    vrcx_0_persistence::player_list::world_summaries_get(state.db.as_ref(), world_ids)
        .map_err(AppError::from)
}
