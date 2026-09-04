use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GameLogWriteOutcome {
    RuntimePersisted { affected_count: u64 },
    PersistenceFailed,
}

#[derive(Clone)]
pub enum GameLogWorkerJob {
    Event(GameLogEvent),
    InitialEvent(GameLogEvent),
    Process(GameLogProcessEvent),
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

#[derive(Clone)]
pub struct GameLogProcessor {
    deps: GameLogProcessorDeps,
    engine: Arc<Mutex<GameLogIngestEngine>>,
    media_queue: InstanceMediaQueue,
    persistence_resume_after_ms: Arc<AtomicI64>,
}

impl GameLogProcessor {
    pub fn new(deps: GameLogProcessorDeps) -> Self {
        let mut engine = GameLogIngestEngine::default();
        if deps.store.game_log_location_table_exists().unwrap_or(false) {
            if let Some(last) = deps.store.last_game_log_location().ok().flatten() {
                let location = last.location.clone();
                let started_at = last.created_at.clone();
                engine.seed_current_location(last.location, last.world_name, last.created_at);
                if location.starts_with("wrld_") {
                    if let Ok(entries) = deps.store.join_leave_for_location_unscoped(
                        &location,
                        &started_at,
                        "9999-12-31T23:59:59Z",
                    ) {
                        engine.seed_current_roster(&entries);
                    }
                }
            }
        }
        Self {
            deps,
            engine: Arc::new(Mutex::new(engine)),
            media_queue: InstanceMediaQueue::new(),
            persistence_resume_after_ms: Arc::new(AtomicI64::new(i64::MIN)),
        }
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
            match job {
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
        if events.is_empty() {
            return Ok(());
        }

        let persistence_disabled = self.deps.store.get_bool("gameLogDisabled", false)?;
        let log_resource_load = self.deps.store.get_bool("logResourceLoad", false)?;
        let resume_prefix_len = if persistence_disabled {
            0
        } else {
            self.resume_cutoff_prefix_len(events)
        };
        let events = if resume_prefix_len > 0 {
            let (mut output, snapshot) = self.with_engine(|engine| {
                let output = engine.ingest_events(
                    &events[..resume_prefix_len],
                    GameLogIngestOptions { log_resource_load },
                );
                (output, engine.runtime_snapshot())
            })?;
            self.deps
                .set_game_log_snapshot(snapshot, &mut output, GameLogEventOrigin::InitialScan);
            self.apply_without_core_persistence(output, origin)?;
            if resume_prefix_len == events.len() {
                return Ok(());
            }
            &events[resume_prefix_len..]
        } else {
            events
        };
        let (mut output, snapshot) = self.with_engine(|engine| {
            let output = engine.ingest_events(events, GameLogIngestOptions { log_resource_load });
            (output, engine.runtime_snapshot())
        })?;
        self.deps
            .set_game_log_snapshot(snapshot, &mut output, origin);
        if persistence_disabled {
            return self.apply_without_core_persistence(output, origin);
        }
        self.apply_ingest_output(self.side_effect_deps(), output)
    }

    fn handle_game_process_event_now(&self, event: GameLogProcessEvent) -> Result<()> {
        let before_resume_cutoff = self.is_before_resume_cutoff(&event.changed_at);
        let (mut output, snapshot) = self.with_engine(|engine| {
            let output = engine.handle_process_event(event);
            (output, engine.runtime_snapshot())
        })?;
        self.deps
            .set_game_log_snapshot(snapshot, &mut output, GameLogEventOrigin::Live);
        if self.deps.store.get_bool("gameLogDisabled", false)? || before_resume_cutoff {
            return self.apply_without_core_persistence(output, GameLogEventOrigin::Live);
        }
        self.apply_ingest_output(self.side_effect_deps(), output)
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
            dispatch_side_effect(deps.clone(), side_effect);
        }
        Ok(())
    }

    fn apply_ingest_output(
        &self,
        deps: GameLogSideEffectDeps,
        mut output: GameLogIngestOutput,
    ) -> Result<()> {
        self.enrich_ingest_output_world_names(&mut output);
        let write_outcome = self.write_batch_or_emit_failure_telemetry(
            &OwnerId::new(deps.auth_identity.user_id.clone()),
            &output.batch,
            output.input_count,
        )?;
        if let GameLogWriteOutcome::RuntimePersisted { affected_count } = write_outcome {
            self.ingest_overlay_activity(&output);
            self.deps
                .backend_status
                .publish_game_log_persisted(affected_count);
            if let Some(projection) = output.projection {
                self.deps.event_bus.emit_game_log_projection(projection);
            }
            for row in output.runtime_persisted_mirrors {
                self.deps
                    .event_bus
                    .emit_runtime_game_log_event(RuntimeGameLogEventPayload {
                        runtime_persisted: true,
                        raw: row,
                    });
            }
        }
        for side_effect in output.side_effects {
            dispatch_side_effect(deps.clone(), side_effect);
        }
        Ok(())
    }

    fn ingest_overlay_activity(&self, output: &GameLogIngestOutput) {
        let snapshot = self.deps.snapshot.snapshot();
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
    ) -> Result<GameLogWriteOutcome> {
        match write_batch_with_retry(self.deps.store.as_ref(), owner_user_id, batch) {
            Ok(affected_count) => {
                self.deps.sync.record(
                    "gameLog",
                    RuntimeOperationStatus::Persisted,
                    "GameLog batch persisted by Rust.",
                    0,
                );
                Ok(GameLogWriteOutcome::RuntimePersisted { affected_count })
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

    fn resume_cutoff_prefix_len(&self, events: &[GameLogEvent]) -> usize {
        let resume_after_ms = self.persistence_resume_after_ms.load(Ordering::Acquire);
        if resume_after_ms == i64::MIN {
            return 0;
        }
        events
            .iter()
            .take_while(|event| {
                crate::game_log::parse_event_time_ms(&event.created_at)
                    .is_some_and(|created_at_ms| created_at_ms <= resume_after_ms)
            })
            .count()
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
