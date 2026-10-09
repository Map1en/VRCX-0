use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use vrcx_0_application_core::{Result, RuntimeOperationStatus, TaskSpawnOutcome};

use super::state::{ActiveRealtimeContext, FriendOwnerGuard};
use serde_json::Value;
use vrcx_0_application_core::LocalGameContextSnapshot;
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_core::user_facts::UserFactMergeOptions;

use crate::realtime::{
    FriendProjection, RealtimeCurrentUserOutput, RealtimeFriendOutput,
    RealtimeInstanceClosedOutput, RealtimeNotificationOutput, RealtimeSessionContext,
};

use super::message_dispatch::json_string_field;
use super::RealtimeHostRuntime;
use crate::realtime::activity_events::{
    feed_activity_event, instance_closed_activity_event, notification_activity_event,
};
use vrcx_0_contracts::realtime::RealtimePersistenceBatch;
use vrcx_0_core::json::RawJsonObject;
use vrcx_0_core::OwnerId;

pub(super) enum FriendOutputApplyOutcome {
    Stale,
    Applied { persistence_succeeded: bool },
}

impl RealtimeHostRuntime {
    fn persist_friend_batch_or_queue(
        self: &Arc<Self>,
        owner: &OwnerId,
        batch: &RealtimePersistenceBatch,
    ) -> Result<bool> {
        if batch.is_empty() {
            return Ok(true);
        }

        let mut queue = self
            .pending_realtime_persistence
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let stage_error = self.deps.store.stage_realtime_batch(owner, batch).err();
        let staged = stage_error.is_none();
        let retry_safe = self.deps.store.realtime_batch_retry_safe();
        if let Some(error) = &stage_error {
            tracing::error!("Realtime friend batch could not be durably staged: {error}");
        }
        if queue.batches.is_empty() {
            if !staged {
                queue
                    .batches
                    .push_back((owner.clone(), batch.clone(), false));
                let start_worker = !queue.retry_worker_running;
                queue.retry_worker_running = true;
                drop(queue);
                if start_worker {
                    self.start_realtime_persistence_retry_worker();
                }
                return Err(stage_error.expect("unstaged batch must have a staging error"));
            }
            match self.deps.store.write_realtime_batch(owner, batch) {
                Ok(_) => return Ok(true),
                Err(error) => {
                    queue
                        .batches
                        .push_back((owner.clone(), batch.clone(), true));
                    let start_worker = retry_safe && !queue.retry_worker_running;
                    queue.retry_worker_running |= retry_safe;
                    drop(queue);
                    if retry_safe {
                        tracing::warn!(
                            "Realtime friend persistence failed; queued for retry: {error}"
                        );
                    } else {
                        tracing::error!("Realtime friend persistence failed with an ambiguous remote result; batch retained without automatic replay: {error}");
                    }
                    if start_worker {
                        self.start_realtime_persistence_retry_worker();
                    }
                    return Err(error);
                }
            }
        }

        queue
            .batches
            .push_back((owner.clone(), batch.clone(), staged));
        let start_worker = retry_safe && !queue.retry_worker_running;
        queue.retry_worker_running |= retry_safe;
        drop(queue);
        if start_worker {
            self.start_realtime_persistence_retry_worker();
        }
        match stage_error {
            Some(error) => Err(error),
            None if retry_safe => Ok(false),
            None => Err(vrcx_0_application_core::Error::Custom(
                "Earlier remote friend persistence is awaiting safe replay.".into(),
            )),
        }
    }

