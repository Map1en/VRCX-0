#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{
    mark_notifications_seen_batch, run_avatar_content_tags_batch, run_group_leave_batch,
    run_group_visibility_batch, AvatarContentTagsBatchInput, BatchMutationResult,
    FavoriteImportStartInput, FavoriteImportStatus, GroupLeaveBatchInput,
    GroupVisibilityBatchInput, NotificationMarkSeenBatchInput, NotificationMarkSeenBatchResult,
    RuntimeAuthScopeSnapshot, VrchatBatchMutationActions, VrchatNotificationMarkSeenActions,
};

use crate::{error::AppError, state::AppState};

#[tauri::command]
#[specta::specta]
pub fn app__favorite_import_start(
    state: State<'_, AppState>,
    input: FavoriteImportStartInput,
) -> Result<FavoriteImportStatus, AppError> {
    Ok(state.favorite_import.start(input)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__favorite_import_status(state: State<'_, AppState>) -> FavoriteImportStatus {
    state.favorite_import.status()
}

#[tauri::command]
#[specta::specta]
pub fn app__favorite_import_cancel(state: State<'_, AppState>) -> FavoriteImportStatus {
    state.favorite_import.cancel()
}

#[tauri::command]
#[specta::specta]
pub async fn app__avatar_content_tags_batch(
    state: State<'_, AppState>,
    input: AvatarContentTagsBatchInput,
) -> Result<BatchMutationResult, AppError> {
    let expected_scope = active_scope(&state)?;
    let actions = VrchatBatchMutationActions {
        db: state.db.as_ref(),
        web: state.web.as_ref(),
        auth_scope: &state.runtime_context.auth_scope,
        expected_scope,
    };
    Ok(run_avatar_content_tags_batch(&actions, input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__group_visibility_batch(
    state: State<'_, AppState>,
    input: GroupVisibilityBatchInput,
) -> Result<BatchMutationResult, AppError> {
    let expected_scope = active_scope(&state)?;
    let actions = VrchatBatchMutationActions {
        db: state.db.as_ref(),
        web: state.web.as_ref(),
        auth_scope: &state.runtime_context.auth_scope,
        expected_scope,
    };
    Ok(run_group_visibility_batch(&actions, input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__group_leave_batch(
    state: State<'_, AppState>,
    input: GroupLeaveBatchInput,
) -> Result<BatchMutationResult, AppError> {
    let expected_scope = active_scope(&state)?;
    let actions = VrchatBatchMutationActions {
        db: state.db.as_ref(),
        web: state.web.as_ref(),
        auth_scope: &state.runtime_context.auth_scope,
        expected_scope,
    };
    Ok(run_group_leave_batch(&actions, input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__notification_mark_seen_batch(
    state: State<'_, AppState>,
    input: NotificationMarkSeenBatchInput,
) -> Result<NotificationMarkSeenBatchResult, AppError> {
    let expected_scope = active_scope(&state)?;
    let actions = VrchatNotificationMarkSeenActions {
        db: state.db.as_ref(),
        web: state.web.as_ref(),
        auth_scope: &state.runtime_context.auth_scope,
        expected_scope,
    };
    Ok(mark_notifications_seen_batch(&actions, input).await?)
}

fn active_scope(state: &AppState) -> Result<RuntimeAuthScopeSnapshot, AppError> {
    let scope = state.runtime_context.auth_scope.snapshot();
    if scope.active && !scope.current_user_id.trim().is_empty() {
        Ok(scope)
    } else {
        Err(vrcx_0_application::Error::Custom(
            "Batch action requires an authenticated session.".into(),
        )
        .into())
    }
}
