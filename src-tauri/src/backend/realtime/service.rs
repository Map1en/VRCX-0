use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use tokio::sync::watch;

use crate::backend::context::BackendContext;
use crate::error::AppError;

use super::connection::{run_realtime_transport, RealtimeMessageSink};
use super::types::{RealtimeSessionContext, RealtimeTransportStartResult, RealtimeWsStatusPayload};
use vrcx_0_domain::friends::{FriendRecord, FriendRosterBaseline};
use vrcx_0_domain::realtime::RealtimeWsMessagePayload;
use vrcx_0_integrations::realtime::normalize_websocket_domain;
use vrcx_0_persistence::realtime::write_realtime_batch;
use vrcx_0_runtime::realtime::friends::{
    FriendBaselineResult, FriendProjection, PendingOfflineTimerAction, RealtimeFriendApplyResult,
    RealtimeFriendOutput, RealtimeFriendsRuntime,
};

#[derive(Clone, Debug)]
struct ActiveRealtimeContext {
    session: RealtimeSessionContext,
    generation: u64,
    client_run_id: u64,
    session_generation: u64,
    required_friend_baseline_revision: u64,
    accepted_friend_baseline_revision: u64,
}

#[derive(Default)]
struct RealtimeBackendState {
    generation: u64,
    active_context: Option<ActiveRealtimeContext>,
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
        }
    }

    pub fn start(
        self: &Arc<Self>,
        user_id: String,
        endpoint: String,
        websocket: String,
        client_run_id: u64,
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
                required_friend_baseline_revision: 0,
                accepted_friend_baseline_revision: 0,
            });
            self.friends.clear();
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
            let _ = self.cancel_tx.send(state.generation);
            self.context.session.clear_realtime_context();
            self.friends.clear();
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

    pub fn set_friend_baseline(
        &self,
        current_user_id: String,
        endpoint: String,
        websocket: String,
        client_run_id: u64,
        generation: u64,
        baseline_revision: u64,
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> Result<FriendBaselineResult, AppError> {
        let current_user_id = current_user_id.trim().to_string();
        let endpoint = endpoint.trim().to_string();
        let websocket = websocket.trim().to_string();

        let mut state = self
            .state
            .lock()
            .map_err(|error| AppError::Custom(format!("realtime state lock: {error}")))?;
        let Some(active) = state.active_context.as_mut() else {
            return Ok(FriendBaselineResult {
                accepted: false,
                generation: 0,
                baseline_revision: 0,
                friend_count: 0,
            });
        };

        let matches_context = active.session.user_id == current_user_id
            && active.session.endpoint == endpoint
            && active.session.websocket == websocket
            && active.client_run_id == client_run_id
            && active.generation == generation
            && self
                .context
                .session
                .is_realtime_generation_active(active.session_generation);

        if !matches_context {
            tracing::warn!(
                current_user_id,
                endpoint,
                websocket,
                client_run_id,
                generation,
                active_client_run_id = active.client_run_id,
                active_generation = active.generation,
                "[Realtime] ignored stale friend baseline"
            );
            return Ok(FriendBaselineResult {
                accepted: false,
                generation: active.generation,
                baseline_revision: active.accepted_friend_baseline_revision,
                friend_count: 0,
            });
        }

        if baseline_revision < active.required_friend_baseline_revision
            || baseline_revision < active.accepted_friend_baseline_revision
        {
            tracing::warn!(
                generation,
                baseline_revision,
                required_revision = active.required_friend_baseline_revision,
                accepted_revision = active.accepted_friend_baseline_revision,
                "[Realtime] rejected stale friend baseline revision"
            );
            return Ok(FriendBaselineResult {
                accepted: false,
                generation: active.generation,
                baseline_revision: active
                    .required_friend_baseline_revision
                    .max(active.accepted_friend_baseline_revision),
                friend_count: 0,
            });
        }

        let result = self.friends.set_baseline(
            FriendRosterBaseline {
                current_user_id,
                endpoint,
                websocket,
                friends_by_id,
            },
            active.generation,
            baseline_revision,
        );
        active.accepted_friend_baseline_revision = result.baseline_revision;
        Ok(result)
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
            && projection.baseline_revision >= active.required_friend_baseline_revision
            && projection.baseline_revision >= active.accepted_friend_baseline_revision
            && self
                .context
                .session
                .is_realtime_generation_active(active.session_generation)
    }

    fn apply_friend_output(self: &Arc<Self>, output: RealtimeFriendOutput) {
        let state = match self.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                return;
            }
        };
        self.apply_friend_output_locked(&state, output);
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
}

impl RealtimeMessageSink for RealtimeBackendMessageSink {
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
        let is_current = state
            .active_context
            .as_ref()
            .map(|active| {
                active.generation == generation
                    && active.session_generation == session_generation
                    && active.session == *session
                    && self
                        .backend
                        .context
                        .session
                        .is_realtime_generation_active(session_generation)
            })
            .unwrap_or(false);
        if !is_current {
            return;
        }
        match self.backend.friends.apply_ws_message(payload) {
            RealtimeFriendApplyResult::Output(output) => {
                self.backend.apply_friend_output_locked(&state, output);
            }
            RealtimeFriendApplyResult::MissingBaseline => {
                if let Some(active) = state.active_context.as_mut() {
                    if active.generation == generation
                        && active.session_generation == session_generation
                        && active.session == *session
                    {
                        active.required_friend_baseline_revision =
                            active.required_friend_baseline_revision.saturating_add(1);
                    }
                }
            }
            RealtimeFriendApplyResult::Ignored => {}
        };
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
        self.backend.friends.clear();
    }
}
