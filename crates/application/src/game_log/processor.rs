use std::sync::{Arc, Mutex};
use std::time::Duration;

use vrcx_0_core::log_watcher::GameLogEvent;
use vrcx_0_persistence::config as config_store;
use vrcx_0_persistence::game_log::{write_batch, GameLogWriteBatch};
use vrcx_0_persistence::DatabaseService;

use crate::event_bus::RuntimeEventBus;
use crate::game_log::host::GameLogHostActions;
use crate::game_log::ingest::{
    GameLogIngestEngine, GameLogIngestOptions, GameLogIngestOutput, GameLogProcessEvent,
    GameLogSideEffect,
};
use crate::game_log::instance_media::{
    self as runtime_instance_media, InstanceMediaDeps, InstanceMediaQueue,
};
use crate::game_log::lifecycle as runtime_lifecycle;
use crate::game_log::runtime_state::RuntimeSnapshot;
use crate::game_log::screenshot as runtime_screenshot;
use crate::game_log::video as runtime_video;
use crate::image_cache::ImageCache;
use crate::overlay_activity::OverlayActivityRuntime;
use crate::sync::RuntimeSyncEngine;
use crate::task_supervisor::TaskSupervisor;
use crate::web_client::WebClient;
use crate::{Error, Result};

const GAME_LOG_WRITE_RETRY_DELAYS_MS: &[u64] = &[25, 100, 250];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GameLogWriteOutcome {
    RuntimePersisted { affected_count: u64 },
    PersistenceFailed,
}

#[derive(Clone)]
pub enum GameLogWorkerJob {
    Event(GameLogEvent),
    Process(GameLogProcessEvent),
}

#[derive(Clone)]
pub struct GameLogProcessorDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub event_bus: RuntimeEventBus,
    pub tasks: TaskSupervisor,
    pub sync: RuntimeSyncEngine,
    pub snapshot: Arc<Mutex<RuntimeSnapshot>>,
    pub host_actions: Arc<dyn GameLogHostActions>,
    pub overlay_activity: OverlayActivityRuntime,
}

impl GameLogProcessorDeps {
    fn set_game_log_snapshot(&self, snapshot: RuntimeSnapshot) {
        match self.snapshot.lock() {
            Ok(mut current) => {
                *current = snapshot;
            }
            Err(error) => {
                tracing::warn!("failed to lock game log snapshot: {error}");
            }
        }
    }
}

#[derive(Clone)]
struct GameLogSideEffectDeps {
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
    image_cache: Arc<ImageCache>,
    event_bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    media_queue: InstanceMediaQueue,
    host_actions: Arc<dyn GameLogHostActions>,
}

impl GameLogSideEffectDeps {
    fn emit_side_effect(&self, kind: &str, payload: serde_json::Value) {
        self.event_bus.emit_game_log_side_effect(kind, payload);
    }

    fn instance_media_deps(&self) -> InstanceMediaDeps {
        InstanceMediaDeps {
            db: Arc::clone(&self.db),
            web: Arc::clone(&self.web),
            image_cache: Arc::clone(&self.image_cache),
            queue: self.media_queue.clone(),
            host_actions: Arc::clone(&self.host_actions),
        }
    }
}

#[derive(Clone)]
pub struct GameLogProcessor {
    deps: GameLogProcessorDeps,
    engine: Arc<Mutex<GameLogIngestEngine>>,
    media_queue: InstanceMediaQueue,
}

impl GameLogProcessor {
    pub fn new(deps: GameLogProcessorDeps) -> Self {
        Self {
            deps,
            engine: Arc::new(Mutex::new(GameLogIngestEngine::default())),
            media_queue: InstanceMediaQueue::new(),
        }
    }

    pub fn handle_jobs(&self, jobs: Vec<GameLogWorkerJob>) -> Result<()> {
        let mut pending_events = Vec::new();
        let mut first_error = None;
        for job in jobs {
            match job {
                GameLogWorkerJob::Event(event) => pending_events.push(event),
                GameLogWorkerJob::Process(event) => {
                    if let Err(error) = self.ingest_events_now(&pending_events) {
                        remember_error(&mut first_error, error);
                    }
                    pending_events.clear();
                    if let Err(error) = self.handle_game_process_event_now(event) {
                        remember_error(&mut first_error, error);
                    }
                }
            }
        }
        if let Err(error) = self.ingest_events_now(&pending_events) {
            remember_error(&mut first_error, error);
        }
        first_error.map_or(Ok(()), Err)
    }

