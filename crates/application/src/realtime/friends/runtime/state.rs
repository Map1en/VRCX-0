use super::event_patch::{
    apply_friend_event, apply_patch_to_state, apply_refetched_friend_profile_event,
    apply_trusted_friend_add_event, is_friend_event_type, record_to_value,
};
use super::persistence::{is_online_state, offline_feed_entry};
use super::projection::state_bucket_from_patch;
use super::utils::{bool_field, object_with_pending_offline, EventTime};
use super::*;

pub(super) const PENDING_OFFLINE_DELAY_MS: u64 = 170_000;

#[derive(Clone, Debug, Default)]
pub(super) struct RecentGps {
    pub(super) locations_by_tag: HashMap<String, i64>,
}

#[derive(Clone, Debug)]
pub(super) struct PendingOffline {
    pub(super) token: u64,
    pub(super) patch: serde_json::Value,
    pub(super) previous: FriendRecord,
}

#[derive(Clone, Debug, Default)]
pub(super) struct RealtimeFriendState {
    pub(super) generation: u64,
    pub(super) timer_token: u64,
    pub(super) friend_state_sequence: u64,
    pub(super) friend_state_sequence_by_user: HashMap<String, u64>,
    pub(super) baseline: Option<RealtimeFriendSnapshot>,
    pub(super) pending_offline: HashMap<String, PendingOffline>,
    pub(super) recent_gps: HashMap<String, RecentGps>,
}

#[derive(Clone, Debug, Default)]
pub struct RealtimeFriendsRuntime {
    state: Arc<Mutex<RealtimeFriendState>>,
}

