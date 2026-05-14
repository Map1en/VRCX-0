use std::sync::Arc;

use serde_json::Value;

use crate::backend::event_bus::BackendEventBus;
use crate::domain::database::DatabaseService;
use crate::domain::image_cache::ImageCache;
use crate::domain::web_client::WebClient;

use super::instance_media::InstanceMediaQueue;

#[derive(Clone)]
pub(crate) struct BackendDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub event_bus: BackendEventBus,
    pub media_queue: InstanceMediaQueue,
}

impl BackendDeps {
    pub fn emit_side_effect(&self, kind: &str, payload: Value) {
        self.event_bus.emit_game_log_side_effect(kind, payload);
    }
}
