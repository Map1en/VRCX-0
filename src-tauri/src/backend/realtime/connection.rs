use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use futures_util::StreamExt;
use serde_json::Value;
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::Message;
use vrcx_0_vrchat::realtime::{
    auth_token_from_response, build_auth_url, build_transport_url, connect_websocket,
    normalize_websocket_domain, Error as RealtimeTransportError,
};

use crate::backend::context::BackendContext;
use crate::backend::event_bus::BackendEventBus;
use crate::error::AppError;

use super::parser::RealtimeMessageParser;
use super::types::{RealtimeSessionContext, RealtimeWsStatusPayload};

const RECONNECT_DELAY: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

enum ConnectionEnd {
    Closed,
    Stopped,
}

pub trait RealtimeMessageSink: Send + Sync {
    fn handle_realtime_transport_status(
        &self,
        _generation: u64,
        _session_generation: u64,
        _session: &RealtimeSessionContext,
        _status: &str,
    ) {
    }

    fn handle_realtime_ws_message(
        &self,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
        payload: &super::types::RealtimeWsMessagePayload,
    );

    fn handle_realtime_transport_finished(
        &self,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
    );
}

#[derive(Debug)]
enum RealtimeConnectionError {
    AuthFailure {
        reason: String,
        status_code: Option<i32>,
    },
    Other(AppError),
}

impl RealtimeConnectionError {
    fn reason(&self) -> String {
        match self {
            Self::AuthFailure { reason, .. } => reason.clone(),
            Self::Other(error) => error.to_string(),
        }
    }

    fn status_code(&self) -> Option<i32> {
        match self {
            Self::AuthFailure { status_code, .. } => *status_code,
            Self::Other(_) => None,
        }
    }

    fn is_auth_failure(&self) -> bool {
        matches!(self, Self::AuthFailure { .. })
    }
}

impl From<AppError> for RealtimeConnectionError {
    fn from(error: AppError) -> Self {
        Self::Other(error)
    }
}

impl From<vrcx_0_runtime::Error> for RealtimeConnectionError {
    fn from(error: vrcx_0_runtime::Error) -> Self {
        Self::Other(AppError::from(error))
    }
}

impl From<RealtimeTransportError> for RealtimeConnectionError {
    fn from(error: RealtimeTransportError) -> Self {
        match error {
            RealtimeTransportError::AuthFailure {
                reason,
                status_code,
            } => Self::AuthFailure {
                reason,
                status_code,
            },
            error => Self::Other(AppError::Custom(error.to_string())),
        }
    }
}

async fn fetch_auth_token(
    context: &BackendContext,
    session: &RealtimeSessionContext,
) -> Result<String, RealtimeConnectionError> {
    let mut options = HashMap::new();
    options.insert(
        "url".to_string(),
        Value::String(build_auth_url(&session.endpoint)),
    );
    options.insert("method".to_string(), Value::String("GET".into()));
    let (status, body) = context.web.execute(options).await?;
    context.web.save_cookies(&context.db);
    auth_token_from_response(status, &body).map_err(RealtimeConnectionError::from)
}

pub async fn run_realtime_transport(
    context: Arc<BackendContext>,
    message_sink: Arc<dyn RealtimeMessageSink>,
    client_run_id: u64,
    generation: u64,
    session_generation: u64,
    session: RealtimeSessionContext,
    mut cancel_rx: watch::Receiver<u64>,
) {
    run_realtime_transport_inner(
        Arc::clone(&context),
        Arc::clone(&message_sink),
        client_run_id,
        generation,
        session_generation,
        session.clone(),
        &mut cancel_rx,
    )
    .await;
    message_sink.handle_realtime_transport_finished(generation, session_generation, &session);
    context
        .session
        .clear_realtime_context_if_generation(session_generation);
}

