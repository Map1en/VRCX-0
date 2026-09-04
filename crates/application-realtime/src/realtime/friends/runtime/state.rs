use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use vrcx_0_application_core::{FriendLocationTime, InstanceDwellRegistry};
use vrcx_0_core::derived_keys;

use chrono::Utc;
use compact_str::CompactString;
use serde_json::{json, Value};
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_core::friends::{FriendRecord, FriendRosterBaseline, StateBucket};
use vrcx_0_core::realtime::{RealtimeSessionContext, RealtimeWsMessagePayload};
use vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint;

use crate::realtime::event_kind::RealtimeWsEventKind;
use crate::realtime::{
    FriendBaselineCausalWatermark, FriendBaselineResult, FriendStateBucketAuthority,
    RealtimeFriendApplyResult, RealtimeFriendOutput, RealtimeFriendRecordSnapshot,
    RealtimeFriendRosterSnapshot, RealtimeFriendSnapshot,
};

use super::event_patch::{
    apply_friend_event, apply_record_patch_to_state, apply_refetched_friend_profile_event,
    apply_trusted_friend_add_event, FriendEventKind, FriendRecordPatch,
};
use super::persistence::{is_online_state, offline_feed_entry, OfflineFeedPrevious};
use super::utils::EventTime;

pub(super) use crate::realtime::runtime_types::PENDING_OFFLINE_DELAY;
use vrcx_0_core::OwnerId;

#[derive(Clone, Debug, Default)]
pub(super) struct RecentGps {
    pub(super) locations_by_tag: HashMap<String, i64>,
}

#[derive(Clone, Debug)]
pub(super) struct PendingOffline {
    pub(super) token: u64,
    pub(super) patch: FriendRecordPatch,
    pub(super) state_bucket: CompactString,
    pub(super) previous: OfflineFeedPrevious,
}

pub(crate) struct PendingOfflineSchedule {
    pub(crate) user_id: String,
    pub(crate) token: u64,
    pub(crate) delay: Duration,
}

pub(crate) struct FriendBaselineEffects {
    pub(crate) result: FriendBaselineResult,
    pub(crate) schedules: Vec<PendingOfflineSchedule>,
    pub(crate) confirmed_feed_entries: Vec<FeedLiveEntry>,
    pub(crate) location_time_snapshot: Option<Vec<FriendLocationTime>>,
}

pub(crate) enum SyntheticFriendEvent {
    Delete { user_id: String },
    TrustedAdd { user_id: String, profile: Value },
}

#[derive(Clone, Copy)]
enum FriendEventTrust {
    Untrusted,
    TrustedFriendAdd,
}

struct ExpectedFriendScope<'a> {
    owner_user_id: &'a OwnerId,
    endpoint: &'a str,
}

struct OfflineBaselineTransition {
    user_id: String,
    next: FriendRecord,
    previous: OfflineFeedPrevious,
}

#[derive(Clone, Debug, Default)]
pub(super) struct RealtimeFriendState {
    pub(super) generation: u64,
    pub(super) timer_token: u64,
    pub(super) friend_state_sequence: u64,
    pub(super) friend_state_sequence_by_user: HashMap<String, u64>,
    pub(super) baseline: Option<RealtimeFriendSnapshot>,
    pub(super) friend_user_ids_snapshot: Option<Arc<HashSet<String>>>,
    pub(super) pending_offline: HashMap<String, PendingOffline>,
    pub(super) recent_gps: HashMap<String, RecentGps>,
    pub(super) instance_dwell: Arc<InstanceDwellRegistry>,
}

impl RealtimeFriendState {
    pub(super) fn invalidate_friend_user_ids_snapshot(&mut self) {
        self.friend_user_ids_snapshot = None;
    }
}

#[derive(Debug, Default)]
pub struct RealtimeFriendsRuntime {
    state: Mutex<RealtimeFriendState>,
}

impl RealtimeFriendsRuntime {
    pub fn new(instance_dwell: Arc<InstanceDwellRegistry>) -> Self {
        Self {
            state: Mutex::new(RealtimeFriendState {
                instance_dwell,
                ..RealtimeFriendState::default()
            }),
        }
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
            .result
    }

