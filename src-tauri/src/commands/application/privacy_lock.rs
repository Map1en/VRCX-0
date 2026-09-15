#![allow(non_snake_case)]

use tauri::{AppHandle, Emitter, Manager, State};

use crate::bootstrap;
use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_runtime_host_desktop::PrivacyLockOutcome;

const PRIVACY_LOCK_SETUP_REQUESTED_EVENT: &str = "privacyLockSetupRequested";

#[tauri::command(async)]
#[specta::specta]
pub fn app__privacy_lock_setup_request_take(state: State<'_, AppState>) -> bool {
    state.runtime_host().privacy_lock().take_setup_request()
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__privacy_lock_engage(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<PrivacyLockOutcome, AppError> {
    engage_privacy_lock(&app_handle, &state)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__privacy_lock_unlock(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    password: String,
) -> Result<PrivacyLockOutcome, AppError> {
    let outcome = state.runtime_host().privacy_lock().unlock(&password)?;
    refresh_tray_after(&app_handle, &outcome);
    Ok(outcome)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__privacy_lock_password_set(
    state: State<'_, AppState>,
    password: String,
) -> Result<PrivacyLockOutcome, AppError> {
    Ok(state
        .runtime_host()
        .privacy_lock()
        .set_password(&password)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__privacy_lock_password_change(
    state: State<'_, AppState>,
    current_password: String,
    new_password: String,
) -> Result<PrivacyLockOutcome, AppError> {
    Ok(state
        .runtime_host()
        .privacy_lock()
        .change_password(&current_password, &new_password)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__privacy_lock_password_clear(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    account_password: String,
) -> Result<PrivacyLockOutcome, AppError> {
    let outcome = state
        .runtime_host()
        .privacy_lock()
        .clear_with_account_password(&account_password)?;
    refresh_tray_after(&app_handle, &outcome);
    Ok(outcome)
}

pub(crate) fn engage_privacy_lock(
    app: &AppHandle,
    state: &AppState,
) -> Result<PrivacyLockOutcome, AppError> {
    let outcome = state.runtime_host().privacy_lock().engage()?;
    if matches!(outcome, PrivacyLockOutcome::Ok { .. }) {
        state.pending_deep_links().drain();
    }
    refresh_tray_after(app, &outcome);
    Ok(outcome)
}

pub(crate) fn request_privacy_lock_setup(app: &AppHandle, state: &AppState) {
    state.runtime_host().privacy_lock().request_setup();
    if let Err(error) = app.emit(PRIVACY_LOCK_SETUP_REQUESTED_EVENT, serde_json::json!({})) {
        tracing::warn!(error = %error, "failed to request privacy lock setup");
    }
}

fn refresh_tray_after(app: &AppHandle, outcome: &PrivacyLockOutcome) {
    if !matches!(outcome, PrivacyLockOutcome::Ok { .. }) {
        return;
    }
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || refresh_tray(&app_handle));
}

fn refresh_tray(app: &AppHandle) {
    let state = app.state::<AppState>();
    if let Err(error) = bootstrap::refresh_tray_menu(app, &state) {
        tracing::warn!(error = %error, "failed to refresh tray menu after privacy lock change");
    }
}
