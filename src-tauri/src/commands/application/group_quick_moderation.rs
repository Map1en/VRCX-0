#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{
    get_group_quick_moderation, run_group_quick_moderation_action, GroupApiDeps,
    GroupQuickModerationActionInput, GroupQuickModerationActionOutput, GroupQuickModerationDeps,
    GroupQuickModerationInput, GroupQuickModerationOutput,
};

use crate::error::AppError;
use crate::state::AppState;

fn deps(state: &State<'_, AppState>) -> GroupQuickModerationDeps {
    GroupQuickModerationDeps {
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
pub async fn app__user_group_quick_moderation_get(
    state: State<'_, AppState>,
    input: GroupQuickModerationInput,
) -> Result<GroupQuickModerationOutput, AppError> {
    get_group_quick_moderation(deps(&state), input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__user_group_quick_moderation_action(
    state: State<'_, AppState>,
    input: GroupQuickModerationActionInput,
) -> Result<GroupQuickModerationActionOutput, AppError> {
    run_group_quick_moderation_action(deps(&state), input)
        .await
        .map_err(AppError::from)
}
