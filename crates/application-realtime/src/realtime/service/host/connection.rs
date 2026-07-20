use super::state::{
    ActiveRealtimeContext, RealtimeHostRuntimeMessageSink, RealtimeHostRuntimeState,
};
use super::*;

impl RealtimeHostRuntime {
    pub fn new(deps: RealtimeHostRuntimeDeps) -> Self {
        let (cancel_tx, _) = watch::channel(0);
        let (transport_lifecycle_tx, _) = broadcast::channel(32);
        let (friend_profile_bulk_cancel_tx, _) = watch::channel(0);
        let world_cache = Arc::clone(&deps.world_cache);
        Self {
            deps,
            state: Mutex::new(RealtimeHostRuntimeState::default()),
            cancel_tx,
            transport_lifecycle_tx,
            friends: RealtimeFriendsRuntime::new(),
            current_user: RealtimeCurrentUserRuntime::new(),
            user_cache: UserCacheRuntime::new(),
            user_query_cache: UserQueryCache::new(),
            world_cache,
            friend_owner_lock: Mutex::new(()),
            notification_apply_lock: Arc::new(tokio::sync::Mutex::new(())),
            friend_profile_bulk_load: Mutex::new(
                super::friend_profile_bulk_load::FriendProfileBulkLoadState::default(),
            ),
            friend_profile_bulk_cancel_tx,
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
        let session = RealtimeSessionContext::new(user_id, endpoint, websocket);
        if session.user_id.is_empty() {
            return Err(Error::Custom(
                "Runtime realtime transport requires an authenticated user.".into(),
            ));
        }
        let mut friends_by_id = friends_by_id;
        let mut pending_feed_entries = Vec::new();
        let mut pending_projection = FriendProjection::default();
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
            state.connection.active_context = Some(ActiveRealtimeContext {
                session: session.clone(),
                generation,
                client_run_id,
                session_generation,
            });
            if let Some(pending) = state.friend_baseline.pending.take() {
                if pending.session == session {
                    friends_by_id = pending.friends_by_id;
                    pending_feed_entries = pending.feed_entries;
                    pending_projection = pending.projection;
                }
            }
            state.friend_profile.refetches.clear();
            state.world_enrichment.fetches.clear();
            state.world_enrichment.inflight.clear();
            state.world_enrichment.pending_corrections.clear();
            state.automation.invite.clear_all();
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
            self.set_activity_friend_user_ids(friend_user_ids);
            self.current_user.set_snapshot(
                session.user_id.clone(),
                generation,
                current_user_snapshot,
            );
        }
        let baseline_revision = self
            .friends
            .snapshot()
            .map(|snapshot| snapshot.baseline_revision)
            .unwrap_or(0);
        if !pending_projection.patches.is_empty()
            || !pending_projection.removals.is_empty()
            || pending_projection.friend_log_changed
        {
            pending_projection.generation = generation;
            pending_projection.baseline_revision = baseline_revision;
            self.apply_friend_output_owned(
                &friend_owner,
                RealtimeFriendOutput {
                    owner_user_id: session.user_id.clone(),
                    projection: pending_projection,
                    ..RealtimeFriendOutput::default()
                },
            );
        }
        self.apply_persisted_friend_feed_entries_owned(
            &friend_owner,
            generation,
            baseline_revision,
            pending_feed_entries,
        );
        drop(friend_owner);
        self.user_cache.clear();
        self.user_query_cache.clear();
        self.world_cache.init_load();
        self.record_baseline_friends_into_cache();
        let transport_deps = RealtimeTransportDeps {
            db: Arc::clone(&self.deps.db),
            web: Arc::clone(&self.deps.web),
            event_bus: self.deps.event_bus.clone(),
        };
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
        self.deps.sync.record(
            "realtime",
            "running",
            format!("Realtime transport generation {generation} started."),
            0,
        );
        self.deps.tasks.spawn(async move {
            let termination = supervise_realtime_transport(run_realtime_transport(
                transport_deps,
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
                    let final_current_user_output =
                        self.current_user_game_running_output(active.generation, false);
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
                self.apply_current_user_output(output);
            }
            let terminal_status = match &termination {
                RealtimeTransportTermination::AuthExpired {
                    reason,
                    status_code,
                } => Some(("authFailure", reason.clone(), *status_code)),
                RealtimeTransportTermination::UnexpectedExit { reason } => {
                    Some(("error", reason.clone(), None))
                }
                RealtimeTransportTermination::Stopped => None,
            };
            if let Some((status, reason, status_code)) = terminal_status {
                self.deps.sync.record_failure("realtime", reason.clone());
                self.deps
                    .event_bus
                    .emit_realtime_ws_status(RealtimeWsStatusPayload {
                        status: status.into(),
                        websocket_domain: normalize_websocket_domain(&active.session.websocket),
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

    pub fn current_user_snapshot(&self) -> Option<serde_json::Value> {
        self.current_user.snapshot_value()
    }

    pub fn sync_world_cache_favorites_from_db(&self) {
        self.world_cache.sync_favorites_from_db();
    }

    pub fn notify_favorites_changed(&self, kind: &str, local_changed: bool, remote_changed: bool) {
        let kind = normalize_favorites_changed_kind(kind);
        if kind == "world" && local_changed {
            self.sync_world_cache_favorites_from_db();
        }
        self.deps
            .event_bus
            .emit_favorites_changed(FavoritesChangedPayload {
                kind,
                local: local_changed,
                remote: remote_changed,
            });
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

                    let websocket_domain = normalize_websocket_domain(&active.session.websocket);
                    let final_current_user_output =
                        self.current_user_game_running_output(active.generation, false);
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

fn normalize_favorites_changed_kind(kind: &str) -> String {
    match kind.trim() {
        "vrcPlusWorld" => "world",
        other => other,
    }
    .to_string()
}
