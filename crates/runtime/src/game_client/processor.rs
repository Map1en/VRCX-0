use std::sync::{Arc, Mutex};

use chrono::Utc;
use vrcx_0_core::log_watcher::LogLocationSnapshot;
use vrcx_0_host::asset_bundle_cache;
use vrcx_0_store::config::{self as backend_config, ConfigRepository};
use vrcx_0_store::database::DatabaseService;
use vrcx_0_store::game_log::{
    write_batch, GameLogEventEntry, GameLogExternalEntry, GameLogWriteBatch,
};

use crate::event_bus::BackendEventBus;
use crate::game_client::actions::GameClientActions;
use crate::game_client::lifecycle::{plan_crash_relaunch, CrashRelaunchConfig, CrashRelaunchPlan};
use crate::session::HostSessionRuntime;
use crate::task_runtime::BackendTasks;
use crate::{Error, Result};

const CRASH_RELAUNCH_MESSAGE: &str = "VRChat crashed, attempting to rejoin last instance.";

pub trait GameClientLocationSource: Send + Sync {
    fn vrc_closed_gracefully(&self) -> bool;
    fn current_location_snapshot(&self) -> Option<LogLocationSnapshot>;
}

pub trait GameClientWindowActions: Send + Sync {
    fn focus_main_window(&self);
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
    pub event_bus: BackendEventBus,
    pub tasks: BackendTasks,
    pub session: HostSessionRuntime,
    pub actions: Arc<dyn GameClientActions>,
    pub location_source: Arc<dyn GameClientLocationSource>,
    pub window_actions: Arc<dyn GameClientWindowActions>,
}

#[derive(Default)]
pub struct GameClientState {
    pub external_notifier_version: i64,
    pub last_crash_at_ms: Option<i64>,
    pub session_active: bool,
    pub current_location: String,
}

#[derive(Clone)]
pub enum GameClientJob {
    VrcxNoty {
        message: String,
        fallback_packet: String,
    },
    VrcxExternal {
        message: String,
        display_name: String,
        user_id: String,
        notify: bool,
        fallback_packet: String,
    },
    GameStopped,
}

