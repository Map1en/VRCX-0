use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::watch;

use crate::backend::context::BackendContext;
use crate::error::AppError;

use super::connection::run_realtime_transport;
use super::types::{RealtimeSessionContext, RealtimeTransportStartResult, RealtimeWsStatusPayload};
use vrcx_0_domain::friends::{FriendRecord, FriendRosterBaseline};
use vrcx_0_integrations::realtime::normalize_websocket_domain;
use vrcx_0_runtime::realtime::friends::{FriendBaselineResult, RealtimeFriendsRuntime};

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
        &self,
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
            });
        }
        let context = Arc::clone(&self.context);
        let cancel_rx = self.cancel_tx.subscribe();
        let _ = self.cancel_tx.send(generation);
        tauri::async_runtime::spawn(async move {
            run_realtime_transport(context, generation, session_generation, session, cancel_rx)
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
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> Result<FriendBaselineResult, AppError> {
        let current_user_id = current_user_id.trim().to_string();
        let endpoint = endpoint.trim().to_string();
        let websocket = websocket.trim().to_string();

        let active = {
            let state = self
                .state
                .lock()
                .map_err(|error| AppError::Custom(format!("realtime state lock: {error}")))?;
            state.active_context.clone()
        };

        let Some(active) = active else {
            return Ok(FriendBaselineResult {
                accepted: false,
                generation: 0,
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
                friend_count: 0,
            });
        }

        Ok(self.friends.set_baseline(
            FriendRosterBaseline {
                current_user_id,
                endpoint,
                websocket,
                friends_by_id,
            },
            active.session_generation,
        ))
    }
}
