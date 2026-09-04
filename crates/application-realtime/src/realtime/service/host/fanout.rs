use std::sync::atomic::Ordering;
use std::sync::Arc;
use vrcx_0_application_core::{Result, RuntimeOperationStatus};

use super::state::{ActiveRealtimeContext, FriendOwnerGuard};
use serde_json::Value;
use vrcx_0_application_core::LocalGameContextSnapshot;
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_core::user_facts::UserFactMergeOptions;

use crate::realtime::{
    FriendProjection, PendingOfflineTimerAction, RealtimeCurrentUserOutput,
    RealtimeCurrentUserProjection, RealtimeFriendOutput, RealtimeInstanceClosedOutput,
    RealtimeNotificationOutput, RealtimeSessionContext,
};

use super::RealtimeHostRuntime;
use vrcx_0_core::OwnerId;

pub(super) enum FriendOutputApplyOutcome {
    Stale,
    Applied { persistence_succeeded: bool },
}

impl RealtimeHostRuntime {
    pub fn emit_friend_projection(&self, projection: FriendProjection) {
        self.deps.friend_projection_sink.emit(projection);
    }

    pub fn emit_friend_log_changed(&self) {
        let (generation, baseline_revision) = self
            .friends
            .snapshot()
            .map(|snapshot| (snapshot.generation, snapshot.baseline_revision))
            .unwrap_or((0, 0));
        self.emit_friend_projection(FriendProjection {
            friend_log_changed: true,
            ..FriendProjection::new(generation, baseline_revision)
        });
    }

    pub fn emit_friend_location_time_snapshot(self: &Arc<Self>) {
        let _owner = self.lock_friend_owner();
        let Some(snapshot) = self.friends.snapshot() else {
            return;
        };
        if !self
            .deps
            .auth_scope
            .matches(&snapshot.current_user_id, &snapshot.endpoint)
        {
            return;
        }
        let mut projection = FriendProjection::new(snapshot.generation, snapshot.baseline_revision);
        projection.location_time_snapshot = Some(self.deps.instance_dwell.snapshot());
        self.emit_friend_projection(projection);
    }

    pub fn set_feed_persistence_disabled(&self, disabled: bool) -> Result<()> {
        let _owner = self.lock_friend_owner();
        self.deps
            .store
            .set_bool("feedPersistenceDisabled", disabled)?;
        self.feed_persistence_disabled
            .store(disabled, Ordering::Relaxed);
        self.reset_feed_live_cache();
        Ok(())
    }

    pub fn set_avatar_feed_persistence_disabled(&self, disabled: bool) -> Result<()> {
        let _owner = self.lock_friend_owner();
        self.deps
            .store
            .set_bool("avatarFeedPersistenceDisabled", disabled)?;
        self.avatar_feed_persistence_disabled
            .store(disabled, Ordering::Relaxed);
        Ok(())
    }

    pub(super) fn set_activity_friend_user_ids(&self, user_ids: Vec<String>) {
        if let Some(activity_sink) = &self.deps.activity_sink {
            activity_sink.set_friend_user_ids(user_ids);
        }
    }

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

    pub(super) fn apply_reconciled_friend_feed_entries_owned(
        self: &Arc<Self>,
        _owner: &FriendOwnerGuard<'_>,
        owner_user_id: &OwnerId,
        generation: u64,
        baseline_revision: u64,
        feed_entries: Vec<FeedLiveEntry>,
    ) {
        if feed_entries.is_empty() {
            return;
        }
        let mut projection = FriendProjection::new(generation, baseline_revision);
        projection.feed_entries = feed_entries;
        if !self.is_friend_projection_current(&projection) {
            self.friends
                .clear_baseline_if_revision(projection.generation, projection.baseline_revision);
            return;
        }
        if let Some(activity_sink) = &self.deps.activity_sink {
            activity_sink.ingest_friend_projection(&projection);
        }
        self.emit_feed_entries(
            generation,
            owner_user_id,
            std::mem::take(&mut projection.feed_entries),
        );
    }

