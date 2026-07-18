use std::sync::{Arc, Mutex};

use vrcx_0_core::log_watcher::GameLogEvent;
use vrcx_0_persistence::DatabaseService;

use crate::worker::{RuntimeWorker, RuntimeWorkerOptions};
use crate::Result;
use crate::RuntimeAuthScope;
use crate::WorldCache;
use crate::{HostSessionRuntime, RuntimeSyncEngine, TaskSupervisor, WebClient};
use crate::{ImageCache, RuntimeEventBus};
use vrcx_0_application_activity::OverlayActivityRuntime;
use vrcx_0_application_core::GameProcessEvent;

use super::host::GameLogHostActions;
use super::ingest::GameLogProcessEvent;
use super::processor::{GameLogProcessor, GameLogProcessorDeps, GameLogWorkerJob};
use super::runtime_state::RuntimeSnapshot;

#[derive(Clone)]
pub struct GameLogRuntimeDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub event_bus: RuntimeEventBus,
    pub tasks: TaskSupervisor,
    pub sync: RuntimeSyncEngine,
    pub auth_scope: RuntimeAuthScope,
    pub session: HostSessionRuntime,
    pub snapshot: Arc<Mutex<RuntimeSnapshot>>,
    pub host_actions: Arc<dyn GameLogHostActions>,
    pub overlay_activity: OverlayActivityRuntime,
    pub world_cache: Arc<WorldCache>,
}

pub struct GameLogRuntime {
    session: HostSessionRuntime,
    worker: RuntimeWorker<GameLogWorkerJob>,
}

impl GameLogRuntime {
    pub fn new(deps: GameLogRuntimeDeps) -> Self {
        let session = deps.session.clone();
        let processor = GameLogProcessor::new(GameLogProcessorDeps {
            db: deps.db,
            web: deps.web,
            image_cache: deps.image_cache,
            event_bus: deps.event_bus.clone(),
            tasks: deps.tasks,
            sync: deps.sync,
            auth_scope: deps.auth_scope,
            snapshot: deps.snapshot,
            host_actions: deps.host_actions,
            overlay_activity: deps.overlay_activity,
            world_cache: deps.world_cache,
        });
        let worker_processor = processor.clone();
        let worker = RuntimeWorker::start(
            "game-log",
            RuntimeWorkerOptions::default(),
            deps.event_bus,
            move |jobs| worker_processor.handle_jobs(jobs),
        );

        Self { session, worker }
    }

    pub fn stop(&self) {
        self.worker.stop();
    }

    pub fn ingest_game_log_event(&self, event: &GameLogEvent) -> Result<()> {
        self.worker
            .push_batch([GameLogWorkerJob::Event(event.clone())])?;
        Ok(())
    }

    pub fn ingest_game_log_events(&self, events: &[GameLogEvent]) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }
        self.worker
            .push_batch(events.iter().cloned().map(GameLogWorkerJob::Event))?;
        Ok(())
    }

    pub fn on_game_process_event(&self, event: GameProcessEvent) -> Result<()> {
        let snapshot = self.session.snapshot();
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
