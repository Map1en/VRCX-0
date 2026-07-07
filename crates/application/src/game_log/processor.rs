use std::collections::HashMap;
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
use crate::world_cache::WorldCache;
use crate::world_enrich::{is_meaningful_world_name, world_id_from_location_or_id};
use crate::RuntimeAuthScope;
use crate::{Error, Result};

const GAME_LOG_WRITE_RETRY_DELAYS_MS: &[u64] = &[25, 100, 250];
const JOIN_NOTIFICATION_SUPPRESS_MS: i64 = 30_000;
const LEAVE_NOTIFICATION_SUPPRESS_MS: i64 = 5_000;

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
    pub auth_scope: RuntimeAuthScope,
    pub snapshot: Arc<Mutex<RuntimeSnapshot>>,
    pub host_actions: Arc<dyn GameLogHostActions>,
    pub overlay_activity: OverlayActivityRuntime,
    pub world_cache: Arc<WorldCache>,
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
        let mut engine = GameLogIngestEngine::default();
        if vrcx_0_persistence::game_log::game_log_location_table_exists(&deps.db).unwrap_or(false) {
            if let Some(last) = vrcx_0_persistence::game_log::get_last_game_log_location(&deps.db)
                .ok()
                .flatten()
            {
                let location = last.location.clone();
                let started_at = last.created_at.clone();
                engine.seed_current_location(last.location, last.world_name, last.created_at);
                if location.starts_with("wrld_") {
                    if let Ok(entries) =
                        vrcx_0_persistence::game_log::get_join_leave_entries_for_location_range(
                            &deps.db,
                            &location,
                            &started_at,
                            "9999-12-31T23:59:59Z",
                        )
                    {
                        engine.seed_current_roster(&entries);
                    }
                }
            }
        }
        Self {
            deps,
            engine: Arc::new(Mutex::new(engine)),
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
        mut output: GameLogIngestOutput,
    ) -> Result<()> {
        self.enrich_ingest_output_world_names(&mut output);
        let write_outcome =
            self.write_batch_or_emit_failure_telemetry(&output.batch, output.raw_rows.clone())?;
        if let GameLogWriteOutcome::RuntimePersisted { affected_count } = write_outcome {
            let overlay_output = self.overlay_activity_output(&output);
            self.deps
                .overlay_activity
                .ingest_game_log_output(&overlay_output);
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

    fn overlay_activity_output(&self, output: &GameLogIngestOutput) -> GameLogIngestOutput {
        let current_snapshot = self
            .deps
            .snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default();
        let current_user_id = self.deps.auth_scope.snapshot().current_user_id;
        let context = OverlayJoinLeaveSuppressionContext::from_output(output, current_snapshot);
        let mut overlay_output = output.clone();
        overlay_output.batch.join_leave = output
            .batch
            .join_leave
            .iter()
            .filter(|entry| {
                should_deliver_join_leave_overlay_activity(entry, &context, &current_user_id)
            })
            .cloned()
            .collect();
        overlay_output
    }

    fn enrich_ingest_output_world_names(&self, output: &mut GameLogIngestOutput) {
        for entry in &mut output.batch.join_leave {
            if let Some(world_name) =
                self.cached_world_name_for_location(&entry.world_name, &entry.location)
            {
                entry.world_name = world_name;
            }
        }

        for side_effect in &mut output.side_effects {
            let GameLogSideEffect::Video(input) = side_effect else {
                continue;
            };
            if let Some(world_name) =
                self.cached_world_name_for_location(&input.world_name, &input.location)
            {
                input.world_name = world_name;
            }
        }
    }

    fn cached_world_name_for_location(
        &self,
        current_world_name: &str,
        location: &str,
    ) -> Option<String> {
        if is_meaningful_world_name(current_world_name) {
            return None;
        }
        let world_id = world_id_from_location_or_id(location);
        if world_id.is_empty() {
            return None;
        }
        self.deps.world_cache.get_name(&world_id)
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

struct OverlayJoinLeaveSuppressionContext {
    current_snapshot: RuntimeSnapshot,
    location_started_at_by_location: HashMap<String, String>,
    destination_started_at: Vec<String>,
}

impl OverlayJoinLeaveSuppressionContext {
    fn from_output(output: &GameLogIngestOutput, current_snapshot: RuntimeSnapshot) -> Self {
        let location_started_at_by_location = output
            .batch
            .locations
            .iter()
            .map(|entry| (entry.location.clone(), entry.created_at.clone()))
            .collect();
        let destination_started_at = output
            .raw_rows
            .iter()
            .filter(|row| row.get(2).map(String::as_str) == Some("location-destination"))
            .filter_map(|row| row.get(1).cloned())
            .collect();

        Self {
            current_snapshot,
            location_started_at_by_location,
            destination_started_at,
        }
    }

    fn join_reference_at(&self, location: &str) -> Option<&str> {
        self.location_started_at_by_location
            .get(location)
            .map(String::as_str)
            .or_else(|| {
                (self.current_snapshot.location == location)
                    .then_some(self.current_snapshot.started_at.as_str())
            })
    }

    fn is_within_leave_suppression_window(&self, created_at: &str) -> bool {
        self.destination_started_at
            .iter()
            .map(String::as_str)
            .chain(
                (self.current_snapshot.location == "traveling")
                    .then_some(self.current_snapshot.started_at.as_str()),
            )
            .any(|reference_at| {
                is_within_suppression_window(
                    created_at,
                    reference_at,
                    LEAVE_NOTIFICATION_SUPPRESS_MS,
                )
            })
    }
}

fn should_deliver_join_leave_overlay_activity(
    entry: &vrcx_0_persistence::game_log::GameLogJoinLeaveEntry,
    context: &OverlayJoinLeaveSuppressionContext,
    current_user_id: &str,
) -> bool {
    if !current_user_id.trim().is_empty() && entry.user_id.trim() == current_user_id.trim() {
        return false;
    }

    if is_join_activity_type(&entry.event_type) {
        if let Some(reference_at) = context.join_reference_at(&entry.location) {
            return !is_within_suppression_window(
                &entry.created_at,
                reference_at,
                JOIN_NOTIFICATION_SUPPRESS_MS,
            );
        }
    }

    if is_left_activity_type(&entry.event_type) {
        return !context.is_within_leave_suppression_window(&entry.created_at);
    }

    true
}

fn is_join_activity_type(activity_type: &str) -> bool {
    matches!(
        activity_type,
        "OnPlayerJoined" | "BlockedOnPlayerJoined" | "MutedOnPlayerJoined"
    )
}

fn is_left_activity_type(activity_type: &str) -> bool {
    matches!(
        activity_type,
        "OnPlayerLeft" | "BlockedOnPlayerLeft" | "MutedOnPlayerLeft"
    )
}

fn is_within_suppression_window(created_at: &str, reference_at: &str, window_ms: i64) -> bool {
    let Some(created_at_ms) = crate::game_log::parse_event_time_ms(created_at) else {
        return false;
    };
    let Some(reference_at_ms) = crate::game_log::parse_event_time_ms(reference_at) else {
        return false;
    };

    created_at_ms >= reference_at_ms && created_at_ms <= reference_at_ms.saturating_add(window_ms)
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
mod tests;
