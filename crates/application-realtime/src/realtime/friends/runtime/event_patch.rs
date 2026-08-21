use std::sync::Arc;

use serde_json::{json, Value};
use vrcx_0_application_core::InstanceDwellRegistry;
use vrcx_0_core::derived_keys;
use vrcx_0_core::friends::{FriendRecord, StateBucket};
use vrcx_0_core::trust::{trust_level_changed, trust_level_differs};
use vrcx_0_persistence::realtime::FriendLogDelete;

use crate::realtime::event_kind::RealtimeWsEventKind;
use crate::realtime::{
    FriendStateBucketAuthority, PendingOfflineTimerAction, RealtimeFriendOutput,
};

use super::persistence::{
    add_profile_diff_feed_entries, friend_log_upsert, friend_relationship_feed_entry,
    gps_feed_entry, is_online_state, is_private_location, meaningful_name, meaningful_record_name,
    online_feed_entry, player_joining_feed_entry, trust_level_feed_entry, value_equal_for_diff,
    FriendChangedProps, FriendRelationshipFeedKind, OfflineFeedPrevious,
};
use super::state::{PendingOffline, RealtimeFriendState, PENDING_OFFLINE_DELAY_MS};
use super::utils::{first_owned, parse_location, EventTime, JsonExt};
use vrcx_0_persistence::OwnerId;

mod event_split;
mod patch_builders;
mod record_transition;

use event_split::{location_presence, profile_patch, EventSource};
#[cfg(test)]
use patch_builders::event_user_patch;
use patch_builders::{
    event_user_id, is_online_location_proof, normalize_friend_update_location_patch,
    normalize_patch_trust, offline_like_patch, online_patch, resolve_state_bucket,
    state_bucket_changed,
};
use record_transition::{apply_friend_patch, FriendRecordTransition};
pub(super) use record_transition::{record_string, record_value, FriendRecordPatch};

const GPS_REPEAT_WINDOW_MS: i64 = 5 * 60 * 1000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FriendEventKind {
    Add,
    Delete,
    Update,
    Online,
    Active,
    Offline,
    Location,
}

impl FriendEventKind {
    pub(super) fn from_ws_event_kind(event_kind: &RealtimeWsEventKind) -> Option<Self> {
        match event_kind {
            RealtimeWsEventKind::FriendAdd => Some(Self::Add),
            RealtimeWsEventKind::FriendDelete => Some(Self::Delete),
            RealtimeWsEventKind::FriendUpdate => Some(Self::Update),
            RealtimeWsEventKind::FriendOnline => Some(Self::Online),
            RealtimeWsEventKind::FriendActive => Some(Self::Active),
            RealtimeWsEventKind::FriendOffline => Some(Self::Offline),
            RealtimeWsEventKind::FriendLocation => Some(Self::Location),
            _ => None,
        }
    }
}

pub fn is_friend_event_type(message_type: &str) -> bool {
    RealtimeWsEventKind::from_name(message_type).is_friend()
}

pub(super) fn apply_friend_event(
    state: &mut RealtimeFriendState,
    event_kind: FriendEventKind,
    content: &Value,
    now: &EventTime,
) -> Option<RealtimeFriendOutput> {
    apply_friend_event_with_source(state, event_kind, content, now, EventSource::Websocket)
}

pub(super) fn apply_refetched_friend_profile_event(
    state: &mut RealtimeFriendState,
    content: &Value,
    now: &EventTime,
) -> Option<RealtimeFriendOutput> {
    apply_friend_event_with_source(
        state,
        FriendEventKind::Update,
        content,
        now,
        EventSource::ApiProfile,
    )
}

pub(super) fn apply_trusted_friend_add_event(
    state: &mut RealtimeFriendState,
    content: &Value,
    now: &EventTime,
) -> Option<RealtimeFriendOutput> {
    apply_friend_event_with_source(
        state,
        FriendEventKind::Add,
        content,
        now,
        EventSource::TrustedFriendAdd,
    )
}

