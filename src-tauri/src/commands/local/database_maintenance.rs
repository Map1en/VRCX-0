#![allow(non_snake_case)]

use tauri::State;

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;

use serde_json::Value;
use vrcx_0_runtime_host_desktop::local_data::{
    BrokenGameLogDisplayNameOutput, MaintenanceTableSizesOutput, UserTableContextOutput,
};

#[tauri::command]
#[specta::specta]
pub async fn app__database_maintenance_broken_game_log_display_names_get(
    state: State<'_, AppState>,
) -> Result<Vec<BrokenGameLogDisplayNameOutput>, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("broken game log display names query", move || {
        local_data.broken_game_log_display_names()
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__database_maintenance_broken_leave_entries_get(
    state: State<'_, AppState>,
) -> Result<Vec<Value>, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("broken leave entries query", move || {
        local_data.broken_leave_entries()
    })
    .await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__database_maintenance_max_friend_log_number_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .max_friend_log_number(user_id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__database_maintenance_table_sizes_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<MaintenanceTableSizesOutput, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("maintenance table sizes query", move || {
        local_data.maintenance_table_sizes(user_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__user_tables_ensure(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<UserTableContextOutput, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("user tables ensure", move || {
        local_data.ensure_user_tables(user_id)
    })
    .await
}
