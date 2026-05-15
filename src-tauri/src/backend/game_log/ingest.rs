use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::backend::context::BackendContext;
use crate::domain::log_watcher::GameLogEvent;
use crate::domain::process_monitor::GameProcessEvent;
use crate::error::AppError;
use vrcx_0_persistence::config as backend_config;
use vrcx_0_persistence::game_log::{write_batch, GameLogWriteBatch};
use vrcx_0_runtime::game_log::ingest::{
    GameLogIngestEngine, GameLogIngestOptions, GameLogIngestOutput, GameLogProcessEvent,
    GameLogSideEffect,
};

use super::instance_media::InstanceMediaQueue;
use super::{lifecycle, screenshot, video, BackendDeps};

const GAME_LOG_WRITE_RETRY_DELAYS_MS: &[u64] = &[25, 100, 250];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GameLogWriteOutcome {
    BackendPersisted,
    PersistenceFailed,
}

#[derive(Clone)]
pub(super) enum GameLogWorkerJob {
    Event(GameLogEvent),
    Process(GameProcessEvent),
}

#[derive(Clone)]
pub(super) struct GameLogProcessor {
    context: Arc<BackendContext>,
    engine: Arc<Mutex<GameLogIngestEngine>>,
    media_queue: InstanceMediaQueue,
}

impl GameLogProcessor {
    pub(super) fn new(context: Arc<BackendContext>) -> Self {
        Self {
            context,
            engine: Arc::new(Mutex::new(GameLogIngestEngine::default())),
            media_queue: InstanceMediaQueue::new(),
        }
    }

