use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::sync::watch;
use vrcx_0_vrchat_client::auth::session_get_input;
use vrcx_0_vrchat_client::http_api::ApiScope;
use vrcx_0_vrchat_client::realtime::{
    auth_token_from_response, build_transport_url, classify_websocket_frame, connect_websocket,
    normalize_websocket_domain, Error as RealtimeTransportError, RealtimeFrame,
};

use vrcx_0_core::realtime::RealtimeMessageParser;
use vrcx_0_persistence::DatabaseService;

use crate::event_bus::RuntimeEventBus;
use crate::realtime::{RealtimeSessionContext, RealtimeWsMessagePayload, RealtimeWsStatusPayload};
use crate::session::HostSessionRuntime;
use crate::web_client::WebClient;
use crate::Error;

const RECONNECT_DELAY: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct RealtimeTransportDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub event_bus: RuntimeEventBus,
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
    event_bus: &'a RuntimeEventBus,
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
    let response = deps
        .web
        .execute_api(
            session_get_input(session.endpoint.clone()),
            ApiScope::Vrchat,
            &deps.db,
        )
        .await?;
    auth_token_from_response(response.status, &response.data).map_err(RealtimeConnectionError::from)
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

        let status = reconnect_status_for_attempt(reconnect_attempt);
        if reconnect_attempt > 0 {
            tracing::warn!(
                generation,
                session_generation,
                reconnect_attempt,
                "[Realtime] websocket reconnect attempt starting"
            );
        }
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
                reconnect_attempt = next_reconnect_attempt(reconnect_attempt);
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
                reconnect_attempt = next_reconnect_attempt(reconnect_attempt);
                let status = if error.is_auth_failure() {
                    "authFailure"
                } else {
                    "error"
                };
                let status_code = error.status_code();
                let message = error.reason();
                tracing::warn!(message = %message, "runtime realtime transport failed");
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
                if should_stop_after_connection_error(&error) {
                    return;
                }
            }
        }

        tokio::select! {
            _ = tokio::time::sleep(reconnect_delay_for_attempt(reconnect_attempt)) => {}
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

fn reconnect_status_for_attempt(reconnect_attempt: usize) -> &'static str {
    if reconnect_attempt == 0 {
        "connecting"
    } else {
        "reconnecting"
    }
}

fn next_reconnect_attempt(reconnect_attempt: usize) -> usize {
    reconnect_attempt.saturating_add(1)
}

fn reconnect_delay_for_attempt(_reconnect_attempt: usize) -> Duration {
    RECONNECT_DELAY
}

fn should_stop_after_connection_error(error: &RealtimeConnectionError) -> bool {
    error.is_auth_failure()
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

    let url = build_transport_url(&attempt.session.websocket, &token)
        .map_err(RealtimeConnectionError::from)?;
    let websocket_domain = normalize_websocket_domain(&attempt.session.websocket);
    let Some(mut stream) = wait_for_result_or_cancel(
        async {
            connect_websocket(&url, &deps.web.realtime_connection_options())
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
    let ws_event_log_path = crate::realtime::ws_event_log::resolve_path(deps.db.db_path());
    if let Some(path) = &ws_event_log_path {
        crate::realtime::ws_event_log::append_connect_marker(
            path,
            &chrono::Utc::now().to_rfc3339(),
            attempt.generation,
            attempt.session_generation,
        );
    }
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
                match classify_websocket_frame(frame) {
                    RealtimeFrame::Text(text) => {
                        let received_at = chrono::Utc::now().to_rfc3339();
                        if let Some(path) = &ws_event_log_path {
                            crate::realtime::ws_event_log::append(path, &received_at, &text);
                        }
                        if let Some(payload) = parser.parse_text(&text, received_at) {
                            let message_type = payload
                                .json
                                .get("type")
                                .and_then(|value| value.as_str())
                                .unwrap_or("<missing>");
                            if message_type == "<missing>" {
                                log_untyped_message_summary(attempt.generation, &payload.json);
                            }
                            deps.event_bus.emit_backend_runtime_telemetry(json!({
                                "kind": "wsMessage",
                                "messageType": message_type,
                            }));
                            message_sink.handle_realtime_ws_message(
                                attempt.generation,
                                attempt.session_generation,
                                attempt.session,
                                &payload,
                            );
                        }
                    }
                    RealtimeFrame::Close(close) => {
                        tracing::warn!(
                            generation = attempt.generation,
                            close = %close,
                            "[Realtime] websocket close frame"
                        );
                        return Ok(ConnectionEnd::Closed);
                    }
                    RealtimeFrame::Other => {}
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

fn emit_status(event_bus: &RuntimeEventBus, event: RealtimeStatusEvent<'_>) {
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
    use super::{
        next_reconnect_attempt, reconnect_delay_for_attempt, reconnect_status_for_attempt,
        should_stop_after_connection_error, timeout_error, wait_for_result_or_cancel,
        RealtimeConnectionError, RECONNECT_DELAY,
    };

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

    #[test]
    fn reconnect_status_is_connecting_only_for_first_attempt() {
        assert_eq!(reconnect_status_for_attempt(0), "connecting");
        assert_eq!(reconnect_status_for_attempt(1), "reconnecting");
        assert_eq!(reconnect_status_for_attempt(99), "reconnecting");
    }

    #[test]
    fn reconnect_backoff_uses_fixed_delay_and_saturating_attempts() {
        assert_eq!(next_reconnect_attempt(0), 1);
        assert_eq!(next_reconnect_attempt(usize::MAX), usize::MAX);
        assert_eq!(reconnect_delay_for_attempt(1), RECONNECT_DELAY);
        assert_eq!(reconnect_delay_for_attempt(usize::MAX), RECONNECT_DELAY);
    }

    #[test]
    fn reconnect_retries_non_auth_errors_but_stops_on_auth_failure() {
        let transient = RealtimeConnectionError::Other(crate::Error::Custom("closed".into()));
        assert!(!should_stop_after_connection_error(&transient));

        let auth = RealtimeConnectionError::AuthFailure {
            reason: "expired".into(),
            status_code: Some(401),
        };
        assert!(should_stop_after_connection_error(&auth));
    }
}
