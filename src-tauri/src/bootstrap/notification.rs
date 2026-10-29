use std::time::Duration;

use tauri::Manager;
use tauri_plugin_notification::NotificationExt;
use vrcx_0_application_core::{
    BackendRuntimeMode, BackendRuntimePhase, RuntimeVrchatAuthFailurePayload,
};
use vrcx_0_composition::Error as RuntimeHostError;
use vrcx_0_runtime_host_desktop::auth_failure;

use crate::localization::shell_locale::{
    self, AuthFailureNotificationLabels, BackgroundModeNotificationLabels, TrayLabels,
};
use crate::state::AppState;

use super::shared::{app_language, db_config_bool};

const AUTH_FAILURE_NOTIFICATION_COOLDOWN: Duration = Duration::from_secs(5);

pub(super) fn handle_runtime_auth_failure_notification(
    app_handle: &tauri::AppHandle,
    failure: &RuntimeVrchatAuthFailurePayload,
) {
    if !auth_failure::is_actionable_runtime_auth_failure(failure) {
        return;
    }
    let Some(state) = app_handle.try_state::<AppState>() else {
        return;
    };
    if !runtime_auth_failure_matches_active_source(&state, failure) {
        return;
    }
    let reason = &failure.reason;
    let snapshot = state.runtime_host().backend_runtime_snapshot();
    if !auth_failure::should_show_runtime_auth_failure_notification(&snapshot, failure.status_code)
    {
        return;
    }

    let user_id = snapshot.auth_user_id.trim().to_string();
    let notification_key = format!("{user_id}\n{reason}");
    show_auth_failure_notification_once(app_handle, &state, &notification_key);
}

pub(super) fn handle_runtime_auth_failure_recovery(
    app_handle: &tauri::AppHandle,
    failure: &RuntimeVrchatAuthFailurePayload,
) {
    if !auth_failure::is_actionable_runtime_auth_failure(failure) {
        return;
    }
    let Some(state) = app_handle.try_state::<AppState>() else {
        return;
    };
    if !runtime_auth_failure_matches_active_source(&state, failure) {
        return;
    }
    let failure = failure.clone();
    let app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let Some(state) = app_handle.try_state::<AppState>() else {
            return;
        };
        if !runtime_auth_failure_matches_scope(&state, &failure) {
            return;
        }
        state
            .runtime_host()
            .recover_background_auth_after_failure(failure.reason)
            .await;
    });
}

fn runtime_auth_failure_matches_scope(
    state: &AppState,
    failure: &RuntimeVrchatAuthFailurePayload,
) -> bool {
    auth_failure::runtime_auth_failure_matches_scope(
        &state.runtime_host().auth_scope_snapshot(),
        failure,
    )
}

fn runtime_auth_failure_matches_active_source(
    state: &AppState,
    failure: &RuntimeVrchatAuthFailurePayload,
) -> bool {
    runtime_auth_failure_matches_scope(state, failure)
        && auth_failure::runtime_auth_failure_transport_matches(
            state.runtime_host().active_realtime_transport().as_ref(),
            failure.realtime_transport.as_ref(),
        )
}

pub(crate) fn show_auth_failure_notification_once(
    app_handle: &tauri::AppHandle,
    state: &AppState,
    key: &str,
) {
    let key = key.trim();
    let notification_key = if key.is_empty() {
        "auth-failure".to_string()
    } else {
        format!("auth-failure\n{key}")
    };
    if !state.should_emit_auth_failure_notification(
        &notification_key,
        AUTH_FAILURE_NOTIFICATION_COOLDOWN,
    ) {
        return;
    }

    let labels = auth_failure_notification_labels(state);
    if let Err(error) = app_handle
        .notification()
        .builder()
        .title(labels.title)
        .body(labels.body)
        .show()
    {
        tracing::warn!(error = %error, "failed to show auth failure notification");
    }
}

pub(crate) fn show_auth_failure_notification_after_backend_start_error(
    app_handle: &tauri::AppHandle,
    state: &AppState,
    error: &RuntimeHostError,
) {
    let snapshot = state.runtime_host().backend_runtime_snapshot();
    if !auth_failure::should_show_backend_start_auth_notification(&snapshot, error) {
        return;
    }

    let reason = error.to_string();
    show_auth_failure_notification_once(app_handle, state, &reason);
}

pub(crate) fn show_background_mode_started_notification(app: &tauri::AppHandle, state: &AppState) {
    let labels = background_mode_notification_labels(state);
    if let Err(error) = app
        .notification()
        .builder()
        .title(labels.title)
        .body(labels.body)
        .show()
    {
        tracing::warn!(error = %error, "failed to show background mode notification");
    }
}

pub(super) fn is_background_mode_active(state: &AppState) -> bool {
    let snapshot = state.runtime_host().backend_runtime_snapshot();
    snapshot.mode == BackendRuntimeMode::Background
        && snapshot.phase == BackendRuntimePhase::Running
}

pub(super) fn is_community_theme_enabled(state: &AppState) -> bool {
    db_config_bool(state, "config:vrcx_communitythemeenabled") == Some(true)
}

fn background_mode_notification_labels(state: &AppState) -> BackgroundModeNotificationLabels {
    shell_locale::background_mode_notification_labels_for_language(&app_language(state))
}

fn auth_failure_notification_labels(state: &AppState) -> AuthFailureNotificationLabels {
    auth_failure_notification_labels_for_language(&app_language(state))
}

fn auth_failure_notification_labels_for_language(language: &str) -> AuthFailureNotificationLabels {
    shell_locale::auth_failure_notification_labels_for_language(language)
}

pub(super) fn tray_labels(state: &AppState) -> TrayLabels {
    shell_locale::tray_labels_for_language(&app_language(state))
}

pub(crate) fn tray_realtime_reconnecting_label(state: &AppState) -> String {
    shell_locale::tray_realtime_reconnecting_for_language(&app_language(state))
}
