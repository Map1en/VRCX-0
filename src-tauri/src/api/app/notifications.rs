#![allow(non_snake_case)]
#![allow(unused_imports)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use serde_json::Value;
use vrcx_0_store::notifications::{
    NotificationListItemOutput, NotificationListQueryInput, NotificationRowsOutput,
    NotificationRowsQueryInput,
};

#[tauri::command]
pub fn app__notification_add_v1(
    state: State<'_, AppState>,
    user_id: String,
    notification: Value,
) -> Result<(), AppError> {
    vrcx_0_store::notifications::app__notification_add_v1(state.db.as_ref(), user_id, notification)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_add_v2(
    state: State<'_, AppState>,
    user_id: String,
    notification: Value,
) -> Result<(), AppError> {
    vrcx_0_store::notifications::app__notification_add_v2(state.db.as_ref(), user_id, notification)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_delete(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    vrcx_0_store::notifications::app__notification_delete(state.db.as_ref(), user_id, id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_expire(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    vrcx_0_store::notifications::app__notification_expire(state.db.as_ref(), user_id, id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_list_query(
    state: State<'_, AppState>,
    query: NotificationListQueryInput,
) -> Result<Vec<NotificationListItemOutput>, AppError> {
    vrcx_0_store::notifications::app__notification_list_query(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_mark_seen_local_bulk(
    state: State<'_, AppState>,
    user_id: String,
    ids: Vec<String>,
) -> Result<(), AppError> {
    vrcx_0_store::notifications::app__notification_mark_seen_local_bulk(
        state.db.as_ref(),
        user_id,
        ids,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_rows_query(
    state: State<'_, AppState>,
    query: NotificationRowsQueryInput,
) -> Result<NotificationRowsOutput, AppError> {
    vrcx_0_store::notifications::app__notification_rows_query(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_update_expired(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
    expired: bool,
) -> Result<(), AppError> {
    vrcx_0_store::notifications::app__notification_update_expired(
        state.db.as_ref(),
        user_id,
        id,
        expired,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_v2_expire(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    vrcx_0_store::notifications::app__notification_v2_expire(state.db.as_ref(), user_id, id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_v2_mark_seen(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    vrcx_0_store::notifications::app__notification_v2_mark_seen(state.db.as_ref(), user_id, id)
        .map_err(AppError::from)
}
