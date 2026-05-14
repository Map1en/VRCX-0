use std::sync::{Arc, Mutex};

use tauri::AppHandle;

use crate::backend::context::BackendContext;
use crate::backend::ingest::BackendIngestQueue;
use crate::domain::database::DatabaseService;
use crate::domain::image_cache::ImageCache;
use crate::domain::log_watcher::{GameLogEvent, GameLogEventSink, LogWatcher};
use crate::domain::process_monitor::{GameProcessEvent, GameProcessEventSink};
use crate::domain::web_client::WebClient;
use crate::error::AppError;

use super::deps::BackendDeps;
use super::instance_media::InstanceMediaQueue;
use super::runtime_state::GameLogRuntimeState;

pub struct GameLogBackend {
    pub(super) context: BackendContext,
    pub(super) state: Mutex<GameLogRuntimeState>,
    pub(super) media_queue: InstanceMediaQueue,
    pub(super) ingest_queue: BackendIngestQueue<GameLogEvent>,
}

impl GameLogBackend {
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        image_cache: Arc<ImageCache>,
    ) -> Self {
        Self {
            context: BackendContext::new(db, web, image_cache),
            state: Mutex::new(GameLogRuntimeState::default()),
            media_queue: InstanceMediaQueue::new(),
            ingest_queue: BackendIngestQueue::unbounded(),
        }
    }

    pub fn set_app_handle(&self, app_handle: AppHandle) {
        self.context.event_bus.set_app_handle(app_handle);
    }

    pub fn prime_log_watcher(&self, log_watcher: &LogWatcher) -> Result<(), AppError> {
        let date_till = crate::backend::db::game_log::get_last_game_log_date(&self.context.db)?;
        log_watcher.set_date_till(&date_till);
        Ok(())
    }

    pub(super) fn deps(&self) -> BackendDeps {
        BackendDeps {
            db: Arc::clone(&self.context.db),
            web: Arc::clone(&self.context.web),
            image_cache: Arc::clone(&self.context.image_cache),
            event_bus: self.context.event_bus.clone(),
            media_queue: self.media_queue.clone(),
        }
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
        self.handle_game_process_event(event)
    }
}
