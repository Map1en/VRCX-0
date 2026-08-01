use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use vrcx_0_application_core::{Error, Result};
use vrcx_0_core::friends::{FriendRecord, FriendRosterBaseline};

use crate::realtime::friends::{player_joining_feed_entry, PendingOfflineSchedule};
use crate::realtime::{
    FriendBaselineCausalWatermark, FriendBaselineResult, FriendBaselineSyncOutcome,
    FriendProjection, FriendStateBucketAuthority, RealtimeFriendOutput, RealtimeFriendSnapshot,
    RealtimeSessionContext,
};
use crate::social_baseline::service::{
    reconcile_friend_roster_records, FriendRosterReconcileOutcome, FriendStatusVerdicts,
};

use super::state::{ActiveRealtimeContext, PendingFriendBaseline, ScopedFriendLogMutation};
use super::RealtimeHostRuntime;

enum FriendBaselineSyncMode {
    Direct {
        generation: Option<u64>,
    },
    Causal {
        watermark: FriendBaselineCausalWatermark,
        verdicts: FriendStatusVerdicts,
    },
}

struct FriendBaselineApplyPlan {
    result: FriendBaselineResult,
    active: ActiveRealtimeContext,
    projection: Option<FriendProjection>,
    schedules: Vec<PendingOfflineSchedule>,
    confirmed_feed_entries: Vec<Value>,
}

