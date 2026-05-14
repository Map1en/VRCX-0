mod ingest;
mod instance_media;
mod lifecycle;
mod runtime_state;
mod screenshot;
mod video;

use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::domain::database::DatabaseService;
use crate::domain::image_cache::ImageCache;
use crate::domain::log_watcher::{GameLogEventSink, LogWatcher};
use crate::domain::process_monitor::{GameProcessEvent, GameProcessEventSink};
use crate::domain::web_client::WebClient;
use crate::error::AppError;

use self::instance_media::InstanceMediaQueue;
use self::runtime_state::GameLogRuntimeState;

pub struct GameLogBackend {
    pub(super) db: Arc<DatabaseService>,
    pub(super) web: Arc<WebClient>,
    pub(super) image_cache: Arc<ImageCache>,
    pub(super) app_handle: Mutex<Option<AppHandle>>,
    pub(super) state: Mutex<GameLogRuntimeState>,
    pub(super) media_queue: InstanceMediaQueue,
}

#[derive(Clone)]
pub(super) struct BackendDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub app_handle: Option<AppHandle>,
    pub media_queue: InstanceMediaQueue,
}

impl GameLogBackend {
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        image_cache: Arc<ImageCache>,
    ) -> Self {
        Self {
            db,
            web,
            image_cache,
            app_handle: Mutex::new(None),
            state: Mutex::new(GameLogRuntimeState::default()),
            media_queue: InstanceMediaQueue::new(),
        }
    }

    pub fn set_app_handle(&self, app_handle: AppHandle) {
        *self.app_handle.lock().unwrap() = Some(app_handle);
    }

    pub fn prime_log_watcher(&self, log_watcher: &LogWatcher) -> Result<(), AppError> {
        let date_till = crate::backend::db::game_log::get_last_game_log_date(&self.db)?;
        log_watcher.set_date_till(&date_till);
        Ok(())
    }

    pub(super) fn deps(&self) -> BackendDeps {
        BackendDeps {
            db: Arc::clone(&self.db),
            web: Arc::clone(&self.web),
            image_cache: Arc::clone(&self.image_cache),
            app_handle: self.app_handle.lock().unwrap().clone(),
            media_queue: self.media_queue.clone(),
        }
    }
}

impl BackendDeps {
    pub fn emit_side_effect(&self, kind: &str, payload: Value) {
        let Some(app_handle) = &self.app_handle else {
            return;
        };

        let _ = app_handle.emit(
            "gameLogSideEffect",
            serde_json::json!({
                "kind": kind,
                "payload": payload,
            }),
        );
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
