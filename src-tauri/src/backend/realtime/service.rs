use std::sync::{Arc, Mutex};

use tokio::sync::watch;

use crate::backend::context::BackendContext;
use crate::error::AppError;

use super::connection::{normalize_websocket_domain, run_realtime_transport};
use super::types::{RealtimeSessionContext, RealtimeWsStatusPayload};

#[derive(Default)]
struct RealtimeBackendState {
    generation: u64,
    active_context: Option<RealtimeSessionContext>,
}

pub struct RealtimeBackend {
    context: Arc<BackendContext>,
    state: Mutex<RealtimeBackendState>,
    cancel_tx: watch::Sender<u64>,
}

impl RealtimeBackend {
    pub fn new(context: Arc<BackendContext>) -> Self {
        let (cancel_tx, _) = watch::channel(0);
        Self {
            context,
            state: Mutex::new(RealtimeBackendState::default()),
            cancel_tx,
        }
    }

    pub fn start(
        &self,
        user_id: String,
        endpoint: String,
        websocket: String,
    ) -> Result<(), AppError> {
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
            state.active_context = Some(session.clone());
            state.generation
        };
        let context = Arc::clone(&self.context);
        let cancel_rx = self.cancel_tx.subscribe();
        let _ = self.cancel_tx.send(generation);
        tauri::async_runtime::spawn(async move {
            run_realtime_transport(context, generation, session, cancel_rx).await;
        });

        Ok(())
    }

    pub fn stop(&self) {
        let websocket_domain = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            let websocket_domain = state
                .active_context
                .as_ref()
                .map(|context| normalize_websocket_domain(&context.websocket))
                .unwrap_or_default();
            state.generation = state.generation.saturating_add(1);
            state.active_context = None;
            let _ = self.cancel_tx.send(state.generation);
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
}