    fn start_realtime_persistence_retry_worker(self: &Arc<Self>) {
        let runtime = Arc::clone(self);
        let outcome = self.deps.tasks.spawn_cancellable(move |stop| async move {
            let mut delay = Duration::from_millis(250);
            loop {
                if stop.is_stop_requested() {
                    runtime.finish_realtime_persistence_retry_worker(true);
                    return;
                }

                let next = {
                    let mut queue = runtime
                        .pending_realtime_persistence
                        .lock()
                        .unwrap_or_else(|error| error.into_inner());
                    match queue.batches.front().cloned() {
                        Some(batch) => Some(batch),
                        None => {
                            queue.retry_worker_running = false;
                            return;
                        }
                    }
                };
                let Some((owner, batch, staged)) = next else {
                    continue;
                };

                if !staged {
                    match runtime.deps.store.stage_realtime_batch(&owner, &batch) {
                        Ok(()) => {
                            let mut queue = runtime
                                .pending_realtime_persistence
                                .lock()
                                .unwrap_or_else(|error| error.into_inner());
                            if let Some(front) = queue.batches.front_mut() {
                                front.2 = true;
                            }
                        }
                        Err(error) => {
                            tracing::debug!("Realtime friend batch staging retry failed: {error}");
                            tokio::time::sleep(delay).await;
                            delay = (delay * 2).min(Duration::from_secs(30));
                            continue;
                        }
                    }
                }

                match runtime.deps.store.write_realtime_batch(&owner, &batch) {
                    Ok(_) => {
                        let mut queue = runtime
                            .pending_realtime_persistence
                            .lock()
                            .unwrap_or_else(|error| error.into_inner());
                        queue.batches.pop_front();
                        drop(queue);
                        runtime.deps.sync.record(
                            "realtimeFriends",
                            RuntimeOperationStatus::Persisted,
                            "Queued realtime friend data was persisted after retry.",
                            0,
                        );
                        delay = Duration::from_millis(250);
                    }
                    Err(error) => {
                        tracing::debug!("Queued realtime friend persistence retry failed: {error}");
                        tokio::time::sleep(delay).await;
                        delay = (delay * 2).min(Duration::from_secs(30));
                    }
                }
            }
        });

        if outcome != TaskSpawnOutcome::Scheduled {
            let pending = self.finish_realtime_persistence_retry_worker(false);
            tracing::error!(
                "Realtime friend persistence retry worker could not start ({outcome:?}); {pending} batch(es) remain queued"
            );
        }
    }

    fn finish_realtime_persistence_retry_worker(&self, shutting_down: bool) -> usize {
        let mut queue = self
            .pending_realtime_persistence
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        queue.retry_worker_running = false;
        let pending = queue.batches.len();
        if shutting_down && pending > 0 {
            tracing::error!(
                "Realtime host stopped with {pending} friend persistence batch(es) still pending"
            );
        }
        pending
    }

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

    pub(super) fn set_activity_friend_user_ids(&self, user_ids: Vec<String>) {
        if let Some(activity) = &self.deps.activity {
            activity.replace_friend_ids(user_ids);
        }
    }

    fn ingest_friend_activity(&self, projection: &FriendProjection, entries: &[FeedLiveEntry]) {
        let Some(activity) = &self.deps.activity else {
            return;
        };
        activity.update_friend_ids(
            projection
                .patches
                .iter()
                .map(|patch| patch.user_id.clone())
                .collect(),
            projection.removals.clone(),
        );
        activity.ingest_activity(entries.iter().filter_map(feed_activity_event).collect());
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
        let projection = FriendProjection::new(generation, baseline_revision);
        if !self.is_friend_projection_current(&projection) {
            return;
        }
        self.ingest_friend_activity(&projection, &feed_entries);
        self.emit_feed_entries(generation, owner_user_id, feed_entries);
    }

