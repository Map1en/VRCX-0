use std::sync::Mutex;

use serde_json::{json, Map, Value};
use vrcx_0_core::json::text_of;
use vrcx_0_core::realtime::RealtimeWsMessagePayload;

use crate::realtime::event_kind::RealtimeWsEventKind;
use crate::realtime::{RealtimeCurrentUserOutput, RealtimeCurrentUserProjection};
use vrcx_0_application_core::LocalGameContextSnapshot;

use super::avatar::{
    apply_avatar_wear_transition, checkpoint_avatar_wear, insert_avatar_swap_time,
};
use super::game_log::close_remote_game_log_interval;
use super::patch::{
    apply_current_user_patch, apply_user_location, apply_user_update, insert_presence,
    merge_preserved_remote_presence,
};
use super::presence::current_user_presence;
use super::state::{
    CurrentUserPatchOptions, RealtimeCurrentUserState, RealtimeCurrentUserStateSnapshot,
    CURRENT_USER_REFRESH_LOCAL_AUTHORITY_FIELDS,
};
use super::utils::{has_remote_current_user_presence, map_from_json};
use crate::realtime::event_time::EventTime;
use vrcx_0_contracts::realtime::{AvatarTimeSpentUpsert, RealtimePersistenceBatch};
use vrcx_0_core::friends::normalize_user_id;
use vrcx_0_core::OwnerId;

#[derive(Debug, Default)]
pub struct RealtimeCurrentUserRuntime {
    state: Mutex<RealtimeCurrentUserState>,
}

