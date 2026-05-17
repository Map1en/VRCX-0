use std::sync::Arc;

use crate::backend::context::BackendContext;
use crate::domain::log_watcher::{GameLogEvent, GameLogEventSink, LogWatcher};
use crate::domain::process_monitor::{GameProcessEvent, GameProcessEventSink};
use crate::error::AppError;

use vrcx_0_runtime::game_log::ingest::GameLogProcessEvent;
use vrcx_0_runtime::game_log::processor::{
    GameLogProcessor, GameLogProcessorDeps, GameLogWorkerJob,
};
use vrcx_0_runtime::worker::{BackendWorker, BackendWorkerOptions};
use vrcx_0_runtime::Result as RuntimeResult;

pub struct GameLogBackend {
    pub(super) context: Arc<BackendContext>,
    pub(super) worker: BackendWorker<GameLogWorkerJob>,
}

impl GameLogBackend {
    pub fn new(context: Arc<BackendContext>) -> Self {
        let processor = GameLogProcessor::new(GameLogProcessorDeps {
            db: Arc::clone(&context.db),
            web: Arc::clone(&context.web),
            image_cache: Arc::clone(&context.image_cache),
            event_bus: context.event_bus.clone(),
            tasks: context.tasks.clone(),
            sync: context.sync.clone(),
            snapshot: context.game_log_snapshot_handle(),
        });
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
        let date_till = vrcx_0_store::game_log::get_last_game_log_date(&self.context.db)?;
        log_watcher.set_date_till(&date_till);
        Ok(())
    }

    fn enqueue_process_event(&self, event: GameProcessEvent) -> RuntimeResult<()> {
        let snapshot = self.context.session.snapshot();
        let changed_at = snapshot.last_game_state_changed_at.unwrap_or_else(|| {
            chrono::Utc::now()
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string()
        });
        self.worker
            .push_batch([GameLogWorkerJob::Process(GameLogProcessEvent {
                is_game_running: snapshot.is_game_running,
                is_steamvr_running: snapshot.is_steamvr_running,
                game_changed: event.game_changed,
                changed_at,
            })])?;
        Ok(())
    }
}

impl GameLogEventSink for GameLogBackend {
    fn ingest_game_log_event(&self, event: &GameLogEvent) -> RuntimeResult<()> {
        self.worker
            .push_batch([GameLogWorkerJob::Event(event.clone())])?;
        Ok(())
    }

    fn ingest_game_log_events(&self, events: &[GameLogEvent]) -> RuntimeResult<()> {
        if events.is_empty() {
            return Ok(());
        }

        self.worker
            .push_batch(events.iter().cloned().map(GameLogWorkerJob::Event))?;
        Ok(())
    }
}

impl GameProcessEventSink for GameLogBackend {
    fn on_game_process_event(&self, event: GameProcessEvent) -> RuntimeResult<()> {
        self.enqueue_process_event(event)
    }
}