    pub(super) fn apply_friend_output_owned(
        self: &Arc<Self>,
        _owner: &FriendOwnerGuard<'_>,
        mut output: RealtimeFriendOutput,
    ) -> FriendOutputApplyOutcome {
        let timer_action = output.timer_action.clone();
        let profile_refetch_user_ids = output.profile_refetch_user_ids.clone();
        let mut projection = output.projection.clone();
        let projection_generation = projection.generation;
        if !self.is_friend_projection_current(&projection) {
            self.friends
                .clear_baseline_if_revision(projection.generation, projection.baseline_revision);
            return FriendOutputApplyOutcome::Stale;
        }
        self.retain_current_instance_joining_entries(
            &mut projection,
            output.owner_user_id.as_str(),
        );
        let feed_persistence_disabled = self.feed_persistence_disabled.load(Ordering::Relaxed);
        let avatar_feed_persistence_disabled = self
            .avatar_feed_persistence_disabled
            .load(Ordering::Relaxed);
        if feed_persistence_disabled {
            output.persistence.feed_entries.clear();
        } else if avatar_feed_persistence_disabled {
            output
                .persistence
                .feed_entries
                .retain(|entry| !matches!(entry, FeedLiveEntry::Avatar { .. }));
        }
        let mut world_name_fetch_ids =
            self.enrich_projection_world_names(&mut projection.feed_entries);
        world_name_fetch_ids.extend(self.enrich_persistence_world_names(&mut output.persistence));
        let persisted = match self
            .deps
            .store
            .write_realtime_batch(&output.owner_user_id, &output.persistence)
        {
            Ok(_) => {
                self.deps.sync.record(
                    "realtimeFriends",
                    RuntimeOperationStatus::Persisted,
                    "Realtime friend projection persisted by Rust.",
                    0,
                );
                true
            }
            Err(error) => {
                tracing::warn!("Realtime friend persistence failed: {error}");
                self.deps
                    .sync
                    .record_failure("realtimeFriends", error.to_string());
                if !feed_persistence_disabled {
                    if avatar_feed_persistence_disabled {
                        projection
                            .feed_entries
                            .retain(|entry| matches!(entry, FeedLiveEntry::Avatar { .. }));
                    } else {
                        projection.feed_entries.clear();
                    }
                }
                false
            }
        };
        if let Some(activity_sink) = &self.deps.activity_sink {
            activity_sink.ingest_friend_projection(&projection);
        }
        projection
            .feed_entries
            .retain(|entry| !is_player_joining_entry(entry));
        let feed_entries = std::mem::take(&mut projection.feed_entries);
        if !projection.patches.is_empty() || !projection.removals.is_empty() {
            let endpoint = self.active_endpoint();
            if !projection.removals.is_empty() {
                self.user_cache
                    .remove_users(&endpoint, &projection.removals);
            }
            if !projection.patches.is_empty() {
                let changed = self.collect_friend_record_cache_changes(
                    projection.patches.iter().map(|patch| &patch.patch),
                    &UserFactMergeOptions {
                        endpoint,
                        source: "realtime".into(),
                        received_at: chrono::Utc::now().to_rfc3339(),
                        is_friend: true,
                        ..Default::default()
                    },
                );
                self.emit_user_cache_changes(changed);
            }
        }
        self.emit_friend_projection(projection);
        self.emit_feed_entries(projection_generation, &output.owner_user_id, feed_entries);

        if let PendingOfflineTimerAction::Schedule {
            user_id,
            token,
            delay,
        } = timer_action
        {
            let runtime = Arc::clone(self);
            self.deps.tasks.spawn(async move {
                tokio::time::sleep(delay).await;
                let now = chrono::Utc::now().to_rfc3339();
                runtime.fire_pending_offline(&user_id, token, now);
            });
        }
        self.schedule_friend_profile_refetches(projection_generation, profile_refetch_user_ids);
        self.schedule_world_name_warm(world_name_fetch_ids);
        FriendOutputApplyOutcome::Applied {
            persistence_succeeded: persisted,
        }
    }