    fn side_effect_deps(&self) -> GameLogSideEffectDeps {
        GameLogSideEffectDeps {
            db: Arc::clone(&self.deps.db),
            web: Arc::clone(&self.deps.web),
            image_cache: Arc::clone(&self.deps.image_cache),
            event_bus: self.deps.event_bus.clone(),
            tasks: self.deps.tasks.clone(),
            media_queue: self.media_queue.clone(),
            host_actions: Arc::clone(&self.deps.host_actions),
        }
    }

    fn ingest_events_now(&self, events: &[GameLogEvent]) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }

        if config_store::get_bool(&self.deps.db, "gameLogDisabled", false)? {
            return Ok(());
        }

        let log_resource_load = config_store::get_bool(&self.deps.db, "logResourceLoad", false)?;
        let (output, snapshot) = self.with_engine(|engine| {
            let output = engine.ingest_events(events, GameLogIngestOptions { log_resource_load });
            (output, engine.runtime_snapshot())
        })?;
        self.deps.set_game_log_snapshot(snapshot);
        self.apply_ingest_output(self.side_effect_deps(), output)
    }

    fn handle_game_process_event_now(&self, event: GameLogProcessEvent) -> Result<()> {
        let (output, snapshot) = self.with_engine(|engine| {
            let output = engine.handle_process_event(event);
            (output, engine.runtime_snapshot())
        })?;
        self.deps.set_game_log_snapshot(snapshot);
        self.apply_ingest_output(self.side_effect_deps(), output)
    }

    fn apply_ingest_output(
        &self,
        deps: GameLogSideEffectDeps,
        output: GameLogIngestOutput,
    ) -> Result<()> {
        let write_outcome =
            self.write_batch_or_emit_failure_telemetry(&output.batch, output.raw_rows.clone())?;
        if let GameLogWriteOutcome::RuntimePersisted { affected_count } = write_outcome {
            self.deps.overlay_activity.ingest_game_log_output(&output);
            self.deps.event_bus.emit_game_log_persisted(affected_count);
            if let Some(projection) = output.projection {
                self.deps.event_bus.emit_game_log_projection(projection);
            }
            for row in output.runtime_persisted_mirrors {
                self.deps.event_bus.emit_runtime_game_log_event(row);
            }
        }
        for side_effect in output.side_effects {
            dispatch_side_effect(deps.clone(), side_effect);
        }
        Ok(())
    }

    fn write_batch_or_emit_failure_telemetry(
        &self,
        batch: &GameLogWriteBatch,
        raw_rows: Vec<Vec<String>>,
    ) -> Result<GameLogWriteOutcome> {
        match write_batch_with_retry(&self.deps.db, batch) {
            Ok(affected_count) => {
                self.deps.sync.record(
                    "gameLog",
                    "persisted",
                    "GameLog batch persisted by Rust.",
                    0,
                );
                Ok(GameLogWriteOutcome::RuntimePersisted { affected_count })
            }
            Err(error) => {
                let message = error.to_string();
                self.deps.sync.record_failure("gameLog", &message);
                self.deps
                    .event_bus
                    .emit_game_log_persistence_fallback(batch, raw_rows, &message);
                tracing::warn!(
                    "GameLog batch write failed after retries; frontend fallback writes are disabled: {message}"
                );
                Ok(GameLogWriteOutcome::PersistenceFailed)
            }
        }
    }

    fn with_engine<T>(&self, f: impl FnOnce(&mut GameLogIngestEngine) -> T) -> Result<T> {
        let mut engine = self
            .engine
            .lock()
            .map_err(|error| Error::Custom(format!("GameLog runtime state lock: {error}")))?;
        Ok(f(&mut engine))
    }
}

fn remember_error(first_error: &mut Option<Error>, error: Error) {
    if first_error.is_none() {
        *first_error = Some(error);
    } else {
        tracing::warn!("GameLog worker job failed: {error}");
    }
}

