#![allow(non_snake_case)]

use tauri::State;

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_contracts::database_maintenance::{MaintenanceTableSizesOutput, UserTableContextOutput};

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
