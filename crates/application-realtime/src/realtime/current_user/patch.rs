use serde_json::{Map, Value};
use vrcx_0_core::derived_keys;
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::presence::is_offline_location_proof;
use vrcx_0_core::text::first_owned;

use crate::realtime::runtime_types::PENDING_OFFLINE_DELAY_MS;
use crate::realtime::{RealtimeCurrentUserOutput, RealtimeCurrentUserProjection};
use vrcx_0_application_core::LocalGameContextSnapshot;

use super::avatar::{apply_avatar_wear_transition, insert_avatar_swap_time};
use super::game_log::{
    close_remote_game_log_interval, local_game_location_patch, reconcile_remote_game_log_interval,
};
use super::location::{build_location_patch, location_game_state_patch};
use super::presence::current_user_presence;
use super::self_profile::append_self_profile_observations;
use super::state::{
    CurrentUserPatchOptions, PendingCurrentUserOffline, RealtimeCurrentUserState,
    RealtimeCurrentUserStateSnapshot, CURRENT_USER_REMOTE_PRESENCE_FIELDS,
};
use super::utils::has_remote_current_user_presence;
use crate::realtime::event_time::EventTime;
use vrcx_0_core::friends::normalize_user_id;
use vrcx_0_core::OwnerId;

pub(super) fn apply_user_update(
    state: &mut RealtimeCurrentUserState,
    content: &Value,
    now: &EventTime,
    game: &LocalGameContextSnapshot,
) -> Option<RealtimeCurrentUserOutput> {
    let mut patch = content
        .get("user")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    patch.remove("state");
    let event_user_id = first_owned([patch.text_field("id"), content.text_field("userId")]);
    if event_user_id != state.current_user_id {
        return None;
    }
    if patch.is_empty() {
        return None;
    }
    apply_current_user_patch(state, patch, now, game, CurrentUserPatchOptions::default())
}

pub(super) fn apply_user_location(
    state: &mut RealtimeCurrentUserState,
    content: &Value,
    now: &EventTime,
    game: &LocalGameContextSnapshot,
) -> Option<RealtimeCurrentUserOutput> {
    let event_user_id = normalize_user_id(&content.text_field("userId"));
    if event_user_id != state.current_user_id {
        return None;
    }
    let patch = build_location_patch(
        content.get("location"),
        content.get("travelingToLocation"),
        content.get("worldId"),
    );
    if game.is_game_running() {
        state.pending_offline = None;
        return apply_current_user_patch(
            state,
            patch,
            now,
            game,
            CurrentUserPatchOptions::default(),
        );
    }
    if is_offline_location_proof(&patch.text_field("location"))
        && has_remote_current_user_presence(&state.remote_snapshot)
        && !state.remote_location_from_local_game
    {
        if state.pending_offline.is_some() {
            return None;
        }
        let deadline_ms = now.timestamp_ms + PENDING_OFFLINE_DELAY_MS;
        state.pending_offline = Some(PendingCurrentUserOffline { deadline_ms, patch });
        return apply_current_user_patch(
            state,
            Map::new(),
            now,
            game,
            CurrentUserPatchOptions {
                wake_at_ms: Some(deadline_ms),
                ..CurrentUserPatchOptions::default()
            },
        );
    }
    state.pending_offline = None;
    state.remote_location_from_local_game = false;
    apply_current_user_patch(
        state,
        patch,
        now,
        game,
        CurrentUserPatchOptions {
            reconciles_remote_location: true,
            records_remote_game_log: true,
            ..CurrentUserPatchOptions::default()
        },
    )
}

