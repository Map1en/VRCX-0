#![allow(non_snake_case)]
#![allow(unused_imports)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use serde_json::Value;
use vrcx_0_store::database::maintenance::{
    BrokenGameLogDisplayNameOutput, MaintenanceTableSizesOutput, UserTableContextOutput,
};

#[tauri::command]
pub fn app__database_maintenance_broken_game_log_display_names_get(
    state: State<'_, AppState>,
) -> Result<Vec<BrokenGameLogDisplayNameOutput>, AppError> {
    vrcx_0_store::database::maintenance::app__database_maintenance_broken_game_log_display_names_get(
        state.db.as_ref(),
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__database_maintenance_broken_leave_entries_get(
    state: State<'_, AppState>,
) -> Result<Vec<Value>, AppError> {
    vrcx_0_store::database::maintenance::app__database_maintenance_broken_leave_entries_get(
        state.db.as_ref(),
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__database_maintenance_max_friend_log_number_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<i64, AppError> {
    vrcx_0_store::database::maintenance::app__database_maintenance_max_friend_log_number_get(
        state.db.as_ref(),
        user_id,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__database_maintenance_run(
    state: State<'_, AppState>,
    task: String,
) -> Result<(), AppError> {
    let task = task.trim().to_string();
    let job_name = format!("databaseMaintenance.{task}");
    state.backend_context.diagnostics.record_command(
        "app__database_maintenance_run",
        "running",
        format!("task={task}"),
    );
    state.backend_context.background_jobs.register_job(
        &job_name,
        "rust-command",
        None,
        "running",
        format!("Running maintenance task {task}."),
    );
    let result = vrcx_0_store::database::maintenance::app__database_maintenance_run(
        state.db.as_ref(),
        task.clone(),
    )
    .map_err(AppError::from);
    match &result {
        Ok(()) => {
            state
                .backend_context
                .background_jobs
                .mark_completed(&job_name, format!("Maintenance task {task} finished."));
            state.backend_context.diagnostics.record_command(
                "app__database_maintenance_run",
                "ok",
                format!("task={task}"),
            );
        }
        Err(error) => {
            state
                .backend_context
                .background_jobs
                .mark_failed(&job_name, error.to_string());
            state.backend_context.diagnostics.record_command(
                "app__database_maintenance_run",
                "error",
                format!("task={task}: {error}"),
            );
        }
    }
    result
}

#[tauri::command]
pub fn app__database_maintenance_table_sizes_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<MaintenanceTableSizesOutput, AppError> {
    vrcx_0_store::database::maintenance::app__database_maintenance_table_sizes_get(
        state.db.as_ref(),
        user_id,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__user_tables_ensure(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<UserTableContextOutput, AppError> {
    vrcx_0_store::database::maintenance::app__user_tables_ensure(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}
