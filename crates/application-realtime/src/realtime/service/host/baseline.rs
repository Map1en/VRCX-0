use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use vrcx_0_application_core::RuntimeOperationStatus;
use vrcx_0_core::derived_keys;

use serde_json::Value;
use vrcx_0_application_core::{Error, Result};
use vrcx_0_core::friends::{FriendBaselineEntry, FriendRecord, FriendRosterBaseline};

use crate::realtime::friends::{baseline_friend_view, FriendBaselineEffects, RosterDelta};
use crate::realtime::{
    FriendBaselineCausalWatermark, FriendBaselineResult, FriendBaselineSyncOutcome,
    FriendProjection, RealtimeFriendOutput, RealtimeFriendSnapshot, RealtimeSessionContext,
};
use crate::social_baseline::service::{
    reconcile_friend_roster_records, FriendRosterReconcileOutcome, FriendStatusVerdicts,
};

use super::state::{
    ActiveRealtimeContext, FriendOwnerGuard, QueuedFriendBaseline, ReconnectBackfillCheck,
    ScopedFriendLogMutation,
};
use super::RealtimeHostRuntime;
use vrcx_0_core::OwnerId;

struct FriendBaselineApplyPlan {
    active: ActiveRealtimeContext,
    effects: FriendBaselineEffects,
}

impl RealtimeHostRuntime {
    pub(super) fn apply_friend_baseline_effects_owned(
        self: &Arc<Self>,
        owner: &FriendOwnerGuard<'_>,
        owner_user_id: &OwnerId,
        mut projection: FriendProjection,
        snapshot: Option<&RealtimeFriendSnapshot>,
        effects: FriendBaselineEffects,
    ) {
        let FriendBaselineEffects {
            result,
            reconnected,
            delta,
            schedules,
            mut presence_feed_entries,
            joining_feed_entries,
            profile_refetch_user_ids,
            location_time_snapshot,
        } = effects;
        if reconnected && self.reconnect_left_to_backfill() {
            presence_feed_entries.clear();
        }
        if let Some(snapshot) = snapshot {
            add_roster_delta(&mut projection, snapshot, &delta);
        }
        if location_time_snapshot.is_some() {
            projection.location_time_snapshot = location_time_snapshot;
        }
        if !projection.patches.is_empty()
            || !projection.removals.is_empty()
            || projection.location_time_snapshot.is_some()
            || projection.friend_log_changed
            || !presence_feed_entries.is_empty()
            || !joining_feed_entries.is_empty()
        {
            self.apply_friend_output_owned(
                owner,
                RealtimeFriendOutput::from_baseline(
                    owner_user_id.clone(),
                    projection,
                    presence_feed_entries,
                    joining_feed_entries,
                ),
            );
        }
        for wake in schedules {
            self.schedule_friend_wake(result.generation, wake);
        }
        self.schedule_friend_profile_refetches(result.generation, profile_refetch_user_ids);
    }

    pub fn set_reconnect_backfill_check(&self, check: ReconnectBackfillCheck) {
        *self
            .reconnect_backfill_check
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(check);
    }

    fn reconnect_left_to_backfill(&self) -> bool {
        let check = self
            .reconnect_backfill_check
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        check.is_some_and(|check| check())
    }

    pub fn capture_friend_baseline_watermark(&self) -> Result<FriendBaselineCausalWatermark> {
        let _owner = self.lock_friend_owner();
        let state = self
            .state
            .lock()
            .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
        let active_generation = state
            .connection
            .active_context
            .as_ref()
            .map(|active| active.generation);
        Ok(FriendBaselineCausalWatermark {
            generation: active_generation,
            baseline_revision: self
                .friends
                .roster_revision()
                .filter(|(generation, _)| Some(*generation) == active_generation)
                .map(|(_, baseline_revision)| baseline_revision),
            friend_rev: self.friends.friend_rev(),
            friend_log_sequence: state.friend_baseline.friend_log_sequence,
        })
    }

    #[cfg(test)]
    pub fn run_friend_log_current_mutation<T>(
        &self,
        mutation: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        self.run_friend_log_current_mutation_with_effect(mutation, None)
    }

    pub(super) fn run_friend_log_current_mutation_with_effect<T>(
        &self,
        mutation: impl FnOnce() -> Result<T>,
        effect: Option<ScopedFriendLogMutation>,
    ) -> Result<T> {
        let _owner = self.lock_friend_owner();
        let result = mutation();
        if result.is_ok() {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            state.friend_baseline.friend_log_sequence =
                state.friend_baseline.friend_log_sequence.saturating_add(1);
            if let Some(effect) = effect {
                effect.apply(&mut state.friend_baseline);
            }
        }
        result
    }

