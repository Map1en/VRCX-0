use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use vrcx_0_application_core::{
    BackendRuntimeStatusPublisher, InstanceRosterMember, InstanceRosterObserver,
    InstanceRosterSnapshot, RuntimeOperationStatus,
};

use vrcx_0_contracts::game_log::{GameLogJoinLeaveEntry, GameLogWriteBatch};
use vrcx_0_core::game_log_parser::GameLogEvent;
use vrcx_0_core::location::{
    is_meaningful_world_name, world_id_from_location as world_id_from_location_or_id,
};

use crate::game_log::host::GameLogHostActions;
use crate::game_log::ingest::{
    GameLogIngestEngine, GameLogIngestOptions, GameLogIngestOutput, GameLogProcessEvent,
    GameLogSideEffect,
};
use crate::game_log::instance_media::InstanceMediaQueue;
use crate::game_log::runtime_state::{RuntimeSnapshot, RuntimeSnapshotStore};
use crate::overlay_activity::OverlayActivityGameIngestExt;
use crate::GameLogEventOrigin;
use crate::RuntimeAuthScope;
use crate::RuntimeEventBus;
use crate::RuntimeGameEventBusExt;
use crate::{Error, Result};
use crate::{GameLogPersistenceFallbackPayload, RuntimeGameLogEventPayload};
use crate::{InstanceMediaPort, RuntimeSyncEngine, TaskSupervisor, VideoMetadataPort, WorldCache};
use vrcx_0_application_activity::OverlayActivityRuntime;

use self::side_effects::{dispatch_side_effect, GameLogSideEffectDeps};
use vrcx_0_core::OwnerId;

mod side_effects;

const GAME_LOG_WRITE_RETRY_DELAYS_MS: &[u64] = &[25, 100, 250];
const JOIN_NOTIFICATION_SUPPRESS_MS: i64 = 30_000;
const LEAVE_NOTIFICATION_SUPPRESS_MS: i64 = 5_000;

#[derive(Clone)]
pub enum GameLogWorkerJob {
    #[cfg(test)]
    Event(GameLogEvent),
    #[cfg(test)]
    InitialEvent(GameLogEvent),
    Process(GameLogProcessEvent),
    ResetReplay(std::sync::mpsc::SyncSender<()>),
    RetryWrite(std::sync::mpsc::SyncSender<std::result::Result<(), String>>),
    Events {
        events: Vec<GameLogEvent>,
        origin: GameLogEventOrigin,
    },
    Scan {
        events: Vec<GameLogEvent>,
        origin: GameLogEventOrigin,
        cursor: Box<crate::GameLogScanCursor>,
        publish: bool,
        completed: Option<std::sync::mpsc::SyncSender<std::result::Result<(), String>>>,
    },
}

#[derive(Clone)]
pub struct GameLogProcessorDeps {
    pub(crate) store: Arc<dyn crate::GameStateStore>,
    pub(crate) instance_media: Arc<dyn InstanceMediaPort>,
    pub(crate) video_metadata: Arc<dyn VideoMetadataPort>,
    pub event_bus: RuntimeEventBus,
    pub backend_status: BackendRuntimeStatusPublisher,
    pub side_effect_sink: crate::GameLogSideEffectSink,
    pub tasks: TaskSupervisor,
    pub sync: RuntimeSyncEngine,
    pub auth_scope: RuntimeAuthScope,
    pub snapshot: RuntimeSnapshotStore,
    pub host_actions: Arc<dyn GameLogHostActions>,
    pub overlay_activity: OverlayActivityRuntime,
    pub world_cache: Arc<WorldCache>,
    pub instance_roster_observer: Option<Arc<dyn InstanceRosterObserver>>,
}

