use std::sync::{Arc, Mutex};

use crate::domain::image_cache::ImageCache;
use crate::domain::web_client::WebClient;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::database::DatabaseService;
use vrcx_0_runtime::game_log::runtime_state::RuntimeSnapshot;
use vrcx_0_runtime::session::HostSessionRuntime;

use super::event_bus::BackendEventBus;
use super::host_actions::BackendHost;

#[derive(Clone)]
pub struct BackendContext {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub event_bus: BackendEventBus,
    pub host: BackendHost,
    pub session: HostSessionRuntime,
    pub config: ConfigRepository,
    game_log_snapshot: Arc<Mutex<RuntimeSnapshot>>,
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
            session: HostSessionRuntime::new(),
            config,
            game_log_snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
        }
    }

    pub fn config(&self) -> &ConfigRepository {
        &self.config
    }

    pub fn set_game_log_snapshot(&self, snapshot: RuntimeSnapshot) {
        match self.game_log_snapshot.lock() {
            Ok(mut current) => {
                *current = snapshot;
            }
            Err(error) => {
                tracing::warn!("failed to lock game log snapshot: {error}");
            }
        }
    }

    pub fn game_log_snapshot(&self) -> RuntimeSnapshot {
        self.game_log_snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default()
    }
}
