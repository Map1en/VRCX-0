use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use vrcx_0_application_core::{RuntimeAuthScopeSnapshot, RuntimeOperationStatus};

use tokio::sync::{broadcast, watch};
use vrcx_0_application_core::{Error, Result};
use vrcx_0_contracts::realtime::{NotificationExpiration, RealtimePersistenceBatch};
use vrcx_0_core::friends::{FriendRecord, FriendRosterBaseline};
use vrcx_0_core::vrchat_endpoints::normalize_vrchat_websocket_endpoint;

use crate::realtime::connection::{supervise_realtime_transport, RealtimeMessageSink};
use crate::realtime::current_user::RealtimeCurrentUserRuntime;
use crate::realtime::friends::RealtimeFriendsRuntime;
use crate::realtime::user_cache::UserCacheRuntime;
use crate::realtime::user_query_cache::UserQueryCache;
use crate::realtime::{
    FriendProjection, RealtimeCachedUserProfile, RealtimeFriendOutput,
    RealtimeFriendRecordSnapshot, RealtimeSessionContext, RealtimeTransportLifecycleEvent,
    RealtimeTransportStartResult, RealtimeTransportTermination, RealtimeWsStatus,
    RealtimeWsStatusPayload,
};

use super::state::{
    ActiveRealtimeContext, RealtimeHostRuntimeMessageSink, RealtimeHostRuntimeState,
};
use super::{RealtimeHostRuntime, RealtimeHostRuntimeDeps, RealtimeStopRequest};
use vrcx_0_core::OwnerId;

enum RealtimeFriendBaselineStart {
    Supplied(HashMap<String, FriendRecord>),
    PendingOrPreserved,
}

impl RealtimeHostRuntime {
    pub fn new(deps: RealtimeHostRuntimeDeps) -> Self {
        let (cancel_tx, _) = watch::channel(0);
        let (transport_lifecycle_tx, _) = broadcast::channel(32);
        let (friend_profile_bulk_cancel_tx, _) = watch::channel(0);
        let world_cache = Arc::clone(&deps.world_cache);
        let instance_dwell = Arc::clone(&deps.instance_dwell);
        let feed_persistence_disabled = deps
            .store
            .get_bool("feedPersistenceDisabled", false)
            .unwrap_or_else(|error| {
                tracing::warn!("Feed persistence preference read failed: {error}");
                false
            });
        let avatar_feed_persistence_disabled = deps
            .store
            .get_bool("avatarFeedPersistenceDisabled", false)
            .unwrap_or_else(|error| {
                tracing::warn!("Avatar Feed persistence preference read failed: {error}");
                false
            });
        Self {
            deps,
            state: Mutex::new(RealtimeHostRuntimeState::default()),
            cancel_tx,
            transport_lifecycle_tx,
            friends: RealtimeFriendsRuntime::new(instance_dwell),
            current_user: RealtimeCurrentUserRuntime::new(),
            user_cache: UserCacheRuntime::new(),
            user_query_cache: UserQueryCache::new(),
            world_cache,
            friend_owner_lock: Mutex::new(()),
            feed_owner_lock: Mutex::new(()),
            feed_live_cache: Mutex::new(super::feed::FeedLiveCache::default()),
            feed_persistence_disabled: AtomicBool::new(feed_persistence_disabled),
            avatar_feed_persistence_disabled: AtomicBool::new(avatar_feed_persistence_disabled),
            notification_apply_lock: tokio::sync::Mutex::new(()),
            friend_profile_bulk_load: Mutex::new(
                super::friend_profile_bulk_load::FriendProfileBulkLoadState::default(),
            ),
            friend_profile_bulk_cancel_tx,
            current_user_refresh_inflight: Mutex::new(None),
        }
    }

    pub fn subscribe_transport_lifecycle(
        &self,
    ) -> broadcast::Receiver<RealtimeTransportLifecycleEvent> {
        self.transport_lifecycle_tx.subscribe()
    }

    pub fn transport_is_active(&self, transport: &RealtimeTransportStartResult) -> bool {
        self.state
            .lock()
            .map(|state| {
                state
                    .connection
                    .active_context
                    .as_ref()
                    .is_some_and(|active| {
                        active.client_run_id == transport.client_run_id
                            && active.generation == transport.generation
                            && active.session_generation == transport.session_generation
                    })
            })
            .unwrap_or(false)
    }