fn apply_friend_event_with_source(
    state: &mut RealtimeFriendState,
    event_kind: FriendEventKind,
    content: &Value,
    now: &EventTime,
    source: EventSource,
) -> Option<RealtimeFriendOutput> {
    let baseline = state.baseline.as_ref()?;
    let owner_user_id = baseline.current_user_id.clone();
    let generation = baseline.generation;
    let baseline_revision = baseline.baseline_revision;
    let mut output =
        RealtimeFriendOutput::new(OwnerId::new(owner_user_id), generation, baseline_revision);

    match event_kind {
        FriendEventKind::Add => apply_add(state, &mut output, content, now, source)?,
        FriendEventKind::Delete => apply_delete(state, &mut output, content, now)?,
        FriendEventKind::Update => apply_update(state, &mut output, content, now, source)?,
        FriendEventKind::Online => apply_online(state, &mut output, content, now)?,
        FriendEventKind::Active | FriendEventKind::Offline => {
            let next_state = match event_kind {
                FriendEventKind::Active => StateBucket::Active.as_str(),
                FriendEventKind::Offline => StateBucket::Offline.as_str(),
                _ => unreachable!("matched active or offline event"),
            };
            apply_active_offline(state, &mut output, content, now, next_state)?
        }
        FriendEventKind::Location => apply_location(state, &mut output, content, now)?,
    }

    let mut feed_entries = output.persistence.feed_entries.clone();
    feed_entries.append(&mut output.projection.feed_entries);
    output.projection.feed_entries = feed_entries;
    if output.projection.patches.is_empty()
        && output.projection.removals.is_empty()
        && output.persistence.is_empty()
    {
        return None;
    }
    Some(output)
}

fn apply_add(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    content: &Value,
    now: &EventTime,
    source: EventSource,
) -> Option<()> {
    let user_id = event_user_id(content)?;
    let mut patch = profile_patch(content, &user_id);
    let previous = get_friend_record(state, &user_id);
    normalize_patch_trust(&mut patch, previous.as_ref());
    let state_bucket = resolve_state_bucket(
        content,
        previous.as_ref(),
        source.trusts_embedded_state(),
        StateBucket::Offline.as_str(),
    );
    let already_friend = previous.is_some();
    output.friend_note_changed |= patch_changes_note(&patch, previous.as_ref());
    apply_patch_to_state(
        state,
        output,
        &user_id,
        patch.clone(),
        &state_bucket,
        &now.iso,
    );
    if !already_friend {
        output
            .persistence
            .friend_log_upserts
            .push(friend_log_upsert(
                &user_id,
                &patch,
                previous.as_ref(),
                &state_bucket,
                &now.iso,
            ));
        output
            .persistence
            .feed_entries
            .push(friend_relationship_feed_entry(
                FriendRelationshipFeedKind::Friend,
                &user_id,
                &patch,
                previous.as_ref(),
                &now.iso,
            ));
        output.projection.friend_log_changed = true;
    }
    Some(())
}

fn apply_delete(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    content: &Value,
    now: &EventTime,
) -> Option<()> {
    let user_id = event_user_id(content)?;
    let previous = get_friend_record(state, &user_id);
    state.pending_offline.remove(&user_id);
    state.recent_gps.remove(&user_id);
    let friend_was_removed = state
        .baseline
        .as_mut()
        .and_then(|baseline| baseline.friends_by_id.remove(&user_id))
        .is_some();
    if friend_was_removed {
        state.invalidate_friend_user_ids_snapshot();
    }
    output.projection.removals.push(user_id.clone());
    output.persistence.friend_log_deletes.push(FriendLogDelete {
        target_user_id: user_id.clone(),
        created_at: now.iso.clone(),
    });
    if let Some(previous) = previous.as_ref() {
        let patch = json!({ "id": user_id.clone() });
        output
            .persistence
            .feed_entries
            .push(friend_relationship_feed_entry(
                FriendRelationshipFeedKind::Unfriend,
                &user_id,
                &patch,
                Some(previous),
                &now.iso,
            ));
    }
    output.projection.friend_log_changed = true;
    Some(())
}

