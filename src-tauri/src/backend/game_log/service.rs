use std::sync::Arc;
#[cfg(test)]
use std::time::Duration;

use crate::backend::context::BackendContext;
use crate::domain::log_watcher::{GameLogEvent, GameLogEventSink, LogWatcher};
use crate::domain::process_monitor::{GameProcessEvent, GameProcessEventSink};
use crate::error::AppError;

use crate::backend::worker::{BackendWorker, BackendWorkerOptions};

use super::ingest::{GameLogProcessor, GameLogWorkerJob};

pub struct GameLogBackend {
    pub(super) context: Arc<BackendContext>,
    pub(super) worker: BackendWorker<GameLogWorkerJob>,
}

impl GameLogBackend {
    pub fn new(context: Arc<BackendContext>) -> Self {
        let processor = GameLogProcessor::new(Arc::clone(&context));
        let worker_processor = processor.clone();
        let worker = BackendWorker::start(
            "game-log",
            BackendWorkerOptions::default(),
            context.event_bus.clone(),
            move |jobs| worker_processor.handle_jobs(jobs),
        );

        Self { context, worker }
    }

    pub fn prime_log_watcher(&self, log_watcher: &LogWatcher) -> Result<(), AppError> {
        let date_till = vrcx_0_persistence::game_log::get_last_game_log_date(&self.context.db)?;
        log_watcher.set_date_till(&date_till);
        Ok(())
    }

    pub fn ingest_events(&self, events: &[GameLogEvent]) -> Result<(), AppError> {
        if events.is_empty() {
            return Ok(());
        }

        self.worker
            .push_batch(events.iter().cloned().map(GameLogWorkerJob::Event))?;
        Ok(())
    }

    fn enqueue_process_event(&self, event: GameProcessEvent) -> Result<(), AppError> {
        self.worker.push_batch([GameLogWorkerJob::Process(event)])?;
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn wait_until_idle_for_test(&self) -> bool {
        self.worker.wait_until_idle(Duration::from_secs(2))
    }
}

impl GameLogEventSink for GameLogBackend {
    fn ingest_game_log_event(
        &self,
        event: &crate::domain::log_watcher::GameLogEvent,
    ) -> Result<(), AppError> {
        self.ingest_events(std::slice::from_ref(event))
    }

    fn ingest_game_log_events(
        &self,
        events: &[crate::domain::log_watcher::GameLogEvent],
    ) -> Result<(), AppError> {
        self.ingest_events(events)
    }
}

impl GameProcessEventSink for GameLogBackend {
    fn on_game_process_event(&self, event: GameProcessEvent) -> Result<(), AppError> {
        self.enqueue_process_event(event)
    }
}