    pub(super) fn apply_friend_output_owned(
        self: &Arc<Self>,
        _owner: &FriendOwnerGuard<'_>,
        mut output: RealtimeFriendOutput,
    ) -> FriendOutputApplyOutcome {
        let wake = output.wake.take();
        let profile_refetch_user_ids = output.profile_refetch_user_ids.clone();
        let icon_changes = std::mem::take(&mut output.icon_changes);
        let projection = output.projection.clone();
        let projection_generation = projection.generation;
        if !self.is_friend_projection_current(&projection) {
            return FriendOutputApplyOutcome::Stale;
        }
        let mut joining = std::mem::take(&mut output.joining);
        self.retain_current_instance_joining_entries(&mut joining, output.owner_user_id.as_str());
        let mut live_feed = output.persistence.feed_entries.clone();
        let feed_persistence_disabled = self.feed_persistence_disabled.load(Ordering::Relaxed);
        if feed_persistence_disabled {
            output.persistence.feed_entries.clear();
        }
        let mut world_name_fetch_ids = self.enrich_projection_world_names(&mut live_feed);
        world_name_fetch_ids.extend(self.enrich_projection_world_names(&mut joining));
        world_name_fetch_ids.extend(self.enrich_persistence_world_names(&mut output.persistence));
        let persisted =
            match self.persist_friend_batch_or_queue(&output.owner_user_id, &output.persistence) {
                Ok(true) => {
                    self.deps.sync.record(
                        "realtimeFriends",
                        RuntimeOperationStatus::Persisted,
                        "Realtime friend projection persisted by Rust.",
                        0,
                    );
                    true
                }
                Ok(false) => false,
                Err(error) => {
                    tracing::warn!("Realtime friend persistence failed: {error}");
                    self.deps
                        .sync
                        .record_failure("realtimeFriends", error.to_string());
                    if !feed_persistence_disabled {
                        live_feed.clear();
                        joining.clear();
                    }
                    false
                }
            };
        self.ingest_friend_activity(&projection, &[live_feed.as_slice(), &joining].concat());
        if !projection.patches.is_empty() || !projection.removals.is_empty() {
            let endpoint = self.active_endpoint();
            if !projection.removals.is_empty() {
                self.user_facts
                    .remove_users(&endpoint, &projection.removals);
            }
            if !projection.patches.is_empty() {
                let changed = self.collect_friend_record_cache_changes(
                    projection.patches.iter().map(|patch| &patch.record),
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
        self.emit_feed_entries(projection_generation, &output.owner_user_id, live_feed);

        if let Some(wake) = wake {
            self.schedule_friend_wake(projection_generation, wake);
        }
        self.schedule_friend_profile_refetches(projection_generation, profile_refetch_user_ids);
        self.schedule_friend_icon_changes(projection_generation, icon_changes);
        self.schedule_world_name_warm(world_name_fetch_ids);
        FriendOutputApplyOutcome::Applied {
            persistence_succeeded: persisted,
        }
    }

    fn retain_current_instance_joining_entries(
        &self,
        joining: &mut Vec<FeedLiveEntry>,
        current_user_id: &str,
    ) {
        if joining.is_empty() {
            return;
        }
        let local_game_context = self.local_game_context();
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
        joining.retain(|entry| {
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
            let auto_declines = self.friend_requests_to_auto_decline(&projection);
            if let Some(activity) = &self.deps.activity {
                activity.ingest_activity(
                    projection
                        .upserts
                        .iter()
                        .filter(|upsert| upsert.deliver_runtime)
                        .filter(|upsert| {
                            let id = json_string_field(upsert.notification.get("id"));
                            !auto_declines.iter().any(|decline| decline.facts.id == id)
                        })
                        .filter_map(|upsert| notification_activity_event(&upsert.notification))
                        .collect(),
                );
            }
            self.deps
                .event_bus
                .emit_realtime_notification_projection(projection.clone());
            self.schedule_invite_automation(&projection);
            self.schedule_friend_request_auto_decline(auto_declines);
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
        let snapshot = output.snapshot;
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
            self.apply_current_user_snapshot_sink(&active, &snapshot);
        }
        self.deps
            .event_bus
            .emit_realtime_current_user_projection(projection);
    }

    pub(super) fn apply_current_user_snapshot_sink(
        &self,
        active: &ActiveRealtimeContext,
        snapshot: &RawJsonObject,
    ) {
        if let Some(sink) = &self.deps.current_user_snapshot_sink {
            sink(
                &active.session,
                active.auth_scope_generation,
                Value::Object(snapshot.clone().into_map()),
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
        if let Some(activity) = &self.deps.activity {
            activity.ingest_activity(vec![instance_closed_activity_event(
                &projection.notification,
            )]);
        }
        self.deps
            .event_bus
            .emit_realtime_instance_closed_projection(projection);
        self.emit_feed_entries(generation, owner_user_id, vec![feed_entry]);
    }
}
