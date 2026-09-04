#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use serde_json::Value;
use vrcx_0_runtime_host_desktop::local_data::{
    NotificationListItemOutput, NotificationListQueryInput,
};

#[tauri::command]
#[specta::specta]
pub fn app__notification_add_v1(
    state: State<'_, AppState>,
    user_id: String,
    notification: Value,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .local_data()
        .notification_add_v1(user_id, notification)
        .map_err(AppError::from)?;
    state.runtime_host().refresh_tray_notification();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__notification_add_v2(
    state: State<'_, AppState>,
    user_id: String,
    notification: Value,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .local_data()
        .notification_add_v2(user_id, notification)
        .map_err(AppError::from)?;
    state.runtime_host().refresh_tray_notification();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__notification_delete(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .local_data()
        .notification_delete(user_id, id)
        .map_err(AppError::from)?;
    state.runtime_host().refresh_tray_notification();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__notification_expire(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .local_data()
        .notification_expire(user_id, id)
        .map_err(AppError::from)?;
    state.runtime_host().refresh_tray_notification();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__notification_list_query(
    state: State<'_, AppState>,
    query: NotificationListQueryInput,
) -> Result<Vec<NotificationListItemOutput>, AppError> {
    state
        .runtime_host()
        .local_data()
        .notification_list_query(query)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn app__notification_update_expired(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
    expired: bool,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .local_data()
        .notification_update_expired(user_id, id, expired)
        .map_err(AppError::from)?;
    state.runtime_host().refresh_tray_notification();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__notification_v2_expire(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .local_data()
        .notification_v2_expire(user_id, id)
        .map_err(AppError::from)?;
    state.runtime_host().refresh_tray_notification();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__notification_v2_mark_seen(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .local_data()
        .notification_v2_mark_seen(user_id, id)
        .map_err(AppError::from)?;
    state.runtime_host().refresh_tray_notification();
    Ok(())
}
