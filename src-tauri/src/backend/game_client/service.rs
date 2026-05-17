use std::sync::{Arc, Mutex};
#[cfg(test)]
use std::time::Duration;

use crate::backend::context::BackendContext;
use crate::backend::host_actions::BackendHost;
use crate::domain::log_watcher::LogWatcher;
use crate::domain::process_monitor::{GameProcessEvent, GameProcessEventSink};
use crate::error::AppError;

use vrcx_0_core::log_watcher::LogLocationSnapshot;
use vrcx_0_runtime::game_client::actions::{GameClientActions, SystemGameClientActions};
use vrcx_0_runtime::game_client::processor::{
    GameClientJob, GameClientLocationSource, GameClientProcessor, GameClientProcessorDeps,
    GameClientState, GameClientWindowActions,
};
use vrcx_0_runtime::worker::{BackendWorker, BackendWorkerOptions};
use vrcx_0_runtime::Result as RuntimeResult;

#[derive(Clone)]
struct LogWatcherLocationSource {
    log_watcher: LogWatcher,
}

impl GameClientLocationSource for LogWatcherLocationSource {
    fn vrc_closed_gracefully(&self) -> bool {
        self.log_watcher.vrc_closed_gracefully()
    }

    fn current_location_snapshot(&self) -> Option<LogLocationSnapshot> {
        self.log_watcher.current_location_snapshot()
    }
}

#[derive(Clone)]
struct BackendGameClientWindowActions {
    host: BackendHost,
}

impl GameClientWindowActions for BackendGameClientWindowActions {
    fn focus_main_window(&self) {
        self.host.focus_main_window();
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
        let state = Arc::new(Mutex::new(GameClientState::default()));
        let processor = GameClientProcessor::new(
            GameClientProcessorDeps {
                db: Arc::clone(&context.db),
                config: context.config.clone(),
                event_bus: context.event_bus.clone(),
                tasks: context.tasks.clone(),
                session: context.session.clone(),
                actions: Arc::clone(&actions),
                location_source: Arc::new(LogWatcherLocationSource { log_watcher }),
                window_actions: Arc::new(BackendGameClientWindowActions {
                    host: context.host.clone(),
                }),
            },
            Arc::clone(&state),
        );
        let worker_processor = processor.clone();
        let worker = BackendWorker::start(
            "game-client",
            BackendWorkerOptions::default(),
            context.event_bus.clone(),
            move |jobs| worker_processor.handle_jobs(jobs),
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
    fn on_game_process_event(&self, event: GameProcessEvent) -> RuntimeResult<()> {
        if event.game_changed && !event.is_game_running {
            self.worker.push_batch([GameClientJob::GameStopped])?;
        }
        Ok(())
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
