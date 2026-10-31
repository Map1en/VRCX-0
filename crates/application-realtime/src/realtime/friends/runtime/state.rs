use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};
use vrcx_0_application_core::{FriendLocationTime, InstanceDwellRegistry};
use vrcx_0_core::derived_keys;

use chrono::{TimeZone, Utc};
use serde_json::{json, Value};
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_core::friends::{FriendBaselineEntry, FriendRecord, FriendRosterBaseline};
use vrcx_0_core::presence::PresenceEntry;
use vrcx_0_core::realtime::{RealtimeSessionContext, RealtimeWsMessagePayload};
use vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint;
use vrcx_0_core::OwnerId;

use crate::realtime::event_kind::RealtimeWsEventKind;
use crate::realtime::friends::presence::{
    dwell_place, joining_feed, presence_feed, presence_view, reduce, Evidence, FriendEventKind,
    Phase, Source,
};
use crate::realtime::{
    FriendBaselineResult, FriendWake, RealtimeFriendApplyResult, RealtimeFriendOutput,
    RealtimeFriendRecordSnapshot, RealtimeFriendRosterSnapshot, RealtimeFriendSnapshot,
};

use super::apply::{apply_friend_event, apply_wake};
use crate::realtime::event_time::EventTime;

#[derive(Clone, Debug)]
pub(super) struct FriendEntry {
    pub(super) record: FriendRecord,
    pub(super) presence: Phase,
}

#[derive(Clone, Debug)]
pub(super) struct Roster {
    pub(super) session: RealtimeSessionContext,
    pub(super) generation: u64,
    pub(super) baseline_revision: u64,
    pub(super) entries: HashMap<String, FriendEntry>,
}

pub(crate) enum RosterDelta {
    Rebuilt {
        removed: Vec<String>,
    },
    Changed {
        patched: Vec<String>,
        removed: Vec<String>,
    },
}

pub(crate) struct FriendBaselineEffects {
    pub(crate) result: FriendBaselineResult,
    pub(crate) reconnected: bool,
    pub(crate) delta: RosterDelta,
    pub(crate) schedules: Vec<FriendWake>,
    pub(crate) presence_feed_entries: Vec<FeedLiveEntry>,
    pub(crate) joining_feed_entries: Vec<FeedLiveEntry>,
    pub(crate) profile_refetch_user_ids: Vec<String>,
    pub(crate) location_time_snapshot: Option<Vec<FriendLocationTime>>,
}

pub(crate) enum SyntheticFriendEvent {
    Delete { user_id: String },
    TrustedAdd { user_id: String, profile: Value },
}

struct ExpectedFriendScope<'a> {
    owner_user_id: &'a OwnerId,
    endpoint: &'a str,
}

#[derive(Debug, Default)]
pub(super) struct RealtimeFriendState {
    pub(super) friend_rev: u64,
    pub(super) friend_rev_by_user: HashMap<String, u64>,
    pub(super) roster: Option<Roster>,
    pub(super) friend_user_ids_snapshot: Option<Arc<HashSet<String>>>,
    pub(super) instance_dwell: Arc<InstanceDwellRegistry>,
}

impl RealtimeFriendState {
    pub(super) fn invalidate_friend_user_ids_snapshot(&mut self) {
        self.friend_user_ids_snapshot = None;
    }

    pub(super) fn entry(&self, user_id: &str) -> Option<&FriendEntry> {
        self.roster.as_ref()?.entries.get(user_id)
    }