fn apply_update(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    content: &Value,
    now: &EventTime,
    source: EventSource,
) -> Option<()> {
    let user_id = event_user_id(content)?;
    let mut patch = profile_patch(content, &user_id);
    if !source.trusts_embedded_state()
        && patch.as_object().map(|object| object.len()).unwrap_or(0) <= 1
    {
        return None;
    }
    let previous = get_friend_record(state, &user_id);
    normalize_patch_trust(&mut patch, previous.as_ref());
    let changes = FriendChangedProps::from_patch(&patch, previous.as_ref());
    let location_changed = changes.has("location");
    if location_changed {
        normalize_friend_update_location_patch(&mut patch, previous.as_ref(), now);
    }
    output.friend_note_changed |= changes.has("note");
    let state_bucket = if source.trusts_embedded_state() {
        resolve_state_bucket(
            content,
            previous.as_ref(),
            source.trusts_embedded_state(),
            StateBucket::Offline.as_str(),
        )
    } else {
        previous
            .as_ref()
            .map(|previous| previous.state.trim())
            .filter(|state_bucket| !state_bucket.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| StateBucket::Offline.as_str().to_string())
    };
    if source.trusts_embedded_state() && state.pending_offline.remove(&user_id).is_some() {
        if let Some(patch_object) = patch.as_object_mut() {
            patch_object.insert("pendingOffline".into(), Value::Bool(false));
        }
    }
    record_profile_identity_change(
        output,
        &user_id,
        &patch,
        previous.as_ref(),
        &state_bucket,
        now,
    );
    if source.emits_profile_diff_feed() {
        if location_changed {
            if let Some(previous) = previous.as_ref() {
                add_gps_feed_entry_if_not_repeated(
                    state, output, &user_id, &patch, previous, now, false,
                );
            }
        }
        add_profile_diff_feed_entries(
            output,
            &user_id,
            &patch,
            previous.as_ref(),
            &changes,
            &now.iso,
        );
    }
    request_profile_refetch_for_impossible_location(output, &user_id, &patch, &state_bucket);
    apply_patch_to_state(state, output, &user_id, patch, &state_bucket, &now.iso);
    Some(())
}

fn apply_online(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    content: &Value,
    now: &EventTime,
) -> Option<()> {
    let user_id = event_user_id(content)?;
    let canceled_pending = state.pending_offline.remove(&user_id).is_some();
    let previous_record = state
        .baseline
        .as_ref()?
        .friends_by_id
        .get(&user_id)
        .cloned();
    let user_patch = profile_patch(content, &user_id);
    let mut patch = online_patch(
        content,
        user_patch,
        previous_record.as_ref(),
        now,
        StateBucket::Online.as_str(),
    );
    normalize_patch_trust(&mut patch, previous_record.as_ref());
    output.friend_note_changed |= patch_changes_note(&patch, previous_record.as_ref());
    record_profile_identity_change(
        output,
        &user_id,
        &patch,
        previous_record.as_ref(),
        StateBucket::Online.as_str(),
        now,
    );
    if !canceled_pending
        && !previous_record
            .as_ref()
            .map(is_online_state)
            .unwrap_or(false)
    {
        output.persistence.feed_entries.push(online_feed_entry(
            &user_id,
            &patch,
            previous_record.as_ref(),
            &patch.text_field("location"),
            0,
            &now.iso,
        ));
    } else if let Some(previous) = previous_record.as_ref() {
        add_gps_feed_entry_if_not_repeated(
            state,
            output,
            &user_id,
            &patch,
            previous,
            now,
            state_bucket_changed(previous, StateBucket::Online.as_str()),
        );
    }
    apply_patch_to_state(
        state,
        output,
        &user_id,
        patch,
        StateBucket::Online.as_str(),
        &now.iso,
    );
    Some(())
}

