use std::sync::{Arc, Mutex};

use chrono::Utc;
use vrcx_0_core::log_watcher::LogLocationSnapshot;
use vrcx_0_persistence::config::{self as config_store, ConfigRepository};
use vrcx_0_persistence::game_log::{write_batch, GameLogEventEntry, GameLogWriteBatch};
use vrcx_0_persistence::DatabaseService;

use crate::game_client::actions::{GameClientActions, GameClientDebugLoggingActions};
use crate::game_client::lifecycle::{plan_crash_relaunch, CrashRelaunchConfig, CrashRelaunchPlan};
use crate::RuntimeEventBus;
use crate::RuntimeGameEventBusExt;
use crate::{
    CrashRelaunchDecisionPayload, GameClientEvent, RuntimeGameLogEventPayload,
    RuntimeNotificationPayload,
};
use crate::{Error, Result};
use crate::{HostSessionRuntime, RuntimeAuthScope, TaskSupervisor};

const CRASH_RELAUNCH_MESSAGE: &str = "VRChat crashed, attempting to rejoin last instance.";

pub trait GameClientLocationSource: Send + Sync {
    fn vrc_closed_gracefully(&self) -> bool;
    fn current_location_snapshot(&self) -> Option<LogLocationSnapshot>;
}

pub trait GameClientWindowActions: Send + Sync {
    fn focus_main_window(&self);
}

