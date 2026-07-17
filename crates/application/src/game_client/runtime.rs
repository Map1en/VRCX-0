use std::sync::{Arc, Mutex};
use std::time::Duration;

use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

use crate::event_bus::RuntimeEventBus;
use crate::process_monitor::GameProcessEvent;
use crate::session::HostSessionRuntime;
use crate::task_supervisor::TaskSupervisor;
use crate::worker::{RuntimeWorker, RuntimeWorkerOptions};
use crate::Result;

use super::actions::{GameClientActions, GameClientDebugLoggingActions};
use super::processor::{
    GameClientCacheActions, GameClientJob, GameClientLocationSource, GameClientProcessor,
    GameClientProcessorDeps, GameClientState, GameClientWindowActions,
};

#[derive(Clone)]
pub struct GameClientRuntimeDeps {
    pub db: Arc<DatabaseService>,
    pub config: ConfigRepository,
    pub event_bus: RuntimeEventBus,
    pub tasks: TaskSupervisor,
    pub session: HostSessionRuntime,
    pub actions: Arc<dyn GameClientActions>,
    pub cache_actions: Arc<dyn GameClientCacheActions>,
    pub location_source: Arc<dyn GameClientLocationSource>,
    pub window_actions: Arc<dyn GameClientWindowActions>,
    pub debug_logging_actions: Arc<dyn GameClientDebugLoggingActions>,
}

pub struct GameClientRuntime {
    state: Arc<Mutex<GameClientState>>,
    worker: RuntimeWorker<GameClientJob>,
}

impl GameClientRuntime {
    pub fn new(deps: GameClientRuntimeDeps) -> Self {
        let state = Arc::new(Mutex::new(GameClientState::default()));
        let processor = GameClientProcessor::new(
            GameClientProcessorDeps {
                db: deps.db,
                config: deps.config,
                event_bus: deps.event_bus.clone(),
                tasks: deps.tasks,
                session: deps.session,
                actions: deps.actions,
                cache_actions: deps.cache_actions,
                location_source: deps.location_source,
                window_actions: deps.window_actions,
                debug_logging_actions: deps.debug_logging_actions,
            },
            Arc::clone(&state),
        );
        let worker_processor = processor.clone();
        let worker = RuntimeWorker::start(
            "game-client",
            RuntimeWorkerOptions::default(),
            deps.event_bus,
            move |jobs| worker_processor.handle_jobs(jobs),
        );

        if let Err(error) = worker.push_batch([GameClientJob::DebugLoggingCheck {
            delay: Duration::ZERO,
            game_generation: None,
        }]) {
            tracing::warn!("failed to schedule startup debug logging check: {error}");
        }

        Self { state, worker }
    }

    pub fn set_runtime_state(&self, current_location: &str) {
        let Ok(mut state) = self.state.lock() else {
            tracing::warn!("failed to lock GameClient runtime state");
            return;
        };
        state.current_location = current_location.trim().to_string();
    }

    pub fn on_game_process_event(&self, event: GameProcessEvent) -> Result<()> {
        if event.game_changed {
            let game_generation = self.advance_debug_logging_generation()?;
            if event.is_game_running {
                self.enqueue_job(GameClientJob::DebugLoggingCheck {
                    delay: Duration::from_secs(1),
                    game_generation: Some(game_generation),
                })?;
            } else {
                self.enqueue_job(GameClientJob::GameStopped)?;
            }
        }
        Ok(())
    }

    pub fn debug_logging_outcome(&self) -> Option<super::DebugLoggingOutcome> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.debug_logging_outcome.clone())
    }

    pub fn stop(&self) {
        self.worker.stop();
    }

    fn enqueue_job(&self, job: GameClientJob) -> Result<()> {
        self.worker.push_batch([job])?;
        Ok(())
    }

    fn advance_debug_logging_generation(&self) -> Result<u64> {
        let mut state = self
            .state
            .lock()
            .map_err(|error| crate::Error::Custom(format!("GameClient state lock: {error}")))?;
        state.debug_logging_generation = state.debug_logging_generation.saturating_add(1);
        Ok(state.debug_logging_generation)
    }

    #[cfg(any(test, feature = "test-utils"))]
    pub fn wait_until_idle(&self) -> bool {
        self.worker.wait_until_idle(Duration::from_secs(2))
    }
}