impl RealtimeFriendsRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn baseline_causal_watermark(&self) -> FriendBaselineCausalWatermark {
        let state = self.lock_state();
        FriendBaselineCausalWatermark {
            generation: state.baseline.as_ref().map(|baseline| baseline.generation),
            baseline_revision: state
                .baseline
                .as_ref()
                .map(|baseline| baseline.baseline_revision),
            friend_state_sequence: state.friend_state_sequence,
            friend_log_sequence: 0,
        }
    }

    pub fn set_baseline(
        &self,
        baseline: FriendRosterBaseline,
        realtime_generation: u64,
        baseline_revision: u64,
    ) -> FriendBaselineResult {
        self.apply_baseline(baseline, realtime_generation, baseline_revision, None)
            .0
    }

    pub fn set_baseline_with_schedules(
        &self,
        baseline: FriendRosterBaseline,
        realtime_generation: u64,
        baseline_revision: u64,
    ) -> (FriendBaselineResult, Vec<(String, u64, u64)>) {
        let (result, schedules, _) =
            self.apply_baseline(baseline, realtime_generation, baseline_revision, None);
        (result, schedules)
    }

    pub(crate) fn set_baseline_with_effects(
        &self,
        baseline: FriendRosterBaseline,
        realtime_generation: u64,
        baseline_revision: u64,
        friend_state_sequence_watermark: Option<u64>,
    ) -> (FriendBaselineResult, Vec<(String, u64, u64)>, Vec<Value>) {
        self.apply_baseline(
            baseline,
            realtime_generation,
            baseline_revision,
            friend_state_sequence_watermark,
        )
    }

    fn apply_baseline(
        &self,
        baseline: FriendRosterBaseline,
        realtime_generation: u64,
        baseline_revision: u64,
        friend_state_sequence_watermark: Option<u64>,
    ) -> (FriendBaselineResult, Vec<(String, u64, u64)>, Vec<Value>) {
        let mut baseline = baseline.normalized();
        let mut state = self.lock_state();
        let generation = realtime_generation;
        let same_generation = state
            .baseline
            .as_ref()
            .is_some_and(|snapshot| snapshot.generation == generation);
        state.generation = state.generation.max(generation);
        let mut pending_to_create: Vec<(String, FriendRecord, FriendRecord)> = Vec::new();
        let mut resolved_pending_ids = HashSet::new();
        let mut confirmed_pending: Vec<(String, FriendRecord, FriendRecord)> = Vec::new();
        let friend_state_sequence_watermark = friend_state_sequence_watermark.unwrap_or(0);
        let mut stale_incoming_ids = HashSet::new();
        let mut newer_missing_records = Vec::new();
        if let Some(existing_snapshot) = state.baseline.as_ref() {
            if same_generation {
                newer_missing_records = existing_snapshot
                    .friends_by_id
                    .iter()
                    .filter(|(user_id, _record)| {
                        !baseline.friends_by_id.contains_key(*user_id)
                            && state
                                .friend_state_sequence_by_user
                                .get(*user_id)
                                .is_some_and(|sequence| *sequence > friend_state_sequence_watermark)
                    })
                    .map(|(user_id, record)| (user_id.clone(), record.clone()))
                    .collect();
            }
            for (user_id, record) in baseline.friends_by_id.iter_mut() {
                let existing_record = existing_snapshot.friends_by_id.get(user_id);
                if same_generation
                    && state
                        .friend_state_sequence_by_user
                        .get(user_id)
                        .is_some_and(|sequence| *sequence > friend_state_sequence_watermark)
                {
                    if let Some(existing_record) = existing_record {
                        *record = existing_record.clone();
                    } else {
                        stale_incoming_ids.insert(user_id.clone());
                    }
                    continue;
                }
                let Some(existing_record) = existing_record else {
                    continue;
                };
                let is_placeholder = record.extra.get("$profileSource").and_then(Value::as_str)
                    == Some("placeholder");
                if is_placeholder {
                    preserve_newer_presence_fields(record, existing_record);
                }
                if (record.display_name.is_empty() || record.display_name == record.id)
                    && !existing_record.display_name.is_empty()
                    && existing_record.display_name != existing_record.id
                {
                    record.display_name = existing_record.display_name.clone();
                }
                if !same_generation {
                    continue;
                }
                if let Some(pending) = state.pending_offline.get(user_id) {
                    resolved_pending_ids.insert(user_id.clone());
                    record
                        .extra
                        .insert("pendingOffline".into(), Value::Bool(false));
                    if matches!(record.state_bucket.as_str(), "offline" | "active") {
                        confirmed_pending.push((
                            user_id.clone(),
                            record.clone(),
                            pending.previous.clone(),
                        ));
                    }
                } else if existing_record.state_bucket == "online"
                    && matches!(record.state_bucket.as_str(), "offline" | "active")
                {
                    pending_to_create.push((
                        user_id.clone(),
                        record.clone(),
                        existing_record.clone(),
                    ));
                    *record = existing_record.clone();
                    record
                        .extra
                        .insert("pendingOffline".into(), Value::Bool(true));
                }
            }
        }
        for user_id in stale_incoming_ids {
            baseline.friends_by_id.remove(&user_id);
        }
        for (user_id, record) in newer_missing_records {
            baseline.friends_by_id.insert(user_id, record);
        }
        let confirmed_at = Utc::now();
        let confirmed_at_iso = confirmed_at.to_rfc3339();
        let confirmed_feed_entries = confirmed_pending
            .into_iter()
            .map(|(user_id, record, previous)| {
                offline_feed_entry(
                    &user_id,
                    &record_to_value(&record),
                    &previous,
                    &confirmed_at_iso,
                    confirmed_at.timestamp_millis(),
                )
            })
            .collect::<Vec<_>>();
        let mut schedules: Vec<(String, u64, u64)> = Vec::new();
        for (user_id, new_record, existing_online) in pending_to_create {
            state.timer_token = state.timer_token.saturating_add(1);
            let token = state.timer_token;
            state.pending_offline.insert(
                user_id.clone(),
                PendingOffline {
                    token,
                    patch: record_to_value(&new_record),
                    previous: existing_online,
                },
            );
            schedules.push((user_id, token, PENDING_OFFLINE_DELAY_MS));
        }
        if same_generation {
            state.pending_offline.retain(|user_id, _pending| {
                if resolved_pending_ids.contains(user_id) {
                    return false;
                }
                let Some(record) = baseline.friends_by_id.get_mut(user_id) else {
                    return false;
                };
                if !is_online_state(record) {
                    return false;
                }
                record
                    .extra
                    .insert("pendingOffline".into(), Value::Bool(true));
                true
            });
            state
                .recent_gps
                .retain(|user_id, _recent| baseline.friends_by_id.contains_key(user_id));
        } else {
            state.pending_offline.clear();
            state.recent_gps.clear();
            state.friend_state_sequence_by_user.clear();
        }
        let mut changed_user_ids = HashSet::new();
        if same_generation {
            if let Some(existing_snapshot) = state.baseline.as_ref() {
                for (user_id, record) in &baseline.friends_by_id {
                    if existing_snapshot.friends_by_id.get(user_id) != Some(record) {
                        changed_user_ids.insert(user_id.clone());
                    }
                }
                for user_id in existing_snapshot.friends_by_id.keys() {
                    if !baseline.friends_by_id.contains_key(user_id) {
                        changed_user_ids.insert(user_id.clone());
                    }
                }
            }
        }
        let friend_count = baseline.friends_by_id.len();
        state.baseline = Some(RealtimeFriendSnapshot {
            current_user_id: baseline.current_user_id,
            endpoint: baseline.endpoint,
            websocket: baseline.websocket,
            generation,
            baseline_revision,
            friends_by_id: baseline.friends_by_id,
        });
        if !changed_user_ids.is_empty() {
            state.friend_state_sequence = state.friend_state_sequence.saturating_add(1);
            let sequence = state.friend_state_sequence;
            for user_id in changed_user_ids {
                state
                    .friend_state_sequence_by_user
                    .insert(user_id, sequence);
            }
        }

        (
            FriendBaselineResult {
                accepted: true,
                generation,
                baseline_revision,
                friend_count,
            },
            schedules,
            confirmed_feed_entries,
        )
    }

    pub fn clear(&self) -> u64 {
        let mut state = self.lock_state();
        state.generation = state.generation.saturating_add(1);
        state.baseline = None;
        state.pending_offline.clear();
        state.recent_gps.clear();
        state.friend_state_sequence_by_user.clear();
        state.generation
    }

    pub fn clear_baseline_if_revision(&self, generation: u64, baseline_revision: u64) -> bool {
        let mut state = self.lock_state();
        let should_clear = state
            .baseline
            .as_ref()
            .map(|baseline| {
                baseline.generation == generation && baseline.baseline_revision == baseline_revision
            })
            .unwrap_or(false);
        if should_clear {
            state.generation = state.generation.saturating_add(1);
            state.baseline = None;
            state.pending_offline.clear();
            state.recent_gps.clear();
            state.friend_state_sequence_by_user.clear();
        }
        should_clear
    }

    pub fn snapshot(&self) -> Option<RealtimeFriendSnapshot> {
        self.lock_state().baseline.clone()
    }

    pub fn has_friend(&self, generation: u64, user_id: &str) -> bool {
        let normalized_user_id = user_id.trim();
        if normalized_user_id.is_empty() {
            return false;
        }
        self.lock_state()
            .baseline
            .as_ref()
            .filter(|baseline| baseline.generation == generation)
            .is_some_and(|baseline| baseline.friends_by_id.contains_key(normalized_user_id))
    }

    pub(crate) fn friend_state_sequence_for_user(
        &self,
        generation: u64,
        user_id: &str,
    ) -> Option<u64> {
        let normalized_user_id = user_id.trim();
        if normalized_user_id.is_empty() {
            return None;
        }
        let state = self.lock_state();
        let baseline = state.baseline.as_ref()?;
        if baseline.generation != generation
            || !baseline.friends_by_id.contains_key(normalized_user_id)
        {
            return None;
        }
        Some(current_friend_state_sequence(&state, normalized_user_id))
    }

    pub fn apply_ws_message(
        &self,
        payload: &RealtimeWsMessagePayload,
    ) -> RealtimeFriendApplyResult {
        self.apply_friend_message(payload, None, false)
    }

    pub(crate) fn apply_scoped_synthetic_message(
        &self,
        expected_owner_user_id: &str,
        expected_endpoint: &str,
        payload: &RealtimeWsMessagePayload,
        trust_friend_add_profile_state: bool,
    ) -> RealtimeFriendApplyResult {
        self.apply_friend_message(
            payload,
            Some((expected_owner_user_id, expected_endpoint)),
            trust_friend_add_profile_state,
        )
    }

    fn apply_friend_message(
        &self,
        payload: &RealtimeWsMessagePayload,
        expected_scope: Option<(&str, &str)>,
        trust_friend_add_profile_state: bool,
    ) -> RealtimeFriendApplyResult {
        let Some(message_type) = payload.json.get("type").and_then(Value::as_str) else {
            return RealtimeFriendApplyResult::Ignored;
        };
        if !is_friend_event_type(message_type) {
            return RealtimeFriendApplyResult::Ignored;
        }
        let content = payload.json.get("content").unwrap_or(&Value::Null);
        let now = EventTime::from_received_at(&payload.received_at);
        let mut state = self.lock_state();
        let Some(baseline) = state.baseline.as_ref() else {
            return RealtimeFriendApplyResult::MissingBaseline;
        };
        if expected_scope.is_some_and(|(expected_owner_user_id, expected_endpoint)| {
            baseline.current_user_id != expected_owner_user_id.trim()
                || normalize_vrchat_api_endpoint(Some(&baseline.endpoint))
                    != normalize_vrchat_api_endpoint(Some(expected_endpoint))
        }) {
            return RealtimeFriendApplyResult::MissingBaseline;
        }
        let output = if trust_friend_add_profile_state && message_type == "friend-add" {
            apply_trusted_friend_add_event(&mut state, content, &now)
        } else {
            apply_friend_event(&mut state, message_type, content, &now)
        };
        let Some(output) = output else {
            return RealtimeFriendApplyResult::Ignored;
        };
        record_output_friend_state_sequence(&mut state, &output);
        RealtimeFriendApplyResult::Output(Box::new(output))
    }

    pub fn apply_refetched_user_profile(
        &self,
        generation: u64,
        user_id: &str,
        profile: serde_json::Value,
        received_at: &str,
    ) -> RealtimeFriendApplyResult {
        self.apply_refetched_user_profile_inner(generation, user_id, None, profile, received_at)
    }

    pub(crate) fn apply_refetched_user_profile_if_sequence(
        &self,
        generation: u64,
        user_id: &str,
        expected_sequence: u64,
        profile: serde_json::Value,
        received_at: &str,
    ) -> RealtimeFriendApplyResult {
        self.apply_refetched_user_profile_inner(
            generation,
            user_id,
            Some(expected_sequence),
            profile,
            received_at,
        )
    }

    fn apply_refetched_user_profile_inner(
        &self,
        generation: u64,
        user_id: &str,
        expected_sequence: Option<u64>,
        profile: serde_json::Value,
        received_at: &str,
    ) -> RealtimeFriendApplyResult {
        let mut state = self.lock_state();
        let Some(baseline) = state.baseline.as_ref() else {
            return RealtimeFriendApplyResult::MissingBaseline;
        };
        if baseline.generation != generation {
            return RealtimeFriendApplyResult::Ignored;
        }
        let normalized_user_id = user_id.trim();
        if normalized_user_id.is_empty() {
            return RealtimeFriendApplyResult::Ignored;
        }
        if !baseline.friends_by_id.contains_key(normalized_user_id) {
            return RealtimeFriendApplyResult::Ignored;
        }
        if expected_sequence.is_some_and(|expected_sequence| {
            current_friend_state_sequence(&state, normalized_user_id) != expected_sequence
        }) {
            return RealtimeFriendApplyResult::Ignored;
        }
        let content = json!({
            "userId": normalized_user_id,
            "user": profile
        });
        let now = EventTime::from_received_at(received_at);
        let Some(output) = apply_refetched_friend_profile_event(&mut state, &content, &now) else {
            return RealtimeFriendApplyResult::Ignored;
        };
        record_output_friend_state_sequence(&mut state, &output);
        RealtimeFriendApplyResult::Output(Box::new(output))
    }

    pub fn fire_pending_offline(
        &self,
        user_id: &str,
        token: u64,
        now_iso: String,
    ) -> Option<RealtimeFriendOutput> {
        let mut state = self.lock_state();
        let baseline = state.baseline.as_ref()?;
        let owner_user_id = baseline.current_user_id.clone();
        let generation = baseline.generation;
        let baseline_revision = baseline.baseline_revision;
        let pending = state.pending_offline.get(user_id)?;
        if pending.token != token {
            return None;
        }
        let pending = state.pending_offline.remove(user_id)?;
        state.recent_gps.remove(user_id);
        let current = state
            .baseline
            .as_ref()
            .and_then(|baseline| baseline.friends_by_id.get(user_id))?;
        let current_value = record_to_value(current);
        if is_online_state(current) && !bool_field(current_value.get("pendingOffline")) {
            return None;
        }

        let patch = object_with_pending_offline(pending.patch, false);
        let state_bucket = state_bucket_from_patch(&patch, "offline");
        let previous = pending.previous;
        let mut output = RealtimeFriendOutput {
            owner_user_id,
            projection: FriendProjection {
                generation,
                baseline_revision,
                ..FriendProjection::default()
            },
            ..RealtimeFriendOutput::default()
        };
        apply_patch_to_state(
            &mut state,
            &mut output,
            user_id,
            patch,
            &state_bucket,
            &now_iso,
        );
        output.persistence.feed_entries.push(offline_feed_entry(
            user_id,
            output
                .projection
                .patches
                .last()
                .map(|patch| &patch.patch)
                .unwrap_or(&Value::Null),
            &previous,
            &now_iso,
            Utc::now().timestamp_millis(),
        ));
        output.projection.feed_entries = output.persistence.feed_entries.clone();
        record_output_friend_state_sequence(&mut state, &output);
        Some(output)
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, RealtimeFriendState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

fn current_friend_state_sequence(state: &RealtimeFriendState, user_id: &str) -> u64 {
    state
        .friend_state_sequence_by_user
        .get(user_id)
        .copied()
        .unwrap_or_default()
}

fn record_output_friend_state_sequence(
    state: &mut RealtimeFriendState,
    output: &RealtimeFriendOutput,
) {
    let user_ids = output
        .projection
        .patches
        .iter()
        .map(|patch| patch.user_id.as_str())
        .chain(output.projection.removals.iter().map(String::as_str))
        .collect::<HashSet<_>>();
    if user_ids.is_empty() {
        return;
    }
    state.friend_state_sequence = state.friend_state_sequence.saturating_add(1);
    let sequence = state.friend_state_sequence;
    for user_id in user_ids {
        state
            .friend_state_sequence_by_user
            .insert(user_id.to_string(), sequence);
    }
}

fn preserve_newer_presence_fields(incoming: &mut FriendRecord, existing: &FriendRecord) {
    incoming.location = existing.location.clone();
    incoming.traveling_to_location = existing.traveling_to_location.clone();
    incoming.world_id = existing.world_id.clone();
    incoming.platform = existing.platform.clone();
    incoming.last_platform = existing.last_platform.clone();
    incoming.status = existing.status.clone();
    incoming.status_description = existing.status_description.clone();

    for key in [
        "pendingOffline",
        "$location",
        "$location_at",
        "locationUpdatedAt",
        "instanceId",
        "travelingToWorld",
        "travelingToInstance",
        "$travelingToLocation",
        "$travelingToTime",
        "travelingToLocation",
    ] {
        match existing.extra.get(key) {
            Some(value) => {
                incoming.extra.insert(key.to_string(), value.clone());
            }
            None => {
                incoming.extra.remove(key);
            }
        }
    }
}