fn apply_active_offline(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    content: &Value,
    now: &EventTime,
    next_state: &str,
) -> Option<()> {
    let user_id = event_user_id(content)?;
    let previous_record = state
        .baseline
        .as_ref()?
        .friends_by_id
        .get(&user_id)
        .cloned();
    let mut patch = offline_like_patch(content, &user_id, next_state);
    normalize_patch_trust(&mut patch, previous_record.as_ref());
    if let Some(previous) = previous_record
        .as_ref()
        .filter(|previous| is_online_state(previous))
    {
        if state.pending_offline.contains_key(&user_id) {
            return None;
        }
        record_profile_identity_change(
            output,
            &user_id,
            &patch,
            previous_record.as_ref(),
            StateBucket::Online.as_str(),
            now,
        );
        state.timer_token = state.timer_token.saturating_add(1);
        let token = state.timer_token;
        state.pending_offline.insert(
            user_id.clone(),
            PendingOffline {
                token,
                patch: FriendRecordPatch::from_value(&patch),
                state_bucket: next_state.into(),
                previous: OfflineFeedPrevious::from_record(previous),
            },
        );
        let pending_patch = json!({
            "id": user_id,
            "pendingOffline": true,
        });
        apply_patch_to_state(
            state,
            output,
            &user_id,
            pending_patch,
            StateBucket::Online.as_str(),
            &now.iso,
        );
        output.timer_action = PendingOfflineTimerAction::Schedule {
            user_id,
            token,
            delay_ms: PENDING_OFFLINE_DELAY_MS,
        };
    } else {
        state.recent_gps.remove(&user_id);
        record_profile_identity_change(
            output,
            &user_id,
            &patch,
            previous_record.as_ref(),
            next_state,
            now,
        );
        apply_patch_to_state(state, output, &user_id, patch, next_state, &now.iso);
    }
    Some(())
}

fn apply_location(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    content: &Value,
    now: &EventTime,
) -> Option<()> {
    let user_id = event_user_id(content)?;
    let user_patch = profile_patch(content, &user_id);
    let previous_record = state
        .baseline
        .as_ref()?
        .friends_by_id
        .get(&user_id)
        .cloned();
    let presence = location_presence(content, &user_patch, previous_record.as_ref())?;
    let has_embedded_user = presence.has_embedded_user;
    let has_online_location = presence.has_online_location;
    let has_offline_location = presence.has_offline_location;
    let state_bucket = presence.state_bucket;
    let state_bucket_authority = presence.authority;
    let preserve_pending_offline =
        !has_online_location && state.pending_offline.contains_key(&user_id);
    if has_embedded_user && has_online_location {
        state.pending_offline.remove(&user_id);
    }
    let mut patch = online_patch(
        content,
        user_patch,
        previous_record.as_ref(),
        now,
        &state_bucket,
    );
    normalize_patch_trust(&mut patch, previous_record.as_ref());
    let start_pending_offline = !preserve_pending_offline
        && !has_online_location
        && has_offline_location
        && previous_record
            .as_ref()
            .map(is_online_state)
            .unwrap_or(false);
    if start_pending_offline {
        state.timer_token = state.timer_token.saturating_add(1);
        let token = state.timer_token;
        state.pending_offline.insert(
            user_id.clone(),
            PendingOffline {
                token,
                patch: FriendRecordPatch::from_value(&offline_like_patch(
                    content,
                    &user_id,
                    StateBucket::Offline.as_str(),
                )),
                state_bucket: StateBucket::Offline.as_str().into(),
                previous: OfflineFeedPrevious::from_record(
                    previous_record.as_ref().expect("checked previous record"),
                ),
            },
        );
        if let Some(patch_object) = patch.as_object_mut() {
            patch_object.insert("pendingOffline".into(), Value::Bool(true));
        }
        output.timer_action = PendingOfflineTimerAction::Schedule {
            user_id: user_id.clone(),
            token,
            delay_ms: PENDING_OFFLINE_DELAY_MS,
        };
    } else if preserve_pending_offline {
        if let Some(patch_object) = patch.as_object_mut() {
            patch_object.insert("pendingOffline".into(), Value::Bool(true));
        }
    } else if !has_embedded_user {
        if let Some(patch_object) = patch.as_object_mut() {
            patch_object.remove("pendingOffline");
        }
    }
    output.friend_note_changed |= patch_changes_note(&patch, previous_record.as_ref());
    record_profile_identity_change(
        output,
        &user_id,
        &patch,
        previous_record.as_ref(),
        &state_bucket,
        now,
    );
    if let Some(previous) = previous_record.as_ref() {
        add_gps_feed_entry_if_not_repeated(
            state,
            output,
            &user_id,
            &patch,
            previous,
            now,
            state_bucket_changed(previous, &state_bucket),
        );
    }
    if !StateBucket::Online.matches(&state_bucket) {
        state.recent_gps.remove(&user_id);
    }
    request_profile_refetch_for_location_event(
        output,
        &user_id,
        &patch,
        &state_bucket,
        has_embedded_user,
        has_online_location,
    );
    apply_patch_to_state_with_authority(
        state,
        output,
        &user_id,
        patch,
        &state_bucket,
        state_bucket_authority,
        &now.iso,
    );
    Some(())
}

