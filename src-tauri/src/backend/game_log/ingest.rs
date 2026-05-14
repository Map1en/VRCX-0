use std::sync::{Arc, Mutex};

use crate::backend::context::BackendContext;
use crate::backend::db::config as backend_config;
use crate::backend::db::game_log::{
    write_batch, GameLogEventEntry, GameLogExternalEntry, GameLogJoinLeaveEntry,
    GameLogLocationEntry, GameLogLocationTimeUpdate, GameLogPortalSpawnEntry,
    GameLogResourceLoadEntry, GameLogWriteBatch,
};
use crate::domain::log_watcher::{GameLogEvent, GameLogEventKind};
use crate::domain::process_monitor::GameProcessEvent;
use crate::error::AppError;

use super::instance_media::InstanceMediaQueue;
use super::runtime_state::{
    duration_ms, now_iso, parse_event_time_ms, player_key, world_id_from_location,
    GameLogRuntimeState, PlayerState,
};
use super::{lifecycle, screenshot, video, BackendDeps};

#[derive(Clone)]
pub(super) enum GameLogWorkerJob {
    Event(GameLogEvent),
    Process(GameProcessEvent),
}

#[derive(Clone)]
pub(super) struct GameLogProcessor {
    context: Arc<BackendContext>,
    state: Arc<Mutex<GameLogRuntimeState>>,
    media_queue: InstanceMediaQueue,
}

impl GameLogProcessor {
    pub(super) fn new(context: Arc<BackendContext>) -> Self {
        Self {
            context,
            state: Arc::new(Mutex::new(GameLogRuntimeState::default())),
            media_queue: InstanceMediaQueue::new(),
        }
    }

