#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{
    load_group_calendar, GroupCalendarDeps, GroupCalendarInput, GroupCalendarSnapshot,
};

use crate::{error::AppError, state::AppState};

#[tauri::command]
#[specta::specta]
pub async fn app__group_calendar_snapshot_get(
    state: State<'_, AppState>,
    input: GroupCalendarInput,
) -> Result<GroupCalendarSnapshot, AppError> {
    load_group_calendar(
        GroupCalendarDeps {
            db: state.db.clone(),
            web: state.web.clone(),
            auth_scope: state.runtime_context.auth_scope.clone(),
            diagnostics: state.runtime_context.diagnostics.clone(),
            sync: state.runtime_context.sync.clone(),
        },
        input,
    )
    .await
    .map_err(AppError::from)
}