    fn rev_of(&self, user_id: &str) -> u64 {
        self.friend_rev_by_user
            .get(user_id)
            .copied()
            .unwrap_or_default()
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

    pub(crate) fn roster_revision(&self) -> Option<(u64, u64)> {
        self.lock_state()
            .roster
            .as_ref()
            .map(|roster| (roster.generation, roster.baseline_revision))
    }

    pub(crate) fn friend_rev(&self) -> u64 {
        self.lock_state().friend_rev
    }

    #[cfg(any(test, feature = "test-utils"))]
    pub fn set_baseline(
        &self,
        baseline: FriendRosterBaseline,
        realtime_generation: u64,
        baseline_revision: u64,
    ) -> FriendBaselineResult {
        self.set_baseline_with_effects(
            baseline,
            realtime_generation,
            baseline_revision,
            None,
            Utc::now().timestamp_millis(),
        )
        .result
    }

    pub(crate) fn set_baseline_with_effects(
        &self,
        baseline: FriendRosterBaseline,
        generation: u64,
        baseline_revision: u64,
        friend_rev_watermark: Option<u64>,
        now_ms: i64,
    ) -> FriendBaselineEffects {
        let baseline = baseline.normalized();
        let mut state = self.lock_state();
        let now_iso = Utc
            .timestamp_millis_opt(now_ms)
            .single()
            .map(|time| time.to_rfc3339())
            .unwrap_or_default();
        let watermark = friend_rev_watermark.unwrap_or(0);
        let replaced = state.roster.take();
        let previous_ids = replaced
            .as_ref()
            .map(|roster| roster.entries.keys().cloned().collect::<HashSet<_>>())
            .unwrap_or_default();
        let baseline_session = RealtimeSessionContext {
            user_id: baseline.current_user_id,
            endpoint: baseline.endpoint,
            websocket: baseline.websocket,
        };
        let existing = replaced.filter(|roster| roster.session == baseline_session);
        let new_generation = existing
            .as_ref()
            .is_none_or(|roster| roster.generation != generation);
        if new_generation {
            state.friend_rev_by_user.clear();
        }
        let reconnected = new_generation && existing.is_some();
        let mut presence_feed_entries = Vec::new();
        let mut joining_feed_entries = Vec::new();
        let unseen = Phase::offline();
        let mut schedules = Vec::new();
        let mut profile_refetch_user_ids = Vec::new();
        let mut entries = HashMap::with_capacity(baseline.friends_by_id.len());
        for (
            user_id,
            FriendBaselineEntry {
                mut record,
                presence: reported,
            },
        ) in baseline.friends_by_id
        {
            let existing_entry = existing
                .as_ref()
                .and_then(|roster| roster.entries.get(&user_id));
            if existing.is_some() && state.rev_of(&user_id) > watermark {
                if let Some(entry) = existing_entry {
                    entries.insert(user_id, entry.clone());
                }
                continue;
            }
            if let Some(entry) = existing_entry {
                if record.is_placeholder() {
                    preserve_fields_over_placeholder(&mut record, &entry.record);
                }
                if (record.display_name.is_empty() || record.display_name == record.id)
                    && !entry.record.display_name.is_empty()
                    && entry.record.display_name != entry.record.id
                {
                    record.display_name = entry.record.display_name.clone();
                }
            }
            let evidence = Evidence::from_baseline(&reported);
            let presence = match existing_entry {
                Some(entry) => {
                    let step = reduce(&entry.presence, &evidence, now_ms);
                    presence_feed_entries.extend(presence_feed(
                        &user_id,
                        &record,
                        &entry.presence,
                        &step.next,
                        now_ms,
                        &now_iso,
                    ));
                    let wake_at_ms = if new_generation {
                        step.next.wake_at()
                    } else {
                        step.wake_at_ms
                    };
                    if let Some(wake_at_ms) = wake_at_ms {
                        schedules.push(FriendWake::at(&user_id, wake_at_ms));
                    }
                    if step.refetch {
                        profile_refetch_user_ids.push(user_id.clone());
                    }
                    step.next
                }
                None => Phase::initial(&evidence.claim, now_ms, false),
            };
            let shown = existing_entry
                .filter(|_| !new_generation)
                .map_or(&unseen, |entry| &entry.presence);
            if let Some(entry) = joining_feed(&user_id, &record, shown, &presence, &now_iso) {
                joining_feed_entries.push((user_id.clone(), entry));
            }
            entries.insert(user_id, FriendEntry { record, presence });
        }
        if let Some(existing) = existing.as_ref() {
            for (user_id, entry) in &existing.entries {
                if !entries.contains_key(user_id) && state.rev_of(user_id) > watermark {
                    entries.insert(user_id.clone(), entry.clone());
                }
            }
        }

        let removed = existing
            .as_ref()
            .map(|existing| {
                existing
                    .entries
                    .keys()
                    .filter(|user_id| !entries.contains_key(*user_id))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        let delta = match existing.as_ref().filter(|_| !new_generation) {
            None => RosterDelta::Rebuilt { removed },
            Some(existing) => RosterDelta::Changed {
                patched: entries
                    .iter()
                    .filter(|(user_id, entry)| {
                        existing.entries.get(*user_id).is_none_or(|previous| {
                            previous.record != entry.record
                                || presence_view(&previous.presence)
                                    != presence_view(&entry.presence)
                        })
                    })
                    .map(|(user_id, _)| user_id.clone())
                    .collect(),
                removed,
            },
        };
        let membership_changed = previous_ids.len() != entries.len()
            || previous_ids
                .iter()
                .any(|user_id| !entries.contains_key(user_id));
        let friend_count = entries.len();
        let roster = Roster {
            session: baseline_session,
            generation,
            baseline_revision,
            entries,
        };
        let places = roster
            .entries
            .iter()
            .map(|(user_id, entry)| (user_id.clone(), dwell_place(&entry.presence)))
            .collect::<HashMap<_, _>>();
        state.roster = Some(roster);
        let location_time_snapshot = state.instance_dwell.sync_friends(&places);
        if membership_changed {
            state.invalidate_friend_user_ids_snapshot();
        }
        if let RosterDelta::Changed { patched, removed } = &delta {
            if !patched.is_empty() || !removed.is_empty() {
                state.friend_rev = state.friend_rev.saturating_add(1);
                let rev = state.friend_rev;
                for user_id in patched.iter().chain(removed) {
                    state.friend_rev_by_user.insert(user_id.clone(), rev);
                }
            }
        }

        joining_feed_entries.sort_by(|(left, _), (right, _)| left.cmp(right));
        FriendBaselineEffects {
            result: FriendBaselineResult {
                accepted: true,
                generation,
                baseline_revision,
                friend_count: u32::try_from(friend_count).unwrap_or(u32::MAX),
            },
            reconnected,
            delta,
            schedules,
            presence_feed_entries,
            joining_feed_entries: joining_feed_entries
                .into_iter()
                .map(|(_, entry)| entry)
                .collect(),
            profile_refetch_user_ids,
            location_time_snapshot,
        }
    }

    pub fn clear(&self) {
        let mut state = self.lock_state();
        state.roster = None;
        state.invalidate_friend_user_ids_snapshot();
        state.friend_rev_by_user.clear();
        state.instance_dwell.clear();
    }

    pub(crate) fn restart_preserving_baseline(
        &self,
        session: &RealtimeSessionContext,
        generation: u64,
    ) -> Option<(Vec<String>, Vec<FriendWake>)> {
        let mut state = self.lock_state();
        let roster = state
            .roster
            .as_mut()
            .filter(|roster| roster.session == *session)?;
        roster.generation = generation;
        roster.baseline_revision = 0;
        let schedules = roster
            .entries
            .iter()
            .filter_map(|(user_id, entry)| {
                entry
                    .presence
                    .wake_at()
                    .map(|wake_at_ms| FriendWake::at(user_id, wake_at_ms))
            })
            .collect();
        let friend_user_ids = roster.entries.keys().cloned().collect();
        state.friend_rev_by_user.clear();
        Some((friend_user_ids, schedules))
    }

    pub fn snapshot(&self) -> Option<RealtimeFriendSnapshot> {
        let state = self.lock_state();
        let roster = state.roster.as_ref()?;
        Some(RealtimeFriendSnapshot {
            current_user_id: roster.session.user_id.clone(),
            endpoint: roster.session.endpoint.clone(),
            websocket: roster.session.websocket.clone(),
            generation: roster.generation,
            baseline_revision: roster.baseline_revision,
            friends_by_id: roster
                .entries
                .iter()
                .map(|(user_id, entry)| (user_id.clone(), entry.record.clone()))
                .collect(),
            presence_by_id: presence_entries(&state, roster),
        })
    }

    pub fn is_current_friend(&self, user_id: &str) -> bool {
        let user_id = user_id.trim();
        !user_id.is_empty() && self.lock_state().entry(user_id).is_some()
    }

    pub fn current_friend_record(&self, user_id: &str) -> Option<RealtimeFriendRecordSnapshot> {
        let user_id = user_id.trim();
        if user_id.is_empty() {
            return None;
        }
        let state = self.lock_state();
        let roster = state.roster.as_ref()?;
        Some(RealtimeFriendRecordSnapshot {
            endpoint: roster.session.endpoint.clone(),
            record: roster.entries.get(user_id)?.record.clone(),
        })
    }

    pub fn friend_user_ids_snapshot(&self) -> Arc<HashSet<String>> {
        let mut state = self.lock_state();
        if let Some(snapshot) = state.friend_user_ids_snapshot.as_ref() {
            return Arc::clone(snapshot);
        }
        let snapshot = Arc::new(
            state
                .roster
                .as_ref()
                .map(|roster| roster.entries.keys().cloned().collect())
                .unwrap_or_default(),
        );
        state.friend_user_ids_snapshot = Some(Arc::clone(&snapshot));
        snapshot
    }

    pub(crate) fn with_user_cache_records<R>(
        &self,
        visit: impl FnOnce(&str, &mut dyn Iterator<Item = &FriendRecord>) -> R,
    ) -> Option<R> {
        let state = self.lock_state();
        let roster = state.roster.as_ref()?;
        let mut records = roster.entries.values().map(|entry| &entry.record);
        Some(visit(&roster.session.endpoint, &mut records))
    }

    pub fn roster_snapshot(&self) -> Option<RealtimeFriendRosterSnapshot> {
        let snapshot = self.snapshot()?;
        Some(RealtimeFriendRosterSnapshot {
            friend_count: snapshot.friends_by_id.len(),
            snapshot: snapshot.to_roster_snapshot(),
            current_user_id: snapshot.current_user_id,
            endpoint: snapshot.endpoint,
            websocket: snapshot.websocket,
        })
    }

    pub fn session_context(&self) -> Option<RealtimeSessionContext> {
        self.lock_state()
            .roster
            .as_ref()
            .map(|roster| roster.session.clone())
    }

    pub fn has_friend(&self, generation: u64, user_id: &str) -> bool {
        let user_id = user_id.trim();
        !user_id.is_empty()
            && self
                .lock_state()
                .roster
                .as_ref()
                .filter(|roster| roster.generation == generation)
                .is_some_and(|roster| roster.entries.contains_key(user_id))
    }

    pub(crate) fn friend_rev_of(&self, generation: u64, user_id: &str) -> Option<u64> {
        let user_id = user_id.trim();
        let state = self.lock_state();
        let roster = state.roster.as_ref()?;
        if user_id.is_empty()
            || roster.generation != generation
            || !roster.entries.contains_key(user_id)
        {
            return None;
        }
        Some(state.rev_of(user_id))
    }

    #[cfg(test)]
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
        let Some(event_kind) = FriendEventKind::from_ws_event_kind(event_kind) else {
            return RealtimeFriendApplyResult::Ignored;
        };
        let content = payload.json.get("content").unwrap_or(&Value::Null);
        self.apply_friend_content(event_kind, content, &payload.received_at, None, Source::Ws)
    }

    pub(crate) fn apply_scoped_synthetic_event(
        &self,
        expected_owner_user_id: &OwnerId,
        expected_endpoint: &str,
        event: SyntheticFriendEvent,
        received_at: &str,
    ) -> RealtimeFriendApplyResult {
        let (event_kind, content, source) = match event {
            SyntheticFriendEvent::Delete { user_id } => (
                FriendEventKind::Delete,
                json!({ "userId": user_id }),
                Source::Ws,
            ),
            SyntheticFriendEvent::TrustedAdd { user_id, profile } => (
                FriendEventKind::Add,
                json!({ "userId": user_id, "user": profile }),
                Source::TrustedAdd,
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
            source,
        )
    }

    fn apply_friend_content(
        &self,
        event_kind: FriendEventKind,
        content: &Value,
        received_at: &str,
        expected_scope: Option<ExpectedFriendScope<'_>>,
        source: Source,
    ) -> RealtimeFriendApplyResult {
        let now = EventTime::from_received_at(received_at);
        let mut state = self.lock_state();
        let Some(roster) = state.roster.as_ref() else {
            return RealtimeFriendApplyResult::MissingBaseline;
        };
        if expected_scope.is_some_and(|expected| {
            roster.session.user_id != expected.owner_user_id.as_str().trim()
                || normalize_vrchat_api_endpoint(Some(&roster.session.endpoint))
                    != normalize_vrchat_api_endpoint(Some(expected.endpoint))
        }) {
            return RealtimeFriendApplyResult::MissingBaseline;
        }
        let output = apply_friend_event(&mut state, event_kind, content, &now, source);
        finish_output(&mut state, output)
    }

    pub(crate) fn apply_refetched_user_profile_if_rev(
        &self,
        generation: u64,
        user_id: &str,
        expected_rev: u64,
        profile: Value,
        received_at: &str,
    ) -> RealtimeFriendApplyResult {
        let mut state = self.lock_state();
        let Some(roster) = state.roster.as_ref() else {
            return RealtimeFriendApplyResult::MissingBaseline;
        };
        let user_id = user_id.trim();
        if roster.generation != generation
            || user_id.is_empty()
            || !roster.entries.contains_key(user_id)
            || state.rev_of(user_id) != expected_rev
        {
            return RealtimeFriendApplyResult::Ignored;
        }
        let content = json!({ "userId": user_id, "user": profile });
        let now = EventTime::from_received_at(received_at);
        let output = apply_friend_event(
            &mut state,
            FriendEventKind::Update,
            &content,
            &now,
            Source::Api,
        );
        finish_output(&mut state, output)
    }

    pub fn wake(&self, user_id: &str, now_iso: &str) -> Option<RealtimeFriendOutput> {
        let mut state = self.lock_state();
        let now = EventTime::from_received_at(now_iso);
        let mut output = apply_wake(&mut state, user_id, &now)?;
        stamp_output_revs(&mut state, &mut output);
        Some(output)
    }

    pub fn feed_entry_output(
        &self,
        generation: u64,
        feed_entry: FeedLiveEntry,
    ) -> Option<RealtimeFriendOutput> {
        let state = self.lock_state();
        let roster = state
            .roster
            .as_ref()
            .filter(|roster| roster.generation == generation)?;
        let mut output = RealtimeFriendOutput::new(
            OwnerId::new(roster.session.user_id.clone()),
            roster.generation,
            roster.baseline_revision,
        );
        output.persistence.feed_entries.push(feed_entry);
        Some(output)
    }

    fn lock_state(&self) -> MutexGuard<'_, RealtimeFriendState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

fn finish_output(
    state: &mut RealtimeFriendState,
    output: Option<RealtimeFriendOutput>,
) -> RealtimeFriendApplyResult {
    let Some(mut output) = output else {
        return RealtimeFriendApplyResult::Ignored;
    };
    stamp_output_revs(state, &mut output);
    RealtimeFriendApplyResult::Output(Box::new(output))
}

fn presence_entries(
    state: &RealtimeFriendState,
    roster: &Roster,
) -> HashMap<String, PresenceEntry> {
    roster
        .entries
        .iter()
        .map(|(user_id, entry)| {
            (
                user_id.clone(),
                PresenceEntry {
                    rev: state.rev_of(user_id),
                    view: presence_view(&entry.presence),
                },
            )
        })
        .collect()
}

fn stamp_output_revs(state: &mut RealtimeFriendState, output: &mut RealtimeFriendOutput) {
    let user_ids = output
        .projection
        .patches
        .iter()
        .map(|patch| patch.user_id.clone())
        .chain(output.projection.removals.iter().cloned())
        .collect::<HashSet<_>>();
    if user_ids.is_empty() {
        return;
    }
    state.friend_rev = state.friend_rev.saturating_add(1);
    let rev = state.friend_rev;
    for user_id in user_ids {
        state.friend_rev_by_user.insert(user_id, rev);
    }
    for patch in &mut output.projection.patches {
        patch.presence.rev = rev;
    }
}

fn preserve_fields_over_placeholder(incoming: &mut FriendRecord, existing: &FriendRecord) {
    incoming.last_platform = existing.last_platform.clone();
    incoming.status = existing.status.clone();
    incoming.status_description = existing.status_description.clone();

    for key in [
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
