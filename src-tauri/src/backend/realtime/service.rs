use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use serde_json::Value;
use tokio::sync::watch;

use crate::backend::context::BackendContext;
use crate::error::AppError;

use super::connection::{run_realtime_transport, RealtimeMessageSink};
use super::types::{RealtimeSessionContext, RealtimeTransportStartResult, RealtimeWsStatusPayload};
use vrcx_0_domain::friends::{FriendRecord, FriendRosterBaseline};
use vrcx_0_domain::realtime::RealtimeWsMessagePayload;
use vrcx_0_integrations::realtime::normalize_websocket_domain;
use vrcx_0_persistence::config as backend_config;
use vrcx_0_persistence::realtime::{
    lookup_game_log_world_name, write_realtime_batch, NotificationExpiration,
    RealtimePersistenceBatch,
};
use vrcx_0_runtime::realtime::current_user::RealtimeCurrentUserRuntime;
use vrcx_0_runtime::realtime::friends::{is_friend_event_type, RealtimeFriendsRuntime};
use vrcx_0_runtime::realtime::notifications::{
    apply_instance_closed_ws_message, apply_notification_ws_message,
};
use vrcx_0_runtime::realtime::types::{
    FriendBaselineResult, FriendProjection, PendingOfflineTimerAction,
    RealtimeCurrentUserAuthority, RealtimeCurrentUserOutput, RealtimeFriendApplyResult,
    RealtimeFriendOutput, RealtimeInstanceClosedOutput, RealtimeNotificationOutput,
};

const MAX_QUEUED_FRIEND_MESSAGES: usize = 512;

#[derive(Clone, Debug)]
struct ActiveRealtimeContext {
    session: RealtimeSessionContext,
    generation: u64,
    client_run_id: u64,
    session_generation: u64,
}

#[derive(Default)]
struct RealtimeBackendState {
    generation: u64,
    active_context: Option<ActiveRealtimeContext>,
    friend_messages_paused: bool,
    queued_friend_messages: Vec<RealtimeWsMessagePayload>,
}

#[derive(Clone, Debug, Default)]
pub struct RealtimeStopRequest {
    pub user_id: Option<String>,
    pub endpoint: Option<String>,
    pub websocket: Option<String>,
    pub client_run_id: Option<u64>,
    pub generation: Option<u64>,
}

impl RealtimeStopRequest {
    fn has_scope(&self) -> bool {
        self.user_id.is_some()
            || self.endpoint.is_some()
            || self.websocket.is_some()
            || self.client_run_id.is_some()
            || self.generation.is_some()
    }

    fn matches_active(&self, active: &ActiveRealtimeContext) -> bool {
        let matches_string = |expected: &Option<String>, actual: &str| {
            expected
                .as_ref()
                .map(|value| value.trim() == actual)
                .unwrap_or(true)
        };

        matches_string(&self.user_id, &active.session.user_id)
            && matches_string(&self.endpoint, &active.session.endpoint)
            && matches_string(&self.websocket, &active.session.websocket)
            && self
                .client_run_id
                .map(|client_run_id| client_run_id == active.client_run_id)
                .unwrap_or(true)
            && self
                .generation
                .map(|generation| generation == active.generation)
                .unwrap_or(true)
    }
}

pub struct RealtimeBackend {
    context: Arc<BackendContext>,
    state: Mutex<RealtimeBackendState>,
    cancel_tx: watch::Sender<u64>,
    friends: RealtimeFriendsRuntime,
    current_user: RealtimeCurrentUserRuntime,
}

struct RealtimeBackendMessageSink {
    backend: Arc<RealtimeBackend>,
}