pub trait GameClientCacheActions: Send + Sync {
    fn sweep_vrchat_cache(&self) -> Vec<String>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DebugLoggingOutcomeKind {
    Disabled,
    Unavailable,
    Enabled,
    Repaired,
    NeedsUserAction,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DebugLoggingOutcome {
    pub check_id: u64,
    pub kind: DebugLoggingOutcomeKind,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct NoopGameClientCacheActions;

impl GameClientCacheActions for NoopGameClientCacheActions {
    fn sweep_vrchat_cache(&self) -> Vec<String> {
        Vec::new()
    }
}

#[derive(Default)]
pub struct NoopGameClientWindowActions;

impl GameClientWindowActions for NoopGameClientWindowActions {
    fn focus_main_window(&self) {}
}

#[derive(Clone)]
pub struct GameClientProcessorDeps {
    pub db: Arc<DatabaseService>,
    pub config: ConfigRepository,
    pub event_bus: RuntimeEventBus,
    pub tasks: TaskSupervisor,
    pub session: HostSessionRuntime,
    pub auth_scope: RuntimeAuthScope,
    pub actions: Arc<dyn GameClientActions>,
    pub cache_actions: Arc<dyn GameClientCacheActions>,
    pub location_source: Arc<dyn GameClientLocationSource>,
    pub window_actions: Arc<dyn GameClientWindowActions>,
    pub debug_logging_actions: Arc<dyn GameClientDebugLoggingActions>,
}

#[derive(Default)]
pub struct GameClientState {
    pub last_crash_at_ms: Option<i64>,
    pub current_location: String,
    pub debug_logging_outcome: Option<DebugLoggingOutcome>,
    pub debug_logging_check_id: u64,
    pub debug_logging_generation: u64,
}

#[derive(Clone)]
pub enum GameClientJob {
    GameStopped,
    DebugLoggingCheck {
        delay: std::time::Duration,
        game_generation: Option<u64>,
    },
}

#[derive(Clone)]
pub struct GameClientProcessor {
    deps: GameClientProcessorDeps,
    state: Arc<Mutex<GameClientState>>,
}

impl GameClientProcessor {
    pub fn new(deps: GameClientProcessorDeps, state: Arc<Mutex<GameClientState>>) -> Self {
        Self { deps, state }
    }

    pub fn handle_jobs(&self, jobs: Vec<GameClientJob>) -> Result<()> {
        let mut first_error = None;
        for job in jobs {
            match job {
                GameClientJob::GameStopped => match self.prepare_game_stopped() {
                    Ok(Some(plan)) => {
                        let processor = self.clone();
                        self.deps.tasks.spawn(async move {
                            if let Err(error) = processor.execute_crash_relaunch(plan).await {
                                tracing::warn!("GameClient stopped-game handling failed: {error}");
                            }
                        });
                    }
                    Ok(None) => {}
                    Err(error) => {
                        self.deps.event_bus.emit_game_client_event(
                            GameClientEvent::CrashRelaunchDecision(
                                CrashRelaunchDecisionPayload::Failure {
                                    handled: false,
                                    error: error.to_string(),
                                },
                            ),
                        );
                        remember_error(&mut first_error, error);
                    }
                },
                GameClientJob::DebugLoggingCheck {
                    delay,
                    game_generation,
                } => {
                    if !delay.is_zero() {
                        std::thread::sleep(delay);
                    }
                    if self.should_run_debug_logging_check(game_generation) {
                        self.check_debug_logging();
                    }
                }
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    fn check_debug_logging(&self) {
        let (kind, error) = resolve_debug_logging_outcome(
            config_store::get_bool(&self.deps.db, "gameLogDisabled", false).map_err(Into::into),
            self.deps.debug_logging_actions.as_ref(),
        );
        let mut outcome = DebugLoggingOutcome {
            check_id: 0,
            kind,
            error,
        };
        if let Ok(mut state) = self.state.lock() {
            state.debug_logging_check_id = state.debug_logging_check_id.saturating_add(1);
            outcome.check_id = state.debug_logging_check_id;
            state.debug_logging_outcome = Some(outcome.clone());
        }
        self.deps
            .event_bus
            .emit_game_client_event(GameClientEvent::DebugLoggingOutcome(outcome));
    }

    fn should_run_debug_logging_check(&self, game_generation: Option<u64>) -> bool {
        let Some(expected_generation) = game_generation else {
            return true;
        };
        let generation_matches = self
            .state
            .lock()
            .map(|state| state.debug_logging_generation == expected_generation)
            .unwrap_or(false);
        generation_matches && self.is_game_running()
    }

    fn prepare_game_stopped(&self) -> Result<Option<CrashRelaunchPlan>> {
        if let Err(error) = self.persist_game_stop_session() {
            tracing::warn!("failed to persist runtime game-stop session: {error}");
        }
        if let Err(error) = self.sweep_vrchat_cache_if_enabled() {
            tracing::warn!("failed to sweep VRChat cache after game stop: {error}");
        }

        let config = CrashRelaunchConfig {
            enabled: config_store::get_bool(&self.deps.db, "relaunchVRChatAfterCrash", false)?,
            is_game_no_vr: config_store::get_bool(&self.deps.db, "isGameNoVR", false)?,
            launch_arguments: config_store::get_string(&self.deps.db, "launchArguments", "")?,
            launch_path_override: config_store::get_string(
                &self.deps.db,
                "vrcLaunchPathOverride",
                "",
            )?,
        };
        let location = self.current_location();
        let closed_gracefully = self.deps.location_source.vrc_closed_gracefully();
        let now_ms = Utc::now().timestamp_millis();
        let plan = {
            let mut state = self.lock_state()?;
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

        self.emit_crash_relaunch_decision(plan.as_ref(), &location);
        Ok(plan)
    }

    fn persist_game_stop_session(&self) -> Result<()> {
        let snapshot = self.deps.session.snapshot();
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
        self.deps
            .config
            .set_string("lastGameSessionMs", &session_duration.to_string())?;
        self.deps
            .config
            .set_string("lastGameOfflineAt", &offline_at.to_string())?;
        Ok(())
    }

    fn sweep_vrchat_cache_if_enabled(&self) -> Result<()> {
        if !config_store::get_bool(&self.deps.db, "autoSweepVRChatCache", false)? {
            return Ok(());
        }
        let removed_paths = self.deps.cache_actions.sweep_vrchat_cache();
        let removed_count = removed_paths.len();
        self.deps
            .event_bus
            .emit_game_client_event(GameClientEvent::Notification(RuntimeNotificationPayload {
                level: "info".into(),
                title: "VRChat cache swept".into(),
                message: if removed_count > 0 {
                    format!("Removed {removed_count} cache entries.")
                } else {
                    "No cache entries were removed.".to_string()
                },
            }));
        Ok(())
    }

    async fn execute_crash_relaunch(&self, plan: CrashRelaunchPlan) -> Result<()> {
        tokio::time::sleep(plan.delay).await;
        if self.is_game_running() {
            tracing::info!("VRChat is already running; skipping crash relaunch");
            return Ok(());
        }
        if !plan.desktop_mode && !self.is_steamvr_running() {
            tracing::info!("SteamVR is not running; skipping VRChat crash relaunch");
            return Ok(());
        }

        self.deps.window_actions.focus_main_window();
        self.persist_crash_relaunch_event()?;

        let launched = if plan.launch_path_override.trim().is_empty() {
            self.deps.actions.start_game(&plan.launch_arguments)?
        } else {
            self.deps
                .actions
                .start_game_from_path(&plan.launch_path_override, &plan.launch_arguments)?
        };
        if !launched {
            self.deps
                .event_bus
                .emit_game_client_event(GameClientEvent::Notification(
                RuntimeNotificationPayload {
                    level: "error".into(),
                    title: "VRChat relaunch failed".into(),
                    message:
                        "Failed to find VRChat. Configure a custom launch path in launch options."
                            .into(),
                },
            ));
            return Err(Error::Custom("VRChat crash relaunch failed".into()));
        }

        Ok(())
    }

    fn current_location(&self) -> String {
        if let Ok(state) = self.state.lock() {
            let current_location = state.current_location.trim();
            if !current_location.is_empty() {
                return current_location.to_string();
            }
        }

        self.deps
            .location_source
            .current_location_snapshot()
            .map(|snapshot| snapshot.location)
            .unwrap_or_default()
    }

    fn emit_crash_relaunch_decision(&self, plan: Option<&CrashRelaunchPlan>, location: &str) {
        self.deps
            .event_bus
            .emit_game_client_event(GameClientEvent::CrashRelaunchDecision(
                CrashRelaunchDecisionPayload::Evaluated {
                    handled: plan.is_some(),
                    location: location.into(),
                    delay_ms: plan.map(|entry| entry.delay.as_millis() as u64),
                },
            ));
    }

    fn is_game_running(&self) -> bool {
        self.deps.session.snapshot().is_game_running || self.deps.actions.is_game_running()
    }

    fn is_steamvr_running(&self) -> bool {
        self.deps.session.snapshot().is_steamvr_running || self.deps.actions.is_steamvr_running()
    }

    fn persist_crash_relaunch_event(&self) -> Result<()> {
        let created_at = now_iso();
        let affected_count = write_batch(
            &self.deps.db,
            &self.deps.auth_scope.snapshot().current_user_id,
            &GameLogWriteBatch {
                events: vec![GameLogEventEntry {
                    created_at: created_at.clone(),
                    data: CRASH_RELAUNCH_MESSAGE.into(),
                }],
                ..Default::default()
            },
        )?;
        self.deps.event_bus.emit_game_log_persisted(affected_count);
        self.deps
            .event_bus
            .emit_runtime_game_log_event(RuntimeGameLogEventPayload {
                runtime_persisted: true,
                raw: vec![
                    "runtime-game-client".into(),
                    created_at,
                    "event".into(),
                    CRASH_RELAUNCH_MESSAGE.into(),
                ],
            });
        self.deps
            .event_bus
            .emit_game_client_event(GameClientEvent::Notification(RuntimeNotificationPayload {
                level: "warning".into(),
                title: "VRChat crash detected".into(),
                message: CRASH_RELAUNCH_MESSAGE.into(),
            }));
        Ok(())
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, GameClientState>> {
        self.state
            .lock()
            .map_err(|error| Error::Custom(format!("GameClient state lock: {error}")))
    }
}

fn resolve_debug_logging_outcome(
    game_log_disabled: Result<bool>,
    actions: &dyn GameClientDebugLoggingActions,
) -> (DebugLoggingOutcomeKind, Option<String>) {
    match game_log_disabled {
        Ok(true) => (DebugLoggingOutcomeKind::Disabled, None),
        Err(error) => (
            DebugLoggingOutcomeKind::Unavailable,
            Some(error.to_string()),
        ),
        Ok(false) => match actions.read_debug_logging_enabled() {
            Ok(None) => (DebugLoggingOutcomeKind::Unavailable, None),
            Ok(Some(true)) => (DebugLoggingOutcomeKind::Enabled, None),
            Ok(Some(false)) => match actions.enable_debug_logging() {
                Ok(true) => (DebugLoggingOutcomeKind::Repaired, None),
                Ok(false) => (DebugLoggingOutcomeKind::NeedsUserAction, None),
                Err(error) => (
                    DebugLoggingOutcomeKind::NeedsUserAction,
                    Some(error.to_string()),
                ),
            },
            Err(error) => (
                DebugLoggingOutcomeKind::Unavailable,
                Some(error.to_string()),
            ),
        },
    }
}

fn remember_error(first_error: &mut Option<Error>, error: Error) {
    if first_error.is_none() {
        *first_error = Some(error);
    } else {
        tracing::warn!("GameClient worker job failed: {error}");
    }
}

fn now_iso() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    struct FakeDebugLoggingActions {
        enabled: Option<bool>,
        repair_succeeds: bool,
        repair_attempts: AtomicUsize,
    }

    impl GameClientDebugLoggingActions for FakeDebugLoggingActions {
        fn read_debug_logging_enabled(&self) -> Result<Option<bool>> {
            Ok(self.enabled)
        }

        fn enable_debug_logging(&self) -> Result<bool> {
            self.repair_attempts.fetch_add(1, Ordering::AcqRel);
            Ok(self.repair_succeeds)
        }
    }

    #[test]
    fn debug_logging_disabled_game_log_skips_registry_repair() {
        let actions = FakeDebugLoggingActions {
            enabled: Some(false),
            repair_succeeds: true,
            repair_attempts: AtomicUsize::new(0),
        };

        let (kind, error) = resolve_debug_logging_outcome(Ok(true), &actions);

        assert_eq!(kind, DebugLoggingOutcomeKind::Disabled);
        assert_eq!(error, None);
        assert_eq!(actions.repair_attempts.load(Ordering::Acquire), 0);
    }

    #[test]
    fn debug_logging_disabled_registry_value_is_repaired_once() {
        let actions = FakeDebugLoggingActions {
            enabled: Some(false),
            repair_succeeds: true,
            repair_attempts: AtomicUsize::new(0),
        };

        let (kind, error) = resolve_debug_logging_outcome(Ok(false), &actions);

        assert_eq!(kind, DebugLoggingOutcomeKind::Repaired);
        assert_eq!(error, None);
        assert_eq!(actions.repair_attempts.load(Ordering::Acquire), 1);
    }
}