impl GameLogProcessorDeps {
    fn set_game_log_snapshot(
        &self,
        snapshot: RuntimeSnapshot,
        output: &mut GameLogIngestOutput,
        origin: GameLogEventOrigin,
    ) {
        let publish_roster = output.instance_roster_changed;
        let current_instance_presence = publish_roster.then(|| {
            (
                snapshot.location.clone(),
                snapshot
                    .players
                    .iter()
                    .map(|player| player.user_id.clone())
                    .collect::<Vec<_>>(),
            )
        });
        let instance_roster_snapshot = if publish_roster {
            self.instance_roster_observer
                .as_ref()
                .map(|_| InstanceRosterSnapshot {
                    location: snapshot.location.clone(),
                    world_name: snapshot.world_name.clone(),
                    destination: snapshot.destination.clone(),
                    entered_at: snapshot.started_at.clone(),
                    departed_user_ids: match origin {
                        GameLogEventOrigin::Live => std::mem::take(&mut output.departed_user_ids),
                        GameLogEventOrigin::InitialScan => Vec::new(),
                    },
                    replayed_departed_user_ids: match origin {
                        GameLogEventOrigin::Live => {
                            std::mem::take(&mut output.replayed_departed_user_ids)
                        }
                        GameLogEventOrigin::InitialScan => {
                            let mut replayed =
                                std::mem::take(&mut output.replayed_departed_user_ids);
                            replayed.append(&mut output.departed_user_ids);
                            replayed
                        }
                    },
                    members: snapshot
                        .players
                        .iter()
                        .map(|player| InstanceRosterMember {
                            user_id: player.user_id.clone(),
                            display_name: player.display_name.clone(),
                            joined_at_ms: player.join_time_ms,
                        })
                        .collect(),
                })
        } else {
            None
        };
        self.snapshot.replace(snapshot);
        if let Some((current_location, current_player_user_ids)) = current_instance_presence {
            self.overlay_activity
                .set_current_instance_presence(&current_location, current_player_user_ids);
        }
        if let (Some(observer), Some(snapshot)) =
            (&self.instance_roster_observer, instance_roster_snapshot)
        {
            observer.on_instance_roster(snapshot);
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ReplayCheckpoint {
    cursor: crate::GameLogScanCursor,
    state: super::runtime_state::GameLogRuntimeState,
    replayed_departures: Vec<String>,
}

struct PendingGameLogWrite {
    owner_user_id: OwnerId,
    output: GameLogIngestOutput,
}

#[derive(Clone)]
pub struct GameLogProcessor {
    deps: GameLogProcessorDeps,
    engine: Arc<Mutex<GameLogIngestEngine>>,
    media_queue: InstanceMediaQueue,
    persistence_resume_after_ms: Arc<AtomicI64>,
    stop_requested: Arc<AtomicBool>,
    scan_cursor: Arc<Mutex<Option<crate::GameLogScanCursor>>>,
    replayed_departures: Arc<Mutex<Vec<String>>>,
    pending_write: Arc<Mutex<Option<PendingGameLogWrite>>>,
}

impl GameLogProcessor {
    pub fn new(deps: GameLogProcessorDeps) -> Self {
        let mut engine = GameLogIngestEngine::default();
        let checkpoint = match deps.store.get_string("gameLogReplayCheckpoint", "") {
            Ok(value) if value.is_empty() => None,
            Ok(value) => {
                match serde_json::from_str::<ReplayCheckpoint>(&value) {
                    Ok(checkpoint) => Some(checkpoint),
                    Err(error) => {
                        tracing::warn!("invalid GameLog replay checkpoint; rebuilding the current log: {error}");
                        None
                    }
                }
            }
            Err(error) => {
                tracing::warn!("failed to load GameLog replay checkpoint: {error}");
                None
            }
        };
        let mut scan_cursor = None;
        let mut replayed_departures = Vec::new();
        if !deps
            .store
            .get_bool("gameLogDisabled", false)
            .unwrap_or(false)
        {
            if let Some(checkpoint) = checkpoint {
                engine.restore_state(checkpoint.state);
                replayed_departures = checkpoint.replayed_departures;
                scan_cursor = Some(checkpoint.cursor);
            }
        }
        Self {
            stop_requested: Arc::new(AtomicBool::new(false)),
            pending_write: Arc::new(Mutex::new(None)),
            scan_cursor: Arc::new(Mutex::new(scan_cursor)),
            replayed_departures: Arc::new(Mutex::new(replayed_departures)),
            deps,
            engine: Arc::new(Mutex::new(engine)),
            media_queue: InstanceMediaQueue::new(),
            persistence_resume_after_ms: Arc::new(AtomicI64::new(i64::MIN)),
        }
    }

    pub fn request_stop(&self) {
        if !self.stop_requested.swap(true, Ordering::AcqRel) {
            let mut snapshot = (*self.deps.snapshot.snapshot()).clone();
            snapshot.ready = false;
            self.deps.snapshot.replace(snapshot);
        }
    }

    pub fn replay_cursor(&self) -> Option<crate::GameLogScanCursor> {
        self.scan_cursor
            .lock()
            .ok()
            .and_then(|cursor| cursor.clone())
    }

    pub fn set_persistence_resume_after(&self, resume_after: &str) {
        self.persistence_resume_after_ms.store(
            crate::game_log::parse_event_time_ms(resume_after).unwrap_or(i64::MIN),
            Ordering::Release,
        );
    }

    pub fn handle_jobs(&self, jobs: Vec<GameLogWorkerJob>) -> Result<()> {
        let mut pending_events = Vec::new();
        let mut pending_origin = GameLogEventOrigin::Live;
        let mut first_error = None;
        for job in jobs {
            if self.stop_requested.load(Ordering::Acquire) {
                return Err(Error::Custom("GameLog processing stopped".into()));
            }
            match job {
                GameLogWorkerJob::RetryWrite(completed) => {
                    let result = self.flush_pending_write();
                    let _ =
                        completed.send(result.as_ref().map(|_| ()).map_err(ToString::to_string));
                    result?;
                }
                GameLogWorkerJob::ResetReplay(completed) => {
                    self.ingest_events_now(&pending_events, pending_origin)?;
                    pending_events.clear();
                    *self
                        .pending_write
                        .lock()
                        .map_err(|error| Error::Custom(error.to_string()))? = None;
                    *self
                        .scan_cursor
                        .lock()
                        .map_err(|error| Error::Custom(error.to_string()))? = None;
                    self.with_engine(|engine| engine.start_log_file())?;
                    self.deps.snapshot.replace(RuntimeSnapshot::default());
                    self.replayed_departures
                        .lock()
                        .map_err(|error| Error::Custom(error.to_string()))?
                        .clear();
                    let _ = completed.send(());
                }
                GameLogWorkerJob::Events { events, origin } => {
                    self.ingest_events_now(&pending_events, pending_origin)?;
                    pending_events.clear();
                    self.ingest_events_now(&events, origin)?;
                }
                GameLogWorkerJob::Scan {
                    events,
                    origin,
                    cursor,
                    publish,
                    completed,
                } => {
                    self.ingest_events_now(&pending_events, pending_origin)?;
                    pending_events.clear();
                    let result =
                        self.ingest_events_with_cursor(&events, origin, Some((*cursor, publish)));
                    if let Some(completed) = completed {
                        let _ = completed
                            .send(result.as_ref().map(|_| ()).map_err(ToString::to_string));
                    }
                    result?;
                }
                #[cfg(test)]
                GameLogWorkerJob::Event(event) => {
                    if pending_origin != GameLogEventOrigin::Live {
                        if let Err(error) = self.ingest_events_now(&pending_events, pending_origin)
                        {
                            remember_error(&mut first_error, error);
                        }
                        pending_events.clear();
                        pending_origin = GameLogEventOrigin::Live;
                    }
                    pending_events.push(event);
                }
                #[cfg(test)]
                GameLogWorkerJob::InitialEvent(event) => {
                    if pending_origin != GameLogEventOrigin::InitialScan
                        && !pending_events.is_empty()
                    {
                        if let Err(error) = self.ingest_events_now(&pending_events, pending_origin)
                        {
                            remember_error(&mut first_error, error);
                        }
                        pending_events.clear();
                    }
                    pending_origin = GameLogEventOrigin::InitialScan;
                    pending_events.push(event);
                }
                GameLogWorkerJob::Process(event) => {
                    if let Err(error) = self.ingest_events_now(&pending_events, pending_origin) {
                        remember_error(&mut first_error, error);
                    }
                    pending_events.clear();
                    pending_origin = GameLogEventOrigin::Live;
                    if let Err(error) = self.handle_game_process_event_now(event) {
                        remember_error(&mut first_error, error);
                    }
                }
            }
        }
        if let Err(error) = self.ingest_events_now(&pending_events, pending_origin) {
            remember_error(&mut first_error, error);
        }
        first_error.map_or(Ok(()), Err)
    }

    fn side_effect_deps(&self) -> GameLogSideEffectDeps {
        GameLogSideEffectDeps::new(&self.deps, self.media_queue.clone())
    }

    fn ingest_events_now(&self, events: &[GameLogEvent], origin: GameLogEventOrigin) -> Result<()> {
        self.ingest_events_with_cursor(events, origin, None)
    }

    fn ingest_events_with_cursor(
        &self,
        events: &[GameLogEvent],
        origin: GameLogEventOrigin,
        scan: Option<(crate::GameLogScanCursor, bool)>,
    ) -> Result<()> {
        if events.is_empty() && scan.is_none() {
            return Ok(());
        }
        self.flush_pending_write()?;
        if let Some((cursor, publish)) = &scan {
            if self.replay_cursor().is_some_and(|previous| {
                previous.file_name == cursor.file_name
                    && previous.file_created_at == cursor.file_created_at
                    && previous.start_position == cursor.start_position
                    && previous.context.position == cursor.context.position
            }) {
                if *publish {
                    let snapshot = self.with_engine(|engine| engine.runtime_snapshot())?;
                    let mut output = GameLogIngestOutput::default();
                    self.publish_scan_snapshot(snapshot, &mut output, origin)?;
                    if let Some(projection) = output.projection {
                        self.deps.event_bus.emit_game_log_projection(projection);
                    }
                }
                return Ok(());
            }
        }
        let persistence_disabled = self.deps.store.get_bool("gameLogDisabled", false)?;
        if let Some((cursor, _)) = &scan {
            if self.replay_cursor().as_ref().is_none_or(|previous| {
                previous.file_name != cursor.file_name
                    || (cursor.start_position == 0 && previous.context.position != 0)
            }) {
                self.with_engine(|engine| engine.start_log_file())?;
                self.replayed_departures
                    .lock()
                    .map_err(|error| Error::Custom(error.to_string()))?
                    .clear();
            }
            if !persistence_disabled && self.replay_cursor().is_none() {
                let mut initial = cursor.clone();
                initial.context = crate::game_log_parser::LogContext::new();
                initial.start_position = 0;
                let batch = GameLogWriteBatch {
                    replay_checkpoint: Some(serde_json::to_string(&ReplayCheckpoint {
                        cursor: initial,
                        replayed_departures: Vec::new(),
                        state: self.with_engine(|engine| engine.checkpoint_state())?,
                    })?),
                    ..Default::default()
                };
                self.write_batch_or_emit_failure_telemetry(
                    &OwnerId::new(self.deps.auth_scope.snapshot().current_user_id),
                    &batch,
                    0,
                )?;
            }
        }
        let log_resource_load = self.deps.store.get_bool("logResourceLoad", false)?;
        let cutoff = scan
            .as_ref()
            .and_then(|(cursor, _)| super::parse_event_time_ms(&cursor.cutoff))
            .unwrap_or(i64::MIN)
            .max(self.persistence_resume_after_ms.load(Ordering::Acquire));
        let (mut output, snapshot, mut replayed_departures) = self.with_engine(|engine| {
            let mut output = GameLogIngestOutput::default();
            let mut replayed_departures = Vec::new();
            let mut remaining = events;
            let mut projection = None;
            while let Some(first) = remaining.first() {
                let replay = !persistence_disabled
                    && super::parse_event_time_ms(&first.created_at)
                        .is_some_and(|time| time <= cutoff);
                let count = remaining
                    .iter()
                    .take_while(|event| {
                        (!persistence_disabled
                            && super::parse_event_time_ms(&event.created_at)
                                .is_some_and(|time| time <= cutoff))
                            == replay
                    })
                    .count();
                let mut next = engine.ingest_events(
                    &remaining[..count],
                    GameLogIngestOptions { log_resource_load },
                );
                projection = next.projection.take();
                if replay {
                    replayed_departures.append(&mut next.departed_user_ids);
                } else {
                    output.append(next);
                }
                remaining = &remaining[count..];
            }
            output.projection = projection;
            (output, engine.runtime_snapshot(), replayed_departures)
        })?;
        let only_replay = scan.is_none() && output.input_count == 0;
        if scan.is_some() && origin == GameLogEventOrigin::InitialScan {
            let mut pending = self
                .replayed_departures
                .lock()
                .map_err(|error| Error::Custom(error.to_string()))?;
            pending.append(&mut replayed_departures);
            pending.append(&mut output.departed_user_ids);
            pending.sort();
            pending.dedup();
        }
        let publish = scan.as_ref().is_none_or(|(_, publish)| *publish);
        if let Some((cursor, _)) = scan {
            *self
                .scan_cursor
                .lock()
                .map_err(|error| Error::Custom(error.to_string()))? = Some(cursor);
        }
        if publish {
            output
                .replayed_departed_user_ids
                .extend(replayed_departures);
            self.publish_scan_snapshot(snapshot, &mut output, origin)?;
        } else {
            output.projection = None;
        }
        if only_replay {
            return self.apply_without_core_persistence(output, GameLogEventOrigin::InitialScan);
        }
        if persistence_disabled {
            return self.apply_without_core_persistence(output, origin);
        }
        self.apply_ingest_output(
            self.side_effect_deps(),
            output,
            origin == GameLogEventOrigin::Live,
            !events.is_empty(),
        )
    }

    fn publish_scan_snapshot(
        &self,
        snapshot: RuntimeSnapshot,
        output: &mut GameLogIngestOutput,
        origin: GameLogEventOrigin,
    ) -> Result<()> {
        let changed = snapshot != *self.deps.snapshot.snapshot();
        output.instance_roster_changed |= changed;
        output.replayed_departed_user_ids.append(
            &mut *self
                .replayed_departures
                .lock()
                .map_err(|error| Error::Custom(error.to_string()))?,
        );
        output.instance_roster_changed |= !output.replayed_departed_user_ids.is_empty();
        if output.projection.is_none() && changed {
            output.projection = Some(self.with_engine(|engine| {
                engine.checkpoint_state().projection("", "replay-complete")
            })?);
        }
        self.deps.set_game_log_snapshot(snapshot, output, origin);
        Ok(())
    }

    fn handle_game_process_event_now(&self, event: GameLogProcessEvent) -> Result<()> {
        let before_resume_cutoff = self.is_before_resume_cutoff(&event.changed_at);
        let (mut output, snapshot) = self.with_engine(|engine| {
            let output = engine.handle_process_event(event);
            (output, engine.runtime_snapshot())
        })?;
        if self.deps.snapshot.snapshot().ready {
            self.deps
                .set_game_log_snapshot(snapshot, &mut output, GameLogEventOrigin::Live);
        } else {
            output.projection = None;
        }
        if self.deps.store.get_bool("gameLogDisabled", false)? || before_resume_cutoff {
            return self.apply_without_core_persistence(output, GameLogEventOrigin::Live);
        }
        self.apply_ingest_output(self.side_effect_deps(), output, true, true)
    }

    fn apply_without_core_persistence(
        &self,
        mut output: GameLogIngestOutput,
        origin: GameLogEventOrigin,
    ) -> Result<()> {
        if origin == GameLogEventOrigin::InitialScan {
            if let Some(projection) = output.projection {
                self.deps.event_bus.emit_game_log_projection(projection);
            }
            return Ok(());
        }

        self.enrich_ingest_output_world_names(&mut output);
        self.ingest_overlay_activity(&output);
        if let Some(projection) = output.projection {
            self.deps.event_bus.emit_game_log_projection(projection);
        }
        let deps = self.side_effect_deps();
        for side_effect in output.side_effects {
            dispatch_side_effect(deps.clone(), side_effect, true);
        }
        Ok(())
    }

    fn apply_ingest_output(
        &self,
        deps: GameLogSideEffectDeps,
        mut output: GameLogIngestOutput,
        deliver_activity: bool,
        consumed_events: bool,
    ) -> Result<()> {
        self.enrich_ingest_output_world_names(&mut output);
        if consumed_events || !output.batch.is_empty() {
            if let Some(cursor) = self.replay_cursor() {
                output.batch.replay_checkpoint = Some(serde_json::to_string(&ReplayCheckpoint {
                    cursor,
                    replayed_departures: self
                        .replayed_departures
                        .lock()
                        .map_err(|error| Error::Custom(error.to_string()))?
                        .clone(),
                    state: self.with_engine(|engine| engine.checkpoint_state())?,
                })?);
            }
        }
        if let Some(projection) = output.projection.take() {
            self.deps.event_bus.emit_game_log_projection(projection);
        }
        let side_effects = std::mem::take(&mut output.side_effects);
        if deliver_activity {
            self.ingest_overlay_activity(&output);
        }
        let has_write = !output.batch.is_empty();
        {
            let mut pending = self
                .pending_write
                .lock()
                .map_err(|error| Error::Custom(error.to_string()))?;
            if let Some(pending) = pending.as_mut() {
                if let Some(checkpoint) = output.batch.replay_checkpoint.take() {
                    pending.output.batch.replay_checkpoint = Some(checkpoint);
                }
                pending.output.append(output);
            } else if has_write {
                *pending = Some(PendingGameLogWrite {
                    owner_user_id: OwnerId::new(deps.auth_identity.user_id.clone()),
                    output,
                });
            }
        }
        let result = self.flush_pending_write();
        for side_effect in side_effects {
            dispatch_side_effect(deps.clone(), side_effect, deliver_activity);
        }
        result
    }

    fn flush_pending_write(&self) -> Result<()> {
        let mut slot = self
            .pending_write
            .lock()
            .map_err(|error| Error::Custom(error.to_string()))?;
        let Some(pending) = slot.as_ref() else {
            return Ok(());
        };
        let affected_count = self.write_batch_or_emit_failure_telemetry(
            &pending.owner_user_id,
            &pending.output.batch,
            pending.output.input_count,
        )?;
        let pending = slot.take().expect("pending GameLog write");
        self.deps
            .backend_status
            .publish_game_log_persisted(affected_count);
        for row in pending.output.runtime_persisted_mirrors {
            self.deps
                .event_bus
                .emit_runtime_game_log_event(RuntimeGameLogEventPayload {
                    runtime_persisted: true,
                    raw: row,
                });
        }
        Ok(())
    }

    fn ingest_overlay_activity(&self, output: &GameLogIngestOutput) {
        let Ok(snapshot) = self.with_engine(|engine| engine.runtime_snapshot()) else {
            return;
        };
        let current_location = snapshot.location.clone();
        let current_started_at = snapshot.started_at.clone();
        let current_user_id = self.deps.auth_scope.snapshot().current_user_id;
        let context = OverlayJoinLeaveSuppressionContext::from_output(
            output,
            current_location,
            current_started_at,
        );
        self.deps
            .overlay_activity
            .ingest_game_log_output_with_join_leave_filter(output, |entry| {
                should_deliver_join_leave_overlay_activity(entry, &context, &current_user_id)
            });
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
        owner_user_id: &OwnerId,
        batch: &GameLogWriteBatch,
        attempted_row_count: usize,
    ) -> Result<u64> {
        match write_batch_with_retry(self.deps.store.as_ref(), owner_user_id, batch) {
            Ok(affected_count) => {
                self.deps.sync.record(
                    "gameLog",
                    RuntimeOperationStatus::Persisted,
                    "GameLog batch persisted by Rust.",
                    0,
                );
                Ok(affected_count)
            }
            Err(error) => {
                let message = error.to_string();
                self.deps.sync.record_failure("gameLog", &message);
                self.deps.event_bus.emit_game_log_persistence_fallback(
                    GameLogPersistenceFallbackPayload {
                        attempted_row_count: u32::try_from(attempted_row_count).unwrap_or(u32::MAX),
                        error: message.clone(),
                    },
                );
                tracing::warn!(
                    "GameLog batch write failed after retries; frontend fallback writes are disabled: {message}"
                );
                Err(error)
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

    fn is_before_resume_cutoff(&self, created_at: &str) -> bool {
        let resume_after_ms = self.persistence_resume_after_ms.load(Ordering::Acquire);
        resume_after_ms != i64::MIN
            && crate::game_log::parse_event_time_ms(created_at)
                .is_some_and(|created_at_ms| created_at_ms <= resume_after_ms)
    }
}

struct OverlayJoinLeaveSuppressionContext<'a> {
    current_location: String,
    current_started_at: String,
    location_started_at_by_location: HashMap<&'a str, &'a str>,
    destination_started_at: &'a [String],
}

impl<'a> OverlayJoinLeaveSuppressionContext<'a> {
    fn from_output(
        output: &'a GameLogIngestOutput,
        current_location: String,
        current_started_at: String,
    ) -> Self {
        let location_started_at_by_location = output
            .batch
            .locations
            .iter()
            .map(|entry| (entry.location.as_str(), entry.created_at.as_str()))
            .collect();

        Self {
            current_location,
            current_started_at,
            location_started_at_by_location,
            destination_started_at: &output.destination_started_at,
        }
    }

    fn join_reference_at(&self, location: &str) -> Option<&str> {
        self.location_started_at_by_location
            .get(location)
            .copied()
            .or_else(|| {
                (self.current_location == location).then_some(self.current_started_at.as_str())
            })
    }

    fn is_within_leave_suppression_window(&self, created_at: &str) -> bool {
        self.destination_started_at
            .iter()
            .map(String::as_str)
            .chain(
                (self.current_location == "traveling").then_some(self.current_started_at.as_str()),
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
    entry: &GameLogJoinLeaveEntry,
    context: &OverlayJoinLeaveSuppressionContext<'_>,
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

fn write_batch_with_retry(
    store: &dyn crate::GameStateStore,
    owner_user_id: &OwnerId,
    batch: &GameLogWriteBatch,
) -> Result<u64> {
    let mut delays = GAME_LOG_WRITE_RETRY_DELAYS_MS.iter();
    loop {
        match store.write_game_log(owner_user_id, batch) {
            Ok(affected_count) => return Ok(affected_count),
            Err(error) => {
                let Some(delay_ms) = delays.next() else {
                    return Err(error);
                };
                tracing::warn!("GameLog batch write failed, retrying in {delay_ms}ms: {error}");
                std::thread::sleep(Duration::from_millis(*delay_ms));
            }
        }
    }
}

#[cfg(test)]
mod tests;
