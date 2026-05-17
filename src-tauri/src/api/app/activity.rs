#![allow(non_snake_case)]
#![allow(unused_imports)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_store::activity::{
    ActivityBucketCacheInput, ActivityBucketCacheOutput, ActivityBucketCacheQueryInput,
    ActivityFriendPresenceAfterInput, ActivityFriendPresenceSliceInput, ActivityPresenceOutput,
    ActivitySelfSessionsRefreshInput, ActivitySelfSessionsRefreshOutput,
    ActivitySelfSourceAfterInput, ActivitySelfSourceSliceInput, ActivitySessionInput,
    ActivitySessionOutput, ActivitySourceLocationOutput, ActivitySyncStateInput,
    ActivitySyncStateOutput,
};

#[tauri::command]
pub fn app__activity_bucket_cache_get(
    state: State<'_, AppState>,
    query: ActivityBucketCacheQueryInput,
) -> Result<Option<ActivityBucketCacheOutput>, AppError> {
    vrcx_0_store::activity::app__activity_bucket_cache_get(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_bucket_cache_upsert(
    state: State<'_, AppState>,
    entry: ActivityBucketCacheInput,
) -> Result<(), AppError> {
    vrcx_0_store::activity::app__activity_bucket_cache_upsert(state.db.as_ref(), entry)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_friend_presence_after(
    state: State<'_, AppState>,
    query: ActivityFriendPresenceAfterInput,
) -> Result<Vec<ActivityPresenceOutput>, AppError> {
    vrcx_0_store::activity::app__activity_friend_presence_after(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_friend_presence_slice(
    state: State<'_, AppState>,
    query: ActivityFriendPresenceSliceInput,
) -> Result<Vec<ActivityPresenceOutput>, AppError> {
    vrcx_0_store::activity::app__activity_friend_presence_slice(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_self_sessions_refresh(
    state: State<'_, AppState>,
    input: ActivitySelfSessionsRefreshInput,
) -> Result<ActivitySelfSessionsRefreshOutput, AppError> {
    vrcx_0_store::activity::app__activity_self_sessions_refresh(state.db.as_ref(), input)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_self_source_after(
    state: State<'_, AppState>,
    query: ActivitySelfSourceAfterInput,
) -> Result<Vec<ActivitySourceLocationOutput>, AppError> {
    vrcx_0_store::activity::app__activity_self_source_after(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_self_source_slice(
    state: State<'_, AppState>,
    query: ActivitySelfSourceSliceInput,
) -> Result<Vec<ActivitySourceLocationOutput>, AppError> {
    vrcx_0_store::activity::app__activity_self_source_slice(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_sessions_append(
    state: State<'_, AppState>,
    user_id: String,
    sessions: Vec<ActivitySessionInput>,
    replace_from_start_at: Option<i64>,
) -> Result<(), AppError> {
    vrcx_0_store::activity::app__activity_sessions_append(
        state.db.as_ref(),
        user_id,
        sessions,
        replace_from_start_at,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_sessions_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Vec<ActivitySessionOutput>, AppError> {
    vrcx_0_store::activity::app__activity_sessions_get(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_sessions_replace(
    state: State<'_, AppState>,
    user_id: String,
    sessions: Vec<ActivitySessionInput>,
) -> Result<(), AppError> {
    vrcx_0_store::activity::app__activity_sessions_replace(state.db.as_ref(), user_id, sessions)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_sync_state_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Option<ActivitySyncStateOutput>, AppError> {
    vrcx_0_store::activity::app__activity_sync_state_get(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_sync_state_upsert(
    state: State<'_, AppState>,
    entry: ActivitySyncStateInput,
) -> Result<(), AppError> {
    vrcx_0_store::activity::app__activity_sync_state_upsert(state.db.as_ref(), entry)
        .map_err(AppError::from)
}