    pub(super) fn current_transport(
        &self,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
    ) -> Option<RealtimeTransportStartResult> {
        self.state.lock().ok().and_then(|state| {
            state.connection.active_context.as_ref().and_then(|active| {
                (active.generation == generation
                    && active.session_generation == session_generation
                    && active.session == *session)
                    .then_some(RealtimeTransportStartResult {
                        generation: active.generation,
                        client_run_id: active.client_run_id,
                        session_generation: active.session_generation,
                    })
            })
        })
    }

    pub fn start(
        self: &Arc<Self>,
        user_id: String,
        endpoint: String,
        websocket: String,
        client_run_id: u64,
        current_user_snapshot: serde_json::Value,
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> Result<RealtimeTransportStartResult> {
        self.start_with_friend_baseline(
            user_id,
            endpoint,
            websocket,
            client_run_id,
            current_user_snapshot,
            RealtimeFriendBaselineStart::Supplied(friends_by_id),
        )
    }

    pub fn start_from_friend_baseline(
        self: &Arc<Self>,
        user_id: String,
        endpoint: String,
        websocket: String,
        client_run_id: u64,
        current_user_snapshot: serde_json::Value,
    ) -> Result<RealtimeTransportStartResult> {
        self.start_with_friend_baseline(
            user_id,
            endpoint,
            websocket,
            client_run_id,
            current_user_snapshot,
            RealtimeFriendBaselineStart::PendingOrPreserved,
        )
    }

    fn start_with_friend_baseline(
        self: &Arc<Self>,
        user_id: String,
        endpoint: String,
        websocket: String,
        client_run_id: u64,
        current_user_snapshot: serde_json::Value,
        baseline_start: RealtimeFriendBaselineStart,
    ) -> Result<RealtimeTransportStartResult> {
        let session = RealtimeSessionContext::new(user_id, endpoint, websocket);
        if session.user_id.is_empty() {
            return Err(Error::Custom(
                "Runtime realtime transport requires an authenticated user.".into(),
            ));
        }
        let mut supplied_friends = match baseline_start {
            RealtimeFriendBaselineStart::Supplied(friends_by_id) => Some(friends_by_id),
            RealtimeFriendBaselineStart::PendingOrPreserved => None,
        };
        let auth_scope_generation = self.deps.auth_scope.snapshot().generation;
        let mut pending_feed_entries = Vec::new();
        let mut pending_projection = FriendProjection::new(0, 0);
        let friend_owner = self.lock_friend_owner();
        let generation = {
            let mut state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            state.connection.generation = state.connection.generation.saturating_add(1);
            state.connection.generation
        };
        self.cancel_friend_profile_bulk_load_for_replacement(&session);
        let session_generation = self.deps.session.set_realtime_context(
            vrcx_0_application_core::HostRealtimeSessionContext::new(
                session.user_id.clone(),
                session.endpoint.clone(),
                session.websocket.clone(),
            ),
        );
        {
            let mut state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            let mut pending_friends = None;
            if let Some(pending) = state.friend_baseline.pending.take() {
                if pending.session == session {
                    pending_friends = Some(pending.friends_by_id);
                    pending_feed_entries = pending.feed_entries;
                    pending_projection = pending.projection;
                }
            }
            state.friend_profile.refetches.clear();
            state.world_enrichment.fetches.clear();
            state.world_enrichment.inflight.clear();
            state.world_enrichment.pending_corrections.clear();
            state.automation.invite.clear_all();
            let friend_user_ids =
                if let Some(friends_by_id) = pending_friends.or_else(|| supplied_friends.take()) {
                    if self.friends.session_context().as_ref() != Some(&session) {
                        self.friends.clear();
                    }
                    let friend_user_ids = friends_by_id.keys().cloned().collect::<Vec<_>>();
                    self.friends.set_baseline(
                        FriendRosterBaseline {
                            current_user_id: session.user_id.clone(),
                            endpoint: session.endpoint.clone(),
                            websocket: session.websocket.clone(),
                            friends_by_id,
                        },
                        generation,
                        0,
                    );
                    friend_user_ids
                } else {
                    let Some(friend_user_ids) = self
                        .friends
                        .restart_preserving_baseline(&session, generation)
                    else {
                        self.deps
                            .session
                            .clear_realtime_context_if_generation(session_generation);
                        return Err(Error::Custom(
                            "Realtime transport requires a pending or preserved friend baseline."
                                .into(),
                        ));
                    };
                    friend_user_ids
                };
            pending_projection.location_time_snapshot = Some(self.deps.instance_dwell.snapshot());
            state.connection.active_context = Some(ActiveRealtimeContext {
                session: session.clone(),
                auth_scope_generation,
                generation,
                client_run_id,
                session_generation,
            });
            self.set_activity_friend_user_ids(friend_user_ids);
            self.current_user.set_snapshot(
                session.user_id.clone(),
                generation,
                current_user_snapshot,
            );
        }
        let baseline_revision = self
            .friends
            .baseline_causal_watermark()
            .baseline_revision
            .unwrap_or(0);
        pending_projection.generation = generation;
        pending_projection.baseline_revision = baseline_revision;
        self.apply_friend_output_owned(
            &friend_owner,
            RealtimeFriendOutput::from_projection(
                OwnerId::new(session.user_id.clone()),
                pending_projection,
            ),
        );
        self.apply_reconciled_friend_feed_entries_owned(
            &friend_owner,
            &OwnerId::new(session.user_id.clone()),
            generation,
            baseline_revision,
            pending_feed_entries,
        );
        drop(friend_owner);
        self.user_cache.clear();
        self.user_query_cache.clear();
        self.record_baseline_friends_into_cache();
        let message_sink: Arc<dyn RealtimeMessageSink> = Arc::new(RealtimeHostRuntimeMessageSink {
            runtime: Arc::clone(self),
        });
        let cancel_rx = self.cancel_tx.subscribe();
        let _ = self.cancel_tx.send(generation);
        let transport = RealtimeTransportStartResult {
            generation,
            client_run_id,
            session_generation,
        };
        let task_transport = transport.clone();
        let runtime = Arc::clone(self);
        let realtime_transport = Arc::clone(&self.deps.transport);
        self.deps.sync.record(
            "realtime",
            RuntimeOperationStatus::Running,
            format!("Realtime transport generation {generation} started."),
            0,
        );
        self.deps.tasks.spawn(async move {
            let termination = supervise_realtime_transport(realtime_transport.run(
                message_sink,
                client_run_id,
                generation,
                session_generation,
                session,
                cancel_rx,
            ))
            .await;
            runtime.finish_realtime_transport(task_transport, termination);
        });

        if self.deps.session.snapshot().is_game_running {
            self.sync_current_user_game_running_state(generation, true);
        }

        Ok(transport)
    }

    pub(super) fn finish_realtime_transport(
        &self,
        transport: RealtimeTransportStartResult,
        termination: RealtimeTransportTermination,
    ) {
        let preserve_snapshot = matches!(
            &termination,
            RealtimeTransportTermination::UnexpectedExit { .. }
                | RealtimeTransportTermination::AuthExpired { .. }
        );
        self.deps
            .session
            .clear_realtime_context_if_generation(transport.session_generation);
        let friend_owner = self.lock_friend_owner();
        let finished = match self.state.lock() {
            Ok(mut state) => {
                let active = state
                    .connection
                    .active_context
                    .as_ref()
                    .filter(|active| {
                        active.generation == transport.generation
                            && active.client_run_id == transport.client_run_id
                            && active.session_generation == transport.session_generation
                    })
                    .cloned();
                active.map(|active| {
                    let final_current_user_output = if preserve_snapshot {
                        self.current_user_transport_interruption_output(active.generation)
                    } else {
                        self.current_user_transport_finalization_output(active.generation)
                    };
                    state.connection.active_context = None;
                    state.friend_profile.refetches.clear();
                    if !preserve_snapshot {
                        self.friends.clear();
                        self.current_user.clear();
                    }
                    (active, final_current_user_output)
                })
            }
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                None
            }
        };
        drop(friend_owner);

        if let Some((active, final_current_user_output)) = finished {
            if !preserve_snapshot {
                self.cancel_friend_profile_bulk_load_for_session(&active.session);
            }
            if let Some(output) = final_current_user_output {
                if preserve_snapshot {
                    self.apply_current_user_snapshot_sink(&active, &output.projection);
                }
                self.apply_current_user_output(output);
            }
            let terminal_status = match &termination {
                RealtimeTransportTermination::AuthExpired {
                    reason,
                    status_code,
                } => Some((RealtimeWsStatus::Error, reason.clone(), *status_code)),
                RealtimeTransportTermination::UnexpectedExit { reason, .. } => {
                    Some((RealtimeWsStatus::Error, reason.clone(), None))
                }
                RealtimeTransportTermination::Stopped => None,
            };
            if let Some((status, reason, status_code)) = terminal_status {
                self.deps.sync.record_failure("realtime", reason.clone());
                self.deps
                    .backend_status
                    .publish_realtime_ws_status(RealtimeWsStatusPayload {
                        status,
                        websocket_domain: normalize_vrchat_websocket_endpoint(
                            &active.session.websocket,
                        ),
                        at: chrono::Utc::now().to_rfc3339(),
                        client_run_id: Some(active.client_run_id),
                        generation: Some(active.generation),
                        session_generation: Some(active.session_generation),
                        reason: Some(reason),
                        status_code,
                    });
            }
        }

        let _ = self
            .transport_lifecycle_tx
            .send(RealtimeTransportLifecycleEvent::Finished {
                transport,
                termination,
            });
    }

