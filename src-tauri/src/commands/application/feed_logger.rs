#![allow(non_snake_case)]

use std::sync::Arc;

use tauri::State;
use vrcx_0_logger_protocol::wire::{DeviceLoginState, SessionState, WebhookFormat};
use vrcx_0_runtime_host_desktop::feed_logger::{
    FeedLoggerBackfillHistory, FeedLoggerProbe, FeedLoggerSettingsView, FeedLoggerSyncReport,
    SettingsCheck,
};

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__feed_logger_settings_get(
    state: State<'_, AppState>,
) -> Result<FeedLoggerSettingsView, AppError> {
    let runtime = Arc::clone(state.runtime_host().feed_logger());
    run_blocking("feed logger settings", move || runtime.settings_view()).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_logger_settings_save(
    state: State<'_, AppState>,
    address: String,
    password: String,
) -> Result<FeedLoggerProbe, AppError> {
    let runtime = Arc::clone(state.runtime_host().feed_logger());
    match runtime.verify_settings(address, password).await {
        SettingsCheck::Verified(verified) => {
            run_blocking("feed logger settings", move || {
                runtime.adopt_settings(verified)
            })
            .await
        }
        SettingsCheck::Unhealthy(probe) => Ok(probe),
        SettingsCheck::Invalid(error) => Err(error.into()),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_logger_settings_clear(state: State<'_, AppState>) -> Result<(), AppError> {
    let runtime = Arc::clone(state.runtime_host().feed_logger());
    run_blocking("feed logger settings", move || runtime.clear_settings()).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_logger_backfill_history(
    state: State<'_, AppState>,
) -> Result<FeedLoggerBackfillHistory, AppError> {
    let runtime = Arc::clone(state.runtime_host().feed_logger());
    run_blocking("feed logger backfill history", move || {
        runtime.backfill_history()
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_logger_status(
    state: State<'_, AppState>,
) -> Result<FeedLoggerProbe, AppError> {
    state
        .runtime_host()
        .feed_logger()
        .probe()
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_logger_push_credentials(
    state: State<'_, AppState>,
    username: String,
    password: String,
    save_password: bool,
) -> Result<SessionState, AppError> {
    state
        .runtime_host()
        .feed_logger()
        .push_credentials(username, password, save_password)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_logger_start_device_login(
    state: State<'_, AppState>,
) -> Result<DeviceLoginState, AppError> {
    state
        .runtime_host()
        .feed_logger()
        .start_device_login()
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_logger_cancel_device_login(
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .feed_logger()
        .cancel_device_login()
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_logger_push_saved_credentials(
    state: State<'_, AppState>,
    save_password: bool,
) -> Result<SessionState, AppError> {
    state
        .runtime_host()
        .feed_logger()
        .push_saved_credentials(save_password)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_logger_submit_two_factor(
    state: State<'_, AppState>,
    method: String,
    code: String,
) -> Result<SessionState, AppError> {
    state
        .runtime_host()
        .feed_logger()
        .submit_two_factor(method, code)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_logger_set_webhook(
    state: State<'_, AppState>,
    url: Option<String>,
    format: WebhookFormat,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .feed_logger()
        .set_webhook(url, format)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_logger_test_webhook(state: State<'_, AppState>) -> Result<(), AppError> {
    state
        .runtime_host()
        .feed_logger()
        .test_webhook()
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_logger_unpair(state: State<'_, AppState>) -> Result<(), AppError> {
    state
        .runtime_host()
        .feed_logger()
        .unpair()
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__feed_logger_sync(
    state: State<'_, AppState>,
) -> Result<FeedLoggerSyncReport, AppError> {
    state
        .runtime_host()
        .feed_logger()
        .sync_now()
        .await
        .map_err(AppError::from)
}
