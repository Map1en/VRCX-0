use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::Manager;
use vrcx_0_application_core::{BackendRuntimeMode, BackendRuntimePhase, GuiRuntimeMode};

use crate::error::AppError;
use crate::state::AppState;

const DEFAULT_DELAY_MINUTES: u64 = 60;
const MIN_DELAY_MINUTES: u64 = 10;
const MAX_DELAY_MINUTES: u64 = 600;

pub(crate) fn arm_background_delay(app: &tauri::AppHandle, state: &AppState) -> bool {
    let Some(minutes) = delay_minutes_setting(state) else {
        return false;
    };
    let generation = state
        .background_delay_generation
        .fetch_add(1, Ordering::AcqRel)
        + 1;
    let (cancel, mut cancelled) = tokio::sync::oneshot::channel();
    let Ok(mut cancel_slot) = state.background_delay_cancel.lock() else {
        tracing::warn!("failed to lock background delay cancellation state");
        return false;
    };
    if let Some((_, previous)) = cancel_slot.replace((generation, cancel)) {
        let _ = previous.send(());
    }
    drop(cancel_slot);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(minutes * 60)) => {}
            _ = &mut cancelled => return,
        }
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        if !background_delay_ready(&app, &state) {
            let _ = claim_background_delay_generation(
                &state.background_delay_generation,
                &state.background_delay_cancel,
                generation,
            );
            return;
        }
        if !claim_background_delay_generation(
            &state.background_delay_generation,
            &state.background_delay_cancel,
            generation,
        ) {
            return;
        }
        if !background_delay_ready(&app, &state) {
            return;
        }
        if let Err(error) = start_background_mode_after_delay(&app, &state).await {
            tracing::warn!(
                error = %error,
                "failed to start background mode after delay"
            );
        }
    });
    true
}

pub(crate) fn cancel_background_delay(state: &AppState) {
    state
        .background_delay_generation
        .fetch_add(1, Ordering::AcqRel);
    let Ok(mut cancel_slot) = state.background_delay_cancel.lock() else {
        tracing::warn!("failed to lock background delay cancellation state");
        return;
    };
    if let Some((_, cancel)) = cancel_slot.take() {
        let _ = cancel.send(());
    }
}

fn claim_background_delay_generation(
    generation_counter: &std::sync::atomic::AtomicU64,
    cancel_slot: &std::sync::Mutex<Option<(u64, tokio::sync::oneshot::Sender<()>)>>,
    generation: u64,
) -> bool {
    let Ok(mut cancel_slot) = cancel_slot.lock() else {
        return false;
    };
    if !cancel_slot
        .as_ref()
        .is_some_and(|(current, _)| *current == generation)
    {
        return false;
    }
    let claimed = generation_counter
        .compare_exchange(
            generation,
            generation + 1,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_ok();
    if claimed {
        cancel_slot.take();
    }
    claimed
}

fn background_delay_ready(app: &tauri::AppHandle, state: &AppState) -> bool {
    if !main_window_hidden(app) {
        return false;
    }
    let snapshot = state.runtime_host().backend_runtime_snapshot();
    snapshot.mode == BackendRuntimeMode::Foreground
        && snapshot.phase == BackendRuntimePhase::Running
        && !state.is_main_window_rebuild_in_progress()
}

async fn start_background_mode_after_delay(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<(), AppError> {
    super::capture_background_resume_route(app, state);
    let snapshot = match state
        .runtime_host()
        .start_gui_backend_runtime(GuiRuntimeMode::Background)
        .await
    {
        Ok(snapshot) => snapshot,
        Err(error) => {
            super::show_auth_failure_notification_after_backend_start_error(app, state, &error);
            let _ = super::refresh_tray_menu(app, state);
            return Err(error.into());
        }
    };

    let current = state.runtime_host().backend_runtime_snapshot();
    if snapshot.mode == BackendRuntimeMode::Background
        && current.mode == BackendRuntimeMode::Background
        && current.phase == BackendRuntimePhase::Running
    {
        if destroy_main_window_for_background_mode_if_hidden(app, state) {
            super::show_background_mode_started_notification(app, state);
        } else if let Err(error) = super::restore_foreground_window_from_background_mode(app, state)
        {
            tracing::warn!(
                error = %error,
                "failed to restore foreground window after cancelled background delay"
            );
        }
    }
    let _ = super::refresh_tray_menu(app, state);
    Ok(())
}

fn delay_minutes_setting(state: &AppState) -> Option<u64> {
    let enabled = state
        .runtime_host()
        .config_bool("backgroundModeDelayEnabled", false);
    if !enabled {
        return None;
    }
    let raw = Some(
        state
            .runtime_host()
            .config_string("backgroundModeDelayMinutes", "60"),
    );
    resolve_delay_minutes(true, raw.as_deref())
}

fn resolve_delay_minutes(enabled: bool, raw: Option<&str>) -> Option<u64> {
    if !enabled {
        return None;
    }
    let minutes = raw
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_DELAY_MINUTES);
    Some(minutes.clamp(MIN_DELAY_MINUTES, MAX_DELAY_MINUTES))
}

fn destroy_main_window_for_background_mode_if_hidden(
    app: &tauri::AppHandle,
    state: &AppState,
) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        state.runtime_host().set_frontend_tray_notification(false);
        return true;
    };
    if window.is_visible().unwrap_or(true) {
        return false;
    }
    state.runtime_host().set_frontend_tray_notification(false);
    if let Err(error) = window.destroy() {
        tracing::warn!(error = %error, "failed to destroy main window for background mode");
        let _ = window.hide();
        let _ = window.set_skip_taskbar(true);
    }
    true
}

fn main_window_hidden(app: &tauri::AppHandle) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return true;
    };
    window.is_visible().map(|visible| !visible).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    use super::{claim_background_delay_generation, resolve_delay_minutes};

    #[test]
    fn resolve_delay_minutes_respects_enabled_default_and_clamp_bounds() {
        assert_eq!(resolve_delay_minutes(false, Some("30")), None);
        assert_eq!(resolve_delay_minutes(true, None), Some(60));
        assert_eq!(resolve_delay_minutes(true, Some("not-a-number")), Some(60));
        assert_eq!(resolve_delay_minutes(true, Some("5")), Some(10));
        assert_eq!(resolve_delay_minutes(true, Some("9999")), Some(600));
        assert_eq!(resolve_delay_minutes(true, Some("120")), Some(120));
    }

    #[test]
    fn claim_background_delay_generation_only_claims_current_timer() {
        let generation = AtomicU64::new(7);
        let cancel_slot = Mutex::new(None);
        let (cancel, _cancelled) = tokio::sync::oneshot::channel();
        *cancel_slot.lock().unwrap() = Some((7, cancel));

        assert!(claim_background_delay_generation(
            &generation,
            &cancel_slot,
            7
        ));
        assert_eq!(generation.load(Ordering::Acquire), 8);
        assert!(cancel_slot.lock().unwrap().is_none());
        assert!(!claim_background_delay_generation(
            &generation,
            &cancel_slot,
            7
        ));

        generation.fetch_add(1, Ordering::AcqRel);
        let (cancel, _cancelled) = tokio::sync::oneshot::channel();
        *cancel_slot.lock().unwrap() = Some((8, cancel));
        assert!(!claim_background_delay_generation(
            &generation,
            &cancel_slot,
            8
        ));
    }
}