fn request_profile_refetch_for_impossible_location(
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: &Value,
    state_bucket: &str,
) {
    if !StateBucket::Online.matches(state_bucket) && is_real_instance_patch(patch) {
        push_profile_refetch_user_id(output, user_id);
    }
}

fn request_profile_refetch_for_location_event(
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: &Value,
    state_bucket: &str,
    has_embedded_user: bool,
    has_online_location: bool,
) {
    let embedded_user_without_online_proof = has_embedded_user && !has_online_location;
    let online_with_missing_or_offline_location =
        StateBucket::Online.matches(state_bucket) && !patch_has_online_location(patch);
    let non_online_with_real_instance_location =
        !StateBucket::Online.matches(state_bucket) && is_real_instance_patch(patch);

    if embedded_user_without_online_proof
        || online_with_missing_or_offline_location
        || non_online_with_real_instance_location
    {
        push_profile_refetch_user_id(output, user_id);
    }
}

fn push_profile_refetch_user_id(output: &mut RealtimeFriendOutput, user_id: &str) {
    if output
        .profile_refetch_user_ids
        .iter()
        .any(|existing_id| existing_id == user_id)
    {
        return;
    }
    output.profile_refetch_user_ids.push(user_id.to_string());
}

fn patch_has_online_location(patch: &Value) -> bool {
    [
        patch.get("location").and_then(Value::as_str),
        patch.get("travelingToLocation").and_then(Value::as_str),
    ]
    .iter()
    .flatten()
    .any(|value| is_online_location_proof(value))
}

fn is_real_instance_patch(patch: &Value) -> bool {
    let location = patch.text_field("location");
    let parsed = parse_location(&location);
    parsed.world_id.starts_with("wrld_") && !parsed.instance_id.is_empty()
}

fn recent_enough(previous_ms: i64, now_ms: i64) -> bool {
    previous_ms > 0 && now_ms.saturating_sub(previous_ms) <= GPS_REPEAT_WINDOW_MS
}

fn should_suppress_repeated_gps(
    state: &mut RealtimeFriendState,
    user_id: &str,
    location: &str,
    now_ms: i64,
) -> bool {
    let Some(recent) = state.recent_gps.get_mut(user_id) else {
        return false;
    };
    recent
        .locations_by_tag
        .retain(|_, observed_at_ms| recent_enough(*observed_at_ms, now_ms));
    if recent.locations_by_tag.contains_key(location) {
        recent.locations_by_tag.insert(location.to_string(), now_ms);
        return true;
    }
    false
}

fn remember_gps_event(state: &mut RealtimeFriendState, user_id: &str, location: &str, now_ms: i64) {
    state
        .recent_gps
        .entry(user_id.to_string())
        .or_default()
        .locations_by_tag
        .insert(location.to_string(), now_ms);
}