    fn retain_current_instance_joining_entries(
        &self,
        projection: &mut FriendProjection,
        current_user_id: &str,
    ) {
        if !projection.feed_entries.iter().any(is_player_joining_entry) {
            return;
        }
        let local_game_context = self.deps.local_game_context.snapshot();
        let (is_game_running, current_location, player_user_ids) = match &local_game_context {
            LocalGameContextSnapshot::Unavailable => (false, "", &[][..]),
            LocalGameContextSnapshot::Available {
                is_game_running,
                location,
                player_user_ids,
                ..
            } => (
                *is_game_running,
                location.trim(),
                player_user_ids.as_slice(),
            ),
        };
        let current_user_id = current_user_id.trim();
        projection.feed_entries.retain(|entry| {
            let FeedLiveEntry::OnPlayerJoining {
                user_id,
                traveling_to_location,
                ..
            } = entry
            else {
                return true;
            };
            let user_id = user_id.trim();
            let destination = traveling_to_location.trim();
            is_game_running
                && !current_location.is_empty()
                && destination == current_location
                && !user_id.is_empty()
                && user_id != current_user_id
                && !player_user_ids
                    .iter()
                    .any(|player_user_id| player_user_id == user_id)
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
        match self
            .deps
            .store
            .write_realtime_batch(&output.owner_user_id, &output.persistence)
        {
            Ok(_) => {
                self.deps.sync.record(
                    "realtimeNotifications",
                    RuntimeOperationStatus::Persisted,
                    "Realtime notification projection persisted by Rust.",
                    0,
                );
                if let Some(observer) = &self.deps.notification_projection_observer {
                    observer.observe_realtime_notification_projection(&projection);
                }
            }
            Err(error) => {
                tracing::warn!("Realtime notification persistence failed: {error}");
                self.deps
                    .sync
                    .record_failure("realtimeNotifications", error.to_string());
            }
        }
        if self.projection_has_visible_notification_work(&projection) {
            if let Some(activity_sink) = &self.deps.activity_sink {
                activity_sink.ingest_notification_projection(&projection);
            }
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
        match self
            .deps
            .store
            .write_realtime_batch(&output.owner_user_id, &output.persistence)
        {
            Ok(_) => {
                self.deps.sync.record(
                    "realtimeCurrentUser",
                    RuntimeOperationStatus::Persisted,
                    "Realtime current-user projection persisted by Rust.",
                    0,
                );
            }
            Err(error) => {
                tracing::warn!("Realtime current user persistence failed: {error}");
                self.deps
                    .sync
                    .record_failure("realtimeCurrentUser", error.to_string());
            }
        }
        if let Some(active) = self
            .active_current_user_context()
            .filter(|active| active.generation == projection.generation)
        {
            self.apply_current_user_snapshot_sink(&active, &projection);
        }
        self.deps
            .event_bus
            .emit_realtime_current_user_projection(projection);
    }

    pub(super) fn apply_current_user_snapshot_sink(
        &self,
        active: &ActiveRealtimeContext,
        projection: &RealtimeCurrentUserProjection,
    ) {
        if active.generation != projection.generation {
            return;
        }
        if let Some(sink) = &self.deps.current_user_snapshot_sink {
            sink(
                &active.session,
                active.auth_scope_generation,
                Value::Object(projection.snapshot.clone().into_map()),
            );
        }
    }

    pub(super) fn apply_instance_closed_output(
        &self,
        owner_user_id: &OwnerId,
        output: RealtimeInstanceClosedOutput,
    ) {
        let mut projection = output.projection;
        let mut feed_entry = output.feed_entry;
        let generation = projection.generation;
        self.enrich_world_name(&mut projection.notification);
        self.enrich_feed_entry_world_name(&mut feed_entry);
        if let Some(location) = projection
            .notification
            .get("location")
            .and_then(Value::as_str)
        {
            if let Ok(mut state) = self.state.lock() {
                state.automation.invite.record_closed_location(location);
            }
        }
        match self
            .deps
            .store
            .write_realtime_batch(owner_user_id, &output.persistence)
        {
            Ok(_) => {
                self.deps.sync.record(
                    "realtimeInstanceClosed",
                    RuntimeOperationStatus::Persisted,
                    "Realtime instance-closed projection persisted by Rust.",
                    0,
                );
            }
            Err(error) => {
                tracing::warn!("Realtime instance-closed persistence failed: {error}");
                self.deps
                    .sync
                    .record_failure("realtimeInstanceClosed", error.to_string());
            }
        }
        if let Some(activity_sink) = &self.deps.activity_sink {
            activity_sink.ingest_instance_closed_projection(&projection);
        }
        self.deps
            .event_bus
            .emit_realtime_instance_closed_projection(projection);
        self.emit_feed_entries(generation, owner_user_id, vec![feed_entry]);
    }
}

fn is_player_joining_entry(entry: &FeedLiveEntry) -> bool {
    matches!(entry, FeedLiveEntry::OnPlayerJoining { .. })
}
