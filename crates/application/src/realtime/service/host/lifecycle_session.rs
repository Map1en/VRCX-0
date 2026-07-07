use super::types::{
    ActiveRealtimeContext, RealtimeHostRuntimeMessageSink, RealtimeHostRuntimeState,
};
use super::*;

impl RealtimeHostRuntime {
    pub fn new(deps: RealtimeHostRuntimeDeps) -> Self {
        let (cancel_tx, _) = watch::channel(0);
        let world_cache = Arc::clone(&deps.world_cache);
        Self {
            deps,
            state: Mutex::new(RealtimeHostRuntimeState::default()),
            cancel_tx,
            friends: RealtimeFriendsRuntime::new(),
            current_user: RealtimeCurrentUserRuntime::new(),
            user_cache: UserCacheRuntime::new(),
            user_query_cache: UserQueryCache::new(),
            world_cache,
            notification_apply_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
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
        let session = RealtimeSessionContext::new(user_id, endpoint, websocket);
        if session.user_id.is_empty() {
            return Err(Error::Custom(
                "Runtime realtime transport requires an authenticated user.".into(),
            ));
        }
        let mut friends_by_id = friends_by_id;
        let generation = {
            let mut state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            state.generation = state.generation.saturating_add(1);
            state.generation
        };
        let session_generation =
            self.deps
                .session
                .set_realtime_context(crate::session::RealtimeSessionContext::new(
                    session.user_id.clone(),
                    session.endpoint.clone(),
                    session.websocket.clone(),
                ));
        {
            let mut state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            state.active_context = Some(ActiveRealtimeContext {
                session: session.clone(),
                generation,
                client_run_id,
                session_generation,
            });
            if let Some(pending) = state.pending_friend_baseline.take() {
                if pending.session == session {
                    friends_by_id = pending.friends_by_id;
                }
            }
            state.friend_messages_paused = false;
            state.queued_friend_messages.clear();
            state.friend_profile_refetches.clear();
            state.world_name_fetches.clear();
            state.world_name_fetch_inflight.clear();
            state.pending_world_name_corrections.clear();
            state.invite_automation.clear_all();
            self.friends.clear();
            self.current_user.clear();
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
            self.deps
                .overlay_activity
                .set_friend_user_ids(friend_user_ids);
            self.current_user.set_snapshot(
                session.user_id.clone(),
                generation,
                current_user_snapshot,
            );
        }
        self.user_cache.clear();
        self.user_query_cache.clear();
        self.world_cache.init_load();
        self.record_baseline_friends_into_cache();
        let transport_deps = RealtimeTransportDeps {
            db: Arc::clone(&self.deps.db),
            web: Arc::clone(&self.deps.web),
            event_bus: self.deps.event_bus.clone(),
            session: self.deps.session.clone(),
        };
        let message_sink: Arc<dyn RealtimeMessageSink> = Arc::new(RealtimeHostRuntimeMessageSink {
            runtime: Arc::clone(self),
        });
        let cancel_rx = self.cancel_tx.subscribe();
        let _ = self.cancel_tx.send(generation);
        self.deps.sync.record(
            "realtime",
            "running",
            format!("Realtime transport generation {generation} started."),
            0,
        );
        self.deps.tasks.spawn(async move {
            run_realtime_transport(
                transport_deps,
                message_sink,
                client_run_id,
                generation,
                session_generation,
                session,
                cancel_rx,
            )
            .await;
        });

        if self.deps.session.snapshot().is_game_running {
            self.sync_current_user_game_running_state(generation, true);
        }

        Ok(RealtimeTransportStartResult {
            generation,
            client_run_id,
            session_generation,
        })
    }

    pub fn friend_snapshot(&self) -> Option<crate::realtime::RealtimeFriendSnapshot> {
        self.friends.snapshot()
    }

    pub fn current_user_snapshot(&self) -> Option<serde_json::Value> {
        self.current_user.snapshot_value()
    }

    pub fn sync_world_cache_favorites_from_db(&self) {
        self.world_cache.sync_favorites_from_db();
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
        let persistence_attempted = !batch.is_empty();
        let result = write_realtime_batch(&self.deps.db, &user_id, &batch)
            .map_err(|error| Error::Custom(format!("expire realtime notification: {error}")));
        match &result {
            Ok(counts) => {
                self.deps.sync.record(
                    "realtimeNotifications",
                    "persisted",
                    "Realtime notification expiration persisted by Rust.",
                    0,
                );
                self.emit_realtime_persisted(*counts, persistence_attempted);
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
        let (
            websocket_domain,
            client_run_id,
            generation,
            session_generation,
            final_current_user_output,
        ) = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };

            let Some(active) = state.active_context.clone() else {
                if request.has_scope() {
                    return;
                }
                state.generation = state.generation.saturating_add(1);
                let _ = self.cancel_tx.send(state.generation);
                return;
            };

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

            let websocket_domain = normalize_websocket_domain(&active.session.websocket);
            let final_current_user_output = self
                .current_user
                .apply_game_running_state(active.generation, false);
            state.generation = state.generation.saturating_add(1);
            state.active_context = None;
            state.pending_friend_baseline = None;
            state.friend_messages_paused = false;
            state.queued_friend_messages.clear();
            state.friend_profile_refetches.clear();
            state.world_name_fetches.clear();
            state.world_name_fetch_inflight.clear();
            state.pending_world_name_corrections.clear();
            let _ = self.cancel_tx.send(state.generation);
            self.deps.session.clear_realtime_context();
            self.friends.clear();
            self.current_user.clear();
            (
                websocket_domain,
                active.client_run_id,
                active.generation,
                active.session_generation,
                final_current_user_output,
            )
        };

        self.user_cache.clear();
        self.user_query_cache.clear();
        self.world_cache.clear_working();

        if let Some(output) = final_current_user_output {
            self.apply_current_user_output(output);
        }

        self.deps
            .event_bus
            .emit_realtime_ws_status(RealtimeWsStatusPayload {
                status: "disconnected".into(),
                websocket_domain,
                at: chrono::Utc::now().to_rfc3339(),
                client_run_id: Some(client_run_id),
                generation: Some(generation),
                session_generation: Some(session_generation),
                reason: None,
                status_code: None,
            });
        self.deps
            .sync
            .record("realtime", "idle", "Realtime transport stopped.", 0);
    }
}