fn record_profile_identity_change(
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: &Value,
    previous: Option<&FriendRecord>,
    state_bucket: &str,
    now: &EventTime,
) {
    let Some(previous) = previous else {
        return;
    };
    let next_name = meaningful_name(patch, user_id);
    let name_changed =
        !next_name.is_empty() && next_name != meaningful_record_name(previous, user_id);
    let previous_trust_level = record_string(previous, derived_keys::TRUST_LEVEL);
    let trust_level = first_owned([
        patch.text_field(derived_keys::TRUST_LEVEL),
        previous_trust_level.clone(),
    ]);
    let trust_differs = trust_level_differs(&previous_trust_level, &trust_level);
    let trust_changed = trust_level_changed(&previous_trust_level, &trust_level);
    if !name_changed && !trust_differs {
        return;
    }
    let upsert = friend_log_upsert(user_id, patch, Some(previous), state_bucket, &now.iso);
    if trust_changed {
        output.persistence.feed_entries.push(trust_level_feed_entry(
            &now.iso,
            user_id,
            &upsert.display_name,
            &trust_level,
            &previous_trust_level,
            upsert.friend_number,
        ));
    }
    output.persistence.friend_log_upserts.push(upsert);
    output.projection.friend_log_changed = true;
}

fn patch_changes_note(patch: &Value, previous: Option<&FriendRecord>) -> bool {
    let Some(next) = patch.get("note") else {
        return false;
    };
    let previous = previous
        .map(|previous| record_value(previous, "note"))
        .unwrap_or_else(|| Value::String(String::new()));
    !value_equal_for_diff(next, &previous)
}

fn add_gps_feed_entry_if_not_repeated(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: &Value,
    previous: &FriendRecord,
    now: &EventTime,
    state_bucket_changed: bool,
) {
    if state_bucket_changed {
        return;
    }
    let Some(entry) = gps_feed_entry(user_id, patch, previous, &now.iso) else {
        return;
    };
    let location = entry.text_field("location");
    let previous_location = entry.text_field("previousLocation");
    let crosses_private_boundary =
        is_private_location(&location) || is_private_location(&previous_location);
    if !crosses_private_boundary
        && should_suppress_repeated_gps(state, user_id, &location, now.timestamp_ms)
    {
        return;
    }
    remember_gps_event(state, user_id, &location, now.timestamp_ms);
    output.persistence.feed_entries.push(entry);
}

pub(super) fn apply_patch_to_state(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: serde_json::Value,
    state_bucket: &str,
    created_at: &str,
) {
    apply_patch_to_state_with_authority(
        state,
        output,
        user_id,
        patch,
        state_bucket,
        FriendStateBucketAuthority::Explicit,
        created_at,
    );
}

pub(super) fn apply_patch_to_state_with_authority(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: serde_json::Value,
    state_bucket: &str,
    state_bucket_authority: FriendStateBucketAuthority,
    created_at: &str,
) {
    let patch = FriendRecordPatch::from_value(&patch);
    apply_record_patch_to_state(
        state,
        output,
        user_id,
        patch,
        state_bucket,
        state_bucket_authority,
        created_at,
    );
}

fn normalize_instance_dwell(
    registry: &InstanceDwellRegistry,
    user_id: &str,
    transition: &mut FriendRecordTransition,
) {
    let location = transition.next.location.clone();
    let parsed = parse_location(&location);
    if parsed.is_traveling {
        return;
    }
    if !parsed.is_real_instance {
        registry.forget(user_id);
        return;
    }
    let Some(observed) = transition
        .next
        .extra
        .i64_field(derived_keys::LOCATION_UPDATED_AT)
    else {
        return;
    };
    let canonical = registry.observe_presence_location(user_id, &location, observed);
    if canonical == observed {
        return;
    }
    for record in [&mut transition.next, &mut transition.projection.patch] {
        for key in [derived_keys::LOCATION_UPDATED_AT, "locationUpdatedAt"] {
            if record.extra.contains_key(key) {
                record.extra.insert(key.to_string(), Value::from(canonical));
            }
        }
    }
}

