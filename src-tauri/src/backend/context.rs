use std::sync::{Arc, Mutex};

use vrcx_0_runtime::auth_scope::BackendAuthScope;
use vrcx_0_runtime::backend_runtime::BackendRuntime;
use vrcx_0_runtime::background::BackendBackgroundJobs;
use vrcx_0_runtime::diagnostics::BackendDiagnostics;
use vrcx_0_runtime::event_bus::BackendEventBus;
use vrcx_0_runtime::game_log::runtime_state::RuntimeSnapshot;
use vrcx_0_runtime::image_cache::ImageCache;
use vrcx_0_runtime::session::HostSessionRuntime;
use vrcx_0_runtime::sync::BackendSyncEngine;
use vrcx_0_runtime::task_runtime::BackendTasks;
use vrcx_0_runtime::web_client::WebClient;
use vrcx_0_store::config::ConfigRepository;
use vrcx_0_store::database::DatabaseService;

use super::host_actions::BackendHost;

#[derive(Clone)]
pub struct BackendContext {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub event_bus: BackendEventBus,
    pub host: BackendHost,
    pub runtime: BackendRuntime,
    pub background_jobs: BackendBackgroundJobs,
    pub sync: BackendSyncEngine,
    pub diagnostics: BackendDiagnostics,
    pub tasks: BackendTasks,
    pub session: HostSessionRuntime,
    pub auth_scope: BackendAuthScope,
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
            runtime: BackendRuntime::new(),
            background_jobs: BackendBackgroundJobs::new(),
            sync: BackendSyncEngine::new(),
            diagnostics: BackendDiagnostics::new(),
            tasks: BackendTasks::new(),
            session: HostSessionRuntime::new(),
            auth_scope: BackendAuthScope::new(),
            config,
            game_log_snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
        }
    }

    pub fn config(&self) -> &ConfigRepository {
        &self.config
    }

    pub fn game_log_snapshot_handle(&self) -> Arc<Mutex<RuntimeSnapshot>> {
        Arc::clone(&self.game_log_snapshot)
    }

    pub fn game_log_snapshot(&self) -> RuntimeSnapshot {
        self.game_log_snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default()
    }
}