pub(super) fn apply_current_user_patch(
    state: &mut RealtimeCurrentUserState,
    patch: Map<String, Value>,
    now: &EventTime,
    game: &LocalGameContextSnapshot,
    options: CurrentUserPatchOptions,
) -> Option<RealtimeCurrentUserOutput> {
    let previous = state.snapshot.clone();
    let mut projection_patch = patch.clone();
    let mut remote_merged = state.remote_snapshot.to_map();
    for (key, value) in &patch {
        remote_merged.insert(key.clone(), value.clone());
    }
    remote_merged.insert("id".into(), Value::String(state.current_user_id.clone()));
    state.remote_snapshot =
        RealtimeCurrentUserStateSnapshot::from_map(remote_merged, &state.current_user_id);

    let mut merged = if game.is_game_running() {
        let mut local_merged = previous.to_map();
        for (key, value) in &patch {
            local_merged.insert(key.clone(), value.clone());
        }
        local_merged
    } else {
        state.remote_snapshot.to_map()
    };
    if game.is_game_running() {
        if let Some(local_patch) = local_game_location_patch(game) {
            for (key, value) in &local_patch {
                merged.insert(key.clone(), value.clone());
                projection_patch.insert(key.clone(), value.clone());
            }
        }
    }
    merged.insert("id".into(), Value::String(state.current_user_id.clone()));
    for key in ["state", "stateBucket", "pendingOffline"] {
        merged.remove(key);
    }
    projection_patch.insert("id".into(), Value::String(state.current_user_id.clone()));
    let (snapshot, mut persistence) = apply_avatar_wear_transition(
        RealtimeCurrentUserStateSnapshot::from_map(merged, &state.current_user_id),
        &previous,
        game,
        now,
        options.records_current_avatar_history,
        state.avatar_wear_checkpoint_ms,
    );
    if snapshot.previous_avatar_swap_time != previous.previous_avatar_swap_time {
        state.avatar_wear_checkpoint_ms = 0;
    }
    append_self_profile_observations(&patch, now, &mut persistence);
    if !game.is_game_running() && options.reconciles_remote_location {
        copy_current_user_presence_patch(&snapshot, &mut projection_patch);
    }

    if game.is_game_running() {
        state.remote_location_from_local_game = true;
        close_remote_game_log_interval(state, now, &mut persistence);
    } else if options.records_remote_game_log {
        reconcile_remote_game_log_interval(
            state,
            &snapshot,
            now,
            game.is_available(),
            &mut persistence,
        );
    }

    let writes_location_game_state =
        game.is_available() && options.reconciles_remote_location && !game.is_game_running();
    let game_state_patch = if writes_location_game_state {
        Some(location_game_state_patch(&snapshot, now))
    } else {
        None
    };

    insert_avatar_swap_time(&snapshot, &mut projection_patch);
    let mut snapshot_map = snapshot.to_map();
    state.sequence = state.sequence.saturating_add(1);
    state.snapshot = snapshot;
    insert_presence(state, game, &mut projection_patch, &mut snapshot_map);
    Some(RealtimeCurrentUserOutput {
        owner_user_id: OwnerId::new(state.current_user_id.clone()),
        projection: RealtimeCurrentUserProjection {
            generation: state.generation,
            patch: projection_patch.into(),
            game_state_patch: game_state_patch.map(Into::into),
        },
        snapshot: snapshot_map.into(),
        persistence,
        wake_at_ms: options.wake_at_ms,
    })
}

pub(super) fn insert_presence(
    state: &mut RealtimeCurrentUserState,
    game: &LocalGameContextSnapshot,
    projection_patch: &mut Map<String, Value>,
    snapshot_map: &mut Map<String, Value>,
) {
    let presence = current_user_presence(state, game);
    let value = serde_json::to_value(&presence).expect("PresenceView serializes to JSON");
    projection_patch.insert(derived_keys::PRESENCE.into(), value.clone());
    snapshot_map.insert(derived_keys::PRESENCE.into(), value);
    state.presence = Some(presence);
}

fn copy_current_user_presence_patch(
    snapshot: &RealtimeCurrentUserStateSnapshot,
    projection_patch: &mut Map<String, Value>,
) {
    let snapshot = snapshot.to_map();
    for field in CURRENT_USER_REMOTE_PRESENCE_FIELDS {
        if let Some(value) = snapshot.get(*field) {
            projection_patch.insert((*field).into(), value.clone());
        } else {
            projection_patch.remove(*field);
        }
    }
}

pub(super) fn merge_preserved_remote_presence(
    snapshot: RealtimeCurrentUserStateSnapshot,
    previous: &RealtimeCurrentUserStateSnapshot,
) -> RealtimeCurrentUserStateSnapshot {
    let current_user_id = snapshot.user_id.clone();
    let mut merged = snapshot.to_map();
    let previous = previous.to_map();
    for field in CURRENT_USER_REMOTE_PRESENCE_FIELDS {
        if let Some(value) = previous.get(*field) {
            merged.insert((*field).into(), value.clone());
        }
    }
    RealtimeCurrentUserStateSnapshot::from_map(merged, &current_user_id)
}