async fn run_realtime_transport_inner(
    context: Arc<BackendContext>,
    message_sink: Arc<dyn RealtimeMessageSink>,
    client_run_id: u64,
    generation: u64,
    session_generation: u64,
    session: RealtimeSessionContext,
    cancel_rx: &mut watch::Receiver<u64>,
) {
    let event_bus = context.event_bus.clone();
    let websocket_domain = normalize_websocket_domain(&session.websocket);
    let mut reconnect_attempt = 0usize;

    loop {
        if is_cancelled(cancel_rx, generation) {
            emit_status(
                &event_bus,
                client_run_id,
                generation,
                session_generation,
                "disconnected",
                &websocket_domain,
                None,
                None,
            );
            return;
        }

        let status = if reconnect_attempt == 0 {
            "connecting"
        } else {
            "reconnecting"
        };
        message_sink.handle_realtime_transport_status(
            generation,
            session_generation,
            &session,
            status,
        );
        emit_status(
            &event_bus,
            client_run_id,
            generation,
            session_generation,
            status,
            &websocket_domain,
            None,
            None,
        );

        match connect_once(
            Arc::clone(&context),
            Arc::clone(&message_sink),
            &session,
            client_run_id,
            generation,
            session_generation,
            cancel_rx,
            &event_bus,
        )
        .await
        {
            Ok(ConnectionEnd::Stopped) => {
                emit_status(
                    &event_bus,
                    client_run_id,
                    generation,
                    session_generation,
                    "disconnected",
                    &websocket_domain,
                    None,
                    None,
                );
                return;
            }
            Ok(ConnectionEnd::Closed) => {
                reconnect_attempt += 1;
                tracing::warn!(
                    generation,
                    reconnect_attempt,
                    "[Realtime] websocket closed; scheduling reconnect"
                );
                message_sink.handle_realtime_transport_status(
                    generation,
                    session_generation,
                    &session,
                    "reconnecting",
                );
                emit_status(
                    &event_bus,
                    client_run_id,
                    generation,
                    session_generation,
                    "reconnecting",
                    &websocket_domain,
                    Some("websocket closed".into()),
                    None,
                );
            }
            Err(error) => {
                reconnect_attempt += 1;
                let status = if error.is_auth_failure() {
                    "authFailure"
                } else {
                    "error"
                };
                let status_code = error.status_code();
                let message = error.reason();
                tracing::warn!(message = %message, "backend realtime transport failed");
                emit_status(
                    &event_bus,
                    client_run_id,
                    generation,
                    session_generation,
                    status,
                    &websocket_domain,
                    Some(message),
                    status_code,
                );
                if error.is_auth_failure() {
                    return;
                }
            }
        }

        tokio::select! {
            _ = tokio::time::sleep(RECONNECT_DELAY) => {}
            changed = cancel_rx.changed() => {
                if changed.is_err() || is_cancelled(cancel_rx, generation) {
                    emit_status(
                        &event_bus,
                        client_run_id,
                        generation,
                        session_generation,
                        "disconnected",
                        &websocket_domain,
                        None,
                        None,
                    );
                    return;
                }
            }
        }
    }
}

async fn connect_once(
    context: Arc<BackendContext>,
    message_sink: Arc<dyn RealtimeMessageSink>,
    session: &RealtimeSessionContext,
    client_run_id: u64,
    generation: u64,
    session_generation: u64,
    cancel_rx: &mut watch::Receiver<u64>,
    event_bus: &BackendEventBus,
) -> Result<ConnectionEnd, RealtimeConnectionError> {
    let Some(token) = wait_for_result_or_cancel(
        fetch_auth_token(&context, session),
        cancel_rx,
        generation,
        CONNECT_TIMEOUT,
        |timeout| {
            RealtimeConnectionError::Other(timeout_error("auth transport bootstrap", timeout))
        },
    )
    .await?
    else {
        return Ok(ConnectionEnd::Stopped);
    };
    if is_cancelled(cancel_rx, generation) {
        return Ok(ConnectionEnd::Stopped);
    }

    let url = build_transport_url(&session.websocket, &token);
    let websocket_domain = normalize_websocket_domain(&session.websocket);
    let Some(mut stream) = wait_for_result_or_cancel(
        async {
            connect_websocket(&url, context.web.proxy_url())
                .await
                .map_err(RealtimeConnectionError::from)
        },
        cancel_rx,
        generation,
        CONNECT_TIMEOUT,
        |timeout| RealtimeConnectionError::Other(timeout_error("websocket connect", timeout)),
    )
    .await?
    else {
        return Ok(ConnectionEnd::Stopped);
    };
    if is_cancelled(cancel_rx, generation) {
        return Ok(ConnectionEnd::Stopped);
    }
    message_sink.handle_realtime_transport_status(
        generation,
        session_generation,
        session,
        "connected",
    );
    emit_status(
        event_bus,
        client_run_id,
        generation,
        session_generation,
        "connected",
        &websocket_domain,
        None,
        None,
    );

    let mut parser = RealtimeMessageParser::default();
    loop {
        tokio::select! {
            changed = cancel_rx.changed() => {
                if changed.is_err() || is_cancelled(cancel_rx, generation) {
                    return Ok(ConnectionEnd::Stopped);
                }
            }
            frame = stream.next() => {
                let Some(frame) = frame else {
                    tracing::warn!(generation, "[Realtime] websocket stream ended");
                    return Ok(ConnectionEnd::Closed);
                };
                let frame = frame.map_err(|error| {
                    RealtimeConnectionError::Other(AppError::Custom(format!(
                        "websocket read: {error}"
                    )))
                })?;
                match frame {
                    Message::Text(text) => {
                        let received_at = chrono::Utc::now().to_rfc3339();
                        if let Some(payload) = parser.parse_text(text.as_ref(), received_at) {
                            let message_type = payload
                                .json
                                .get("type")
                                .and_then(|value| value.as_str())
                                .unwrap_or("<missing>");
                            if message_type == "<missing>" {
                                log_untyped_message_summary(generation, &payload.json);
                            }
                            message_sink.handle_realtime_ws_message(
                                generation,
                                session_generation,
                                session,
                                &payload,
                            );
                        }
                    }
                    Message::Close(close) => {
                        tracing::warn!(
                            generation,
                            close = ?close,
                            "[Realtime] websocket close frame"
                        );
                        return Ok(ConnectionEnd::Closed);
                    }
                    Message::Binary(bytes) => {
                        let _ = bytes;
                    }
                    Message::Ping(bytes) => {
                        let _ = bytes;
                    }
                    Message::Pong(bytes) => {
                        let _ = bytes;
                    }
                    Message::Frame(_) => {}
                }
            }
        }
    }
}