    pub(super) fn handle_jobs(&self, jobs: Vec<GameLogWorkerJob>) -> Result<(), AppError> {
        let mut pending_events = Vec::new();
        for job in jobs {
            match job {
                GameLogWorkerJob::Event(event) => pending_events.push(event),
                GameLogWorkerJob::Process(event) => {
                    self.ingest_events_now(&pending_events)?;
                    pending_events.clear();
                    self.handle_game_process_event_now(event)?;
                }
            }
        }
        self.ingest_events_now(&pending_events)
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
}

enum SideEffectCommand {
    Video(video::VideoInput),
    VideoSync {
        timestamp: String,
        created_at: String,
    },
    NowPlayingReset,
    Screenshot(screenshot::ScreenshotInput),
    ApiRequest {
        url: String,
    },
    Sticker {
        user_id: String,
        display_name: String,
        inventory_id: String,
    },
    VrcQuit {
        created_at: String,
        is_game_running: bool,
    },
    NoVr {
        no_vr: bool,
    },
    UdonException {
        data: String,
    },
}

impl GameLogProcessor {
    fn ingest_events_now(&self, events: &[GameLogEvent]) -> Result<(), AppError> {
        if events.is_empty() {
            return Ok(());
        }

        if backend_config::get_bool(&self.context.db, "gameLogDisabled", false)? {
            return Ok(());
        }

        let log_resource_load =
            backend_config::get_bool(&self.context.db, "logResourceLoad", false)?;
        let deps = self.deps();
        let mut batch = GameLogWriteBatch::default();
        let mut side_effects = Vec::new();

        {
            let mut state = self.state.lock().map_err(|error| {
                AppError::Custom(format!("GameLog backend state lock: {error}"))
            })?;

            for event in events {
                match &event.kind {
                    GameLogEventKind::Location {
                        location,
                        world_name,
                    } => self.ingest_location(&mut state, &mut batch, event, location, world_name),
                    GameLogEventKind::LocationDestination { .. } => {
                        self.finalize_location_session(&mut state, &mut batch, &event.created_at);
                        state.current_location = "traveling".into();
                        state.current_world_name.clear();
                        state.current_location_started_at = event.created_at.clone();
                        state.current_location_started_at_ms =
                            parse_event_time_ms(&event.created_at);
                    }
                    GameLogEventKind::PlayerJoined {
                        display_name,
                        user_id,
                    } => self.ingest_player_joined(
                        &mut state,
                        &mut batch,
                        event,
                        display_name,
                        user_id,
                    ),
                    GameLogEventKind::PlayerLeft {
                        display_name,
                        user_id,
                    } => self.ingest_player_left(
                        &mut state,
                        &mut batch,
                        event,
                        display_name,
                        user_id,
                    ),
                    GameLogEventKind::PortalSpawn => {
                        self.ingest_portal_spawn(&state, &mut batch, event)
                    }
                    GameLogEventKind::Notification { .. }
                    | GameLogEventKind::AvatarChange { .. } => {}
                    GameLogEventKind::ResourceLoad {
                        resource_type,
                        resource_url,
                    } => self.ingest_resource_load(
                        &mut state,
                        &mut batch,
                        event,
                        resource_type,
                        resource_url,
                        log_resource_load,
                    ),
                    GameLogEventKind::VideoPlay {
                        video_url,
                        display_name,
                    } => {
                        if let Some(input) =
                            self.prepare_video_play(&mut state, event, video_url, display_name)
                        {
                            side_effects.push(SideEffectCommand::Video(input));
                        }
                    }
                    GameLogEventKind::VideoSync { timestamp } => {
                        side_effects.push(SideEffectCommand::VideoSync {
                            timestamp: timestamp.clone(),
                            created_at: event.created_at.clone(),
                        });
                    }
                    GameLogEventKind::Vrcx { data } => {
                        match video::parse_provider_video(
                            &event.created_at,
                            &state.current_location,
                            data,
                        ) {
                            video::ProviderVideoEvent::Video(input) => {
                                if self.accept_video_url(&mut state, &input.video_url) {
                                    side_effects.push(SideEffectCommand::Video(input));
                                }
                            }
                            video::ProviderVideoEvent::ResetNowPlaying => {
                                state.last_video_url.clear();
                                state.now_playing_url.clear();
                                side_effects.push(SideEffectCommand::NowPlayingReset);
                            }
                            video::ProviderVideoEvent::Ignored => {}
                            video::ProviderVideoEvent::NotProvider => {
                                batch.externals.push(GameLogExternalEntry {
                                    created_at: event.created_at.clone(),
                                    message: data.clone(),
                                    display_name: String::new(),
                                    user_id: String::new(),
                                    location: state.current_location.clone(),
                                });
                            }
                        }
                    }
                    GameLogEventKind::ApiRequest { url } => {
                        side_effects.push(SideEffectCommand::ApiRequest { url: url.clone() });
                    }
                    GameLogEventKind::Screenshot { path } => {
                        side_effects.push(SideEffectCommand::Screenshot(
                            screenshot::ScreenshotInput {
                                created_at: event.created_at.clone(),
                                path: path.clone(),
                                snapshot: state.snapshot(),
                            },
                        ));
                    }
                    GameLogEventKind::StickerSpawn {
                        user_id,
                        display_name,
                        inventory_id,
                    } => side_effects.push(SideEffectCommand::Sticker {
                        user_id: user_id.clone(),
                        display_name: display_name.clone(),
                        inventory_id: inventory_id.clone(),
                    }),
                    GameLogEventKind::VrcQuit => side_effects.push(SideEffectCommand::VrcQuit {
                        created_at: event.created_at.clone(),
                        is_game_running: state.is_game_running,
                    }),
                    GameLogEventKind::OpenVrInit => {
                        side_effects.push(SideEffectCommand::NoVr { no_vr: false })
                    }
                    GameLogEventKind::DesktopMode => {
                        side_effects.push(SideEffectCommand::NoVr { no_vr: true })
                    }
                    GameLogEventKind::UdonException { data } => {
                        side_effects.push(SideEffectCommand::UdonException { data: data.clone() })
                    }
                    GameLogEventKind::Event { data } => batch.events.push(GameLogEventEntry {
                        created_at: event.created_at.clone(),
                        data: data.clone(),
                    }),
                    GameLogEventKind::External { data } => {
                        batch.externals.push(GameLogExternalEntry {
                            created_at: event.created_at.clone(),
                            message: data.clone(),
                            display_name: String::new(),
                            user_id: String::new(),
                            location: state.current_location.clone(),
                        });
                    }
                }
            }
        }

        write_batch(&self.context.db, &batch)?;
        self.emit_backend_persisted_mirrors(events);
        for side_effect in side_effects {
            dispatch_side_effect(deps.clone(), side_effect);
        }

        Ok(())
    }

    fn handle_game_process_event_now(&self, event: GameProcessEvent) -> Result<(), AppError> {
        let deps = self.deps();
        let mut batch = GameLogWriteBatch::default();
        {
            let mut state = self.state.lock().map_err(|error| {
                AppError::Custom(format!("GameLog backend state lock: {error}"))
            })?;
            state.is_game_running = event.is_game_running;
            state.is_steamvr_running = event.is_steamvr_running;
            if event.game_changed && !event.is_game_running {
                let stopped_at = now_iso();
                self.finalize_location_session(&mut state, &mut batch, &stopped_at);
                state.current_location.clear();
                state.current_world_name.clear();
                state.current_location_started_at.clear();
                state.current_location_started_at_ms = None;
                state.last_resource_url.clear();
                state.last_video_url.clear();
                state.now_playing_url.clear();
            }
        }

        write_batch(&self.context.db, &batch)?;
        if event.game_changed && !event.is_game_running {
            deps.emit_side_effect("nowPlayingReset", serde_json::json!({}));
        }
        Ok(())
    }