impl RealtimeHostRuntime {
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
        let mut watermark = self.friends.baseline_causal_watermark();
        if watermark.generation != active_generation {
            watermark.baseline_revision = None;
        }
        watermark.generation = active_generation;
        watermark.friend_log_sequence = state.friend_baseline.friend_log_sequence;
        Ok(watermark)
    }

    pub fn run_friend_log_current_mutation<T>(
        &self,
        mutation: impl FnOnce() -> vrcx_0_persistence::Result<T>,
    ) -> vrcx_0_persistence::Result<T> {
        self.run_friend_log_current_mutation_with_effect(mutation, None)
    }

    pub(super) fn run_friend_log_current_mutation_with_effect<T>(
        &self,
        mutation: impl FnOnce() -> vrcx_0_persistence::Result<T>,
        effect: Option<ScopedFriendLogMutation>,
    ) -> vrcx_0_persistence::Result<T> {
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

    pub fn sync_friend_snapshot(
        self: &Arc<Self>,
        session: RealtimeSessionContext,
        generation: Option<u64>,
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> Result<FriendBaselineResult> {
        Ok(self
            .sync_friend_snapshot_inner(
                session,
                FriendBaselineSyncMode::Direct { generation },
                friends_by_id,
            )?
            .into_result())
    }

    pub fn sync_friend_snapshot_with_watermark(
        self: &Arc<Self>,
        session: RealtimeSessionContext,
        watermark: FriendBaselineCausalWatermark,
        friends_by_id: HashMap<String, FriendRecord>,
        verdicts: FriendStatusVerdicts,
    ) -> Result<FriendBaselineSyncOutcome> {
        self.sync_friend_snapshot_inner(
            session,
            FriendBaselineSyncMode::Causal {
                watermark,
                verdicts,
            },
            friends_by_id,
        )
    }

    fn sync_friend_snapshot_inner(
        self: &Arc<Self>,
        requested_session: RealtimeSessionContext,
        mode: FriendBaselineSyncMode,
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> Result<FriendBaselineSyncOutcome> {
        let (generation, causal_watermark, friend_log_verdicts) = match mode {
            FriendBaselineSyncMode::Direct { generation } => (generation, None, None),
            FriendBaselineSyncMode::Causal {
                watermark,
                verdicts,
            } => (watermark.generation, Some(watermark), Some(verdicts)),
        };
        let owner = self.lock_friend_owner();
        let friend_count = friends_by_id.len();
        let FriendBaselineApplyPlan {
            result,
            active,
            projection: baseline_projection,
            schedules: baseline_schedules,
            confirmed_feed_entries,
        } = {
            let mut state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            if causal_watermark.is_some_and(|watermark| {
                watermark.friend_log_sequence != state.friend_baseline.friend_log_sequence
            }) {
                self.deps.sync.record(
                    "realtimeFriends",
                    "ignored",
                    "Friend baseline superseded by a local friend-log mutation.",
                    friend_count as u64,
                );
                return Ok(FriendBaselineSyncOutcome::rejected(FriendBaselineResult {
                    accepted: false,
                    generation: causal_watermark
                        .and_then(|watermark| watermark.generation)
                        .unwrap_or(0),
                    baseline_revision: causal_watermark
                        .and_then(|watermark| watermark.baseline_revision)
                        .unwrap_or(0),
                    friend_count,
                }));
            }
            let Some(active) = state.connection.active_context.clone() else {
                if causal_watermark.is_some_and(|watermark| watermark.generation.is_some()) {
                    self.deps.sync.record(
                        "realtimeFriends",
                        "ignored",
                        "Friend baseline from a stopped realtime generation was ignored.",
                        friend_count as u64,
                    );
                    return Ok(FriendBaselineSyncOutcome::rejected(FriendBaselineResult {
                        accepted: false,
                        generation: causal_watermark
                            .and_then(|watermark| watermark.generation)
                            .unwrap_or(0),
                        baseline_revision: causal_watermark
                            .and_then(|watermark| watermark.baseline_revision)
                            .unwrap_or(0),
                        friend_count,
                    }));
                }
                let pending_snapshot = RealtimeFriendSnapshot {
                    current_user_id: requested_session.user_id.clone(),
                    endpoint: requested_session.endpoint.clone(),
                    websocket: requested_session.websocket.clone(),
                    generation: 0,
                    baseline_revision: 0,
                    friends_by_id: friends_by_id.clone(),
                };
                state.friend_baseline.pending = Some(PendingFriendBaseline {
                    session: requested_session.clone(),
                    friends_by_id,
                    feed_entries: Vec::new(),
                    projection: FriendProjection::new(0, 0),
                });
                drop(state);
                self.deps.sync.record(
                    "realtimeFriends",
                    "pending",
                    "Friend baseline cached until realtime transport starts.",
                    friend_count as u64,
                );
                self.set_activity_friend_user_ids(
                    pending_snapshot.friends_by_id.keys().cloned().collect(),
                );
                let reconcile_outcome = if let Some(verdicts) = friend_log_verdicts.as_ref() {
                    let roster_order =
                        roster_order_from_friend_records(&pending_snapshot.friends_by_id);
                    reconcile_friend_roster_records(
                        self.deps.db.as_ref(),
                        &pending_snapshot.current_user_id,
                        &pending_snapshot.friends_by_id,
                        roster_order.as_deref(),
                        verdicts,
                    )
                } else {
                    FriendRosterReconcileOutcome::default()
                };
                let FriendRosterReconcileOutcome {
                    changed: friend_log_changed,
                    feed_entries,
                } = reconcile_outcome;
                if !feed_entries.is_empty() {
                    let mut state = self
                        .state
                        .lock()
                        .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
                    if let Some(pending) = state.friend_baseline.pending.as_mut() {
                        if pending.session == requested_session {
                            pending.feed_entries = feed_entries;
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
                || !self
                    .deps
                    .session
                    .is_realtime_generation_active(active.session_generation)
            {
                self.deps.sync.record(
                    "realtimeFriends",
                    "ignored",
                    "Stale friend baseline ignored by Rust realtime runtime.",
                    friend_count as u64,
                );
                return Ok(FriendBaselineSyncOutcome::rejected(FriendBaselineResult {
                    accepted: false,
                    generation: generation.unwrap_or(active.generation),
                    baseline_revision: self
                        .friends
                        .snapshot()
                        .map(|snapshot| snapshot.baseline_revision)
                        .unwrap_or(0),
                    friend_count: friends_by_id.len(),
                }));
            }

            let previous_snapshot = self
                .friends
                .snapshot()
                .filter(|snapshot| snapshot.generation == active.generation);
            let current_baseline_revision = previous_snapshot
                .as_ref()
                .map(|snapshot| snapshot.baseline_revision);
            if causal_watermark.is_some_and(|watermark| {
                watermark.generation.is_some()
                    && current_baseline_revision != watermark.baseline_revision
            }) {
                self.deps.sync.record(
                    "realtimeFriends",
                    "ignored",
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
                causal_watermark.map(|watermark| watermark.friend_state_sequence),
            );
            let result = baseline_effects.result;
            let baseline_schedules = baseline_effects.schedules;
            let confirmed_feed_entries = baseline_effects.confirmed_feed_entries;
            let baseline_projection = if result.accepted {
                self.friends
                    .snapshot()
                    .filter(|snapshot| snapshot.generation == active.generation)
                    .and_then(|snapshot| {
                        friend_snapshot_diff_projection(previous_snapshot.as_ref(), &snapshot)
                    })
            } else {
                None
            };
            FriendBaselineApplyPlan {
                result,
                active,
                projection: baseline_projection,
                schedules: baseline_schedules,
                confirmed_feed_entries,
            }
        };

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
        let reconcile_outcome = if let Some(verdicts) = friend_log_verdicts.as_ref() {
            canonical_snapshot
                .as_ref()
                .map(|snapshot| {
                    let roster_order = roster_order_from_friend_records(&snapshot.friends_by_id);
                    reconcile_friend_roster_records(
                        self.deps.db.as_ref(),
                        &snapshot.current_user_id,
                        &snapshot.friends_by_id,
                        roster_order.as_deref(),
                        verdicts,
                    )
                })
                .unwrap_or_default()
        } else {
            FriendRosterReconcileOutcome::default()
        };
        if baseline_projection.is_some() || !confirmed_feed_entries.is_empty() {
            let mut projection = baseline_projection.unwrap_or_else(|| {
                FriendProjection::new(result.generation, result.baseline_revision)
            });
            let mut feed_entries = confirmed_feed_entries.clone();
            feed_entries.append(&mut projection.feed_entries);
            projection.feed_entries = feed_entries;
            let mut output =
                RealtimeFriendOutput::from_projection(active.session.user_id.clone(), projection);
            output.persistence.feed_entries = confirmed_feed_entries;
            self.apply_friend_output_owned(&owner, output);
        }
        let FriendRosterReconcileOutcome {
            changed: friend_log_changed,
            feed_entries,
        } = reconcile_outcome;
        self.apply_persisted_friend_feed_entries_owned(
            &owner,
            result.generation,
            result.baseline_revision,
            feed_entries,
        );
        for schedule in baseline_schedules {
            let runtime = Arc::clone(self);
            self.deps.tasks.spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(schedule.delay_ms)).await;
                let now = chrono::Utc::now().to_rfc3339();
                runtime.fire_pending_offline(&schedule.user_id, schedule.token, now);
            });
        }
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
            if result.accepted { "ready" } else { "ignored" },
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

fn friend_snapshot_diff_projection(
    previous: Option<&crate::realtime::RealtimeFriendSnapshot>,
    next: &crate::realtime::RealtimeFriendSnapshot,
) -> Option<FriendProjection> {
    let created_at = chrono::Utc::now().to_rfc3339();
    let mut projection = FriendProjection::new(next.generation, next.baseline_revision);

    if let Some(previous) = previous {
        let mut removals = previous
            .friends_by_id
            .keys()
            .filter(|user_id| !next.friends_by_id.contains_key(*user_id))
            .cloned()
            .collect::<Vec<_>>();
        removals.sort();
        projection.removals = removals;
    }

    let mut user_ids = next.friends_by_id.keys().cloned().collect::<Vec<_>>();
    user_ids.sort();
    for user_id in user_ids {
        let Some(record) = next.friends_by_id.get(&user_id) else {
            continue;
        };
        let previous_record = previous.and_then(|snapshot| snapshot.friends_by_id.get(&user_id));
        let state_bucket = friend_record_state_bucket(record);
        let changed = !previous_record.is_some_and(|previous_record| previous_record == record);
        if !changed {
            continue;
        }
        let was_traveling = previous_record.is_some_and(|record| {
            vrcx_0_core::location::parse_location(&record.location).is_traveling
        });
        let joining_entry = player_joining_feed_entry(&user_id, was_traveling, record, &created_at);
        projection
            .patches
            .push(crate::realtime::FriendProjectionPatch {
                user_id,
                patch: record.clone(),
                state_bucket,
                state_bucket_authority: FriendStateBucketAuthority::Explicit,
            });
        if let Some(entry) = joining_entry {
            projection.feed_entries.push(entry);
        }
    }

    (!projection.patches.is_empty() || !projection.removals.is_empty()).then_some(projection)
}

fn friend_record_state_bucket(record: &FriendRecord) -> String {
    vrcx_0_core::friends::normalize_state_bucket(&record.state_bucket)
        .or_else(|| vrcx_0_core::friends::normalize_state_bucket(&record.state))
        .unwrap_or_else(|| "offline".to_string())
}

fn roster_order_from_friend_records(
    friends_by_id: &HashMap<String, FriendRecord>,
) -> Option<Vec<String>> {
    let mut numbered: Vec<(i64, String)> = friends_by_id
        .iter()
        .filter_map(|(user_id, record)| {
            let number = record
                .extra
                .get("friendNumber")
                .or_else(|| record.extra.get("$friendNumber"))
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
