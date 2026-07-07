use super::types::PendingFriendBaseline;
use super::*;

impl RealtimeHostRuntime {
    pub fn sync_friend_snapshot(
        self: &Arc<Self>,
        user_id: String,
        endpoint: String,
        websocket: String,
        generation: Option<u64>,
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> Result<FriendBaselineResult> {
        let requested_session = RealtimeSessionContext::new(user_id, endpoint, websocket);
        let friend_count = friends_by_id.len();
        let friend_user_ids = friends_by_id.keys().cloned().collect::<Vec<_>>();
        let (result, active, baseline_projection, baseline_schedules) = {
            let mut state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            let Some(active) = state.active_context.clone() else {
                state.pending_friend_baseline = Some(PendingFriendBaseline {
                    session: requested_session,
                    friends_by_id,
                });
                drop(state);
                self.deps.sync.record(
                    "realtimeFriends",
                    "pending",
                    "Friend baseline cached until realtime transport starts.",
                    friend_count as u64,
                );
                self.deps
                    .overlay_activity
                    .set_friend_user_ids(friend_user_ids);
                return Ok(FriendBaselineResult {
                    accepted: true,
                    generation: 0,
                    baseline_revision: 0,
                    friend_count,
                });
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
                return Ok(FriendBaselineResult {
                    accepted: false,
                    generation: generation.unwrap_or(active.generation),
                    baseline_revision: self
                        .friends
                        .snapshot()
                        .map(|snapshot| snapshot.baseline_revision)
                        .unwrap_or(0),
                    friend_count: friends_by_id.len(),
                });
            }

            let previous_snapshot = self
                .friends
                .snapshot()
                .filter(|snapshot| snapshot.generation == active.generation);
            let baseline_revision = previous_snapshot
                .as_ref()
                .map(|snapshot| snapshot.baseline_revision.saturating_add(1))
                .unwrap_or(0);
            let (result, baseline_schedules) = self.friends.set_baseline_with_schedules(
                FriendRosterBaseline {
                    current_user_id: active.session.user_id.clone(),
                    endpoint: active.session.endpoint.clone(),
                    websocket: active.session.websocket.clone(),
                    friends_by_id,
                },
                active.generation,
                baseline_revision,
            );
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
            (result, active, baseline_projection, baseline_schedules)
        };

        if result.accepted {
            self.deps
                .overlay_activity
                .set_friend_user_ids(friend_user_ids);
        }
        if let Some(projection) = baseline_projection {
            self.apply_friend_output(RealtimeFriendOutput {
                owner_user_id: active.session.user_id.clone(),
                projection,
                ..RealtimeFriendOutput::default()
            });
        }
        for (user_id, token, delay_ms) in baseline_schedules {
            let runtime = Arc::clone(self);
            self.deps.tasks.spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                let now = chrono::Utc::now().to_rfc3339();
                runtime.fire_pending_offline(&user_id, token, now);
            });
        }
        self.drain_queued_friend_messages(active);
        self.deps.sync.record(
            "realtimeFriends",
            if result.accepted { "ready" } else { "ignored" },
            format!(
                "Friend baseline revision {} with {} friends.",
                result.baseline_revision, result.friend_count
            ),
            0,
        );

        Ok(result)
    }

    pub(super) fn resume_friend_messages_after_reconnect(
        self: &Arc<Self>,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
    ) {
        let active = {
            let state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            if !self.is_message_current_locked(&state, generation, session_generation, session) {
                return;
            }
            if !state.friend_messages_paused {
                return;
            }
            let Some(active) = state.active_context.clone() else {
                return;
            };
            active
        };
        self.drain_queued_friend_messages(active);
    }
}

fn friend_snapshot_diff_projection(
    previous: Option<&crate::realtime::RealtimeFriendSnapshot>,
    next: &crate::realtime::RealtimeFriendSnapshot,
) -> Option<FriendProjection> {
    let mut projection = FriendProjection {
        generation: next.generation,
        baseline_revision: next.baseline_revision,
        ..FriendProjection::default()
    };

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
        let patch = match serde_json::to_value(record) {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(
                    user_id,
                    error = %error,
                    "[Realtime] failed to serialize friend baseline projection patch"
                );
                continue;
            }
        };
        projection
            .patches
            .push(crate::realtime::FriendProjectionPatch {
                user_id,
                patch,
                state_bucket,
                state_bucket_authority: Some("explicit".to_string()),
            });
    }

    (!projection.patches.is_empty() || !projection.removals.is_empty()).then_some(projection)
}

fn friend_record_state_bucket(record: &FriendRecord) -> String {
    vrcx_0_core::friends::normalize_state_bucket(&record.state_bucket)
        .or_else(|| vrcx_0_core::friends::normalize_state_bucket(&record.state))
        .unwrap_or_else(|| "offline".to_string())
}