    pub(crate) fn set_baseline_with_effects(
        &self,
        baseline: FriendRosterBaseline,
        realtime_generation: u64,
        baseline_revision: u64,
        friend_state_sequence_watermark: Option<u64>,
    ) -> FriendBaselineEffects {
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
    ) -> FriendBaselineEffects {
        let mut baseline = baseline.normalized();
        let mut state = self.lock_state();
        let generation = realtime_generation;
        let same_generation = state
            .baseline
            .as_ref()
            .is_some_and(|snapshot| snapshot.generation == generation);
        state.generation = state.generation.max(generation);
        let mut pending_to_create = Vec::new();
        let mut resolved_pending_ids = HashSet::new();
        let mut confirmed_pending = Vec::new();
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
                if record.is_placeholder() {
                    preserve_fields_over_placeholder(record, existing_record);
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
                    if leaves_online(&record.state) {
                        confirmed_pending.push(OfflineBaselineTransition {
                            user_id: user_id.clone(),
                            next: record.clone(),
                            previous: pending.previous.clone(),
                        });
                    }
                } else if StateBucket::Online.matches(&existing_record.state)
                    && leaves_online(&record.state)
                {
                    pending_to_create.push(OfflineBaselineTransition {
                        user_id: user_id.clone(),
                        next: record.clone(),
                        previous: OfflineFeedPrevious::from_record(existing_record),
                    });
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
            .map(|transition| {
                offline_feed_entry(
                    &transition.user_id,
                    &transition.next,
                    &transition.previous,
                    &confirmed_at_iso,
                    confirmed_at.timestamp_millis(),
                )
            })
            .collect::<Vec<_>>();
        let mut schedules = Vec::new();
        for transition in pending_to_create {
            state.timer_token = state.timer_token.saturating_add(1);
            let token = state.timer_token;
            state.pending_offline.insert(
                transition.user_id.clone(),
                PendingOffline {
                    token,
                    patch: FriendRecordPatch::from_record(&transition.next),
                    state_bucket: transition.next.state.clone(),
                    previous: transition.previous,
                },
            );
            schedules.push(PendingOfflineSchedule {
                user_id: transition.user_id,
                token,
                delay: PENDING_OFFLINE_DELAY,
            });
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
            for record in baseline.friends_by_id.values_mut() {
                record.extra.remove("pendingOffline");
            }
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
        let friend_membership_changed = state.baseline.as_ref().map_or(
            !baseline.friends_by_id.is_empty(),
            |existing_snapshot| {
                existing_snapshot.friends_by_id.len() != baseline.friends_by_id.len()
                    || existing_snapshot
                        .friends_by_id
                        .keys()
                        .any(|user_id| !baseline.friends_by_id.contains_key(user_id))
            },
        );
        let friend_count = baseline.friends_by_id.len();
        state.baseline = Some(RealtimeFriendSnapshot {
            current_user_id: baseline.current_user_id,
            endpoint: baseline.endpoint,
            websocket: baseline.websocket,
            generation,
            baseline_revision,
            friends_by_id: baseline.friends_by_id,
        });
        let instance_dwell = Arc::clone(&state.instance_dwell);
        let location_time_snapshot = state.baseline.as_ref().and_then(|snapshot| {
            instance_dwell.sync_friends(&snapshot.friends_by_id, confirmed_at.timestamp_millis())
        });
        if friend_membership_changed {
            state.invalidate_friend_user_ids_snapshot();
        }
        if !changed_user_ids.is_empty() {
            state.friend_state_sequence = state.friend_state_sequence.saturating_add(1);
            let sequence = state.friend_state_sequence;
            for user_id in changed_user_ids {
                state
                    .friend_state_sequence_by_user
                    .insert(user_id, sequence);
            }
        }

        FriendBaselineEffects {
            result: FriendBaselineResult {
                accepted: true,
                generation,
                baseline_revision,
                friend_count: u32::try_from(friend_count).unwrap_or(u32::MAX),
            },
            schedules,
            confirmed_feed_entries,
            location_time_snapshot,
        }
    }

    pub fn clear(&self) -> u64 {
        let mut state = self.lock_state();
        state.generation = state.generation.saturating_add(1);
        state.baseline = None;
        state.invalidate_friend_user_ids_snapshot();
        state.pending_offline.clear();
        state.recent_gps.clear();
        state.friend_state_sequence_by_user.clear();
        state.instance_dwell.clear();
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
            state.invalidate_friend_user_ids_snapshot();
            state.pending_offline.clear();
            state.recent_gps.clear();
            state.friend_state_sequence_by_user.clear();
            state.instance_dwell.clear();
        }
        should_clear
    }

    pub(crate) fn restart_preserving_baseline(
        &self,
        session: &RealtimeSessionContext,
        generation: u64,
    ) -> Option<Vec<String>> {
        let mut state = self.lock_state();
        {
            let baseline = state.baseline.as_ref()?;
            if baseline.current_user_id != session.user_id
                || baseline.endpoint != session.endpoint
                || baseline.websocket != session.websocket
            {
                return None;
            }
        }
        let pending_offline = std::mem::take(&mut state.pending_offline);
        let baseline = state
            .baseline
            .as_mut()
            .expect("friend baseline was validated while holding the state lock");
        baseline.generation = generation;
        baseline.baseline_revision = 0;
        for user_id in pending_offline.keys() {
            if let Some(record) = baseline.friends_by_id.get_mut(user_id) {
                record.extra.remove("pendingOffline");
            }
        }
        let friend_user_ids = baseline.friends_by_id.keys().cloned().collect();
        state.generation = state.generation.max(generation);
        state.recent_gps.clear();
        state.friend_state_sequence_by_user.clear();
        Some(friend_user_ids)
    }

    pub fn snapshot(&self) -> Option<RealtimeFriendSnapshot> {
        self.lock_state().baseline.clone()
    }

    pub fn is_current_friend(&self, user_id: &str) -> bool {
        let user_id = user_id.trim();
        if user_id.is_empty() {
            return false;
        }
        self.lock_state()
            .baseline
            .as_ref()
            .is_some_and(|baseline| baseline.friends_by_id.contains_key(user_id))
    }

    pub fn current_friend_record(&self, user_id: &str) -> Option<RealtimeFriendRecordSnapshot> {
        let user_id = user_id.trim();
        if user_id.is_empty() {
            return None;
        }
        let state = self.lock_state();
        let baseline = state.baseline.as_ref()?;
        let record = baseline.friends_by_id.get(user_id)?.clone();
        Some(RealtimeFriendRecordSnapshot {
            endpoint: baseline.endpoint.clone(),
            record,
        })
    }

    pub fn friend_user_ids_snapshot(&self) -> Arc<HashSet<String>> {
        let mut state = self.lock_state();
        if let Some(snapshot) = state.friend_user_ids_snapshot.as_ref() {
            return Arc::clone(snapshot);
        }
        let snapshot = Arc::new(
            state
                .baseline
                .as_ref()
                .map(|baseline| baseline.friends_by_id.keys().cloned().collect())
                .unwrap_or_default(),
        );
        state.friend_user_ids_snapshot = Some(Arc::clone(&snapshot));
        snapshot
    }

    pub(crate) fn with_user_cache_records<R>(
        &self,
        visit: impl FnOnce(&str, &HashMap<String, FriendRecord>) -> R,
    ) -> Option<R> {
        let state = self.lock_state();
        let baseline = state.baseline.as_ref()?;
        Some(visit(&baseline.endpoint, &baseline.friends_by_id))
    }

    pub fn roster_snapshot(
        &self,
        previous_order: &[String],
    ) -> serde_json::Result<Option<RealtimeFriendRosterSnapshot>> {
        let state = self.lock_state();
        let Some(baseline) = state.baseline.as_ref() else {
            return Ok(None);
        };
        let snapshot = current_friend_roster_snapshot(
            &baseline.current_user_id,
            &baseline.friends_by_id,
            previous_order,
        )?;
        Ok(Some(RealtimeFriendRosterSnapshot {
            current_user_id: baseline.current_user_id.clone(),
            endpoint: baseline.endpoint.clone(),
            websocket: baseline.websocket.clone(),
            friend_count: baseline.friends_by_id.len(),
            snapshot: snapshot.into(),
        }))
    }

    pub fn session_context(&self) -> Option<RealtimeSessionContext> {
        self.lock_state()
            .baseline
            .as_ref()
            .map(|baseline| RealtimeSessionContext {
                user_id: baseline.current_user_id.clone(),
                endpoint: baseline.endpoint.clone(),
                websocket: baseline.websocket.clone(),
            })
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
        let Some(event_kind) = RealtimeWsEventKind::from_payload(payload) else {
            return RealtimeFriendApplyResult::Ignored;
        };
        self.apply_ws_event(&event_kind, payload)
    }

    pub(crate) fn apply_ws_event(
        &self,
        event_kind: &RealtimeWsEventKind,
        payload: &RealtimeWsMessagePayload,
    ) -> RealtimeFriendApplyResult {
        self.apply_friend_message(event_kind, payload)
    }

    pub(crate) fn apply_scoped_synthetic_event(
        &self,
        expected_owner_user_id: &OwnerId,
        expected_endpoint: &str,
        event: SyntheticFriendEvent,
        received_at: &str,
    ) -> RealtimeFriendApplyResult {
        let (event_kind, content, trust) = match event {
            SyntheticFriendEvent::Delete { user_id } => (
                FriendEventKind::Delete,
                json!({ "userId": user_id }),
                FriendEventTrust::Untrusted,
            ),
            SyntheticFriendEvent::TrustedAdd { user_id, profile } => (
                FriendEventKind::Add,
                json!({ "userId": user_id, "user": profile }),
                FriendEventTrust::TrustedFriendAdd,
            ),
        };
        self.apply_friend_content(
            event_kind,
            &content,
            received_at,
            Some(ExpectedFriendScope {
                owner_user_id: expected_owner_user_id,
                endpoint: expected_endpoint,
            }),
            trust,
        )
    }

    fn apply_friend_message(
        &self,
        ws_event_kind: &RealtimeWsEventKind,
        payload: &RealtimeWsMessagePayload,
    ) -> RealtimeFriendApplyResult {
        let Some(event_kind) = FriendEventKind::from_ws_event_kind(ws_event_kind) else {
            return RealtimeFriendApplyResult::Ignored;
        };
        let content = payload.json.get("content").unwrap_or(&Value::Null);
        self.apply_friend_content(
            event_kind,
            content,
            &payload.received_at,
            None,
            FriendEventTrust::Untrusted,
        )
    }

    fn apply_friend_content(
        &self,
        event_kind: FriendEventKind,
        content: &Value,
        received_at: &str,
        expected_scope: Option<ExpectedFriendScope<'_>>,
        trust: FriendEventTrust,
    ) -> RealtimeFriendApplyResult {
        let now = EventTime::from_received_at(received_at);
        let mut state = self.lock_state();
        let Some(baseline) = state.baseline.as_ref() else {
            return RealtimeFriendApplyResult::MissingBaseline;
        };
        if expected_scope.is_some_and(|expected| {
            baseline.current_user_id != expected.owner_user_id.as_str().trim()
                || normalize_vrchat_api_endpoint(Some(&baseline.endpoint))
                    != normalize_vrchat_api_endpoint(Some(expected.endpoint))
        }) {
            return RealtimeFriendApplyResult::MissingBaseline;
        }
        let output = match trust {
            FriendEventTrust::TrustedFriendAdd => {
                apply_trusted_friend_add_event(&mut state, content, &now)
            }
            FriendEventTrust::Untrusted => {
                apply_friend_event(&mut state, event_kind, content, &now)
            }
        };
        let Some(output) = output else {
            return RealtimeFriendApplyResult::Ignored;
        };
        record_output_friend_state_sequence(&mut state, &output);
        RealtimeFriendApplyResult::Output(Box::new(output))
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
        if is_online_state(current)
            && !current
                .extra
                .get("pendingOffline")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        {
            return None;
        }

        let mut patch = pending.patch;
        patch.set_pending_offline(false);
        let state_bucket = pending.state_bucket;
        let previous = pending.previous;
        let mut output =
            RealtimeFriendOutput::new(OwnerId::new(owner_user_id), generation, baseline_revision);
        apply_record_patch_to_state(
            &mut state,
            &mut output,
            user_id,
            patch,
            &state_bucket,
            FriendStateBucketAuthority::Explicit,
            &now_iso,
        );
        let current = state
            .baseline
            .as_ref()
            .and_then(|baseline| baseline.friends_by_id.get(user_id))?;
        output.persistence.feed_entries.push(offline_feed_entry(
            user_id,
            current,
            &previous,
            &now_iso,
            Utc::now().timestamp_millis(),
        ));
        output.projection.feed_entries = output.persistence.feed_entries.clone();
        record_output_friend_state_sequence(&mut state, &output);
        Some(output)
    }

    fn lock_state(&self) -> MutexGuard<'_, RealtimeFriendState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

fn leaves_online(state_bucket: &str) -> bool {
    matches!(
        StateBucket::from_exact(state_bucket),
        Some(StateBucket::Offline | StateBucket::Active)
    )
}

fn current_friend_roster_snapshot(
    user_id: &str,
    friends_by_id: &HashMap<String, FriendRecord>,
    previous_order: &[String],
) -> serde_json::Result<Value> {
    let mut ordered_friend_ids = previous_order
        .iter()
        .filter(|friend_id| friends_by_id.contains_key(*friend_id))
        .cloned()
        .collect::<Vec<_>>();
    let mut seen = ordered_friend_ids.iter().cloned().collect::<HashSet<_>>();
    let mut added = friends_by_id
        .keys()
        .filter(|friend_id| seen.insert((*friend_id).clone()))
        .cloned()
        .collect::<Vec<_>>();
    added.sort();
    ordered_friend_ids.extend(added);

    let bucket_ids = |bucket: &str| {
        ordered_friend_ids
            .iter()
            .filter(|friend_id| {
                friends_by_id
                    .get(*friend_id)
                    .is_some_and(|friend| friend_snapshot_state_bucket(friend) == bucket)
            })
            .cloned()
            .collect::<Vec<_>>()
    };
    let online_ids = bucket_ids("online");
    let active_ids = bucket_ids("active");
    let offline_ids = bucket_ids("offline");
    let ordered_friend_ids = online_ids
        .iter()
        .chain(&active_ids)
        .chain(&offline_ids)
        .cloned()
        .collect::<Vec<_>>();
    let friends_by_id = serde_json::to_value(friends_by_id)?;

    Ok(json!({
        "currentUserId": user_id,
        "friendsById": friends_by_id,
        "orderedFriendIds": ordered_friend_ids,
        "onlineIds": online_ids,
        "activeIds": active_ids,
        "offlineIds": offline_ids,
        "detail": "",
    }))
}

fn friend_snapshot_state_bucket(friend: &FriendRecord) -> &str {
    match friend.state.as_str() {
        "online" => "online",
        "active" => "active",
        _ => "offline",
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

fn preserve_fields_over_placeholder(incoming: &mut FriendRecord, existing: &FriendRecord) {
    incoming.location = existing.location.clone();
    incoming.traveling_to_location = existing.traveling_to_location.clone();
    incoming.world_id = existing.world_id.clone();
    incoming.platform = existing.platform.clone();
    incoming.last_platform = existing.last_platform.clone();
    incoming.status = existing.status.clone();
    incoming.status_description = existing.status_description.clone();

    for key in [
        "pendingOffline",
        derived_keys::LOCATION_PROJECTION,
        "locationUpdatedAt",
        "instanceId",
        "travelingToWorld",
        "travelingToInstance",
        derived_keys::TRAVELING_TO_LOCATION_PROJECTION,
        derived_keys::TRAVELING_TO_TIME,
        "travelingToLocation",
        "tags",
        "developerType",
        "trustLevel",
        derived_keys::TRUST_LEVEL,
        derived_keys::TRUST_CLASS,
        derived_keys::TRUST_SORT_NUM,
        derived_keys::IS_MODERATOR,
        derived_keys::IS_TROLL,
        derived_keys::IS_PROBABLE_TROLL,
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
