use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::worker::{RuntimeWorker, RuntimeWorkerOptions};
use crate::Result;
use crate::{HostSessionRuntime, RuntimeAuthScope, RuntimeEventBus, TaskSupervisor};
use vrcx_0_application_core::BackendRuntimeStatusPublisher;
use vrcx_0_application_core::GameProcessEvent;
use vrcx_0_application_core::InstanceRosterObserver;

use super::actions::{GameClientActions, GameClientDebugLoggingActions};
use super::processor::{
    GameClientCacheActions, GameClientJob, GameClientLocationSource, GameClientProcessor,
    GameClientProcessorDeps, GameClientState, GameClientWindowActions,
};

#[derive(Clone)]
pub struct GameClientRuntimeDeps {
    pub(crate) store: Arc<dyn crate::GameStateStore>,
    pub event_bus: RuntimeEventBus,
    pub backend_status: BackendRuntimeStatusPublisher,
    pub tasks: TaskSupervisor,
    pub session: HostSessionRuntime,
    pub auth_scope: RuntimeAuthScope,
    pub actions: Arc<dyn GameClientActions>,
    pub cache_actions: Arc<dyn GameClientCacheActions>,
    pub location_source: Arc<dyn GameClientLocationSource>,
    pub window_actions: Arc<dyn GameClientWindowActions>,
    pub debug_logging_actions: Arc<dyn GameClientDebugLoggingActions>,
    pub instance_roster_observer: Option<Arc<dyn InstanceRosterObserver>>,
}

impl GameClientRuntimeDeps {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        store: Arc<dyn crate::GameStateStore>,
        event_bus: RuntimeEventBus,
        backend_status: BackendRuntimeStatusPublisher,
        tasks: TaskSupervisor,
        session: HostSessionRuntime,
        auth_scope: RuntimeAuthScope,
        actions: Arc<dyn GameClientActions>,
        cache_actions: Arc<dyn GameClientCacheActions>,
        location_source: Arc<dyn GameClientLocationSource>,
        window_actions: Arc<dyn GameClientWindowActions>,
        debug_logging_actions: Arc<dyn GameClientDebugLoggingActions>,
        instance_roster_observer: Option<Arc<dyn InstanceRosterObserver>>,
    ) -> Self {
        Self {
            store,
            event_bus,
            backend_status,
            tasks,
            session,
            auth_scope,
            actions,
            cache_actions,
            location_source,
            window_actions,
            debug_logging_actions,
            instance_roster_observer,
        }
    }
}

pub struct GameClientRuntime {
    state: Arc<Mutex<GameClientState>>,
    worker: RuntimeWorker<GameClientJob>,
    instance_roster_observer: Option<Arc<dyn InstanceRosterObserver>>,
}

impl GameClientRuntime {
    pub fn new(deps: GameClientRuntimeDeps) -> Self {
        let instance_roster_observer = deps.instance_roster_observer;
        let state = Arc::new(Mutex::new(GameClientState::default()));
        let processor = GameClientProcessor::new(
            GameClientProcessorDeps {
                store: deps.store,
                event_bus: deps.event_bus.clone(),
                backend_status: deps.backend_status,
                tasks: deps.tasks,
                session: deps.session,
                auth_scope: deps.auth_scope,
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

        Self {
            state,
            worker,
            instance_roster_observer,
        }
    }

    pub fn on_game_process_event(&self, event: GameProcessEvent) -> Result<()> {
        if let Some(observer) = &self.instance_roster_observer {
            observer.on_game_running(event.is_game_running);
        }
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
