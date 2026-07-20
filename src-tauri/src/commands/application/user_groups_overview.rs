#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{
    get_user_groups_overview, GroupApiDeps, UserGroupsOverviewDeps, UserGroupsOverviewInput,
    UserGroupsOverviewOutput,
};

use crate::error::AppError;
use crate::state::AppState;

fn deps(state: &State<'_, AppState>) -> UserGroupsOverviewDeps {
    UserGroupsOverviewDeps {
        groups: GroupApiDeps {
            db: state.db.clone(),
            web: state.web.clone(),
            diagnostics: state.runtime_context.diagnostics.clone(),
            sync: state.runtime_context.sync.clone(),
        },
        auth_scope: state.runtime_context.auth_scope.clone(),
        session: state.runtime_context.session.clone(),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app__user_groups_overview_get(
    state: State<'_, AppState>,
    input: UserGroupsOverviewInput,
) -> Result<UserGroupsOverviewOutput, AppError> {
    get_user_groups_overview(deps(&state), input)
        .await
        .map_err(AppError::from)
}
