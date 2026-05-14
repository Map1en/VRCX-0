use std::sync::{Arc, Mutex};
#[cfg(test)]
use std::time::Duration;

use crate::backend::context::BackendContext;
use crate::domain::log_watcher::LogWatcher;
use crate::domain::process_monitor::{GameProcessEvent, GameProcessEventSink};
use crate::error::AppError;

use crate::backend::worker::{BackendWorker, BackendWorkerOptions};

use super::actions::{GameClientActions, SystemGameClientActions};
use super::{ipc, lifecycle};

pub(super) struct GameClientState {
    pub external_notifier_version: i64,
    pub last_crash_at_ms: Option<i64>,
    pub session_active: bool,
    pub current_location: String,
}

#[derive(Clone)]
pub(super) struct GameClientDeps {
    pub context: Arc<BackendContext>,
    pub log_watcher: LogWatcher,
    pub actions: Arc<dyn GameClientActions>,
    pub state: Arc<Mutex<GameClientState>>,
}

pub(super) enum GameClientJob {
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

pub struct GameClientBackend {
    pub(super) state: Arc<Mutex<GameClientState>>,
    pub(super) worker: BackendWorker<GameClientJob>,
}

impl GameClientBackend {
    pub fn new(context: Arc<BackendContext>, log_watcher: LogWatcher) -> Self {
        Self::new_with_actions(context, log_watcher, Arc::new(SystemGameClientActions))
    }

    fn new_with_actions(
        context: Arc<BackendContext>,
        log_watcher: LogWatcher,
        actions: Arc<dyn GameClientActions>,
    ) -> Self {
        let state = Arc::new(Mutex::new(GameClientState {
            external_notifier_version: 0,
            last_crash_at_ms: None,
            session_active: false,
            current_location: String::new(),
        }));
        let worker_deps = GameClientDeps {
            context: Arc::clone(&context),
            log_watcher: log_watcher.clone(),
            actions: Arc::clone(&actions),
            state: Arc::clone(&state),
        };
        let worker = BackendWorker::start(
            "game-client",
            BackendWorkerOptions::default(),
            context.event_bus.clone(),
            move |jobs| handle_jobs(worker_deps.clone(), jobs),
        );

        Self { state, worker }
    }

    pub fn set_runtime_state(&self, session_active: bool, current_location: &str) {
        let Ok(mut state) = self.state.lock() else {
            tracing::warn!("failed to lock GameClient runtime state");
            return;
        };
        state.session_active = session_active;
        state.current_location = current_location.trim().to_string();
    }

    pub(super) fn enqueue_job(&self, job: GameClientJob) -> Result<(), AppError> {
        self.worker.push_batch([job])?;
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn wait_until_idle_for_test(&self) -> bool {
        self.worker.wait_until_idle(Duration::from_secs(2))
    }
}

impl GameProcessEventSink for GameClientBackend {
    fn on_game_process_event(&self, event: GameProcessEvent) -> Result<(), AppError> {
        if event.game_changed && !event.is_game_running {
            self.enqueue_job(GameClientJob::GameStopped)?;
        }
        Ok(())
    }
}

fn handle_jobs(deps: GameClientDeps, jobs: Vec<GameClientJob>) -> Result<(), AppError> {
    let mut first_error = None;
    for job in jobs {
        let fallback_packet = job.fallback_packet().map(ToOwned::to_owned);
        match job {
            GameClientJob::VrcxNoty { .. } | GameClientJob::VrcxExternal { .. } => {
                if let Err(error) = ipc::handle_ipc_job(&deps, job) {
                    if let Some(packet) = fallback_packet {
                        deps.context.event_bus.emit_ipc_event(&packet);
                    }
                    remember_error(&mut first_error, error);
                }
            }
            GameClientJob::GameStopped => match lifecycle::prepare_game_stopped(&deps) {
                Ok(Some(plan)) => {
                    let task_deps = deps.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = lifecycle::execute_crash_relaunch(task_deps, plan).await
                        {
                            tracing::warn!("GameClient stopped-game handling failed: {error}");
                        }
                    });
                }
                Ok(None) => {}
                Err(error) => {
                    deps.context.event_bus.emit_game_client_event(
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

fn remember_error(first_error: &mut Option<AppError>, error: AppError) {
    if first_error.is_none() {
        *first_error = Some(error);
    } else {
        tracing::warn!("GameClient worker job failed: {error}");
    }
}

#[cfg(test)]
impl GameClientBackend {
    pub(super) fn test_with_actions(
        context: Arc<BackendContext>,
        log_watcher: LogWatcher,
        actions: Arc<dyn GameClientActions>,
    ) -> Self {
        Self::new_with_actions(context, log_watcher, actions)
    }
}
