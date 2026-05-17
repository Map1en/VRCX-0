use std::time::Duration;

use chrono::Utc;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};

use crate::error::AppError;
use vrcx_0_host::asset_bundle_cache;
use vrcx_0_store::config as backend_config;
use vrcx_0_store::game_log::{write_batch, GameLogEventEntry, GameLogWriteBatch};

use super::service::GameClientDeps;

const CRASH_RELAUNCH_MESSAGE: &str = "VRChat crashed, attempting to rejoin last instance.";
const CRASH_RELAUNCH_DEDUPE_MS: i64 = 120_000;
const NOVR_RELAUNCH_DELAY: Duration = Duration::from_secs(2);
const VR_RELAUNCH_DELAY: Duration = Duration::from_secs(8);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct CrashRelaunchPlan {
    pub location: String,
    pub desktop_mode: bool,
    pub delay: Duration,
    pub launch_arguments: String,
    pub launch_path_override: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct CrashRelaunchConfig {
    pub enabled: bool,
    pub is_game_no_vr: bool,
    pub launch_arguments: String,
    pub launch_path_override: String,
}

pub(super) fn prepare_game_stopped(
    deps: &GameClientDeps,
) -> Result<Option<CrashRelaunchPlan>, AppError> {
    if let Err(error) = persist_game_stop_session(deps) {
        tracing::warn!("failed to persist backend game-stop session: {error}");
    }
    if let Err(error) = sweep_vrchat_cache_if_enabled(deps) {
        tracing::warn!("failed to sweep VRChat cache after game stop: {error}");
    }

    let config = CrashRelaunchConfig {
        enabled: backend_config::get_bool(&deps.context.db, "relaunchVRChatAfterCrash", false)?,
        is_game_no_vr: backend_config::get_bool(&deps.context.db, "isGameNoVR", false)?,
        launch_arguments: backend_config::get_string(&deps.context.db, "launchArguments", "")?,
        launch_path_override: backend_config::get_string(
            &deps.context.db,
            "vrcLaunchPathOverride",
            "",
        )?,
    };
    let location = resolve_current_location(deps);
    let closed_gracefully = deps.log_watcher.vrc_closed_gracefully();
    let now_ms = Utc::now().timestamp_millis();
    let plan = {
        let mut state = deps
            .state
            .lock()
            .map_err(|error| AppError::Custom(format!("GameClient state lock: {error}")))?;
        let plan = plan_crash_relaunch(
            &config,
            &location,
            closed_gracefully,
            now_ms,
            state.last_crash_at_ms,
        );
        if plan.is_some() {
            state.last_crash_at_ms = Some(now_ms);
        }
        plan
    };

    emit_crash_relaunch_decision(deps, plan.as_ref(), &location);
    Ok(plan)
}

fn persist_game_stop_session(deps: &GameClientDeps) -> Result<(), AppError> {
    let snapshot = deps.context.session.snapshot();
    let Some(started_at) = snapshot.last_game_started_at.as_deref() else {
        return Ok(());
    };
    let Ok(started_at) = chrono::DateTime::parse_from_rfc3339(started_at) else {
        return Ok(());
    };
    let offline_at = Utc::now().timestamp_millis();
    let session_duration = offline_at.saturating_sub(started_at.timestamp_millis());
    if session_duration <= 0 {
        return Ok(());
    }
    deps.context
        .config
        .set_string("lastGameSessionMs", &session_duration.to_string())?;
    deps.context
        .config
        .set_string("lastGameOfflineAt", &offline_at.to_string())?;
    Ok(())
}

fn sweep_vrchat_cache_if_enabled(deps: &GameClientDeps) -> Result<(), AppError> {
    if !backend_config::get_bool(&deps.context.db, "autoSweepVRChatCache", false)? {
        return Ok(());
    }
    let removed_paths = asset_bundle_cache::sweep_cache();
    let removed_count = removed_paths.len();
    deps.context.event_bus.emit_game_client_event(
        "notification",
        serde_json::json!({
            "level": "info",
            "title": "VRChat cache swept",
            "message": if removed_count > 0 {
                format!("Removed {removed_count} cache entries.")
            } else {
                "No cache entries were removed.".to_string()
            },
        }),
    );
    Ok(())
}

pub(super) async fn execute_crash_relaunch(
    deps: GameClientDeps,
    plan: CrashRelaunchPlan,
) -> Result<(), AppError> {
    tokio::time::sleep(plan.delay).await;
    if is_game_running(&deps) {
        tracing::info!("VRChat is already running; skipping crash relaunch");
        return Ok(());
    }
    if !plan.desktop_mode && !is_steamvr_running(&deps) {
        tracing::info!("SteamVR is not running; skipping VRChat crash relaunch");
        return Ok(());
    }

    focus_main_window(&deps);
    persist_crash_relaunch_event(&deps)?;

    let launched = if plan.launch_path_override.trim().is_empty() {
        deps.actions.start_game(&plan.launch_arguments)?
    } else {
        deps.actions
            .start_game_from_path(&plan.launch_path_override, &plan.launch_arguments)?
    };
    if !launched {
        deps.context.event_bus.emit_game_client_event(
            "notification",
            serde_json::json!({
                "level": "error",
                "title": "VRChat relaunch failed",
                "message": "Failed to find VRChat. Configure a custom launch path in launch options.",
            }),
        );
        return Err(AppError::Custom("VRChat crash relaunch failed".into()));
    }

    Ok(())
}

pub(super) fn plan_crash_relaunch(
    config: &CrashRelaunchConfig,
    location: &str,
    closed_gracefully: bool,
    now_ms: i64,
    last_crash_at_ms: Option<i64>,
) -> Option<CrashRelaunchPlan> {
    if !config.enabled || closed_gracefully || !is_real_instance(location) {
        return None;
    }
    if last_crash_at_ms.is_some_and(|last| now_ms - last < CRASH_RELAUNCH_DEDUPE_MS) {
        return None;
    }

    Some(CrashRelaunchPlan {
        location: location.to_string(),
        desktop_mode: config.is_game_no_vr,
        delay: if config.is_game_no_vr {
            NOVR_RELAUNCH_DELAY
        } else {
            VR_RELAUNCH_DELAY
        },
        launch_arguments: build_launch_arguments(
            location,
            &config.launch_arguments,
            config.is_game_no_vr,
        ),
        launch_path_override: config.launch_path_override.clone(),
    })
}

fn build_launch_arguments(location: &str, launch_arguments: &str, desktop_mode: bool) -> String {
    let launch_url = format!(
        "vrchat://launch?ref=vrcx.app&id={}",
        utf8_percent_encode(location, NON_ALPHANUMERIC)
    );
    let mut args = vec![launch_url];
    if !launch_arguments.trim().is_empty() {
        args.push(launch_arguments.trim().to_string());
    }
    if desktop_mode {
        args.push("--no-vr".into());
    }
    args.join(" ")
}

fn resolve_current_location(deps: &GameClientDeps) -> String {
    if let Ok(state) = deps.state.lock() {
        let current_location = state.current_location.trim();
        if !current_location.is_empty() {
            return current_location.to_string();
        }
    }

    deps.log_watcher
        .current_location_snapshot()
        .map(|snapshot| snapshot.location)
        .unwrap_or_default()
}

fn emit_crash_relaunch_decision(
    deps: &GameClientDeps,
    plan: Option<&CrashRelaunchPlan>,
    location: &str,
) {
    deps.context.event_bus.emit_game_client_event(
        "crashRelaunchDecision",
        serde_json::json!({
            "handled": plan.is_some(),
            "location": location,
            "delayMs": plan.map(|entry| entry.delay.as_millis() as u64),
        }),
    );
}

fn focus_main_window(deps: &GameClientDeps) {
    deps.context.host.focus_main_window();
}

fn is_game_running(deps: &GameClientDeps) -> bool {
    deps.context.session.snapshot().is_game_running || deps.actions.is_game_running()
}

fn is_steamvr_running(deps: &GameClientDeps) -> bool {
    deps.context.session.snapshot().is_steamvr_running || deps.actions.is_steamvr_running()
}

fn persist_crash_relaunch_event(deps: &GameClientDeps) -> Result<(), AppError> {
    let created_at = now_iso();
    write_batch(
        &deps.context.db,
        &GameLogWriteBatch {
            events: vec![GameLogEventEntry {
                created_at: created_at.clone(),
                data: CRASH_RELAUNCH_MESSAGE.into(),
            }],
            ..Default::default()
        },
    )?;
    deps.context.event_bus.emit_backend_game_log_event(vec![
        "backend-game-client".into(),
        created_at,
        "event".into(),
        CRASH_RELAUNCH_MESSAGE.into(),
    ]);
    deps.context.event_bus.emit_game_client_event(
        "notification",
        serde_json::json!({
            "level": "warning",
            "title": "VRChat crash detected",
            "message": CRASH_RELAUNCH_MESSAGE,
        }),
    );
    Ok(())
}

fn now_iso() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn is_real_instance(location: &str) -> bool {
    if location.is_empty() {
        return false;
    }
    match location {
        ":"
        | "offline"
        | "offline:offline"
        | "private"
        | "private:private"
        | "traveling"
        | "traveling:traveling" => return false,
        _ => {}
    }
    !location.starts_with("local")
}

#[cfg(test)]
mod tests {
    use super::{plan_crash_relaunch, CrashRelaunchConfig};

    fn config() -> CrashRelaunchConfig {
        CrashRelaunchConfig {
            enabled: true,
            is_game_no_vr: false,
            launch_arguments: "--profile=0".into(),
            launch_path_override: String::new(),
        }
    }

    #[test]
    fn skips_crash_relaunch_when_disabled_or_not_real_location() {
        let mut disabled = config();
        disabled.enabled = false;
        assert!(plan_crash_relaunch(&disabled, "wrld_test:1", false, 10_000, None).is_none());
        assert!(plan_crash_relaunch(&config(), "traveling", false, 10_000, None).is_none());
        assert!(plan_crash_relaunch(&config(), "wrld_test:1", true, 10_000, None).is_none());
    }

    #[test]
    fn builds_relaunch_plan_with_desktop_mode_arguments() {
        let mut cfg = config();
        cfg.is_game_no_vr = true;
        let plan = plan_crash_relaunch(&cfg, "wrld_test:1", false, 10_000, None).unwrap();
        assert!(plan
            .launch_arguments
            .contains("vrchat://launch?ref=vrcx.app&id=wrld"));
        assert!(plan.launch_arguments.contains("--profile=0"));
        assert!(plan.launch_arguments.ends_with("--no-vr"));
        assert_eq!(plan.delay.as_secs(), 2);
    }

    #[test]
    fn dedupes_recent_crash_relaunch_attempts() {
        assert!(
            plan_crash_relaunch(&config(), "wrld_test:1", false, 10_000, Some(9_000)).is_none()
        );
        assert!(
            plan_crash_relaunch(&config(), "wrld_test:1", false, 200_000, Some(9_000)).is_some()
        );
    }
}
