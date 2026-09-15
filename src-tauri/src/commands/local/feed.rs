#![allow(non_snake_case)]

use crate::error::AppError;
use crate::state::AppState;
use tauri::State;

use vrcx_0_runtime_host_desktop::local_data::{
    FeedLatestQueryInput, FeedReadModelOutput, FeedRowOutput, FeedRowsQueryInput,
    FeedSearchQueryInput,
};

#[tauri::command(async)]
#[specta::specta]
pub fn app__feed_persistence_set_disabled(
    state: State<'_, AppState>,
    disabled: bool,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .local_data()
        .set_feed_persistence_disabled(disabled)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__avatar_feed_persistence_set_disabled(
    state: State<'_, AppState>,
    disabled: bool,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .local_data()
        .set_avatar_feed_persistence_disabled(disabled)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__avatar_feed_history_cleanup(
    state: State<'_, AppState>,
    cutoff_date: Option<String>,
) -> Result<vrcx_0_application::avatars::AvatarFeedCleanupOutcome, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    tauri::async_runtime::spawn_blocking(move || {
        local_data.cleanup_avatar_feed_history(cutoff_date)
    })
    .await
    .map_err(|error| AppError::Custom(format!("avatar feed cleanup task: {error}")))?
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_latest_query(
    state: State<'_, AppState>,
    query: FeedLatestQueryInput,
) -> Result<FeedReadModelOutput, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    tauri::async_runtime::spawn_blocking(move || local_data.query_feed_latest(query))
        .await
        .map_err(|error| AppError::Custom(format!("feed latest query task: {error}")))?
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_search_query(
    state: State<'_, AppState>,
    query: FeedSearchQueryInput,
) -> Result<Vec<FeedRowOutput>, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    tauri::async_runtime::spawn_blocking(move || local_data.query_feed_search(query))
        .await
        .map_err(|error| AppError::Custom(format!("feed search query task: {error}")))?
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_rows_query(
    state: State<'_, AppState>,
    query: FeedRowsQueryInput,
) -> Result<Vec<FeedRowOutput>, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    tauri::async_runtime::spawn_blocking(move || local_data.feed_rows_query(query))
        .await
        .map_err(|error| AppError::Custom(format!("feed rows query task: {error}")))?
        .map_err(AppError::from)
}