    pub fn sync_friend_snapshot_with_watermark(
        self: &Arc<Self>,
        requested_session: RealtimeSessionContext,
        watermark: FriendBaselineCausalWatermark,
        friends_by_id: HashMap<String, FriendBaselineEntry>,
        verdicts: FriendStatusVerdicts,
    ) -> Result<FriendBaselineSyncOutcome> {
        let generation = watermark.generation;
        let owner = self.lock_friend_owner();
        let feed_persistence_disabled = self.feed_persistence_disabled.load(Ordering::Relaxed);
        let friend_count = u32::try_from(friends_by_id.len()).unwrap_or(u32::MAX);
        let FriendBaselineApplyPlan { active, effects } = {
            let mut state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            if watermark.friend_log_sequence != state.friend_baseline.friend_log_sequence {
                self.deps.sync.record(
                    "realtimeFriends",
                    RuntimeOperationStatus::Ignored,
                    "Friend baseline superseded by a local friend-log mutation.",
                    friend_count as u64,
                );
                return Ok(FriendBaselineSyncOutcome::rejected(FriendBaselineResult {
                    accepted: false,
                    generation: generation.unwrap_or(0),
                    baseline_revision: watermark.baseline_revision.unwrap_or(0),
                    friend_count,
                }));
            }
            let Some(active) = state.connection.active_context.clone() else {
                if generation.is_some() {
                    self.deps.sync.record(
                        "realtimeFriends",
                        RuntimeOperationStatus::Ignored,
                        "Friend baseline from a stopped realtime generation was ignored.",
                        friend_count as u64,
                    );
                    return Ok(FriendBaselineSyncOutcome::rejected(FriendBaselineResult {
                        accepted: false,
                        generation: generation.unwrap_or(0),
                        baseline_revision: watermark.baseline_revision.unwrap_or(0),
                        friend_count,
                    }));
                }
                let (snapshot_friends_by_id, presence_by_id) = friends_by_id
                    .iter()
                    .map(|(user_id, entry)| {
                        let (record, presence) = baseline_friend_view(entry);
                        ((user_id.clone(), record), (user_id.clone(), presence))
                    })
                    .unzip();
                let pending_snapshot = RealtimeFriendSnapshot {
                    current_user_id: requested_session.user_id.clone(),
                    endpoint: requested_session.endpoint.clone(),
                    websocket: requested_session.websocket.clone(),
                    generation: 0,
                    baseline_revision: 0,
                    presence_by_id,
                    friends_by_id: snapshot_friends_by_id,
                };
                state.friend_baseline.queued = Some(QueuedFriendBaseline {
                    session: requested_session.clone(),
                    friends_by_id,
                    feed_entries: Vec::new(),
                    projection: FriendProjection::new(0, 0),
                });
                drop(state);
                self.deps.sync.record(
                    "realtimeFriends",
                    RuntimeOperationStatus::Pending,
                    "Friend baseline cached until realtime transport starts.",
                    friend_count as u64,
                );
                self.set_activity_friend_user_ids(
                    pending_snapshot.friends_by_id.keys().cloned().collect(),
                );
                let roster_order =
                    roster_order_from_friend_records(&pending_snapshot.friends_by_id);
                let FriendRosterReconcileOutcome {
                    changed: friend_log_changed,
                    feed_entries,
                } = reconcile_friend_roster_records(
                    self.deps.store.as_ref(),
                    &pending_snapshot.current_user_id,
                    &pending_snapshot.friends_by_id,
                    roster_order.as_deref(),
                    feed_persistence_disabled,
                    &verdicts,
                );
                if !feed_entries.is_empty() {
                    let mut state = self
                        .state
                        .lock()
                        .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
                    if let Some(queued) = state.friend_baseline.queued.as_mut() {
                        if queued.session == requested_session {
                            queued.feed_entries = feed_entries;
                        }
                    }
                }
                return Ok(FriendBaselineSyncOutcome::accepted(
                    FriendBaselineResult {
                        accepted: true,
                        generation: 0,
                        baseline_revision: 0,
                        friend_count,
                    },
                    pending_snapshot,
                    friend_log_changed,
                ));
            };
            if active.session != requested_session
                || generation
                    .map(|generation| generation != active.generation)
                    .unwrap_or(false)
                || !self.is_session_live(&active)
            {
                self.deps.sync.record(
                    "realtimeFriends",
                    RuntimeOperationStatus::Ignored,
                    "Stale friend baseline ignored by Rust realtime runtime.",
                    friend_count as u64,
                );
                return Ok(FriendBaselineSyncOutcome::rejected(FriendBaselineResult {
                    accepted: false,
                    generation: generation.unwrap_or(active.generation),
                    baseline_revision: self
                        .friends
                        .roster_revision()
                        .map_or(0, |(_, baseline_revision)| baseline_revision),
                    friend_count: u32::try_from(friends_by_id.len()).unwrap_or(u32::MAX),
                }));
            }

            let current_baseline_revision = self
                .friends
                .roster_revision()
                .filter(|(generation, _)| *generation == active.generation)
                .map(|(_, baseline_revision)| baseline_revision);
            if generation.is_some() && current_baseline_revision != watermark.baseline_revision {
                self.deps.sync.record(
                    "realtimeFriends",
                    RuntimeOperationStatus::Ignored,
                    "Superseded friend baseline ignored by Rust realtime runtime.",
                    friend_count as u64,
                );
                return Ok(FriendBaselineSyncOutcome::rejected(FriendBaselineResult {
                    accepted: false,
                    generation: active.generation,
                    baseline_revision: current_baseline_revision.unwrap_or(0),
                    friend_count,
                }));
            }
            let baseline_revision = current_baseline_revision
                .map(|revision| revision.saturating_add(1))
                .unwrap_or(0);
            let baseline_effects = self.friends.set_baseline_with_effects(
                FriendRosterBaseline {
                    current_user_id: active.session.user_id.clone(),
                    endpoint: active.session.endpoint.clone(),
                    websocket: active.session.websocket.clone(),
                    friends_by_id,
                },
                active.generation,
                baseline_revision,
                Some(watermark.friend_rev),
                chrono::Utc::now().timestamp_millis(),
            );
            FriendBaselineApplyPlan {
                active,
                effects: baseline_effects,
            }
        };
        let result = effects.result.clone();

        let canonical_snapshot = if result.accepted {
            self.friends
                .snapshot()
                .filter(|snapshot| snapshot.generation == result.generation)
        } else {
            None
        };
        if let Some(snapshot) = canonical_snapshot.as_ref() {
            self.set_activity_friend_user_ids(snapshot.friends_by_id.keys().cloned().collect());
        }
        let reconcile_outcome = canonical_snapshot
            .as_ref()
            .map(|snapshot| {
                let roster_order = roster_order_from_friend_records(&snapshot.friends_by_id);
                reconcile_friend_roster_records(
                    self.deps.store.as_ref(),
                    &snapshot.current_user_id,
                    &snapshot.friends_by_id,
                    roster_order.as_deref(),
                    feed_persistence_disabled,
                    &verdicts,
                )
            })
            .unwrap_or_default();
        self.apply_friend_baseline_effects_owned(
            &owner,
            &OwnerId::new(active.session.user_id.clone()),
            FriendProjection::new(result.generation, result.baseline_revision),
            canonical_snapshot.as_ref(),
            effects,
        );
        drop(canonical_snapshot);
        let FriendRosterReconcileOutcome {
            changed: friend_log_changed,
            feed_entries,
        } = reconcile_outcome;
        self.apply_reconciled_friend_feed_entries_owned(
            &owner,
            &OwnerId::new(active.session.user_id),
            result.generation,
            result.baseline_revision,
            feed_entries,
        );
        drop(owner);
        let final_snapshot = if result.accepted {
            let _owner = self.lock_friend_owner();
            let snapshot = self
                .friends
                .snapshot()
                .filter(|snapshot| snapshot.generation == active.generation);
            if let Some(snapshot) = snapshot.as_ref() {
                self.set_activity_friend_user_ids(snapshot.friends_by_id.keys().cloned().collect());
            }
            snapshot
        } else {
            None
        };
        self.deps.sync.record(
            "realtimeFriends",
            if result.accepted {
                RuntimeOperationStatus::Ready
            } else {
                RuntimeOperationStatus::Ignored
            },
            format!(
                "Friend baseline revision {} with {} friends.",
                result.baseline_revision, result.friend_count
            ),
            0,
        );

        Ok(match final_snapshot {
            Some(snapshot) => {
                FriendBaselineSyncOutcome::accepted(result, snapshot, friend_log_changed)
            }
            None => FriendBaselineSyncOutcome::rejected(result),
        })
    }
}