fn write_batch_with_retry(db: &DatabaseService, batch: &GameLogWriteBatch) -> Result<u64> {
    let mut delays = GAME_LOG_WRITE_RETRY_DELAYS_MS.iter();
    loop {
        match write_batch(db, batch) {
            Ok(affected_count) => return Ok(affected_count),
            Err(error) => {
                let Some(delay_ms) = delays.next() else {
                    return Err(error.into());
                };
                tracing::warn!("GameLog batch write failed, retrying in {delay_ms}ms: {error}");
                std::thread::sleep(Duration::from_millis(*delay_ms));
            }
        }
    }
}

fn dispatch_side_effect(deps: GameLogSideEffectDeps, side_effect: GameLogSideEffect) {
    match side_effect {
        GameLogSideEffect::Video(input) => {
            deps.tasks.clone().spawn(async move {
                if let Err(error) = runtime_video::handle_video_play(
                    deps.db.as_ref(),
                    deps.web.as_ref(),
                    &deps.event_bus,
                    input,
                )
                .await
                {
                    tracing::warn!("GameLog video side effect failed: {error}");
                }
            });
        }
        GameLogSideEffect::VideoSync {
            timestamp,
            created_at,
        } => {
            runtime_lifecycle::emit_video_sync(&deps.event_bus, &timestamp, &created_at);
        }
        GameLogSideEffect::NowPlayingReset => {
            deps.emit_side_effect("nowPlayingReset", serde_json::json!({}));
        }
        GameLogSideEffect::Screenshot(input) => {
            deps.tasks.clone().spawn(async move {
                if let Err(error) = runtime_screenshot::handle_screenshot(
                    deps.db.as_ref(),
                    deps.host_actions.as_ref(),
                    &deps.event_bus,
                    input,
                )
                .await
                {
                    tracing::warn!("GameLog screenshot side effect failed: {error}");
                }
            });
        }
        GameLogSideEffect::ApiRequest { url } => {
            deps.tasks.clone().spawn(async move {
                if let Err(error) =
                    runtime_instance_media::handle_api_request(deps.instance_media_deps(), &url)
                        .await
                {
                    tracing::warn!("GameLog instance media side effect failed: {error}");
                }
            });
        }
        GameLogSideEffect::Sticker {
            user_id,
            display_name,
            inventory_id,
        } => {
            deps.tasks.clone().spawn(async move {
                if let Err(error) = runtime_instance_media::handle_sticker_spawn(
                    deps.instance_media_deps(),
                    &user_id,
                    &display_name,
                    &inventory_id,
                )
                .await
                {
                    tracing::warn!("GameLog sticker side effect failed: {error}");
                }
            });
        }
        GameLogSideEffect::VrcQuit {
            created_at,
            is_game_running,
        } => {
            runtime_lifecycle::handle_vrc_quit(
                deps.db.as_ref(),
                deps.host_actions.as_ref(),
                &deps.event_bus,
                &created_at,
                is_game_running,
            );
        }
        GameLogSideEffect::NoVr { no_vr } => {
            if let Err(error) =
                runtime_lifecycle::set_game_no_vr(deps.db.as_ref(), &deps.event_bus, no_vr)
            {
                tracing::warn!("GameLog NoVR side effect failed: {error}");
            }
        }
        GameLogSideEffect::UdonException { data } => {
            if config_store::get_bool(&deps.db, "udonExceptionLogging", false).unwrap_or(false) {
                tracing::warn!(data, "VRChat Udon exception");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    use vrcx_0_core::log_watcher::{GameLogEvent, GameLogEventKind};
    use vrcx_0_persistence::config as config_store;
    use vrcx_0_persistence::storage::StorageService;
    use vrcx_0_persistence::DatabaseService;

    use crate::event_bus::RuntimeEventBus;
    use crate::game_log::runtime_state::RuntimeSnapshot;
    use crate::game_log::NoopGameLogHostActions;
    use crate::image_cache::ImageCache;
    use crate::overlay_activity::OverlayActivityRuntime;
    use crate::sync::RuntimeSyncEngine;
    use crate::task_supervisor::TaskSupervisor;
    use crate::web_client::WebClient;
    use crate::Result;

    use super::{GameLogProcessor, GameLogProcessorDeps, GameLogWorkerJob};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn event(created_at: &str, kind: GameLogEventKind) -> GameLogEvent {
        GameLogEvent {
            file_name: "output_log_2026-05-14_00-00-00.txt".into(),
            created_at: created_at.into(),
            kind,
        }
    }

    fn test_processor(name: &str) -> Result<(TestDir, Arc<DatabaseService>, GameLogProcessor)> {
        let dir = TestDir::new(name);
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        let storage = StorageService::new(&dir.path.join("VRCX-0.json"))?;
        let web = Arc::new(WebClient::new(&storage, &db, "https://app.example".into())?);
        let image_fetcher = web.image_fetcher()?;
        let image_cache = Arc::new(ImageCache::new(dir.path.join("ImageCache"), image_fetcher)?);
        let processor = GameLogProcessor::new(GameLogProcessorDeps {
            db: Arc::clone(&db),
            web,
            image_cache,
            event_bus: RuntimeEventBus::new(),
            tasks: TaskSupervisor::new(),
            sync: RuntimeSyncEngine::new(),
            snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
            host_actions: Arc::new(NoopGameLogHostActions),
            overlay_activity: OverlayActivityRuntime::new(),
        });
        Ok((dir, db, processor))
    }

    #[test]
    fn tracks_location_players_and_session_duration() -> Result<()> {
        let (_dir, db, processor) = test_processor("runtime-gamelog-ingest")?;

        processor.handle_jobs(vec![
            GameLogWorkerJob::Event(event(
                "2026-05-14T04:00:00.000Z",
                GameLogEventKind::Location {
                    location: "wrld_ingest:1".into(),
                    world_name: "Ingest World".into(),
                },
            )),
            GameLogWorkerJob::Event(event(
                "2026-05-14T04:00:10.000Z",
                GameLogEventKind::PlayerJoined {
                    display_name: "Alpha".into(),
                    user_id: "usr_alpha".into(),
                },
            )),
            GameLogWorkerJob::Event(event(
                "2026-05-14T04:00:40.000Z",
                GameLogEventKind::LocationDestination {
                    location: "wrld_next:1".into(),
                },
            )),
        ])?;

        let locations = vrcx_0_persistence::game_log::get_game_log_locations(&db)?;
        assert_eq!(locations[0].time, 40000);
        let join_leave = vrcx_0_persistence::game_log::get_game_log_join_leave(&db)?;
        assert_eq!(join_leave.len(), 2);
        assert_eq!(join_leave[0].event_type, "OnPlayerJoined");
        assert_eq!(join_leave[1].event_type, "OnPlayerLeft");
        assert_eq!(join_leave[1].display_name, "Alpha");
        assert_eq!(join_leave[1].time, 30000);
        Ok(())
    }

    #[test]
    fn respects_game_log_disabled_before_core_writes_and_side_effects() -> Result<()> {
        let (_dir, db, processor) = test_processor("runtime-gamelog-disabled")?;
        config_store::set_bool(&db, "gameLogDisabled", true)?;

        processor.handle_jobs(vec![GameLogWorkerJob::Event(event(
            "2026-05-14T05:00:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_disabled:1".into(),
                world_name: "Disabled".into(),
            },
        ))])?;

        assert!(!vrcx_0_persistence::game_log::game_log_location_table_exists(&db)?);
        Ok(())
    }

    #[test]
    fn emits_runtime_persisted_mirror_after_worker_write() -> Result<()> {
        let (_dir, _db, processor) = test_processor("runtime-gamelog-worker-mirror")?;

        processor.handle_jobs(vec![GameLogWorkerJob::Event(event(
            "2026-05-14T06:00:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_mirror:1".into(),
                world_name: "Mirror World".into(),
            },
        ))])?;

        let events = processor.deps.event_bus.take_events_for_test();
        assert!(events.iter().any(|event| {
            event.name == "runtimeGameLogEvent"
                && event
                    .payload
                    .get("runtimePersisted")
                    .and_then(|value| value.as_bool())
                    == Some(true)
        }));
        Ok(())
    }
}
