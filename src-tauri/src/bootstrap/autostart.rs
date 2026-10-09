use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use vrcx_0_application_core::RuntimeOperationStatus;

use tauri::Manager;
use tauri_plugin_autostart::ManagerExt as _;

use crate::state::AppState;

use super::shared::db_config_bool;
use super::{arm_background_delay, start_background_mode_for_current_session};

static STARTUP_FOREGROUND_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AutostartWindowAction {
    None,
    Minimize,
    HideToTray { start_background: bool },
}

fn autostart_window_action(
    launched_from_autostart: bool,
    start_minimized: bool,
    close_to_tray: bool,
    background_mode_enabled: bool,
    foreground_requested: bool,
) -> AutostartWindowAction {
    if foreground_requested || !launched_from_autostart || !start_minimized {
        return AutostartWindowAction::None;
    }
    if close_to_tray {
        return AutostartWindowAction::HideToTray {
            start_background: background_mode_enabled,
        };
    }
    AutostartWindowAction::Minimize
}

pub(crate) fn request_startup_foreground() {
    STARTUP_FOREGROUND_REQUESTED.store(true, Ordering::Release);
}

pub(super) fn sync_autostart_from_db(app: &tauri::AppHandle, state: &AppState) {
    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    {
        if db_config_bool(state, "config:vrcx_startatwindowsstartup") == Some(true) {
            if let Err(error) = app.autolaunch().enable() {
                tracing::warn!(error = %error, "failed to synchronize autostart preference");
            }
        }
        state.runtime_host().record_lifecycle_phase(
            "autostart",
            RuntimeOperationStatus::Completed,
            "Autostart preference synchronized.",
        );
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = app;
        state.runtime_host().record_lifecycle_phase(
            "autostart",
            RuntimeOperationStatus::Skipped,
            "Autostart synchronization is unavailable on this platform.",
        );
    }
}

pub(super) fn apply_autostart_window_state_if_needed(app: &tauri::AppHandle, state: &AppState) {
    let action = autostart_window_action(
        state.runtime_host().launched_from_autostart(),
        state
            .runtime_host()
            .storage_get("VRCX_StartAsMinimizedState")
            .as_deref()
            == Some("true"),
        state
            .runtime_host()
            .storage_get("VRCX_CloseToTray")
            .as_deref()
            == Some("true"),
        db_config_bool(state, "backgroundModeEnabled") == Some(true),
        STARTUP_FOREGROUND_REQUESTED.load(Ordering::Acquire),
    );
    if action == AutostartWindowAction::None {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let window = window.clone();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        match action {
            AutostartWindowAction::HideToTray { start_background } => {
                let _ = window.hide();
                let _ = window.set_skip_taskbar(true);
                if start_background {
                    let Some(state) = app_handle.try_state::<AppState>() else {
                        return;
                    };
                    if arm_background_delay(&app_handle, &state) {
                        return;
                    }
                    if let Err(error) =
                        start_background_mode_for_current_session(&app_handle, &state).await
                    {
                        tracing::warn!(
                            error = %error,
                            "failed to start background mode from autostart"
                        );
                    }
                }
            }
            AutostartWindowAction::Minimize => {
                let _ = window.set_skip_taskbar(false);
                let _ = window.minimize();
            }
            AutostartWindowAction::None => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn autostart_minimized_to_tray_starts_background_when_enabled() {
        assert_eq!(
            autostart_window_action(true, true, true, true, false),
            AutostartWindowAction::HideToTray {
                start_background: true
            }
        );
    }

    #[test]
    fn autostart_minimized_to_tray_does_not_start_background_when_disabled() {
        assert_eq!(
            autostart_window_action(true, true, true, false, false),
            AutostartWindowAction::HideToTray {
                start_background: false
            }
        );
    }

    #[test]
    fn startup_foreground_request_overrides_autostart_window_action() {
        assert_eq!(
            autostart_window_action(true, true, true, true, true),
            AutostartWindowAction::None
        );
    }
}