async fn wait_for_result_or_cancel<F, T, E, M>(
    future: F,
    cancel_rx: &mut watch::Receiver<u64>,
    generation: u64,
    timeout: Duration,
    make_timeout_error: M,
) -> Result<Option<T>, E>
where
    F: Future<Output = Result<T, E>>,
    M: FnOnce(Duration) -> E,
{
    let timer = tokio::time::sleep(timeout);
    tokio::pin!(future);
    tokio::pin!(timer);

    loop {
        tokio::select! {
            result = &mut future => {
                return result.map(Some);
            }
            _ = &mut timer => {
                return Err(make_timeout_error(timeout));
            }
            changed = cancel_rx.changed() => {
                if changed.is_err() || is_cancelled(cancel_rx, generation) {
                    return Ok(None);
                }
            }
        }
    }
}

fn timeout_error(operation: &str, timeout: Duration) -> AppError {
    AppError::Custom(format!(
        "{operation} timed out after {} seconds",
        timeout.as_secs()
    ))
}

fn is_cancelled(cancel_rx: &watch::Receiver<u64>, generation: u64) -> bool {
    *cancel_rx.borrow() != generation
}

fn emit_status(
    event_bus: &BackendEventBus,
    client_run_id: u64,
    generation: u64,
    session_generation: u64,
    status: &str,
    websocket_domain: &str,
    reason: Option<String>,
    status_code: Option<i32>,
) {
    event_bus.emit_realtime_ws_status(RealtimeWsStatusPayload {
        status: status.to_string(),
        websocket_domain: websocket_domain.to_string(),
        at: Utc::now().to_rfc3339(),
        client_run_id: Some(client_run_id),
        generation: Some(generation),
        session_generation: Some(session_generation),
        reason,
        status_code,
    });
}

fn log_untyped_message_summary(generation: u64, json: &Value) {
    let keys = json
        .as_object()
        .map(|object| object.keys().cloned().collect::<Vec<_>>().join(","))
        .unwrap_or_else(|| "<non-object>".into());
    let error = json
        .get("err")
        .or_else(|| json.get("error"))
        .or_else(|| json.get("message"))
        .and_then(|value| {
            value
                .as_str()
                .map(ToString::to_string)
                .or_else(|| Some(value.to_string()))
        })
        .unwrap_or_default();
    let ip = json
        .get("ip")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    tracing::warn!(
        generation,
        keys,
        error,
        ip,
        "[Realtime] websocket message missing type"
    );
}

#[cfg(test)]
mod tests {
    use super::{timeout_error, wait_for_result_or_cancel};

    #[tokio::test]
    async fn connect_wait_returns_stopped_when_cancelled() {
        let (tx, mut rx) = tokio::sync::watch::channel(1u64);
        tx.send(2).unwrap();

        let result = wait_for_result_or_cancel(
            std::future::pending::<Result<(), crate::error::AppError>>(),
            &mut rx,
            1,
            std::time::Duration::from_millis(50),
            |timeout| timeout_error("websocket connect", timeout),
        )
        .await
        .unwrap();

        assert!(result.is_none());
    }

    #[tokio::test]
    async fn connect_wait_ignores_same_generation_change() {
        let (tx, mut rx) = tokio::sync::watch::channel(0u64);
        tx.send(1).unwrap();

        let result = wait_for_result_or_cancel(
            async {
                tokio::time::sleep(std::time::Duration::from_millis(1)).await;
                Ok::<_, crate::error::AppError>(())
            },
            &mut rx,
            1,
            std::time::Duration::from_millis(50),
            |timeout| timeout_error("websocket connect", timeout),
        )
        .await
        .unwrap();

        assert!(result.is_some());
    }

    #[tokio::test]
    async fn connect_wait_times_out() {
        let (_tx, mut rx) = tokio::sync::watch::channel(1u64);

        let error = wait_for_result_or_cancel(
            std::future::pending::<Result<(), crate::error::AppError>>(),
            &mut rx,
            1,
            std::time::Duration::from_millis(1),
            |timeout| timeout_error("websocket connect", timeout),
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("timed out"));
    }
}