    fn ingest_location(
        &self,
        state: &mut GameLogRuntimeState,
        batch: &mut GameLogWriteBatch,
        event: &GameLogEvent,
        location: &str,
        world_name: &str,
    ) {
        if location.is_empty() {
            return;
        }

        batch.locations.push(GameLogLocationEntry {
            created_at: event.created_at.clone(),
            location: location.to_string(),
            world_id: world_id_from_location(location),
            world_name: world_name.to_string(),
            time: 0,
            group_name: String::new(),
        });

        state.current_location = location.to_string();
        state.current_world_name = world_name.to_string();
        state.current_location_started_at = event.created_at.clone();
        state.current_location_started_at_ms = parse_event_time_ms(&event.created_at);
        state.players_by_key.clear();
        state.last_resource_url.clear();
        state.last_video_url.clear();
    }

    fn ingest_player_joined(
        &self,
        state: &mut GameLogRuntimeState,
        batch: &mut GameLogWriteBatch,
        event: &GameLogEvent,
        display_name: &str,
        user_id: &str,
    ) {
        let join_time_ms = parse_event_time_ms(&event.created_at);
        state.players_by_key.insert(
            player_key(user_id, display_name),
            PlayerState {
                user_id: user_id.to_string(),
                display_name: display_name.to_string(),
                join_time_ms,
            },
        );

        batch.join_leave.push(GameLogJoinLeaveEntry {
            created_at: event.created_at.clone(),
            event_type: "OnPlayerJoined".into(),
            display_name: display_name.to_string(),
            location: state.current_location.clone(),
            user_id: user_id.to_string(),
            time: 0,
        });
    }

    fn ingest_player_left(
        &self,
        state: &mut GameLogRuntimeState,
        batch: &mut GameLogWriteBatch,
        event: &GameLogEvent,
        display_name: &str,
        user_id: &str,
    ) {
        let left_time_ms = parse_event_time_ms(&event.created_at);
        let player = state
            .players_by_key
            .remove(&player_key(user_id, display_name));
        let duration = duration_ms(player.as_ref().and_then(|p| p.join_time_ms), left_time_ms);

        batch.join_leave.push(GameLogJoinLeaveEntry {
            created_at: event.created_at.clone(),
            event_type: "OnPlayerLeft".into(),
            display_name: display_name.to_string(),
            location: state.current_location.clone(),
            user_id: user_id.to_string(),
            time: duration,
        });
    }

    fn ingest_portal_spawn(
        &self,
        state: &GameLogRuntimeState,
        batch: &mut GameLogWriteBatch,
        event: &GameLogEvent,
    ) {
        batch.portal_spawns.push(GameLogPortalSpawnEntry {
            created_at: event.created_at.clone(),
            display_name: String::new(),
            location: state.current_location.clone(),
            user_id: String::new(),
            instance_id: String::new(),
            world_name: String::new(),
        });
    }

    fn ingest_resource_load(
        &self,
        state: &mut GameLogRuntimeState,
        batch: &mut GameLogWriteBatch,
        event: &GameLogEvent,
        resource_type: &str,
        resource_url: &str,
        log_resource_load: bool,
    ) {
        if resource_url.is_empty() || state.last_resource_url == resource_url || !log_resource_load
        {
            return;
        }

        state.last_resource_url = resource_url.to_string();
        batch.resource_loads.push(GameLogResourceLoadEntry {
            created_at: event.created_at.clone(),
            resource_url: resource_url.to_string(),
            resource_type: resource_type.to_string(),
            location: state.current_location.clone(),
        });
    }