    pub fn friend_snapshot(&self) -> Option<crate::realtime::RealtimeFriendSnapshot> {
        self.friends.snapshot()
    }

    pub fn is_current_friend(&self, user_id: &str) -> bool {
        self.friends.is_current_friend(user_id)
    }

    pub fn current_friend_record(&self, user_id: &str) -> Option<RealtimeFriendRecordSnapshot> {
        self.friends.current_friend_record(user_id)
    }

    pub fn friend_user_ids_snapshot(&self) -> std::sync::Arc<std::collections::HashSet<String>> {
        self.friends.friend_user_ids_snapshot()
    }

    pub fn friend_roster_snapshot(
        &self,
        previous_order: &[String],
    ) -> serde_json::Result<Option<crate::realtime::RealtimeFriendRosterSnapshot>> {
        self.friends.roster_snapshot(previous_order)
    }

    pub fn friend_session_context(&self) -> Option<RealtimeSessionContext> {
        self.friends.session_context()
    }

    pub fn current_user_snapshot(&self) -> Option<serde_json::Value> {
        self.current_user.snapshot_value()
    }

    pub fn cached_user_profiles(
        &self,
        auth_scope: &RuntimeAuthScopeSnapshot,
        user_ids: &[String],
    ) -> Vec<RealtimeCachedUserProfile> {
        let endpoint = self
            .state
            .lock()
            .ok()
            .and_then(|state| {
                state
                    .connection
                    .active_context
                    .as_ref()
                    .filter(|active| {
                        auth_scope.active
                            && active.auth_scope_generation == auth_scope.generation
                            && active.session.user_id == auth_scope.current_user_id
                            && active.session.endpoint == auth_scope.endpoint
                    })
                    .map(|active| active.session.endpoint.clone())
            })
            .unwrap_or_default();
        if endpoint.is_empty() {
            return Vec::new();
        }
        self.user_cache
            .get_users(&endpoint, user_ids)
            .into_iter()
            .map(|(user_id, user)| RealtimeCachedUserProfile {
                user_id,
                is_friend: user.get("isFriend").and_then(serde_json::Value::as_bool) == Some(true),
                languages: user
                    .get("tags")
                    .and_then(serde_json::Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(serde_json::Value::as_str)
                    .filter_map(|tag| tag.strip_prefix("language_"))
                    .filter(|language| !language.is_empty())
                    .map(str::to_string)
                    .collect(),
            })
            .collect()
    }

    pub fn expire_notification(&self, user_id: String, notification_id: String) -> Result<()> {
        let user_id = user_id.trim().to_string();
        let notification_id = notification_id.trim().to_string();
        if user_id.is_empty() || notification_id.is_empty() {
            return Ok(());
        }

        let batch = RealtimePersistenceBatch {
            notification_expirations: vec![NotificationExpiration {
                id: notification_id,
                expired_at: chrono::Utc::now().to_rfc3339(),
            }],
            ..RealtimePersistenceBatch::default()
        };
        let result = self
            .deps
            .store
            .write_realtime_batch(&OwnerId::new(user_id), &batch)
            .map_err(|error| Error::Custom(format!("expire realtime notification: {error}")));
        match &result {
            Ok(_) => {
                self.deps.sync.record(
                    "realtimeNotifications",
                    RuntimeOperationStatus::Persisted,
                    "Realtime notification expiration persisted by Rust.",
                    0,
                );
            }
            Err(error) => self
                .deps
                .sync
                .record_failure("realtimeNotifications", error.to_string()),
        }
        result.map(|_| ())
    }

    pub(super) fn is_notification_context_current(
        &self,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
    ) -> bool {
        let state = match self.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                return false;
            }
        };
        self.is_message_current_locked(&state, generation, session_generation, session)
    }

    pub fn stop(&self, request: RealtimeStopRequest) {
        let friend_owner = self.lock_friend_owner();
        let stopped = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };

            match state.connection.active_context.clone() {
                None => {
                    if !request.has_scope() {
                        state.connection.generation = state.connection.generation.saturating_add(1);
                        let _ = self.cancel_tx.send(state.connection.generation);
                    }
                    None
                }
                Some(active) => {
                    if !request.matches_active(&active) {
                        tracing::warn!(
                            client_run_id = ?request.client_run_id,
                            generation = ?request.generation,
                            active_client_run_id = active.client_run_id,
                            active_generation = active.generation,
                            "[Realtime] ignored stale stop request"
                        );
                        return;
                    }

                    let websocket_domain =
                        normalize_vrchat_websocket_endpoint(&active.session.websocket);
                    let final_current_user_output =
                        self.current_user_transport_finalization_output(active.generation);
                    state.connection.generation = state.connection.generation.saturating_add(1);
                    state.connection.active_context = None;
                    state.friend_baseline.pending = None;
                    state.friend_profile.refetches.clear();
                    state.world_enrichment.fetches.clear();
                    state.world_enrichment.inflight.clear();
                    state.world_enrichment.pending_corrections.clear();
                    let _ = self.cancel_tx.send(state.connection.generation);
                    self.deps.session.clear_realtime_context();
                    self.friends.clear();
                    self.current_user.clear();
                    Some((
                        active.clone(),
                        websocket_domain,
                        active.client_run_id,
                        active.generation,
                        active.session_generation,
                        final_current_user_output,
                    ))
                }
            }
        };
        drop(friend_owner);
        let Some((
            stopped_active,
            websocket_domain,
            client_run_id,
            generation,
            session_generation,
            final_current_user_output,
        )) = stopped
        else {
            self.cancel_friend_profile_bulk_load_for_stop_request(&request);
            return;
        };
        self.cancel_friend_profile_bulk_load_for_session(&stopped_active.session);

        self.user_cache.clear();
        self.user_query_cache.clear();
        self.world_cache.clear_working();
        self.reset_feed_live_cache();

        if let Some(output) = final_current_user_output {
            self.apply_current_user_output(output);
        }

        self.deps
            .backend_status
            .publish_realtime_ws_status(RealtimeWsStatusPayload {
                status: RealtimeWsStatus::Disconnected,
                websocket_domain,
                at: chrono::Utc::now().to_rfc3339(),
                client_run_id: Some(client_run_id),
                generation: Some(generation),
                session_generation: Some(session_generation),
                reason: None,
                status_code: None,
            });
        self.deps.sync.record(
            "realtime",
            RuntimeOperationStatus::Idle,
            "Realtime transport stopped.",
            0,
        );
    }
}

#[cfg(test)]
mod cached_user_profile_tests {
    use super::*;
    use crate::realtime::service::host::test_support::runtime_with_active_session;
    use serde_json::json;

    #[test]
    fn cached_user_profiles_reject_a_previous_realtime_auth_scope() -> Result<()> {
        let (_dir, test_runtime, session) =
            runtime_with_active_session("cached-user-profile-auth-scope")?;
        let runtime = test_runtime.runtime();
        runtime.ingest_user_facts(vec![json!({
            "user": {
                "id": "usr_target",
                "tags": ["language_eng"]
            },
            "isFriend": true
        })]);
        let user_ids = vec!["usr_target".to_string()];
        let original_scope = test_runtime.auth_scope().snapshot();

        assert_eq!(
            runtime.cached_user_profiles(&original_scope, &user_ids),
            vec![RealtimeCachedUserProfile {
                user_id: "usr_target".into(),
                is_friend: true,
                languages: vec!["eng".into()],
            }]
        );

        test_runtime.auth_scope().set("", "");
        let replacement_scope = test_runtime
            .auth_scope()
            .set("usr_replacement", &session.endpoint);

        assert!(runtime
            .cached_user_profiles(&replacement_scope, &user_ids)
            .is_empty());
        Ok(())
    }
}