impl GameClientJob {
    fn fallback_packet(&self) -> Option<&str> {
        match self {
            GameClientJob::VrcxNoty {
                fallback_packet, ..
            }
            | GameClientJob::VrcxExternal {
                fallback_packet, ..
            } => Some(fallback_packet),
            GameClientJob::GameStopped => None,
        }
    }
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
            let fallback_packet = job.fallback_packet().map(ToOwned::to_owned);
            match job {
                GameClientJob::VrcxNoty { .. } | GameClientJob::VrcxExternal { .. } => {
                    if let Err(error) = self.handle_ipc_job(job) {
                        if let Some(packet) = fallback_packet {
                            self.deps.event_bus.emit_ipc_event(&packet);
                        }
                        remember_error(&mut first_error, error);
                    }
                }
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
                            "crashRelaunchDecision",
                            serde_json::json!({
                                "handled": false,
                                "error": error.to_string(),
                            }),
                        );
                        remember_error(&mut first_error, error);
                    }
                },
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    fn handle_ipc_job(&self, job: GameClientJob) -> Result<()> {
        match job {
            GameClientJob::VrcxNoty { message, .. } => self.handle_vrcx_noty(&message),
            GameClientJob::VrcxExternal {
                message,
                display_name,
                user_id,
                notify,
                ..
            } => self.handle_vrcx_external(&message, &display_name, &user_id, notify),
            GameClientJob::GameStopped => Ok(()),
        }
    }

    fn handle_vrcx_noty(&self, message: &str) -> Result<()> {
        let version = self.lock_state()?.external_notifier_version;
        if version > 21 {
            return Ok(());
        }

        let created_at = now_iso();
        write_batch(
            &self.deps.db,
            &GameLogWriteBatch {
                events: vec![GameLogEventEntry {
                    created_at: created_at.clone(),
                    data: message.to_string(),
                }],
                ..Default::default()
            },
        )?;
        self.deps.event_bus.emit_backend_game_log_event(vec![
            "backend-ipc".into(),
            created_at,
            "event".into(),
            message.to_string(),
        ]);
        self.deps.event_bus.emit_game_client_event(
            "notification",
            serde_json::json!({
                "level": "info",
                "title": "External notifier",
                "message": message,
            }),
        );
        Ok(())
    }

    fn handle_vrcx_external(
        &self,
        message: &str,
        display_name: &str,
        user_id: &str,
        notify: bool,
    ) -> Result<()> {
        let created_at = now_iso();
        let location = self.current_location();
        write_batch(
            &self.deps.db,
            &GameLogWriteBatch {
                externals: vec![GameLogExternalEntry {
                    created_at: created_at.clone(),
                    message: message.to_string(),
                    display_name: display_name.to_string(),
                    user_id: user_id.to_string(),
                    location: location.clone(),
                }],
                ..Default::default()
            },
        )?;
        self.deps.event_bus.emit_backend_game_log_event(vec![
            "backend-ipc".into(),
            created_at,
            "external".into(),
            message.to_string(),
            display_name.to_string(),
            user_id.to_string(),
            location,
        ]);
        if notify {
            self.deps.event_bus.emit_game_client_event(
                "notification",
                serde_json::json!({
                    "level": "info",
                    "title": if display_name.is_empty() { "External" } else { display_name },
                    "message": message,
                }),
            );
        }
        Ok(())
    }

    fn prepare_game_stopped(&self) -> Result<Option<CrashRelaunchPlan>> {
        if let Err(error) = self.persist_game_stop_session() {
            tracing::warn!("failed to persist backend game-stop session: {error}");
        }
        if let Err(error) = self.sweep_vrchat_cache_if_enabled() {
            tracing::warn!("failed to sweep VRChat cache after game stop: {error}");
        }

        let config = CrashRelaunchConfig {
            enabled: backend_config::get_bool(&self.deps.db, "relaunchVRChatAfterCrash", false)?,
            is_game_no_vr: backend_config::get_bool(&self.deps.db, "isGameNoVR", false)?,
            launch_arguments: backend_config::get_string(&self.deps.db, "launchArguments", "")?,
            launch_path_override: backend_config::get_string(
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
        if !backend_config::get_bool(&self.deps.db, "autoSweepVRChatCache", false)? {
            return Ok(());
        }
        let removed_paths = asset_bundle_cache::sweep_cache();
        let removed_count = removed_paths.len();
        self.deps.event_bus.emit_game_client_event(
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
            self.deps.event_bus.emit_game_client_event(
                "notification",
                serde_json::json!({
                    "level": "error",
                    "title": "VRChat relaunch failed",
                    "message": "Failed to find VRChat. Configure a custom launch path in launch options.",
                }),
            );
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
        self.deps.event_bus.emit_game_client_event(
            "crashRelaunchDecision",
            serde_json::json!({
                "handled": plan.is_some(),
                "location": location,
                "delayMs": plan.map(|entry| entry.delay.as_millis() as u64),
            }),
        );
    }

    fn is_game_running(&self) -> bool {
        self.deps.session.snapshot().is_game_running || self.deps.actions.is_game_running()
    }

    fn is_steamvr_running(&self) -> bool {
        self.deps.session.snapshot().is_steamvr_running || self.deps.actions.is_steamvr_running()
    }

    fn persist_crash_relaunch_event(&self) -> Result<()> {
        let created_at = now_iso();
        write_batch(
            &self.deps.db,
            &GameLogWriteBatch {
                events: vec![GameLogEventEntry {
                    created_at: created_at.clone(),
                    data: CRASH_RELAUNCH_MESSAGE.into(),
                }],
                ..Default::default()
            },
        )?;
        self.deps.event_bus.emit_backend_game_log_event(vec![
            "backend-game-client".into(),
            created_at,
            "event".into(),
            CRASH_RELAUNCH_MESSAGE.into(),
        ]);
        self.deps.event_bus.emit_game_client_event(
            "notification",
            serde_json::json!({
                "level": "warning",
                "title": "VRChat crash detected",
                "message": CRASH_RELAUNCH_MESSAGE,
            }),
        );
        Ok(())
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, GameClientState>> {
        self.state
            .lock()
            .map_err(|error| Error::Custom(format!("GameClient state lock: {error}")))
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
