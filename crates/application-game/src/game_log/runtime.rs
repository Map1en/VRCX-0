use std::sync::Arc;

use vrcx_0_core::game_log_parser::GameLogEvent;

use crate::worker::{RuntimeWorker, RuntimeWorkerOptions};
use crate::Result;
use crate::RuntimeAuthScope;
use crate::WorldCache;
use crate::{GameLogEventOrigin, HostSessionRuntime, RuntimeSyncEngine, TaskSupervisor};
use crate::{InstanceMediaPort, RuntimeEventBus, VideoMetadataPort};
use vrcx_0_application_core::ActivityIngress;
use vrcx_0_application_core::BackendRuntimeStatusPublisher;
use vrcx_0_application_core::ConfigStore;
use vrcx_0_application_core::GameProcessEvent;
use vrcx_0_contracts::InstanceRosterObserver;

use super::host::GameLogHostActions;
use super::ingest::GameLogProcessEvent;
use super::processor::{GameLogProcessor, GameLogProcessorDeps, GameLogWorkerJob};
use super::runtime_state::RuntimeSnapshotStore;

#[derive(Clone)]
pub struct GameLogRuntimeDeps {
    pub stores: crate::GameLogStores,
    pub config: Arc<dyn ConfigStore>,
    pub instance_media: Arc<dyn InstanceMediaPort>,
    pub video_metadata: Arc<dyn VideoMetadataPort>,
    pub event_bus: RuntimeEventBus,
    pub backend_status: BackendRuntimeStatusPublisher,
    pub side_effect_sink: crate::GameLogSideEffectSink,
    pub tasks: TaskSupervisor,
    pub sync: RuntimeSyncEngine,
    pub auth_scope: RuntimeAuthScope,
    pub session: HostSessionRuntime,
    pub snapshot: RuntimeSnapshotStore,
    pub host_actions: Arc<dyn GameLogHostActions>,
    pub activity: Arc<dyn ActivityIngress>,
    pub world_cache: Arc<WorldCache>,
    pub instance_roster_observer: Option<Arc<dyn InstanceRosterObserver>>,
}

pub struct GameLogRuntime {
    session: HostSessionRuntime,
    processor: GameLogProcessor,
    worker: RuntimeWorker<GameLogWorkerJob>,
}

impl GameLogRuntime {
    pub fn new(deps: GameLogRuntimeDeps) -> Self {
        let session = deps.session.clone();
        let processor = GameLogProcessor::new(GameLogProcessorDeps {
            stores: deps.stores,
            config: deps.config,
            instance_media: deps.instance_media,
            video_metadata: deps.video_metadata,
            event_bus: deps.event_bus.clone(),
            backend_status: deps.backend_status,
            side_effect_sink: deps.side_effect_sink,
            tasks: deps.tasks,
            sync: deps.sync,
            auth_scope: deps.auth_scope,
            snapshot: deps.snapshot,
            host_actions: deps.host_actions,
            activity: deps.activity,
            world_cache: deps.world_cache,
            instance_roster_observer: deps.instance_roster_observer,
        });
        let worker_processor = processor.clone();
        let worker = RuntimeWorker::start(
            "game-log",
            RuntimeWorkerOptions {
                capacity: 8,
                max_batch: 1,
                ..Default::default()
            },
            deps.event_bus,
            move |jobs| worker_processor.handle_jobs(jobs),
        );

        Self {
            session,
            processor,
            worker,
        }
    }

    pub fn stop(&self) {
        self.processor.request_stop();
        self.worker.stop();
    }

    pub fn reset_replay(&self) -> Result<()> {
        let (completed, receiver) = std::sync::mpsc::sync_channel(1);
        self.worker
            .push_batch([GameLogWorkerJob::ResetReplay(completed)])?;
        receiver
            .recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|error| {
                crate::Error::Custom(format!("GameLog replay reset failed: {error}"))
            })?;
        Ok(())
    }

    pub fn retry_pending_game_log(&self) -> Result<()> {
        let (completed, receiver) = std::sync::mpsc::sync_channel(1);
        self.worker
            .push_batch([GameLogWorkerJob::RetryWrite(completed)])?;
        receiver
            .recv()
            .map_err(|error| {
                crate::Error::Custom(format!("GameLog write worker disconnected: {error}"))
            })?
            .map_err(crate::Error::Custom)
    }

    pub fn replay_cursor(&self) -> Option<crate::GameLogScanCursor> {
        self.processor.replay_cursor()
    }

    pub fn ingest_game_log_scan(
        &self,
        events: &[GameLogEvent],
        origin: GameLogEventOrigin,
        cursor: crate::GameLogScanCursor,
        publish: bool,
    ) -> Result<()> {
        let (completed, receiver) = std::sync::mpsc::sync_channel(1);
        self.worker.push_batch([GameLogWorkerJob::Scan {
            events: events.to_vec(),
            origin,
            cursor: Box::new(cursor),
            publish,
            completed: Some(completed),
        }])?;
        receiver
            .recv()
            .map_err(|error| {
                crate::Error::Custom(format!("GameLog scan worker disconnected: {error}"))
            })?
            .map_err(crate::Error::Custom)
    }

    pub fn set_persistence_resume_after(&self, resume_after: &str) {
        self.processor.set_persistence_resume_after(resume_after);
    }

    pub fn ingest_game_log_event(&self, event: &GameLogEvent) -> Result<()> {
        self.ingest_game_log_events(std::slice::from_ref(event))
    }

    pub fn ingest_game_log_events(&self, events: &[GameLogEvent]) -> Result<()> {
        self.ingest_game_log_events_with_origin(events, GameLogEventOrigin::Live)
    }

    pub fn ingest_game_log_events_with_origin(
        &self,
        events: &[GameLogEvent],
        origin: GameLogEventOrigin,
    ) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }
        let jobs = events.chunks(256).map(|events| GameLogWorkerJob::Events {
            events: events.to_vec(),
            origin,
        });
        self.worker.push_batch(jobs)?;
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
                process: GameProcessEvent {
                    is_game_running: snapshot.is_game_running,
                    is_steamvr_running: snapshot.is_steamvr_running,
                    game_changed: event.game_changed,
                },
                changed_at,
            })])?;
        Ok(())
    }
}

impl Drop for GameLogRuntime {
    fn drop(&mut self) {
        self.processor.request_stop();
        self.worker.stop();
    }
}
