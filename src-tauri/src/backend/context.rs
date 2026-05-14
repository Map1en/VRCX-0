use std::sync::Arc;

use crate::domain::database::DatabaseService;
use crate::domain::image_cache::ImageCache;
use crate::domain::web_client::WebClient;

use super::db::config::ConfigRepository;
use super::event_bus::BackendEventBus;

#[derive(Clone)]
pub struct BackendContext {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub event_bus: BackendEventBus,
    pub config: ConfigRepository,
}

impl BackendContext {
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        image_cache: Arc<ImageCache>,
    ) -> Self {
        let config = ConfigRepository::new(Arc::clone(&db));
        Self {
            db,
            web,
            image_cache,
            event_bus: BackendEventBus::new(),
            config,
        }
    }

    pub fn config(&self) -> &ConfigRepository {
        &self.config
    }
}
