#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use serde_json::Value;
use vrcx_0_persistence::maintenance::{
    BrokenGameLogDisplayNameOutput, DatabaseMaintenanceTask, MaintenanceTableSizesOutput,
    UserTableContextOutput,
};

fn is_user_requested_maintenance_task(task: DatabaseMaintenanceTask) -> bool {
    matches!(task, DatabaseMaintenanceTask::Vacuum)
}

#[tauri::command]
#[specta::specta]
pub fn app__database_maintenance_broken_game_log_display_names_get(
    state: State<'_, AppState>,
) -> Result<Vec<BrokenGameLogDisplayNameOutput>, AppError> {
    vrcx_0_persistence::maintenance::database_maintenance_broken_game_log_display_names_get(
        state.db.as_ref(),
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__database_maintenance_broken_leave_entries_get(
    state: State<'_, AppState>,
) -> Result<Vec<Value>, AppError> {
    vrcx_0_persistence::maintenance::database_maintenance_broken_leave_entries_get(
        state.db.as_ref(),
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__database_maintenance_max_friend_log_number_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<i64, AppError> {
    vrcx_0_persistence::maintenance::database_maintenance_max_friend_log_number_get(
        state.db.as_ref(),
        user_id,
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__database_maintenance_run(
    state: State<'_, AppState>,
    task: String,
) -> Result<(), AppError> {
    let parsed_task = DatabaseMaintenanceTask::parse(&task).map_err(AppError::from)?;
    if !is_user_requested_maintenance_task(parsed_task) {
        return Err(AppError::Custom(format!(
            "Database maintenance task {} is internal to Rust orchestration.",
            parsed_task.as_str()
        )));
    }
    let task = parsed_task.as_str();
    let job_name = format!("databaseMaintenance.{task}");
    state.runtime_context.diagnostics.record_command(
        "app__database_maintenance_run",
        "running",
        format!("task={task}"),
    );
    state.runtime_context.background_jobs.register_job(
        &job_name,
        "rust-command",
        None,
        "running",
        format!("Running maintenance task {task}."),
    );
    let result =
        vrcx_0_persistence::maintenance::database_maintenance_run(state.db.as_ref(), parsed_task)
            .map_err(AppError::from);
    match &result {
        Ok(()) => {
            state
                .runtime_context
                .background_jobs
                .mark_completed(&job_name, format!("Maintenance task {task} finished."));
            state.runtime_context.diagnostics.record_command(
                "app__database_maintenance_run",
                "ok",
                format!("task={task}"),
            );
        }
        Err(error) => {
            state
                .runtime_context
                .background_jobs
                .mark_failed(&job_name, error.to_string());
            state.runtime_context.diagnostics.record_command(
                "app__database_maintenance_run",
                "error",
                format!("task={task}: {error}"),
            );
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_requested_maintenance_allowlist_excludes_upgrade_steps() {
        assert!(is_user_requested_maintenance_task(
            DatabaseMaintenanceTask::Vacuum
        ));
        assert!(!is_user_requested_maintenance_task(
            DatabaseMaintenanceTask::Optimize
        ));
        assert!(!is_user_requested_maintenance_task(
            DatabaseMaintenanceTask::InitGlobalTables
        ));
        assert!(!is_user_requested_maintenance_task(
            DatabaseMaintenanceTask::AddV17PerformanceIndexes
        ));
        assert!(!is_user_requested_maintenance_task(
            DatabaseMaintenanceTask::RepairZeroCopresenceDurations
        ));
    }
}

#[tauri::command]
#[specta::specta]
pub fn app__database_maintenance_table_sizes_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<MaintenanceTableSizesOutput, AppError> {
    vrcx_0_persistence::maintenance::database_maintenance_table_sizes_get(
        state.db.as_ref(),
        user_id,
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__user_tables_ensure(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<UserTableContextOutput, AppError> {
    vrcx_0_persistence::maintenance::user_tables_ensure(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}
