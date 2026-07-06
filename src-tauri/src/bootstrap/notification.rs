use std::time::Duration;

use tauri::Manager;
use tauri_plugin_notification::NotificationExt;
use vrcx_0_application::{BackendRuntimeMode, BackendRuntimePhase, BackendRuntimeSnapshot};

use crate::localization::shell_locale::{
    self, AuthFailureNotificationLabels, BackgroundModeNotificationLabels, TrayLabels,
};
use crate::state::AppState;

use super::shared::{app_language, db_config_bool, json_string_field};

const AUTH_FAILURE_NOTIFICATION_COOLDOWN: Duration = Duration::from_secs(5);

pub(super) fn handle_runtime_auth_failure_notification(
    app_handle: &tauri::AppHandle,
    event: &str,
    payload: &serde_json::Value,
) {
    if event != "realtimeWsStatus" || json_string_field(payload, "status") != "authFailure" {
        return;
    }
    let Some(state) = app_handle.try_state::<AppState>() else {
        return;
    };
    let snapshot = state.snapshot_backend_runtime();
    let reason = json_string_field(payload, "reason");
    if !should_show_runtime_auth_failure_notification(&snapshot, &reason) {
        return;
    }

    let user_id = snapshot.auth_user_id.trim().to_string();
    let notification_key = format!("{user_id}\n{reason}");
    show_auth_failure_notification_once(app_handle, &state, &notification_key);
}

pub(super) fn handle_runtime_auth_failure_recovery(
    app_handle: &tauri::AppHandle,
    event: &str,
    payload: &serde_json::Value,
) {
    if event != "realtimeWsStatus" || json_string_field(payload, "status") != "authFailure" {
        return;
    }
    let reason = json_string_field(payload, "reason");
    let app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let Some(state) = app_handle.try_state::<AppState>() else {
            return;
        };
        state.recover_background_auth_after_failure(reason).await;
    });
}

fn should_show_runtime_auth_failure_notification(
    snapshot: &BackendRuntimeSnapshot,
    reason: &str,
) -> bool {
    snapshot.auth_status == "interactionRequired"
        && !auth_failure_reason_allows_automatic_recovery(reason)
}

fn should_show_backend_start_auth_notification(
    snapshot: &BackendRuntimeSnapshot,
    reason: &str,
) -> bool {
    if auth_failure_reason_allows_automatic_recovery(reason) {
        return false;
    }
    snapshot.auth_status == "interactionRequired"
        || (snapshot.phase == BackendRuntimePhase::Idle && snapshot.auth_status == "signedOut")
}

fn auth_failure_reason_allows_automatic_recovery(reason: &str) -> bool {
    let normalized = reason.trim().to_ascii_lowercase();
    normalized.contains("missing credentials")
        || normalized.contains("401")
        || normalized == "unauthorized"
        || normalized.contains("\"unauthorized\"")
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
    reason: &str,
) {
    let snapshot = state.snapshot_backend_runtime();
    if !should_show_backend_start_auth_notification(&snapshot, reason) {
        return;
    }

    show_auth_failure_notification_once(app_handle, state, reason);
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
    let snapshot = state.snapshot_backend_runtime();
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

#[cfg(test)]
mod tests {
    use super::*;

    use std::collections::BTreeMap;

    fn backend_snapshot(
        phase: BackendRuntimePhase,
        auth_status: &str,
        auth_user_id: &str,
        ws_status: &str,
    ) -> BackendRuntimeSnapshot {
        BackendRuntimeSnapshot {
            mode: BackendRuntimeMode::Background,
            phase,
            auth_status: auth_status.into(),
            auth_user_id: auth_user_id.into(),
            auth_display_name: String::new(),
            ws_status: ws_status.into(),
            game_log_status: "idle".into(),
            process_status: "unknown".into(),
            ws_message_counts: BTreeMap::new(),
            ws_persisted_count: 0,
            game_log_persisted_count: 0,
            last_error: None,
            updated_at: String::new(),
        }
    }

    #[test]
    fn auth_failure_notification_label_language_prefixes_are_localized() {
        assert_eq!(
            auth_failure_notification_labels_for_language("zh-CN").title,
            "VRChat 登录已失效"
        );
        assert_eq!(
            auth_failure_notification_labels_for_language("zh-TW").title,
            "VRChat 登入已過期"
        );
        assert_eq!(
            auth_failure_notification_labels_for_language("ja").title,
            "VRChat ログインの有効期限が切れました"
        );
    }

    #[test]
    fn realtime_auth_failure_notification_skips_recoverable_websocket_401() {
        let snapshot = backend_snapshot(
            BackendRuntimePhase::Running,
            "authenticated",
            "usr_1",
            "authFailure",
        );
        assert!(!should_show_runtime_auth_failure_notification(
            &snapshot,
            "auth transport bootstrap failed (401): {\"error\":{\"message\":\"Missing Credentials\"}}"
        ));
    }

    #[test]
    fn backend_start_auth_notification_requires_manual_action() {
        let recoverable = backend_snapshot(BackendRuntimePhase::Idle, "signedOut", "", "idle");
        assert!(!should_show_backend_start_auth_notification(
            &recoverable,
            "Missing Credentials"
        ));

        let interaction_required = backend_snapshot(
            BackendRuntimePhase::Error,
            "interactionRequired",
            "",
            "idle",
        );
        assert!(should_show_backend_start_auth_notification(
            &interaction_required,
            "Re-authentication in the GUI is required because this account requires 2FA/OTP."
        ));

        let invalid_session = backend_snapshot(BackendRuntimePhase::Idle, "signedOut", "", "idle");
        assert!(should_show_backend_start_auth_notification(
            &invalid_session,
            "VRChat config request failed with HTTP 403."
        ));
    }
}