fn add_roster_delta(
    projection: &mut FriendProjection,
    snapshot: &RealtimeFriendSnapshot,
    delta: &RosterDelta,
) {
    let (mut patched, removed) = match delta {
        RosterDelta::Rebuilt { removed } => (
            snapshot.friends_by_id.keys().cloned().collect::<Vec<_>>(),
            removed,
        ),
        RosterDelta::Changed { patched, removed } => (patched.clone(), removed),
    };
    patched.sort();
    projection.patches = patched
        .into_iter()
        .filter_map(|user_id| {
            Some(crate::realtime::FriendProjectionPatch {
                record: snapshot.friends_by_id.get(&user_id)?.clone(),
                presence: snapshot.presence_by_id.get(&user_id)?.clone(),
                user_id,
            })
        })
        .collect();
    projection.removals.extend(removed.iter().cloned());
    projection.removals.sort();
    projection.removals.dedup();
}

fn roster_order_from_friend_records(
    friends_by_id: &HashMap<String, FriendRecord>,
) -> Option<Vec<String>> {
    let mut numbered: Vec<(i64, String)> = friends_by_id
        .iter()
        .filter_map(|(user_id, record)| {
            let number = record
                .extra
                .get(derived_keys::FRIEND_NUMBER)
                .and_then(Value::as_i64)?;
            (number > 0).then(|| (number, user_id.clone()))
        })
        .collect();
    if numbered.is_empty() {
        return None;
    }
    numbered.sort_by_key(|(number, _)| *number);
    Some(numbered.into_iter().map(|(_, user_id)| user_id).collect())
}