pub(super) fn apply_record_patch_to_state(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: FriendRecordPatch,
    state_bucket: &str,
    state_bucket_authority: FriendStateBucketAuthority,
    created_at: &str,
) {
    let previous = state
        .baseline
        .as_ref()
        .and_then(|baseline| baseline.friends_by_id.get(user_id))
        .cloned();
    let mut transition = apply_friend_patch(
        previous.as_ref(),
        user_id,
        &patch,
        state_bucket,
        state_bucket_authority,
    );
    let instance_dwell = Arc::clone(&state.instance_dwell);
    normalize_instance_dwell(&instance_dwell, user_id, &mut transition);
    if let Some(entry) = player_joining_feed_entry(
        user_id,
        transition.was_traveling,
        &transition.next,
        created_at,
    ) {
        output.projection.feed_entries.push(entry);
    }

    let friend_was_added = match state.baseline.as_mut() {
        Some(baseline) => baseline
            .friends_by_id
            .insert(user_id.to_string(), transition.next)
            .is_none(),
        None => false,
    };
    if friend_was_added {
        state.invalidate_friend_user_ids_snapshot();
    }
    output.projection.patches.push(transition.projection);
}

pub(super) fn get_friend_record(
    state: &RealtimeFriendState,
    user_id: &str,
) -> Option<FriendRecord> {
    state
        .baseline
        .as_ref()
        .and_then(|baseline| baseline.friends_by_id.get(user_id))
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn online_patch_emits_full_location_projection() {
        let now = EventTime {
            iso: "2026-06-25T00:00:00Z".into(),
            timestamp_ms: 1_772_000_000_000,
        };
        let tag = "wrld_a:1~hidden(usr_owner)~region(jp)";
        let patch = online_patch(
            &json!({ "location": tag }),
            json!({ "id": "usr_friend" }),
            None,
            &now,
            "online",
        );

        assert_eq!(patch["location"], json!(tag));
        assert_eq!(patch["$location"]["tag"], json!(tag));
        assert_eq!(patch["$location"]["worldId"], json!("wrld_a"));
        assert_eq!(
            patch["$location"]["instanceId"],
            json!("1~hidden(usr_owner)~region(jp)")
        );
        assert_eq!(patch["$location"]["accessType"], json!("friends+"));
        assert_eq!(patch["$location"]["userId"], json!("usr_owner"));
        assert_eq!(patch["$location"]["region"], json!("jp"));
    }

    #[test]
    fn offline_like_patch_emits_structured_offline_locations() {
        let patch = offline_like_patch(&json!({}), "usr_friend", "offline");

        assert_eq!(patch["location"], json!("offline"));
        assert_eq!(patch["travelingToLocation"], json!("offline"));
        assert_eq!(patch["$location"]["tag"], json!("offline"));
        assert_eq!(patch["$location"]["isOffline"], json!(true));
        assert_eq!(patch["$travelingToLocation"]["tag"], json!("offline"));
        assert_eq!(patch["$travelingToLocation"]["isOffline"], json!(true));
    }

    #[test]
    fn event_user_patch_strips_state_and_state_bucket_uses_trust_gate() {
        let content = json!({
            "userId": "usr_friend",
            "user": {
                "id": "usr_friend",
                "displayName": "Friend",
                "state": "online"
            }
        });

        let patch = event_user_patch(&content, "usr_friend").expect("user patch");
        assert_eq!(patch["id"], json!("usr_friend"));
        assert_eq!(patch["displayName"], json!("Friend"));
        assert!(patch.get("state").is_none());

        let previous = FriendRecord {
            id: "usr_friend".into(),
            state: "active".into(),
            ..FriendRecord::default()
        };
        assert_eq!(
            resolve_state_bucket(&content, Some(&previous), false, "offline"),
            "active"
        );
        assert_eq!(
            resolve_state_bucket(&content, Some(&previous), true, "offline"),
            "online"
        );
    }
}
