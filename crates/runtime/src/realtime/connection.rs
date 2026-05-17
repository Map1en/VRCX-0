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

use vrcx_0_core::realtime::RealtimeMessageParser;
use vrcx_0_store::database::DatabaseService;

use crate::event_bus::BackendEventBus;
use crate::realtime::types::{
    RealtimeSessionContext, RealtimeWsMessagePayload, RealtimeWsStatusPayload,
};
use crate::session::HostSessionRuntime;
use crate::web_client::WebClient;
use crate::Error;

const RECONNECT_DELAY: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct RealtimeTransportDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub event_bus: BackendEventBus,
    pub session: HostSessionRuntime,
}

enum ConnectionEnd {
    Closed,
    Stopped,
}

struct ConnectionAttempt<'a> {
    session: &'a RealtimeSessionContext,
    client_run_id: u64,
    generation: u64,
    session_generation: u64,
    cancel_rx: &'a mut watch::Receiver<u64>,
    event_bus: &'a BackendEventBus,
}

struct RealtimeStatusEvent<'a> {
    client_run_id: u64,
    generation: u64,
    session_generation: u64,
    status: &'a str,
    websocket_domain: &'a str,
    reason: Option<String>,
    status_code: Option<i32>,
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
        payload: &RealtimeWsMessagePayload,
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
    Other(Error),
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

impl From<Error> for RealtimeConnectionError {
    fn from(error: Error) -> Self {
        Self::Other(error)
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
            error => Self::Other(Error::Custom(error.to_string())),
        }
    }
}

async fn fetch_auth_token(
    deps: &RealtimeTransportDeps,
    session: &RealtimeSessionContext,
) -> std::result::Result<String, RealtimeConnectionError> {
    let mut options = HashMap::new();
    options.insert(
        "url".to_string(),
        Value::String(build_auth_url(&session.endpoint)),
    );
    options.insert("method".to_string(), Value::String("GET".into()));
    let (status, body) = deps.web.execute(options).await?;
    deps.web.save_cookies(&deps.db);
    auth_token_from_response(status, &body).map_err(RealtimeConnectionError::from)
}

pub async fn run_realtime_transport(
    deps: RealtimeTransportDeps,
    message_sink: Arc<dyn RealtimeMessageSink>,
    client_run_id: u64,
    generation: u64,
    session_generation: u64,
    session: RealtimeSessionContext,
    mut cancel_rx: watch::Receiver<u64>,
) {
    run_realtime_transport_inner(
        deps.clone(),
        Arc::clone(&message_sink),
        client_run_id,
        generation,
        session_generation,
        session.clone(),
        &mut cancel_rx,
    )
    .await;
    message_sink.handle_realtime_transport_finished(generation, session_generation, &session);
    deps.session
        .clear_realtime_context_if_generation(session_generation);
}

async fn run_realtime_transport_inner(
    deps: RealtimeTransportDeps,
    message_sink: Arc<dyn RealtimeMessageSink>,
    client_run_id: u64,
    generation: u64,
    session_generation: u64,
    session: RealtimeSessionContext,
    cancel_rx: &mut watch::Receiver<u64>,
) {
    let event_bus = deps.event_bus.clone();
    let websocket_domain = normalize_websocket_domain(&session.websocket);
    let mut reconnect_attempt = 0usize;

    loop {
        if is_cancelled(cancel_rx, generation) {
            emit_status(
                &event_bus,
                RealtimeStatusEvent {
                    client_run_id,
                    generation,
                    session_generation,
                    status: "disconnected",
                    websocket_domain: &websocket_domain,
                    reason: None,
                    status_code: None,
                },
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
            RealtimeStatusEvent {
                client_run_id,
                generation,
                session_generation,
                status,
                websocket_domain: &websocket_domain,
                reason: None,
                status_code: None,
            },
        );

        let attempt = ConnectionAttempt {
            session: &session,
            client_run_id,
            generation,
            session_generation,
            cancel_rx,
            event_bus: &event_bus,
        };
        match connect_once(deps.clone(), Arc::clone(&message_sink), attempt).await {
            Ok(ConnectionEnd::Stopped) => {
                emit_status(
                    &event_bus,
                    RealtimeStatusEvent {
                        client_run_id,
                        generation,
                        session_generation,
                        status: "disconnected",
                        websocket_domain: &websocket_domain,
                        reason: None,
                        status_code: None,
                    },
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
                    RealtimeStatusEvent {
                        client_run_id,
                        generation,
                        session_generation,
                        status: "reconnecting",
                        websocket_domain: &websocket_domain,
                        reason: Some("websocket closed".into()),
                        status_code: None,
                    },
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
                    RealtimeStatusEvent {
                        client_run_id,
                        generation,
                        session_generation,
                        status,
                        websocket_domain: &websocket_domain,
                        reason: Some(message),
                        status_code,
                    },
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
                        RealtimeStatusEvent {
                            client_run_id,
                            generation,
                            session_generation,
                            status: "disconnected",
                            websocket_domain: &websocket_domain,
                            reason: None,
                            status_code: None,
                        },
                    );
                    return;
                }
            }
        }
    }
}

