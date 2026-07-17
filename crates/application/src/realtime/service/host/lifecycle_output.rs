use super::types::FriendOwnerGuard;
use super::*;
use vrcx_0_core::user_facts::UserFactMergeOptions;

impl RealtimeHostRuntime {
    pub(super) fn lock_friend_owner(&self) -> FriendOwnerGuard<'_> {
        FriendOwnerGuard {
            _guard: self
                .friend_owner_lock
                .lock()
                .unwrap_or_else(|error| error.into_inner()),
        }
    }

    #[cfg(test)]
    pub(super) fn apply_friend_output(self: &Arc<Self>, output: RealtimeFriendOutput) {
        let owner = self.lock_friend_owner();
        self.apply_friend_output_owned(&owner, output);
    }

    pub(super) fn apply_persisted_friend_feed_entries_owned(
        self: &Arc<Self>,
        _owner: &FriendOwnerGuard<'_>,
        generation: u64,
        baseline_revision: u64,
        feed_entries: Vec<Value>,
    ) {
        if feed_entries.is_empty() {
            return;
        }
        let projection = FriendProjection {
            generation,
            baseline_revision,
            feed_entries,
            ..FriendProjection::default()
        };
        if !self.is_friend_projection_current(&projection) {
            self.friends
                .clear_baseline_if_revision(projection.generation, projection.baseline_revision);
            return;
        }
        self.deps
            .overlay_activity
            .ingest_friend_projection(&projection);
        self.deps
            .event_bus
            .emit_realtime_friend_projection(projection);
    }

    pub(super) fn apply_friend_output_owned(
        self: &Arc<Self>,
        _owner: &FriendOwnerGuard<'_>,
        mut output: RealtimeFriendOutput,
    ) -> bool {
        let timer_action = output.timer_action.clone();
        let profile_refetch_user_ids = output.profile_refetch_user_ids.clone();
        let mut projection = output.projection.clone();
        let projection_generation = projection.generation;
        if !self.is_friend_projection_current(&projection) {
            self.friends
                .clear_baseline_if_revision(projection.generation, projection.baseline_revision);
            return false;
        }
        self.retain_current_instance_joining_entries(&mut projection, &output.owner_user_id);
        let friend_note_changed = output.friend_note_changed;
        let mut world_name_fetch_ids =
            self.enrich_projection_world_names(&mut projection.feed_entries);
        world_name_fetch_ids.extend(self.enrich_persistence_world_names(&mut output.persistence));
        let persistence_attempted = !output.persistence.is_empty();
        let persisted =
            match write_realtime_batch(&self.deps.db, &output.owner_user_id, &output.persistence) {
                Ok(counts) => {
                    self.deps.sync.record(
                        "realtimeFriends",
                        "persisted",
                        "Realtime friend projection persisted by Rust.",
                        0,
                    );
                    self.emit_realtime_persisted(counts, persistence_attempted);
                    true
                }
                Err(error) => {
                    tracing::warn!("Realtime friend persistence failed: {error}");
                    self.deps
                        .sync
                        .record_failure("realtimeFriends", error.to_string());
                    projection.feed_entries.clear();
                    false
                }
            };
        self.deps
            .overlay_activity
            .ingest_friend_projection(&projection);
        projection
            .feed_entries
            .retain(|entry| !is_player_joining_entry(entry));
        if friend_note_changed {
            if let Some(sink) = &self.deps.friend_note_change_sink {
                sink();
            }
        }
        if !projection.patches.is_empty() {
            let values: Vec<Value> = projection
                .patches
                .iter()
                .map(|patch| patch.patch.clone())
                .collect();
            self.record_users_into_cache_with_source(
                &values,
                &UserFactMergeOptions {
                    endpoint: self.active_endpoint(),
                    source: "realtime".into(),
                    received_at: chrono::Utc::now().to_rfc3339(),
                    is_friend: true,
                    ..Default::default()
                },
                projection.source,
            );
        }
        self.deps
            .event_bus
            .emit_realtime_friend_projection(projection);

        if let PendingOfflineTimerAction::Schedule {
            user_id,
            token,
            delay_ms,
        } = timer_action
        {
            let runtime = Arc::clone(self);
            self.deps.tasks.spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                let now = chrono::Utc::now().to_rfc3339();
                runtime.fire_pending_offline(&user_id, token, now);
            });
        }
        self.schedule_friend_profile_refetches(projection_generation, profile_refetch_user_ids);
        self.schedule_world_name_warm(world_name_fetch_ids);
        persisted
    }

    fn retain_current_instance_joining_entries(
        &self,
        projection: &mut FriendProjection,
        current_user_id: &str,
    ) {
        if !projection.feed_entries.iter().any(is_player_joining_entry) {
            return;
        }
        let session = self.deps.session.snapshot();
        let game_log = self
            .deps
            .game_log_snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default();
        let current_location = game_log.location.trim();
        let current_user_id = current_user_id.trim();
        projection.feed_entries.retain(|entry| {
            if !is_player_joining_entry(entry) {
                return true;
            }
            let user_id = entry
                .get("userId")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            let destination = entry
                .get("travelingToLocation")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            session.is_game_running
                && !current_location.is_empty()
                && destination == current_location
                && !user_id.is_empty()
                && user_id != current_user_id
                && !game_log
                    .players
                    .iter()
                    .any(|player| player.user_id.trim() == user_id)
        });
    }

    pub(super) fn apply_notification_output(
        self: &Arc<Self>,
        mut output: RealtimeNotificationOutput,
    ) {
        let mut projection = output.projection;
        let mut world_name_fetch_ids = self.enrich_notification_world_names(&mut projection);
        self.enrich_notification_sender_names(&mut projection);
        self.enrich_notification_images(&mut projection, &output.owner_user_id);
        world_name_fetch_ids.extend(self.enrich_persistence_world_names(&mut output.persistence));
        self.enrich_persistence_sender_names(&mut output.persistence);
        output.projection = projection;
        self.finalize_notification_output_for_delivery(&mut output);
        let projection = self.visible_notification_projection(output.projection.clone());
        let persistence_attempted = !output.persistence.is_empty();
        match write_realtime_batch(&self.deps.db, &output.owner_user_id, &output.persistence) {
            Ok(counts) => {
                self.deps.sync.record(
                    "realtimeNotifications",
                    "persisted",
                    "Realtime notification projection persisted by Rust.",
                    0,
                );
                self.emit_realtime_persisted(counts, persistence_attempted);
            }
            Err(error) => {
                tracing::warn!("Realtime notification persistence failed: {error}");
                self.deps
                    .sync
                    .record_failure("realtimeNotifications", error.to_string());
            }
        }
        if self.projection_has_visible_notification_work(&projection) {
            self.deps
                .overlay_activity
                .ingest_notification_projection(&projection);
            self.deps
                .event_bus
                .emit_realtime_notification_projection(projection.clone());
            self.schedule_invite_automation(&projection);
        }
        self.schedule_world_name_warm(world_name_fetch_ids);
    }

    pub(super) fn schedule_notification_output(
        self: &Arc<Self>,
        generation: u64,
        session_generation: u64,
        session: RealtimeSessionContext,
        output: RealtimeNotificationOutput,
    ) {
        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            let _guard = runtime.notification_apply_lock.lock().await;
            if !runtime.is_notification_context_current(generation, session_generation, &session) {
                return;
            }
            let mut output = output;
            if runtime.notification_output_needs_remote_resolution(&output) {
                runtime.resolve_notification_output_names(&mut output).await;
                if !runtime.is_notification_context_current(
                    generation,
                    session_generation,
                    &session,
                ) {
                    return;
                }
            }
            runtime.apply_notification_output(output);
        });
    }

    pub(super) fn apply_current_user_output(&self, mut output: RealtimeCurrentUserOutput) {
        self.enrich_current_user_location_output(&mut output);
        let projection = output.projection;
        let persistence_attempted = !output.persistence.is_empty();
        match write_realtime_batch(&self.deps.db, &output.owner_user_id, &output.persistence) {
            Ok(counts) => {
                self.deps.sync.record(
                    "realtimeCurrentUser",
                    "persisted",
                    "Realtime current-user projection persisted by Rust.",
                    0,
                );
                self.emit_realtime_persisted(counts, persistence_attempted);
            }
            Err(error) => {
                tracing::warn!("Realtime current user persistence failed: {error}");
                self.deps
                    .sync
                    .record_failure("realtimeCurrentUser", error.to_string());
            }
        }
        self.deps
            .event_bus
            .emit_realtime_current_user_projection(projection);
    }

    pub(super) fn apply_instance_closed_output(
        &self,
        owner_user_id: &str,
        output: RealtimeInstanceClosedOutput,
    ) {
        let mut projection = output.projection;
        self.enrich_world_name(&mut projection.notification);
        if let Some(location) = projection
            .notification
            .get("location")
            .and_then(Value::as_str)
        {
            if let Ok(mut state) = self.state.lock() {
                state.invite_automation.record_closed_location(location);
            }
        }
        let persistence_attempted = !output.persistence.is_empty();
        match write_realtime_batch(&self.deps.db, owner_user_id, &output.persistence) {
            Ok(counts) => {
                self.deps.sync.record(
                    "realtimeInstanceClosed",
                    "persisted",
                    "Realtime instance-closed projection persisted by Rust.",
                    0,
                );
                self.emit_realtime_persisted(counts, persistence_attempted);
            }
            Err(error) => {
                tracing::warn!("Realtime instance-closed persistence failed: {error}");
                self.deps
                    .sync
                    .record_failure("realtimeInstanceClosed", error.to_string());
            }
        }
        self.deps
            .overlay_activity
            .ingest_instance_closed_projection(&projection);
        self.deps
            .event_bus
            .emit_realtime_instance_closed_projection(projection);
    }

    pub(super) fn emit_realtime_persisted(
        &self,
        counts: RealtimeWriteCounts,
        persistence_attempted: bool,
    ) {
        if persistence_attempted {
            self.deps.event_bus.emit_ws_persisted(counts.affected_count);
        }
        if counts.game_log_affected_count > 0 {
            self.deps
                .event_bus
                .emit_game_log_persisted(counts.game_log_affected_count);
        }
    }
}

fn is_player_joining_entry(entry: &Value) -> bool {
    entry.get("type").and_then(Value::as_str) == Some("OnPlayerJoining")
}