impl RealtimeCurrentUserRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_snapshot(
        &self,
        current_user_id: String,
        generation: u64,
        snapshot: serde_json::Value,
    ) {
        let mut state = self.lock_state();
        let current_user_id = normalize_user_id(&current_user_id);
        let preserves_remote_interval = state.current_user_id == current_user_id;
        state.current_user_id = current_user_id;
        state.generation = generation;
        let mut snapshot =
            RealtimeCurrentUserStateSnapshot::from_value(snapshot, &state.current_user_id);
        if preserves_remote_interval
            && state.remote_game_log_interval.is_some()
            && !has_remote_current_user_presence(&snapshot)
        {
            snapshot = merge_preserved_remote_presence(snapshot, &state.remote_snapshot);
        }
        state.sequence = state.sequence.saturating_add(1);
        state.snapshot = snapshot.clone();
        state.remote_snapshot = snapshot;
        state.pending_offline = None;
        state.presence = None;
        state.avatar_wear_checkpoint_ms = 0;
        if !preserves_remote_interval {
            state.remote_game_log_interval = None;
        }
    }

    pub fn clear(&self) {
        let mut state = self.lock_state();
        state.generation = state.generation.saturating_add(1);
        state.current_user_id.clear();
        state.snapshot = RealtimeCurrentUserStateSnapshot::default();
        state.remote_snapshot = RealtimeCurrentUserStateSnapshot::default();
        state.pending_offline = None;
        state.remote_game_log_interval = None;
        state.presence = None;
        state.avatar_wear_checkpoint_ms = 0;
    }

    pub fn checkpoint_avatar_wear(
        &self,
        generation: u64,
        game: LocalGameContextSnapshot,
    ) -> Option<(OwnerId, RealtimePersistenceBatch)> {
        let mut state = self.lock_state();
        if state.generation != generation || state.current_user_id.is_empty() {
            return None;
        }
        let now = EventTime::now();
        let upsert = checkpoint_avatar_wear(
            &state.snapshot,
            state.avatar_wear_checkpoint_ms,
            &game,
            &now,
        )?;
        state.avatar_wear_checkpoint_ms = now.timestamp_ms;
        Some((
            OwnerId::new(state.current_user_id.clone()),
            RealtimePersistenceBatch {
                avatar_time_spent_upserts: vec![upsert],
                ..RealtimePersistenceBatch::default()
            },
        ))
    }

    pub fn restore_avatar_wear_checkpoint(&self, generation: u64, unsaved: &AvatarTimeSpentUpsert) {
        let mut state = self.lock_state();
        if state.generation == generation && state.avatar_wear_checkpoint_ms == unsaved.ended_at_ms
        {
            state.avatar_wear_checkpoint_ms =
                unsaved.ended_at_ms.saturating_sub(unsaved.time_spent);
        }
    }

    pub fn snapshot_value(&self) -> Option<serde_json::Value> {
        let state = self.lock_state();
        if state.current_user_id.is_empty() {
            return None;
        }
        Some(serde_json::Value::Object(state.snapshot.to_map()))
    }

    #[cfg(test)]
    pub fn apply_ws_message(
        &self,
        generation: u64,
        payload: &RealtimeWsMessagePayload,
        game: LocalGameContextSnapshot,
    ) -> Option<RealtimeCurrentUserOutput> {
        let event_kind = RealtimeWsEventKind::from_payload(payload)?;
        self.apply_ws_event(generation, &event_kind, payload, game)
    }

    pub(crate) fn apply_ws_event(
        &self,
        generation: u64,
        event_kind: &RealtimeWsEventKind,
        payload: &RealtimeWsMessagePayload,
        game: LocalGameContextSnapshot,
    ) -> Option<RealtimeCurrentUserOutput> {
        let content = payload.json.get("content").unwrap_or(&Value::Null);
        let now = EventTime::from_received_at(&payload.received_at);
        let mut state = self.lock_state();
        if state.generation != generation || state.current_user_id.is_empty() {
            return None;
        }

        match event_kind {
            RealtimeWsEventKind::UserUpdate => apply_user_update(&mut state, content, &now, &game),
            RealtimeWsEventKind::UserLocation => {
                apply_user_location(&mut state, content, &now, &game)
            }
            _ => None,
        }
    }

    pub fn snapshot_sequence(&self, generation: u64) -> Option<u64> {
        let state = self.lock_state();
        if state.generation != generation || state.current_user_id.is_empty() {
            return None;
        }
        Some(state.sequence)
    }

    pub fn apply_refreshed_snapshot_if_sequence(
        &self,
        generation: u64,
        expected_sequence: u64,
        snapshot: serde_json::Value,
        overlay_patch: serde_json::Value,
        game: LocalGameContextSnapshot,
    ) -> Option<RealtimeCurrentUserOutput> {
        let mut state = self.lock_state();
        if state.generation != generation || state.current_user_id.is_empty() {
            return None;
        }
        if state.sequence != expected_sequence {
            return None;
        }
        let event_user_id = snapshot
            .get("id")
            .map(|value| normalize_user_id(&text_of(Some(value))))
            .unwrap_or_default();
        if event_user_id != state.current_user_id {
            return None;
        }
        let mut patch = snapshot.as_object().cloned().unwrap_or_default();
        for field in CURRENT_USER_REFRESH_LOCAL_AUTHORITY_FIELDS {
            patch.remove(*field);
        }
        if let Some(overlay) = overlay_patch.as_object() {
            for (key, value) in overlay {
                patch.insert(key.clone(), value.clone());
            }
        }
        apply_current_user_patch(
            &mut state,
            patch,
            &EventTime::now(),
            &game,
            CurrentUserPatchOptions::default(),
        )
    }

    pub fn apply_game_running_state(
        &self,
        generation: u64,
        game: LocalGameContextSnapshot,
    ) -> Option<RealtimeCurrentUserOutput> {
        if !game.is_available() {
            return None;
        }
        let mut state = self.lock_state();
        if state.generation != generation || state.current_user_id.is_empty() {
            return None;
        }
        if game.is_game_running() {
            state.pending_offline = None;
        }
        apply_current_user_patch(
            &mut state,
            Map::new(),
            &EventTime::now(),
            &game,
            CurrentUserPatchOptions {
                reconciles_remote_location: !game.is_game_running(),
                records_current_avatar_history: game.is_game_running(),
                ..CurrentUserPatchOptions::default()
            },
        )
    }

    pub fn refresh_local_presence(
        &self,
        generation: u64,
        game: LocalGameContextSnapshot,
    ) -> Option<RealtimeCurrentUserOutput> {
        let mut state = self.lock_state();
        if state.generation != generation || state.current_user_id.is_empty() {
            return None;
        }
        if state.presence.as_ref() == Some(&current_user_presence(&state, &game)) {
            return None;
        }
        apply_current_user_patch(
            &mut state,
            Map::new(),
            &EventTime::now(),
            &game,
            CurrentUserPatchOptions::default(),
        )
    }

    pub fn wake_pending_offline(
        &self,
        generation: u64,
        now: String,
        game: LocalGameContextSnapshot,
    ) -> Option<RealtimeCurrentUserOutput> {
        let mut state = self.lock_state();
        let now = EventTime::from_received_at(&now);
        if state.generation != generation
            || state.current_user_id.is_empty()
            || game.is_game_running()
            || !state
                .pending_offline
                .as_ref()
                .is_some_and(|pending| now.timestamp_ms >= pending.deadline_ms)
        {
            return None;
        }
        let pending = state.pending_offline.take()?;
        apply_current_user_patch(
            &mut state,
            pending.patch,
            &now,
            &game,
            CurrentUserPatchOptions {
                reconciles_remote_location: true,
                records_remote_game_log: true,
                ..CurrentUserPatchOptions::default()
            },
        )
    }

    pub fn interrupt_transport(
        &self,
        generation: u64,
        game: LocalGameContextSnapshot,
    ) -> Option<RealtimeCurrentUserOutput> {
        self.transport_end_output(generation, game, false)
    }

    pub fn finalize_transport(
        &self,
        generation: u64,
        game: LocalGameContextSnapshot,
    ) -> Option<RealtimeCurrentUserOutput> {
        self.transport_end_output(generation, game, true)
    }

    fn transport_end_output(
        &self,
        generation: u64,
        game: LocalGameContextSnapshot,
        ends_remote_interval: bool,
    ) -> Option<RealtimeCurrentUserOutput> {
        if !game.is_available() {
            return None;
        }
        let mut state = self.lock_state();
        if state.generation != generation || state.current_user_id.is_empty() {
            return None;
        }
        let previous = state.snapshot.clone();
        let now = EventTime::now();
        let stopped_game = game.clone().with_game_running(false);
        let (snapshot, mut persistence) = apply_avatar_wear_transition(
            previous.clone(),
            &previous,
            &stopped_game,
            &now,
            false,
            state.avatar_wear_checkpoint_ms,
        );
        state.avatar_wear_checkpoint_ms = 0;
        if ends_remote_interval {
            close_remote_game_log_interval(&mut state, &now, &mut persistence);
        }
        let previous_avatar_swap_time = snapshot.previous_avatar_swap_time;
        state.sequence = state.sequence.saturating_add(1);
        state.snapshot = snapshot.clone();
        state.remote_snapshot.set_previous_avatar_swap_time(
            (previous_avatar_swap_time > 0).then_some(previous_avatar_swap_time),
        );
        let mut patch = map_from_json(json!({ "id": state.current_user_id.clone() }));
        insert_avatar_swap_time(&snapshot, &mut patch);
        let mut snapshot_map = snapshot.to_map();
        insert_presence(&mut state, &game, &mut patch, &mut snapshot_map);
        Some(RealtimeCurrentUserOutput {
            owner_user_id: OwnerId::new(state.current_user_id.clone()),
            projection: RealtimeCurrentUserProjection {
                generation: state.generation,
                patch: patch.into(),
                game_state_patch: None,
            },
            snapshot: snapshot_map.into(),
            persistence,
            wake_at_ms: None,
        })
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, RealtimeCurrentUserState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}