    pub(super) fn handle_jobs(&self, jobs: Vec<GameLogWorkerJob>) -> Result<(), AppError> {
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

    fn deps(&self) -> BackendDeps {
        BackendDeps {
            db: Arc::clone(&self.context.db),
            web: Arc::clone(&self.context.web),
            image_cache: Arc::clone(&self.context.image_cache),
            event_bus: self.context.event_bus.clone(),
            media_queue: self.media_queue.clone(),
        }
    }

    fn ingest_events_now(&self, events: &[GameLogEvent]) -> Result<(), AppError> {
        if events.is_empty() {
            return Ok(());
        }

        if backend_config::get_bool(&self.context.db, "gameLogDisabled", false)? {
            return Ok(());
        }

        let log_resource_load =
            backend_config::get_bool(&self.context.db, "logResourceLoad", false)?;
        let output = self.with_engine(|engine| {
            engine.ingest_events(events, GameLogIngestOptions { log_resource_load })
        })?;
        self.apply_ingest_output(self.deps(), output)
    }

    fn handle_game_process_event_now(&self, event: GameProcessEvent) -> Result<(), AppError> {
        let output = self.with_engine(|engine| {
            engine.handle_process_event(GameLogProcessEvent {
                is_game_running: event.is_game_running,
                is_steamvr_running: event.is_steamvr_running,
                game_changed: event.game_changed,
                changed_at: chrono::Utc::now()
                    .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                    .to_string(),
            })
        })?;
        self.apply_ingest_output(self.deps(), output)
    }

    fn apply_ingest_output(
        &self,
        deps: BackendDeps,
        output: GameLogIngestOutput,
    ) -> Result<(), AppError> {
        let write_outcome =
            self.write_batch_or_emit_failure_telemetry(&output.batch, output.raw_rows)?;
        if write_outcome == GameLogWriteOutcome::BackendPersisted {
            for row in output.backend_persisted_mirrors {
                self.context.event_bus.emit_backend_game_log_event(row);
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
    ) -> Result<GameLogWriteOutcome, AppError> {
        match write_batch_with_retry(&self.context.db, batch) {
            Ok(()) => Ok(GameLogWriteOutcome::BackendPersisted),
            Err(error) => {
                let message = error.to_string();
                self.context
                    .event_bus
                    .emit_game_log_persistence_fallback(batch, raw_rows, &message);
                tracing::warn!(
                    "GameLog batch write failed after retries; frontend fallback writes are disabled: {message}"
                );
                Ok(GameLogWriteOutcome::PersistenceFailed)
            }
        }
    }

    fn with_engine<T>(&self, f: impl FnOnce(&mut GameLogIngestEngine) -> T) -> Result<T, AppError> {
        let mut engine = self
            .engine
            .lock()
            .map_err(|error| AppError::Custom(format!("GameLog backend state lock: {error}")))?;
        Ok(f(&mut engine))
    }
}

fn remember_error(first_error: &mut Option<AppError>, error: AppError) {
    if first_error.is_none() {
        *first_error = Some(error);
    } else {
        tracing::warn!("GameLog worker job failed: {error}");
    }
}

fn write_batch_with_retry(
    db: &vrcx_0_persistence::database::DatabaseService,
    batch: &GameLogWriteBatch,
) -> Result<(), AppError> {
    let mut delays = GAME_LOG_WRITE_RETRY_DELAYS_MS.iter();
    loop {
        match write_batch(db, batch) {
            Ok(()) => return Ok(()),
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

fn dispatch_side_effect(deps: BackendDeps, side_effect: GameLogSideEffect) {
    match side_effect {
        GameLogSideEffect::Video(input) => {
            tauri::async_runtime::spawn(async move {
                if let Err(error) = video::handle_video_play(deps, input).await {
                    tracing::warn!("GameLog video side effect failed: {error}");
                }
            });
        }
        GameLogSideEffect::VideoSync {
            timestamp,
            created_at,
        } => {
            lifecycle::emit_video_sync(deps, &timestamp, &created_at);
        }
        GameLogSideEffect::NowPlayingReset => {
            deps.emit_side_effect("nowPlayingReset", serde_json::json!({}));
        }
        GameLogSideEffect::Screenshot(input) => {
            tauri::async_runtime::spawn(async move {
                if let Err(error) = screenshot::handle_screenshot(
                    deps,
                    screenshot::ScreenshotInput {
                        created_at: input.created_at,
                        path: input.path,
                        snapshot: input.snapshot,
                    },
                )
                .await
                {
                    tracing::warn!("GameLog screenshot side effect failed: {error}");
                }
            });
        }
        GameLogSideEffect::ApiRequest { url } => {
            tauri::async_runtime::spawn(async move {
                if let Err(error) = super::instance_media::handle_api_request(deps, &url).await {
                    tracing::warn!("GameLog instance media side effect failed: {error}");
                }
            });
        }
        GameLogSideEffect::Sticker {
            user_id,
            display_name,
            inventory_id,
        } => {
            tauri::async_runtime::spawn(async move {
                if let Err(error) = super::instance_media::handle_sticker_spawn(
                    deps,
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
            lifecycle::handle_vrc_quit(deps, &created_at, is_game_running);
        }
        GameLogSideEffect::NoVr { no_vr } => {
            if let Err(error) = lifecycle::set_game_no_vr(deps, no_vr) {
                tracing::warn!("GameLog NoVR side effect failed: {error}");
            }
        }
        GameLogSideEffect::UdonException { data } => {
            if backend_config::get_bool(&deps.db, "udonExceptionLogging", false).unwrap_or(false) {
                tracing::warn!(data, "VRChat Udon exception");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use crate::backend::context::BackendContext;
    use crate::backend::game_log::GameLogBackend;
    use crate::domain::image_cache::ImageCache;
    use crate::domain::log_watcher::{GameLogEvent, GameLogEventKind};
    use crate::domain::storage::StorageService;
    use crate::domain::web_client::WebClient;
    use crate::error::AppError;
    use vrcx_0_persistence::config as backend_config;
    use vrcx_0_persistence::database::DatabaseService;

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

    fn test_backend(
        name: &str,
    ) -> Result<(TestDir, Arc<DatabaseService>, GameLogBackend), AppError> {
        let dir = TestDir::new(name);
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        let storage = StorageService::new(&dir.path.join("VRCX-0.json"))?;
        let web = Arc::new(WebClient::new(&storage, &db)?);
        let image_cache = Arc::new(ImageCache::new(
            dir.path.join("ImageCache"),
            web.cookie_jar(),
            web.proxy_url(),
        )?);
        let context = Arc::new(BackendContext::new(Arc::clone(&db), web, image_cache));
        let backend = GameLogBackend::new(context);
        Ok((dir, db, backend))
    }

    #[test]
    fn tracks_location_players_and_session_duration() -> Result<(), AppError> {
        let (_dir, db, backend) = test_backend("backend-gamelog-phase3-ingest")?;

        backend.ingest_events(&[
            event(
                "2026-05-14T04:00:00.000Z",
                GameLogEventKind::Location {
                    location: "wrld_ingest:1".into(),
                    world_name: "Ingest World".into(),
                },
            ),
            event(
                "2026-05-14T04:00:10.000Z",
                GameLogEventKind::PlayerJoined {
                    display_name: "Alpha".into(),
                    user_id: "usr_alpha".into(),
                },
            ),
            event(
                "2026-05-14T04:00:40.000Z",
                GameLogEventKind::LocationDestination {
                    location: "wrld_next:1".into(),
                },
            ),
        ])?;
        assert!(backend.wait_until_idle_for_test());

        let rows = db.execute("SELECT time FROM gamelog_location", &Default::default())?;
        assert_eq!(rows[0][0], serde_json::json!(40000));
        let rows = db.execute(
            "SELECT type, display_name, time FROM gamelog_join_leave ORDER BY created_at",
            &Default::default(),
        )?;
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0][0], serde_json::json!("OnPlayerJoined"));
        assert_eq!(rows[1][0], serde_json::json!("OnPlayerLeft"));
        assert_eq!(rows[1][1], serde_json::json!("Alpha"));
        assert_eq!(rows[1][2], serde_json::json!(30000));
        Ok(())
    }

    #[test]
    fn respects_game_log_disabled_before_core_writes_and_side_effects() -> Result<(), AppError> {
        let (_dir, db, backend) = test_backend("backend-gamelog-phase3-disabled")?;
        backend_config::set_bool(&db, "gameLogDisabled", true)?;

        backend.ingest_events(&[event(
            "2026-05-14T05:00:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_disabled:1".into(),
                world_name: "Disabled".into(),
            },
        )])?;
        assert!(backend.wait_until_idle_for_test());

        let rows = db.execute(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'gamelog_location'",
            &Default::default(),
        )?;
        assert!(rows.is_empty());
        Ok(())
    }

    #[test]
    fn emits_backend_persisted_mirror_after_worker_write() -> Result<(), AppError> {
        let (_dir, _db, backend) = test_backend("backend-gamelog-worker-mirror")?;

        backend.ingest_events(&[event(
            "2026-05-14T06:00:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_mirror:1".into(),
                world_name: "Mirror World".into(),
            },
        )])?;
        assert!(backend.wait_until_idle_for_test());

        let events = backend.context.event_bus.take_events_for_test();
        assert!(events.iter().any(|event| {
            event.name == "addGameLogEvent"
                && event
                    .payload
                    .get("backendPersisted")
                    .and_then(|value| value.as_bool())
                    == Some(true)
        }));
        Ok(())
    }
}
