#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_persistence::activity::{
    ActivityBucketCacheInput, ActivityBucketCacheOutput, ActivityBucketCacheQueryInput,
    ActivityOverlapViewBuildInput, ActivityOverlapViewOutput, ActivitySelfSessionsRefreshInput,
    ActivitySelfSessionsRefreshOutput, ActivitySelfSourceBoundsOutput, ActivitySessionInput,
    ActivitySessionOutput, ActivitySyncStateInput, ActivitySyncStateOutput, ActivityViewBuildInput,
    ActivityViewOutput,
};

#[tauri::command]
#[specta::specta]
pub fn app__activity_bucket_cache_get(
    state: State<'_, AppState>,
    query: ActivityBucketCacheQueryInput,
) -> Result<Option<ActivityBucketCacheOutput>, AppError> {
    vrcx_0_persistence::activity::activity_bucket_cache_get(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__activity_bucket_cache_upsert(
    state: State<'_, AppState>,
    entry: ActivityBucketCacheInput,
) -> Result<(), AppError> {
    vrcx_0_persistence::activity::activity_bucket_cache_upsert(state.db.as_ref(), entry)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__activity_overlap_view(
    state: State<'_, AppState>,
    input: ActivityOverlapViewBuildInput,
) -> Result<ActivityOverlapViewOutput, AppError> {
    vrcx_0_persistence::activity::activity_overlap_view_build(state.db.as_ref(), input)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__activity_view(
    state: State<'_, AppState>,
    input: ActivityViewBuildInput,
) -> Result<ActivityViewOutput, AppError> {
    vrcx_0_persistence::activity::activity_view_build(state.db.as_ref(), input)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__activity_self_source_bounds(
    state: State<'_, AppState>,
) -> Result<ActivitySelfSourceBoundsOutput, AppError> {
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    vrcx_0_persistence::activity::activity_self_source_bounds(state.db.as_ref(), &owner_user_id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__activity_self_sessions_refresh(
    state: State<'_, AppState>,
    input: ActivitySelfSessionsRefreshInput,
) -> Result<ActivitySelfSessionsRefreshOutput, AppError> {
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    vrcx_0_persistence::activity::activity_self_sessions_refresh(
        state.db.as_ref(),
        &owner_user_id,
        input,
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__activity_sessions_append(
    state: State<'_, AppState>,
    user_id: String,
    sessions: Vec<ActivitySessionInput>,
    replace_from_start_at: Option<i64>,
) -> Result<(), AppError> {
    vrcx_0_persistence::activity::activity_sessions_append(
        state.db.as_ref(),
        user_id,
        sessions,
        replace_from_start_at,
    )
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__activity_sessions_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Vec<ActivitySessionOutput>, AppError> {
    vrcx_0_persistence::activity::activity_sessions_get(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__activity_sessions_replace(
    state: State<'_, AppState>,
    user_id: String,
    sessions: Vec<ActivitySessionInput>,
) -> Result<(), AppError> {
    vrcx_0_persistence::activity::activity_sessions_replace(state.db.as_ref(), user_id, sessions)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__activity_sync_state_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Option<ActivitySyncStateOutput>, AppError> {
    vrcx_0_persistence::activity::activity_sync_state_get(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__activity_sync_state_upsert(
    state: State<'_, AppState>,
    entry: ActivitySyncStateInput,
) -> Result<(), AppError> {
    vrcx_0_persistence::activity::activity_sync_state_upsert(state.db.as_ref(), entry)
        .map_err(AppError::from)
}
