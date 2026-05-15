use std::sync::Arc;

use crate::domain::image_cache::ImageCache;
use crate::domain::web_client::WebClient;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::database::DatabaseService;

use super::event_bus::BackendEventBus;
use super::host_actions::BackendHost;

#[derive(Clone)]
pub struct BackendContext {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub event_bus: BackendEventBus,
    pub host: BackendHost,
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
            host: BackendHost::new(),
            config,
        }
    }

    pub fn config(&self) -> &ConfigRepository {
        &self.config
    }
}
