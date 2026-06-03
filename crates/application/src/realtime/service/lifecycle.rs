use super::message_dispatch::json_string_field;
use super::types::{
    ActiveRealtimeContext, RealtimeHostRuntimeMessageSink, RealtimeHostRuntimeState,
    MAX_QUEUED_FRIEND_MESSAGES,
};
use super::*;

const FRIEND_PROFILE_REFETCH_THROTTLE_MS: i64 = 10_000;

impl RealtimeHostRuntime {
    pub fn new(deps: RealtimeHostRuntimeDeps) -> Self {
        let (cancel_tx, _) = watch::channel(0);
        Self {
            deps,
            state: Mutex::new(RealtimeHostRuntimeState::default()),
            cancel_tx,
            friends: RealtimeFriendsRuntime::new(),
            current_user: RealtimeCurrentUserRuntime::new(),
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
        let friend_user_ids = friends_by_id.keys().cloned().collect::<Vec<_>>();
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
            state.friend_messages_paused = false;
            state.queued_friend_messages.clear();
            state.friend_profile_refetches.clear();
            self.friends.clear();
            self.current_user.clear();
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
        let (result, active) = {
            let state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            let Some(active) = state.active_context.clone() else {
                self.deps.sync.record(
                    "realtimeFriends",
                    "ignored",
                    "Friend baseline ignored because realtime has no active context.",
                    friend_count as u64,
                );
                return Ok(FriendBaselineResult::default());
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

            let baseline_revision = self
                .friends
                .snapshot()
                .filter(|snapshot| snapshot.generation == active.generation)
                .map(|snapshot| snapshot.baseline_revision.saturating_add(1))
                .unwrap_or(0);
            let result = self.friends.set_baseline(
                FriendRosterBaseline {
                    current_user_id: active.session.user_id.clone(),
                    endpoint: active.session.endpoint.clone(),
                    websocket: active.session.websocket.clone(),
                    friends_by_id,
                },
                active.generation,
                baseline_revision,
            );
            (result, active)
        };

        if result.accepted {
            self.deps
                .overlay_activity
                .set_friend_user_ids(friend_user_ids);
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

    pub fn sync_current_user_snapshot(
        &self,
        user_id: String,
        endpoint: String,
        websocket: String,
        generation: Option<u64>,
        snapshot: serde_json::Value,
        overlay_patch: serde_json::Value,
    ) -> Result<bool> {
        let requested_session = RealtimeSessionContext::new(user_id, endpoint, websocket);
        let active = {
            let state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            let Some(active) = state.active_context.clone() else {
                return Ok(false);
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
                return Ok(false);
            }
            active
        };

        let Some(output) = self.current_user.apply_refreshed_snapshot(
            active.generation,
            snapshot,
            overlay_patch,
            self.current_user_authority(),
        ) else {
            return Ok(false);
        };
        self.apply_current_user_output(output);
        Ok(true)
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
            state.friend_messages_paused = false;
            state.queued_friend_messages.clear();
            state.friend_profile_refetches.clear();
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

    fn is_friend_output_current_locked(
        &self,
        state: &RealtimeHostRuntimeState,
        projection: &FriendProjection,
    ) -> bool {
        let Some(active) = state.active_context.as_ref() else {
            return false;
        };
        active.generation == projection.generation
            && self
                .deps
                .session
                .is_realtime_generation_active(active.session_generation)
    }

    pub(super) fn is_message_current_locked(
        &self,
        state: &RealtimeHostRuntimeState,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
    ) -> bool {
        state
            .active_context
            .as_ref()
            .map(|active| {
                active.generation == generation
                    && active.session_generation == session_generation
                    && active.session == *session
                    && self
                        .deps
                        .session
                        .is_realtime_generation_active(session_generation)
            })
            .unwrap_or(false)
    }

    pub(super) fn queue_friend_message_locked(
        &self,
        state: &mut RealtimeHostRuntimeState,
        generation: u64,
        payload: &RealtimeWsMessagePayload,
    ) {
        if state.queued_friend_messages.len() >= MAX_QUEUED_FRIEND_MESSAGES {
            state.queued_friend_messages.remove(0);
            tracing::warn!(
                generation,
                max = MAX_QUEUED_FRIEND_MESSAGES,
                "[Realtime] dropped oldest queued friend message during baseline refresh"
            );
        }
        state.queued_friend_messages.push(payload.clone());
    }

    pub(super) fn handle_friend_ws_message(
        self: &Arc<Self>,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
        payload: &RealtimeWsMessagePayload,
    ) {
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
        drop(state);

        match self.friends.apply_ws_message(payload) {
            RealtimeFriendApplyResult::Output(output) => {
                self.apply_friend_output(*output);
            }
            RealtimeFriendApplyResult::MissingBaseline => {
                tracing::warn!(
                    generation,
                    "[Realtime] friend event arrived without a baseline"
                );
            }
            RealtimeFriendApplyResult::Ignored => {}
        };
    }

    fn apply_friend_output(self: &Arc<Self>, mut output: RealtimeFriendOutput) {
        let timer_action = output.timer_action.clone();
        let profile_refetch_user_ids = output.profile_refetch_user_ids.clone();
        let mut projection = output.projection.clone();
        let projection_generation = projection.generation;
        if !self.is_friend_projection_current(&projection) {
            self.friends
                .clear_baseline_if_revision(projection.generation, projection.baseline_revision);
            return;
        }
        self.enrich_projection_world_names(&mut projection.feed_entries);
        self.enrich_persistence_world_names(&mut output.persistence);
        let persistence_attempted = !output.persistence.is_empty();
        match write_realtime_batch(&self.deps.db, &output.owner_user_id, &output.persistence) {
            Ok(counts) => {
                self.deps.sync.record(
                    "realtimeFriends",
                    "persisted",
                    "Realtime friend projection persisted by Rust.",
                    0,
                );
                self.emit_realtime_persisted(counts, persistence_attempted);
            }
            Err(error) => {
                tracing::warn!("Realtime friend persistence failed: {error}");
                self.deps
                    .sync
                    .record_failure("realtimeFriends", error.to_string());
                projection.feed_entries.clear();
            }
        }
        self.deps
            .overlay_activity
            .ingest_friend_projection(&projection);
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
    }

    fn schedule_friend_profile_refetches(self: &Arc<Self>, generation: u64, user_ids: Vec<String>) {
        if user_ids.is_empty() {
            return;
        }
        let now_ms = chrono::Utc::now().timestamp_millis();
        let (active, refetch_ids) = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            let Some(active) = state.active_context.clone() else {
                return;
            };
            if active.generation != generation
                || !self
                    .deps
                    .session
                    .is_realtime_generation_active(active.session_generation)
            {
                return;
            }
            let mut refetch_ids = Vec::new();
            for user_id in user_ids {
                let user_id = user_id.trim().to_string();
                if user_id.is_empty() || refetch_ids.contains(&user_id) {
                    continue;
                }
                let recent = state
                    .friend_profile_refetches
                    .get(&user_id)
                    .map(|last_ms| {
                        now_ms.saturating_sub(*last_ms) < FRIEND_PROFILE_REFETCH_THROTTLE_MS
                    })
                    .unwrap_or(false);
                if recent {
                    continue;
                }
                state
                    .friend_profile_refetches
                    .insert(user_id.clone(), now_ms);
                refetch_ids.push(user_id);
            }
            (active, refetch_ids)
        };
        for user_id in refetch_ids {
            let runtime = Arc::clone(self);
            let active = active.clone();
            self.deps.tasks.spawn(async move {
                runtime.refetch_friend_profile(active, user_id).await;
            });
        }
    }

    async fn refetch_friend_profile(
        self: Arc<Self>,
        active: ActiveRealtimeContext,
        user_id: String,
    ) {
        {
            let state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            if !self.is_message_current_locked(
                &state,
                active.generation,
                active.session_generation,
                &active.session,
            ) {
                return;
            }
        }
        let (_, request) = match remote_users::user_get_input(
            active.session.endpoint.clone(),
            user_id.clone(),
        ) {
            Ok(request) => request,
            Err(error) => {
                tracing::warn!(user_id = %user_id, "Realtime friend profile refetch input failed: {error}");
                return;
            }
        };
        let response = match self
            .deps
            .web
            .execute_api(request, ApiScope::Vrchat, &self.deps.db)
            .await
        {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(user_id = %user_id, "Realtime friend profile refetch failed: {error}");
                return;
            }
        };
        if !(200..300).contains(&response.status) {
            tracing::warn!(
                user_id = %user_id,
                status = response.status,
                "Realtime friend profile refetch returned non-success"
            );
            return;
        }
        let profile = match serde_json::from_str::<Value>(&response.data) {
            Ok(profile) => profile,
            Err(error) => {
                tracing::warn!(user_id = %user_id, "Realtime friend profile refetch json failed: {error}");
                return;
            }
        };
        let profile_user_id = json_string_field(profile.get("id"));
        if profile_user_id != user_id {
            tracing::warn!(
                expected_user_id = %user_id,
                profile_user_id = %profile_user_id,
                "Realtime friend profile refetch returned a different user"
            );
            return;
        }
        {
            let state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            if !self.is_message_current_locked(
                &state,
                active.generation,
                active.session_generation,
                &active.session,
            ) {
                return;
            }
        }
        match self.friends.apply_refetched_user_profile(
            active.generation,
            &user_id,
            profile,
            &chrono::Utc::now().to_rfc3339(),
        ) {
            RealtimeFriendApplyResult::Output(output) => self.apply_friend_output(*output),
            RealtimeFriendApplyResult::MissingBaseline | RealtimeFriendApplyResult::Ignored => {}
        }
    }

    fn is_friend_projection_current(&self, projection: &FriendProjection) -> bool {
        let state = match self.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                return false;
            }
        };
        self.is_friend_output_current_locked(&state, projection)
    }

    pub(super) fn apply_notification_output(&self, mut output: RealtimeNotificationOutput) {
        let mut projection = output.projection;
        self.enrich_notification_world_names(&mut projection);
        self.enrich_persistence_world_names(&mut output.persistence);
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
        self.deps
            .overlay_activity
            .ingest_notification_projection(&projection);
        self.deps
            .event_bus
            .emit_realtime_notification_projection(projection);
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

    fn enrich_projection_world_names(&self, entries: &mut [Value]) {
        for entry in entries {
            self.enrich_world_name(entry);
        }
    }

    fn enrich_notification_world_names(&self, projection: &mut RealtimeNotificationProjection) {
        for upsert in &mut projection.upserts {
            self.enrich_world_name(&mut upsert.notification);
        }
    }

    fn enrich_persistence_world_names(&self, persistence: &mut RealtimePersistenceBatch) {
        self.enrich_projection_world_names(&mut persistence.feed_entries);
        for notification in &mut persistence.notification_v1_upserts {
            self.enrich_world_name(notification);
        }
        for notification in &mut persistence.notification_v2_upserts {
            self.enrich_world_name(notification);
        }
        for update in &mut persistence.notification_v2_updates {
            self.enrich_world_name(&mut update.updates);
        }
    }

    fn enrich_world_name(&self, value: &mut Value) {
        let Some(object) = value.as_object_mut() else {
            return;
        };
        let top_level_name = object_string(object, "worldName");
        let details_name = nested_object_string(object, &["details", "worldName"]);
        let top_level_is_meaningful = is_meaningful_world_name(&top_level_name);
        let details_is_meaningful = is_meaningful_world_name(&details_name);
        if top_level_is_meaningful && details_is_meaningful {
            return;
        }

        let world_name = if top_level_is_meaningful {
            Some(top_level_name)
        } else if details_is_meaningful {
            Some(details_name)
        } else {
            let world_id = first_world_id([
                object_string(object, "worldId"),
                object_string(object, "worldName"),
                object_string(object, "location"),
                object_string(object, "instanceLocation"),
                nested_object_string(object, &["details", "worldId"]),
                nested_object_string(object, &["details", "worldName"]),
                nested_object_string(object, &["details", "location"]),
            ]);
            if world_id.is_empty() {
                None
            } else {
                self.lookup_world_display_name(&world_id)
            }
        };

        if let Some(world_name) = world_name {
            if !top_level_is_meaningful {
                object.insert("worldName".into(), Value::String(world_name.clone()));
            }
            if !details_is_meaningful {
                if let Some(details) = object.get_mut("details").and_then(Value::as_object_mut) {
                    details.insert("worldName".into(), Value::String(world_name));
                }
            }
        }
    }

    fn lookup_world_display_name(&self, world_id: &str) -> Option<String> {
        world_cache_get(self.deps.db.as_ref(), world_id.to_string())
            .ok()
            .flatten()
            .map(|world| world.name)
            .filter(|name| is_meaningful_world_name(name))
            .or_else(|| {
                lookup_game_log_world_name(self.deps.db.as_ref(), world_id)
                    .ok()
                    .filter(|name| is_meaningful_world_name(name))
            })
    }

    fn enrich_current_user_location_output(&self, output: &mut RealtimeCurrentUserOutput) {
        let Some(location_entry) = output.persistence.game_log_locations.first_mut() else {
            return;
        };
        if !location_entry.world_name.trim().is_empty()
            && location_entry.world_name.trim() != location_entry.world_id.trim()
        {
            return;
        }
        let world_name = match lookup_game_log_world_name(&self.deps.db, &location_entry.world_id) {
            Ok(world_name) => world_name,
            Err(error) => {
                tracing::warn!("Realtime current user world-name lookup failed: {error}");
                String::new()
            }
        };
        if world_name.is_empty() {
            return;
        }
        location_entry.world_name = world_name.clone();
        if let Some(game_state_patch) = output.projection.game_state_patch.as_mut() {
            let current_world_id = json_string_field(game_state_patch.get("currentWorldId"));
            if current_world_id == location_entry.world_id {
                game_state_patch.insert("currentWorldName".into(), Value::String(world_name));
            }
        }
    }

    pub(super) fn apply_instance_closed_output(
        &self,
        owner_user_id: &str,
        output: RealtimeInstanceClosedOutput,
    ) {
        let projection = output.projection;
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

    fn emit_realtime_persisted(&self, counts: RealtimeWriteCounts, persistence_attempted: bool) {
        if persistence_attempted {
            self.deps.event_bus.emit_ws_persisted(counts.affected_count);
        }
        if counts.game_log_affected_count > 0 {
            self.deps
                .event_bus
                .emit_game_log_persisted(counts.game_log_affected_count);
        }
    }

    pub(super) fn refresh_current_user_snapshot_after_update(
        self: &Arc<Self>,
        generation: u64,
        session: RealtimeSessionContext,
        overlay_patch: serde_json::Map<String, Value>,
    ) {
        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            let response = match runtime
                .deps
                .web
                .execute_api(
                    current_user_get_input(session.endpoint.clone()),
                    ApiScope::Vrchat,
                    &runtime.deps.db,
                )
                .await
            {
                Ok(result) => result,
                Err(error) => {
                    tracing::warn!("Realtime current user refresh failed: {error}");
                    return;
                }
            };
            if !(200..300).contains(&response.status) {
                tracing::warn!(
                    status = response.status,
                    "Realtime current user refresh returned non-success"
                );
                return;
            }
            let snapshot = match serde_json::from_str::<Value>(&response.data) {
                Ok(snapshot) => snapshot,
                Err(error) => {
                    tracing::warn!("Realtime current user refresh json failed: {error}");
                    return;
                }
            };
            let Some(output) = runtime.current_user.apply_refreshed_snapshot(
                generation,
                snapshot,
                serde_json::Value::Object(overlay_patch),
                runtime.current_user_authority(),
            ) else {
                return;
            };
            runtime.apply_current_user_output(output);
        });
    }

    fn fire_pending_offline(self: &Arc<Self>, user_id: &str, token: u64, now: String) {
        if let Some(output) = self.friends.fire_pending_offline(user_id, token, now) {
            self.apply_friend_output(output);
        }
    }

    fn drain_queued_friend_messages(self: &Arc<Self>, active: ActiveRealtimeContext) {
        loop {
            let queued_messages = {
                let mut state = match self.state.lock() {
                    Ok(state) => state,
                    Err(error) => {
                        tracing::warn!("realtime state lock failed: {error}");
                        return;
                    }
                };
                if !self.is_message_current_locked(
                    &state,
                    active.generation,
                    active.session_generation,
                    &active.session,
                ) {
                    return;
                }
                if state.queued_friend_messages.is_empty() {
                    state.friend_messages_paused = false;
                    return;
                }
                std::mem::take(&mut state.queued_friend_messages)
            };

            for payload in queued_messages {
                self.handle_friend_ws_message(
                    active.generation,
                    active.session_generation,
                    &active.session,
                    &payload,
                );
            }
        }
    }

    pub(super) fn current_user_authority(&self) -> RealtimeCurrentUserAuthority {
        let session = self.deps.session.snapshot();
        let game_log_snapshot = self
            .deps
            .game_log_snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default();
        let game_log_disabled =
            config_store::get_bool(&self.deps.db, "gameLogDisabled", false).unwrap_or(false);
        RealtimeCurrentUserAuthority {
            is_game_running: session.is_game_running,
            game_log_enabled: !game_log_disabled,
            game_log_location: game_log_snapshot.location,
            game_log_destination: game_log_snapshot.destination,
            game_log_world_name: game_log_snapshot.world_name,
        }
    }

    pub(super) fn sync_current_user_game_running_state(
        &self,
        generation: u64,
        is_game_running: bool,
    ) {
        let Some(output) = self
            .current_user
            .apply_game_running_state(generation, is_game_running)
        else {
            return;
        };
        self.apply_current_user_output(output);
    }
}

fn object_string(object: &serde_json::Map<String, Value>, key: &str) -> String {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn nested_object_string(object: &serde_json::Map<String, Value>, path: &[&str]) -> String {
    let Some((first, rest)) = path.split_first() else {
        return String::new();
    };
    let Some(mut current) = object.get(*first) else {
        return String::new();
    };
    for key in rest {
        let Some(next) = current.get(*key) else {
            return String::new();
        };
        current = next;
    }
    current
        .as_str()
        .map(str::trim)
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn first_world_id<const N: usize>(values: [String; N]) -> String {
    values
        .into_iter()
        .map(|value| world_id_from_location_or_id(&value))
        .find(|value| !value.is_empty())
        .unwrap_or_default()
}

fn world_id_from_location_or_id(value: &str) -> String {
    let trimmed = value.trim();
    if !trimmed.starts_with("wrld_") {
        return String::new();
    }
    trimmed
        .split([':', '~'])
        .next()
        .unwrap_or_default()
        .to_string()
}

fn is_meaningful_world_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && !trimmed.starts_with("wrld_")
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    use serde_json::json;
    use vrcx_0_core::friends::FriendRecord;
    use vrcx_0_persistence::storage::StorageService;
    use vrcx_0_persistence::DatabaseService;

    use crate::overlay_activity::{
        OverlayActivityCandidate, OverlayActivityFilters, OverlayActivityRuntime,
    };
    use crate::{
        HostSessionRuntime, RuntimeEventBus, RuntimeSnapshot, RuntimeSyncEngine, TaskSupervisor,
        WebClient,
    };

    use super::super::types::RealtimeHostRuntimeState;
    use super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-realtime-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn sync_friend_snapshot_updates_overlay_friend_scope() -> Result<()> {
        let dir = TestDir::new("overlay-friend-scope");
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        let storage = StorageService::new(&dir.path.join("storage.json"))?;
        let web = Arc::new(WebClient::new(
            &storage,
            db.as_ref(),
            "wss://pipeline.vrchat.cloud".to_string(),
        )?);
        let session = HostSessionRuntime::new();
        let host_session_generation =
            session.set_realtime_context(crate::session::RealtimeSessionContext::new(
                "usr_self".into(),
                "https://api.vrchat.cloud/api/1".into(),
                "wss://pipeline.vrchat.cloud".into(),
            ));
        let overlay_activity =
            OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(json!({
                "version": 1,
                "wrist": {
                    "types": {
                        "invite": {
                            "scope": "friends",
                            "favoriteGroupKeys": "all"
                        }
                    }
                }
            })));
        let runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
            db,
            web,
            event_bus: RuntimeEventBus::new(),
            sync: RuntimeSyncEngine::new(),
            tasks: TaskSupervisor::new(),
            session,
            game_log_snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
            overlay_activity: overlay_activity.clone(),
        }));
        let active_session = RealtimeSessionContext::new(
            "usr_self".into(),
            "https://api.vrchat.cloud/api/1".into(),
            "wss://pipeline.vrchat.cloud".into(),
        );
        {
            let mut state = runtime.state.lock().unwrap();
            *state = RealtimeHostRuntimeState {
                generation: 7,
                active_context: Some(ActiveRealtimeContext {
                    session: active_session.clone(),
                    generation: 7,
                    client_run_id: 1,
                    session_generation: host_session_generation,
                }),
                ..RealtimeHostRuntimeState::default()
            };
        }
        let mut friends_by_id = HashMap::new();
        friends_by_id.insert(
            "usr_new".to_string(),
            FriendRecord {
                id: "usr_new".to_string(),
                display_name: "New Friend".to_string(),
                state: "online".to_string(),
                state_bucket: "online".to_string(),
                ..FriendRecord::default()
            },
        );

        let result = runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(7),
            friends_by_id,
        )?;

        assert!(result.accepted);
        assert!(overlay_activity
            .ingest_candidate(invite_candidate("usr_new"))
            .is_some());
        Ok(())
    }

    fn invite_candidate(user_id: &str) -> OverlayActivityCandidate {
        OverlayActivityCandidate {
            source_id: format!("invite:{user_id}"),
            activity_type: "invite".to_string(),
            created_at: "2026-06-01T00:00:00.000Z".to_string(),
            actor_user_id: user_id.to_string(),
            actor_display_name: "Friend".to_string(),
            current_instance: false,
            payload: json!({}),
        }
    }
}