impl RealtimeBackend {
    pub fn new(context: Arc<BackendContext>) -> Self {
        let (cancel_tx, _) = watch::channel(0);
        Self {
            context,
            state: Mutex::new(RealtimeBackendState::default()),
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
        current_user_snapshot: Value,
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> Result<RealtimeTransportStartResult, AppError> {
        let session = RealtimeSessionContext::new(user_id, endpoint, websocket);
        if session.user_id.is_empty() {
            return Err(AppError::Custom(
                "Backend realtime transport requires an authenticated user.".into(),
            ));
        }
        let generation = {
            let mut state = self
                .state
                .lock()
                .map_err(|error| AppError::Custom(format!("realtime state lock: {error}")))?;
            state.generation = state.generation.saturating_add(1);
            state.generation
        };
        let session_generation = self.context.session.set_realtime_context(
            vrcx_0_runtime::session::RealtimeSessionContext::new(
                session.user_id.clone(),
                session.endpoint.clone(),
                session.websocket.clone(),
            ),
        );
        {
            let mut state = self
                .state
                .lock()
                .map_err(|error| AppError::Custom(format!("realtime state lock: {error}")))?;
            state.active_context = Some(ActiveRealtimeContext {
                session: session.clone(),
                generation,
                client_run_id,
                session_generation,
            });
            state.friend_messages_paused = false;
            state.queued_friend_messages.clear();
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
            self.current_user.set_snapshot(
                session.user_id.clone(),
                generation,
                current_user_snapshot,
            );
        }
        let context = Arc::clone(&self.context);
        let message_sink: Arc<dyn RealtimeMessageSink> = Arc::new(RealtimeBackendMessageSink {
            backend: Arc::clone(self),
        });
        let cancel_rx = self.cancel_tx.subscribe();
        let _ = self.cancel_tx.send(generation);
        tauri::async_runtime::spawn(async move {
            run_realtime_transport(
                context,
                message_sink,
                generation,
                session_generation,
                session,
                cancel_rx,
            )
            .await;
        });

        Ok(RealtimeTransportStartResult {
            generation,
            client_run_id,
            session_generation,
        })
    }

    pub fn sync_friend_snapshot(
        self: &Arc<Self>,
        user_id: String,
        endpoint: String,
        websocket: String,
        generation: Option<u64>,
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> Result<FriendBaselineResult, AppError> {
        let requested_session = RealtimeSessionContext::new(user_id, endpoint, websocket);
        let (result, active) = {
            let state = self
                .state
                .lock()
                .map_err(|error| AppError::Custom(format!("realtime state lock: {error}")))?;
            let Some(active) = state.active_context.clone() else {
                return Ok(FriendBaselineResult::default());
            };
            if active.session != requested_session
                || generation
                    .map(|generation| generation != active.generation)
                    .unwrap_or(false)
                || !self
                    .context
                    .session
                    .is_realtime_generation_active(active.session_generation)
            {
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

        self.drain_queued_friend_messages(active);

        Ok(result)
    }

    pub fn expire_notification(
        &self,
        user_id: String,
        notification_id: String,
    ) -> Result<(), AppError> {
        let user_id = user_id.trim().to_string();
        let notification_id = notification_id.trim().to_string();
        if user_id.is_empty() || notification_id.is_empty() {
            return Ok(());
        }

        write_realtime_batch(
            &self.context.db,
            &user_id,
            &RealtimePersistenceBatch {
                notification_expirations: vec![NotificationExpiration {
                    id: notification_id,
                    expired_at: chrono::Utc::now().to_rfc3339(),
                }],
                ..RealtimePersistenceBatch::default()
            },
        )
        .map_err(|error| AppError::Custom(format!("expire realtime notification: {error}")))
    }

    pub fn stop(&self, request: RealtimeStopRequest) {
        let websocket_domain = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };

            let Some(active) = state.active_context.as_ref() else {
                if request.has_scope() {
                    return;
                }
                state.generation = state.generation.saturating_add(1);
                let _ = self.cancel_tx.send(state.generation);
                return;
            };

            if !request.matches_active(active) {
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
            state.generation = state.generation.saturating_add(1);
            state.active_context = None;
            state.friend_messages_paused = false;
            state.queued_friend_messages.clear();
            let _ = self.cancel_tx.send(state.generation);
            self.context.session.clear_realtime_context();
            self.friends.clear();
            self.current_user.clear();
            websocket_domain
        };

        self.context
            .event_bus
            .emit_realtime_ws_status(RealtimeWsStatusPayload {
                status: "disconnected".into(),
                websocket_domain,
                at: chrono::Utc::now().to_rfc3339(),
                reason: None,
                status_code: None,
            });
    }

    fn is_friend_output_current_locked(
        &self,
        state: &RealtimeBackendState,
        projection: &FriendProjection,
    ) -> bool {
        let Some(active) = state.active_context.as_ref() else {
            return false;
        };
        active.generation == projection.generation
            && self
                .context
                .session
                .is_realtime_generation_active(active.session_generation)
    }

    fn is_message_current_locked(
        &self,
        state: &RealtimeBackendState,
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
                        .context
                        .session
                        .is_realtime_generation_active(session_generation)
            })
            .unwrap_or(false)
    }

    fn queue_friend_message_locked(
        &self,
        state: &mut RealtimeBackendState,
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

    fn handle_friend_ws_message(
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
        match self.friends.apply_ws_message(payload) {
            RealtimeFriendApplyResult::Output(output) => {
                self.apply_friend_output_locked(&state, *output);
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

    fn apply_friend_output_locked(
        self: &Arc<Self>,
        state: &MutexGuard<'_, RealtimeBackendState>,
        output: RealtimeFriendOutput,
    ) {
        let mut projection = output.projection.clone();
        if !self.is_friend_output_current_locked(state, &projection) {
            self.friends
                .clear_baseline_if_revision(projection.generation, projection.baseline_revision);
            return;
        }
        if let Err(error) =
            write_realtime_batch(&self.context.db, &output.owner_user_id, &output.persistence)
        {
            tracing::warn!("Realtime friend persistence failed: {error}");
            projection.feed_entries.clear();
        }
        self.context
            .event_bus
            .emit_realtime_friend_projection(projection);

        if let PendingOfflineTimerAction::Schedule {
            user_id,
            token,
            delay_ms,
        } = output.timer_action
        {
            let backend = Arc::clone(self);
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                let now = chrono::Utc::now().to_rfc3339();
                backend.fire_pending_offline(&user_id, token, now);
            });
        }
    }

    fn apply_notification_output(&self, output: RealtimeNotificationOutput) {
        let projection = output.projection;
        if let Err(error) =
            write_realtime_batch(&self.context.db, &output.owner_user_id, &output.persistence)
        {
            tracing::warn!("Realtime notification persistence failed: {error}");
        }
        self.context
            .event_bus
            .emit_realtime_notification_projection(projection);
    }

    fn apply_current_user_output(&self, mut output: RealtimeCurrentUserOutput) {
        self.enrich_current_user_location_output(&mut output);
        let projection = output.projection;
        if let Err(error) =
            write_realtime_batch(&self.context.db, &output.owner_user_id, &output.persistence)
        {
            tracing::warn!("Realtime current user persistence failed: {error}");
        }
        self.context
            .event_bus
            .emit_realtime_current_user_projection(projection);
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
        let world_name =
            match lookup_game_log_world_name(&self.context.db, &location_entry.world_id) {
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
        if let Some(game_state_patch) = output
            .projection
            .game_state_patch
            .as_mut()
            .and_then(Value::as_object_mut)
        {
            let current_world_id = json_string_field(game_state_patch.get("currentWorldId"));
            if current_world_id == location_entry.world_id {
                game_state_patch.insert("currentWorldName".into(), Value::String(world_name));
            }
        }
    }

    fn apply_instance_closed_output(
        &self,
        owner_user_id: &str,
        output: RealtimeInstanceClosedOutput,
    ) {
        let projection = output.projection;
        if let Err(error) =
            write_realtime_batch(&self.context.db, owner_user_id, &output.persistence)
        {
            tracing::warn!("Realtime instance-closed persistence failed: {error}");
        }
        self.context
            .event_bus
            .emit_realtime_instance_closed_projection(projection);
    }

    fn refresh_current_user_snapshot_after_update(
        self: &Arc<Self>,
        generation: u64,
        session: RealtimeSessionContext,
        overlay_patch: Value,
    ) {
        let backend = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut options = HashMap::new();
            options.insert(
                "url".to_string(),
                Value::String(current_user_url(&session.endpoint)),
            );
            options.insert("method".to_string(), Value::String("GET".into()));
            let (status, body) = match backend.context.web.execute(options).await {
                Ok(result) => result,
                Err(error) => {
                    tracing::warn!("Realtime current user refresh failed: {error}");
                    return;
                }
            };
            backend.context.web.save_cookies(&backend.context.db);
            if !(200..300).contains(&status) {
                tracing::warn!(status, "Realtime current user refresh returned non-success");
                return;
            }
            let snapshot = match serde_json::from_str::<Value>(&body) {
                Ok(snapshot) => snapshot,
                Err(error) => {
                    tracing::warn!("Realtime current user refresh json failed: {error}");
                    return;
                }
            };
            let Some(output) = backend.current_user.apply_refreshed_snapshot(
                generation,
                snapshot,
                overlay_patch,
                backend.current_user_authority(),
            ) else {
                return;
            };
            backend.apply_current_user_output(output);
        });
    }

    fn fire_pending_offline(self: &Arc<Self>, user_id: &str, token: u64, now: String) {
        let state = match self.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                return;
            }
        };
        if let Some(output) = self.friends.fire_pending_offline(user_id, token, now) {
            self.apply_friend_output_locked(&state, output);
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

    fn current_user_authority(&self) -> RealtimeCurrentUserAuthority {
        let session = self.context.session.snapshot();
        let game_log_snapshot = self.context.game_log_snapshot();
        let game_log_disabled =
            backend_config::get_bool(&self.context.db, "gameLogDisabled", false).unwrap_or(false);
        RealtimeCurrentUserAuthority {
            is_game_running: session.is_game_running,
            game_log_enabled: !game_log_disabled,
            game_log_location: game_log_snapshot.location,
            game_log_destination: game_log_snapshot.destination,
            game_log_world_name: game_log_snapshot.world_name,
        }
    }
}

fn current_user_url(endpoint: &str) -> String {
    let endpoint = endpoint.trim().trim_end_matches('/');
    let endpoint = if endpoint.is_empty() {
        "https://api.vrchat.cloud/api/1"
    } else {
        endpoint
    };
    format!("{endpoint}/auth/user")
}

fn json_string_field(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            value
                .filter(|value| !value.is_null())
                .map(ToString::to_string)
                .unwrap_or_default()
        })
        .trim()
        .to_string()
}

impl RealtimeMessageSink for RealtimeBackendMessageSink {
    fn handle_realtime_transport_status(
        &self,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
        status: &str,
    ) {
        if status != "reconnecting" {
            return;
        }
        let mut state = match self.backend.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                return;
            }
        };
        if !self
            .backend
            .is_message_current_locked(&state, generation, session_generation, session)
        {
            return;
        }
        state.friend_messages_paused = true;
        state.queued_friend_messages.clear();
    }

    fn handle_realtime_ws_message(
        &self,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
        payload: &RealtimeWsMessagePayload,
    ) {
        let mut state = match self.backend.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                return;
            }
        };
        if !self
            .backend
            .is_message_current_locked(&state, generation, session_generation, session)
        {
            return;
        }

        let message_type = payload.json.get("type").and_then(serde_json::Value::as_str);
        if message_type.map(is_friend_event_type).unwrap_or(false) {
            if state.friend_messages_paused {
                self.backend
                    .queue_friend_message_locked(&mut state, generation, payload);
                return;
            }
            drop(state);
            self.backend
                .handle_friend_ws_message(generation, session_generation, session, payload);
        } else {
            drop(state);
        }

        if let Some(output) =
            apply_notification_ws_message(&session.user_id, &session.endpoint, generation, payload)
        {
            self.backend.apply_notification_output(output);
            return;
        }

        let is_user_update = message_type == Some("user-update");
        if let Some(output) = self.backend.current_user.apply_ws_message(
            generation,
            payload,
            self.backend.current_user_authority(),
        ) {
            let overlay_patch = output.projection.patch.clone();
            self.backend.apply_current_user_output(output);
            if is_user_update {
                self.backend.refresh_current_user_snapshot_after_update(
                    generation,
                    session.clone(),
                    overlay_patch,
                );
            }
            return;
        }

        if let Some(output) = apply_instance_closed_ws_message(generation, payload) {
            self.backend
                .apply_instance_closed_output(&session.user_id, output);
        }
    }

    fn handle_realtime_transport_finished(
        &self,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
    ) {
        let mut state = match self.backend.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                return;
            }
        };
        let Some(active) = state.active_context.as_ref() else {
            return;
        };
        if active.generation != generation
            || active.session_generation != session_generation
            || active.session != *session
        {
            return;
        }
        state.active_context = None;
        state.friend_messages_paused = false;
        state.queued_friend_messages.clear();
        self.backend.friends.clear();
        self.backend.current_user.clear();
    }
}