async fn connect_once(
    deps: RealtimeTransportDeps,
    message_sink: Arc<dyn RealtimeMessageSink>,
    attempt: ConnectionAttempt<'_>,
) -> std::result::Result<ConnectionEnd, RealtimeConnectionError> {
    let Some(token) = wait_for_result_or_cancel(
        fetch_auth_token(&deps, attempt.session),
        attempt.cancel_rx,
        attempt.generation,
        CONNECT_TIMEOUT,
        |timeout| {
            RealtimeConnectionError::Other(timeout_error("auth transport bootstrap", timeout))
        },
    )
    .await?
    else {
        return Ok(ConnectionEnd::Stopped);
    };
    if is_cancelled(attempt.cancel_rx, attempt.generation) {
        return Ok(ConnectionEnd::Stopped);
    }

    let url = build_transport_url(&attempt.session.websocket, &token);
    let websocket_domain = normalize_websocket_domain(&attempt.session.websocket);
    let Some(mut stream) = wait_for_result_or_cancel(
        async {
            connect_websocket(&url, deps.web.proxy_url())
                .await
                .map_err(RealtimeConnectionError::from)
        },
        attempt.cancel_rx,
        attempt.generation,
        CONNECT_TIMEOUT,
        |timeout| RealtimeConnectionError::Other(timeout_error("websocket connect", timeout)),
    )
    .await?
    else {
        return Ok(ConnectionEnd::Stopped);
    };
    if is_cancelled(attempt.cancel_rx, attempt.generation) {
        return Ok(ConnectionEnd::Stopped);
    }
    message_sink.handle_realtime_transport_status(
        attempt.generation,
        attempt.session_generation,
        attempt.session,
        "connected",
    );
    emit_status(
        attempt.event_bus,
        RealtimeStatusEvent {
            client_run_id: attempt.client_run_id,
            generation: attempt.generation,
            session_generation: attempt.session_generation,
            status: "connected",
            websocket_domain: &websocket_domain,
            reason: None,
            status_code: None,
        },
    );

    let mut parser = RealtimeMessageParser::default();
    loop {
        tokio::select! {
            changed = attempt.cancel_rx.changed() => {
                if changed.is_err() || is_cancelled(attempt.cancel_rx, attempt.generation) {
                    return Ok(ConnectionEnd::Stopped);
                }
            }
            frame = stream.next() => {
                let Some(frame) = frame else {
                    tracing::warn!(
                        generation = attempt.generation,
                        "[Realtime] websocket stream ended"
                    );
                    return Ok(ConnectionEnd::Closed);
                };
                let frame = frame.map_err(|error| {
                    RealtimeConnectionError::Other(Error::Custom(format!(
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
                                log_untyped_message_summary(attempt.generation, &payload.json);
                            }
                            message_sink.handle_realtime_ws_message(
                                attempt.generation,
                                attempt.session_generation,
                                attempt.session,
                                &payload,
                            );
                        }
                    }
                    Message::Close(close) => {
                        tracing::warn!(
                            generation = attempt.generation,
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
) -> std::result::Result<Option<T>, E>
where
    F: Future<Output = std::result::Result<T, E>>,
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

fn timeout_error(operation: &str, timeout: Duration) -> Error {
    Error::Custom(format!(
        "{operation} timed out after {} seconds",
        timeout.as_secs()
    ))
}

fn is_cancelled(cancel_rx: &watch::Receiver<u64>, generation: u64) -> bool {
    *cancel_rx.borrow() != generation
}

fn emit_status(event_bus: &BackendEventBus, event: RealtimeStatusEvent<'_>) {
    event_bus.emit_realtime_ws_status(RealtimeWsStatusPayload {
        status: event.status.to_string(),
        websocket_domain: event.websocket_domain.to_string(),
        at: Utc::now().to_rfc3339(),
        client_run_id: Some(event.client_run_id),
        generation: Some(event.generation),
        session_generation: Some(event.session_generation),
        reason: event.reason,
        status_code: event.status_code,
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
            std::future::pending::<std::result::Result<(), crate::Error>>(),
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
                Ok::<_, crate::Error>(())
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
            std::future::pending::<std::result::Result<(), crate::Error>>(),
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