    fn finalize_location_session(
        &self,
        state: &mut GameLogRuntimeState,
        batch: &mut GameLogWriteBatch,
        stopped_at: &str,
    ) {
        let stopped_at_ms = parse_event_time_ms(stopped_at);
        if state.current_location.is_empty() || stopped_at_ms.is_none() {
            state.players_by_key.clear();
            return;
        }

        for player in state.players_by_key.values() {
            batch.join_leave.push(GameLogJoinLeaveEntry {
                created_at: stopped_at.to_string(),
                event_type: "OnPlayerLeft".into(),
                display_name: player.display_name.clone(),
                location: state.current_location.clone(),
                user_id: player.user_id.clone(),
                time: duration_ms(player.join_time_ms, stopped_at_ms),
            });
        }
        state.players_by_key.clear();

        let location_duration = duration_ms(state.current_location_started_at_ms, stopped_at_ms);
        if !state.current_location_started_at.is_empty() {
            batch.location_time_updates.push(GameLogLocationTimeUpdate {
                created_at: state.current_location_started_at.clone(),
                time: location_duration,
            });
        }
    }

    fn prepare_video_play(
        &self,
        state: &mut GameLogRuntimeState,
        event: &GameLogEvent,
        video_url: &str,
        display_name: &str,
    ) -> Option<video::VideoInput> {
        let video_url = decode_video_url(video_url);
        if !self.accept_video_url(state, &video_url) {
            return None;
        }

        Some(video::VideoInput {
            created_at: event.created_at.clone(),
            location: state.current_location.clone(),
            video_url,
            display_name: display_name.to_string(),
            ..Default::default()
        })
    }

    fn accept_video_url(&self, state: &mut GameLogRuntimeState, video_url: &str) -> bool {
        if video_url.is_empty() || state.last_video_url == video_url {
            return false;
        }
        state.last_video_url = video_url.to_string();
        state.now_playing_url = video_url.to_string();
        true
    }

    fn emit_backend_persisted_mirrors(&self, events: &[GameLogEvent]) {
        for event in events {
            if should_emit_backend_persisted_mirror(&event.kind) {
                self.context
                    .event_bus
                    .emit_backend_game_log_event(event.to_compat_row());
            }
        }
    }
}

fn should_emit_backend_persisted_mirror(kind: &GameLogEventKind) -> bool {
    matches!(
        kind,
        GameLogEventKind::Location { .. }
            | GameLogEventKind::LocationDestination { .. }
            | GameLogEventKind::PlayerJoined { .. }
            | GameLogEventKind::PlayerLeft { .. }
            | GameLogEventKind::PortalSpawn
            | GameLogEventKind::ResourceLoad { .. }
            | GameLogEventKind::Event { .. }
            | GameLogEventKind::External { .. }
            | GameLogEventKind::Vrcx { .. }
    )
}

fn decode_video_url(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|_| value.trim().to_string())
}

fn dispatch_side_effect(deps: BackendDeps, side_effect: SideEffectCommand) {
    match side_effect {
        SideEffectCommand::Video(input) => {
            tauri::async_runtime::spawn(async move {
                if let Err(error) = video::handle_video_play(deps, input).await {
                    tracing::warn!("GameLog video side effect failed: {error}");
                }
            });
        }
        SideEffectCommand::VideoSync {
            timestamp,
            created_at,
        } => {
            lifecycle::emit_video_sync(deps, &timestamp, &created_at);
        }
        SideEffectCommand::NowPlayingReset => {
            deps.emit_side_effect("nowPlayingReset", serde_json::json!({}));
        }
        SideEffectCommand::Screenshot(input) => {
            tauri::async_runtime::spawn(async move {
                if let Err(error) = screenshot::handle_screenshot(deps, input).await {
                    tracing::warn!("GameLog screenshot side effect failed: {error}");
                }
            });
        }
        SideEffectCommand::ApiRequest { url } => {
            tauri::async_runtime::spawn(async move {
                if let Err(error) = super::instance_media::handle_api_request(deps, &url).await {
                    tracing::warn!("GameLog instance media side effect failed: {error}");
                }
            });
        }
        SideEffectCommand::Sticker {
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
        SideEffectCommand::VrcQuit {
            created_at,
            is_game_running,
        } => {
            lifecycle::handle_vrc_quit(deps, &created_at, is_game_running);
        }
        SideEffectCommand::NoVr { no_vr } => {
            if let Err(error) = lifecycle::set_game_no_vr(deps, no_vr) {
                tracing::warn!("GameLog NoVR side effect failed: {error}");
            }
        }
        SideEffectCommand::UdonException { data } => {
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
    use crate::backend::db::config as backend_config;
    use crate::backend::game_log::GameLogBackend;
    use crate::domain::database::DatabaseService;
    use crate::domain::image_cache::ImageCache;
    use crate::domain::log_watcher::{GameLogEvent, GameLogEventKind};
    use crate::domain::storage::StorageService;
    use crate::domain::web_client::WebClient;
    use crate::error::AppError;

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
