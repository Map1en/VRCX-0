use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use futures_util::StreamExt;
use serde_json::Value;
use tokio::sync::watch;
use vrcx_0_vrchat_client::realtime::{
    auth_token_from_response, build_transport_url, classify_websocket_frame, connect_websocket,
    heartbeat, normalize_websocket_domain, Error as RealtimeTransportError, RealtimeFrame,
    HEARTBEAT_INTERVAL,
};

use vrcx_0_core::realtime::{RealtimeMessageParseOutcome, RealtimeMessageParser};

use vrcx_0_application_core::BackendRuntimeStatusPublisher;
use vrcx_0_application_core::Error;
use vrcx_0_application_core::WebClient;
use vrcx_0_application_realtime::{
    RealtimeMessageSink, RealtimeSessionContext, RealtimeTransport, RealtimeTransportTermination,
    RealtimeWsStatus, RealtimeWsStatusPayload,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const AUTH_BOOTSTRAP_TIMEOUT: Duration = Duration::from_secs(30);
const ALIVE_TRAIL_INTERVAL: Duration = Duration::from_secs(300);
const LIVENESS_QUIET_PERIOD: Duration = Duration::from_secs(5);
const LIVENESS_REPLY_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone)]
pub struct RealtimeTransportDeps {
    store: Arc<dyn vrcx_0_application_realtime::RealtimeStore>,
    web: Arc<WebClient>,
    pub backend_status: BackendRuntimeStatusPublisher,
    liveness_probe: Arc<watch::Sender<u64>>,
}

#[derive(Clone)]
pub struct VrchatRealtimeTransport {
    deps: RealtimeTransportDeps,
}

impl VrchatRealtimeTransport {
    pub fn new(
        store: Arc<dyn vrcx_0_application_realtime::RealtimeStore>,
        web: Arc<WebClient>,
        backend_status: BackendRuntimeStatusPublisher,
    ) -> Self {
        Self {
            deps: RealtimeTransportDeps {
                store,
                web,
                backend_status,
                liveness_probe: Arc::new(watch::channel(0).0),
            },
        }
    }
}

impl RealtimeTransport for VrchatRealtimeTransport {
    fn run(
        &self,
        message_sink: Arc<dyn RealtimeMessageSink>,
        client_run_id: u64,
        generation: u64,
        session_generation: u64,
        session: RealtimeSessionContext,
        cancel_rx: watch::Receiver<u64>,
    ) -> vrcx_0_application_realtime::RealtimeTransportFuture {
        Box::pin(run_realtime_transport(
            self.deps.clone(),
            message_sink,
            client_run_id,
            generation,
            session_generation,
            session,
            cancel_rx,
        ))
    }

    fn verify_liveness(&self) {
        self.deps
            .liveness_probe
            .send_modify(|probe| *probe = probe.wrapping_add(1));
    }
}

enum ConnectionEnd {
    Stopped,
    UnexpectedExit {
        reason: String,
        connected_secs: u64,
        silent_secs: u64,
    },
}

struct ConnectionAttempt<'a> {
    session: &'a RealtimeSessionContext,
    client_run_id: u64,
    generation: u64,
    session_generation: u64,
    cancel_rx: &'a mut watch::Receiver<u64>,
    backend_status: &'a BackendRuntimeStatusPublisher,
}

struct RealtimeStatusEvent<'a> {
    client_run_id: u64,
    generation: u64,
    session_generation: u64,
    status: RealtimeWsStatus,
    websocket_domain: &'a str,
}

#[derive(Debug)]
enum RealtimeConnectionError {
    AuthFailure {
        reason: String,
        status_code: Option<i32>,
    },
    Other(Error),
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
    trail_db_path: &std::path::Path,
) -> std::result::Result<String, RealtimeConnectionError> {
    if let Some(token) = deps.web.auth_cookie_value() {
        return Ok(token);
    }
    let fetch = deps
        .web
        .fetch_realtime_auth_token(&session.endpoint)
        .await?;
    if let Some(pooled_status) = fetch.rejected_pooled_status {
        trail(
            trail_db_path,
            "authTokenPooledRejected",
            serde_json::json!({ "pooledStatus": pooled_status }),
        );
    }
    auth_token_from_response(fetch.response.status, &fetch.response.data)
        .map_err(RealtimeConnectionError::from)
}

pub async fn run_realtime_transport(
    deps: RealtimeTransportDeps,
    message_sink: Arc<dyn RealtimeMessageSink>,
    client_run_id: u64,
    generation: u64,
    session_generation: u64,
    session: RealtimeSessionContext,
    mut cancel_rx: watch::Receiver<u64>,
) -> RealtimeTransportTermination {
    run_realtime_transport_inner(
        deps,
        message_sink,
        client_run_id,
        generation,
        session_generation,
        session,
        &mut cancel_rx,
    )
    .await
}

async fn run_realtime_transport_inner(
    deps: RealtimeTransportDeps,
    message_sink: Arc<dyn RealtimeMessageSink>,
    client_run_id: u64,
    generation: u64,
    session_generation: u64,
    session: RealtimeSessionContext,
    cancel_rx: &mut watch::Receiver<u64>,
) -> RealtimeTransportTermination {
    let backend_status = deps.backend_status.clone();
    let websocket_domain = normalize_websocket_domain(&session.websocket);
    if is_cancelled(cancel_rx, generation) {
        return stopped_transport(
            &backend_status,
            client_run_id,
            generation,
            session_generation,
            &websocket_domain,
        );
    }

    message_sink.handle_realtime_transport_status(
        generation,
        session_generation,
        &session,
        RealtimeWsStatus::Connecting,
    );
    emit_status(
        &backend_status,
        RealtimeStatusEvent {
            client_run_id,
            generation,
            session_generation,
            status: RealtimeWsStatus::Connecting,
            websocket_domain: &websocket_domain,
        },
    );

    let attempt = ConnectionAttempt {
        session: &session,
        client_run_id,
        generation,
        session_generation,
        cancel_rx,
        backend_status: &backend_status,
    };
    let trail_db_path = deps.store.database_path();
    let diagnostics_web = Arc::clone(&deps.web);
    let cookie_diagnostics = diagnostics_web.cookie_diagnostics();
    trail(
        &trail_db_path,
        "connecting",
        serde_json::json!({
            "generation": generation,
            "sessionGeneration": session_generation,
            "clientRunId": client_run_id,
            "websocketDomain": websocket_domain,
        }),
    );
    match connect_once(deps, message_sink, attempt).await {
        Ok(ConnectionEnd::Stopped) => stopped_transport(
            &backend_status,
            client_run_id,
            generation,
            session_generation,
            &websocket_domain,
        ),
        Ok(ConnectionEnd::UnexpectedExit {
            reason,
            connected_secs,
            silent_secs,
        }) => {
            tracing::warn!(
                generation,
                connected_secs,
                silent_secs,
                reason,
                "[Realtime] websocket disconnected"
            );
            trail(
                &trail_db_path,
                "disconnected",
                serde_json::json!({
                    "generation": generation,
                    "connectedSecs": connected_secs,
                    "silentSecs": silent_secs,
                    "reason": reason,
                }),
            );
            RealtimeTransportTermination::UnexpectedExit {
                reason,
                connected_secs: Some(connected_secs),
            }
        }
        Err(RealtimeConnectionError::AuthFailure {
            reason,
            status_code,
        }) => {
            tracing::warn!(
                generation,
                status_code,
                reason,
                "[Realtime] websocket connect rejected by auth"
            );
            trail(
                &trail_db_path,
                "authRejected",
                serde_json::json!({
                    "generation": generation,
                    "authCode": status_code,
                    "reason": reason,
                    "cookiesBefore": cookie_diagnostics,
                    "cookiesAfter": diagnostics_web.cookie_diagnostics(),
                }),
            );
            RealtimeTransportTermination::AuthExpired {
                reason,
                status_code,
            }
        }
        Err(RealtimeConnectionError::Other(error)) => {
            let reason = error.to_string();
            tracing::warn!(generation, reason, "[Realtime] websocket connect failed");
            trail(
                &trail_db_path,
                "connectFailed",
                serde_json::json!({
                    "generation": generation,
                    "reason": reason,
                }),
            );
            RealtimeTransportTermination::UnexpectedExit {
                reason,
                connected_secs: None,
            }
        }
    }
}

fn stopped_transport(
    backend_status: &BackendRuntimeStatusPublisher,
    client_run_id: u64,
    generation: u64,
    session_generation: u64,
    websocket_domain: &str,
) -> RealtimeTransportTermination {
    emit_status(
        backend_status,
        RealtimeStatusEvent {
            client_run_id,
            generation,
            session_generation,
            status: RealtimeWsStatus::Disconnected,
            websocket_domain,
        },
    );
    RealtimeTransportTermination::Stopped
}

async fn connect_once(
    deps: RealtimeTransportDeps,
    message_sink: Arc<dyn RealtimeMessageSink>,
    attempt: ConnectionAttempt<'_>,
) -> std::result::Result<ConnectionEnd, RealtimeConnectionError> {
    let trail_db_path = deps.store.database_path();
    let auth_started_at = tokio::time::Instant::now();
    let Some(token) = wait_for_result_or_cancel(
        fetch_auth_token(&deps, attempt.session, &trail_db_path),
        attempt.cancel_rx,
        attempt.generation,
        AUTH_BOOTSTRAP_TIMEOUT,
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

    trail(
        &trail_db_path,
        "authTokenReady",
        serde_json::json!({
            "generation": attempt.generation,
            "elapsedMs": auth_started_at.elapsed().as_millis() as u64,
        }),
    );

    let url = build_transport_url(&attempt.session.websocket, &token)
        .map_err(RealtimeConnectionError::from)?;
    let websocket_domain = normalize_websocket_domain(&attempt.session.websocket);
    let handshake_started_at = tokio::time::Instant::now();
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
        RealtimeWsStatus::Connected,
    );
    emit_status(
        attempt.backend_status,
        RealtimeStatusEvent {
            client_run_id: attempt.client_run_id,
            generation: attempt.generation,
            session_generation: attempt.session_generation,
            status: RealtimeWsStatus::Connected,
            websocket_domain: &websocket_domain,
        },
    );

    let mut parser = RealtimeMessageParser::default();
    let connected_at = tokio::time::Instant::now();
    let mut last_inbound_at = connected_at;
    let mut last_alive_trail_at = connected_at;
    let mut messages_received: u64 = 0;
    trail(
        &trail_db_path,
        "connected",
        serde_json::json!({
            "generation": attempt.generation,
            "handshakeMs": handshake_started_at.elapsed().as_millis() as u64,
            "websocketDomain": websocket_domain,
        }),
    );
    let database_path = deps.store.database_path();
    let ws_event_log_path = crate::ws_event_log::resolve_path(&database_path);
    if let Some(path) = &ws_event_log_path {
        crate::ws_event_log::append_connect_marker(
            path,
            &chrono::Utc::now().to_rfc3339(),
            attempt.generation,
            attempt.session_generation,
        );
    }
    let mut liveness_rx = deps.liveness_probe.subscribe();
    let mut liveness_requested = false;
    let mut liveness_deadline: Option<tokio::time::Instant> = None;
    let reason = loop {
        if liveness_deadline.is_some_and(|deadline| tokio::time::Instant::now() >= deadline) {
            break format!(
                "websocket did not answer a liveness ping within {} seconds",
                LIVENESS_REPLY_TIMEOUT.as_secs()
            );
        }
        let liveness_due = liveness_requested && last_inbound_at.elapsed() >= LIVENESS_QUIET_PERIOD;
        if liveness_due || last_inbound_at.elapsed() >= HEARTBEAT_INTERVAL {
            if let Err(reason) = heartbeat(&mut stream, last_inbound_at).await {
                break reason;
            }
            if liveness_due {
                liveness_requested = false;
                liveness_deadline = Some(tokio::time::Instant::now() + LIVENESS_REPLY_TIMEOUT);
                trail(
                    &trail_db_path,
                    "livenessProbe",
                    serde_json::json!({
                        "generation": attempt.generation,
                        "silentSecs": last_inbound_at.elapsed().as_secs(),
                    }),
                );
            }
        }
        let mut read_timeout = liveness_deadline.map_or(HEARTBEAT_INTERVAL, |deadline| {
            deadline
                .saturating_duration_since(tokio::time::Instant::now())
                .min(HEARTBEAT_INTERVAL)
        });
        if liveness_requested {
            read_timeout =
                read_timeout.min(LIVENESS_QUIET_PERIOD.saturating_sub(last_inbound_at.elapsed()));
        }
        tokio::select! {
            changed = attempt.cancel_rx.changed() => {
                if changed.is_err() || is_cancelled(attempt.cancel_rx, attempt.generation) {
                    return Ok(ConnectionEnd::Stopped);
                }
            }
            Ok(()) = liveness_rx.changed() => {
                liveness_requested = true;
            }
            frame = tokio::time::timeout(read_timeout, stream.next()) => {
                let Ok(frame) = frame else {
                    trail(
                        &trail_db_path,
                        "silent",
                        serde_json::json!({
                            "generation": attempt.generation,
                            "connectedSecs": connected_at.elapsed().as_secs(),
                            "silentSecs": last_inbound_at.elapsed().as_secs(),
                            "messages": messages_received,
                        }),
                    );
                    continue;
                };
                let Some(frame) = frame else {
                    break "websocket stream ended".to_string();
                };
                let frame = match frame {
                    Ok(frame) => frame,
                    Err(error) => break format!("websocket read: {error}"),
                };
                last_inbound_at = tokio::time::Instant::now();
                liveness_requested = false;
                liveness_deadline = None;
                messages_received = messages_received.saturating_add(1);
                if last_alive_trail_at.elapsed() >= ALIVE_TRAIL_INTERVAL {
                    last_alive_trail_at = last_inbound_at;
                    trail(
                        &trail_db_path,
                        "alive",
                        serde_json::json!({
                            "generation": attempt.generation,
                            "connectedSecs": connected_at.elapsed().as_secs(),
                            "messages": messages_received,
                        }),
                    );
                }
                match classify_websocket_frame(frame) {
                    RealtimeFrame::Text(text) => {
                        let received_at = chrono::Utc::now().to_rfc3339();
                        if let Some(path) = &ws_event_log_path {
                            crate::ws_event_log::append(path, &received_at, &text);
                        }
                        match parser.parse_text(&text, received_at) {
                            RealtimeMessageParseOutcome::Duplicate => {}
                            RealtimeMessageParseOutcome::Invalid { error } => {
                                tracing::warn!(
                                    raw_len = text.len(),
                                    error = %error,
                                    "[Realtime] websocket message json parse failed"
                                );
                            }
                            RealtimeMessageParseOutcome::Valid(payload) => {
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
                    }
                    RealtimeFrame::Close(close) => break format!("websocket closed: {close}"),
                    RealtimeFrame::Other => {}
                }
            }
        }
    };

    Ok(ConnectionEnd::UnexpectedExit {
        reason,
        connected_secs: connected_at.elapsed().as_secs(),
        silent_secs: last_inbound_at.elapsed().as_secs(),
    })
}

fn trail(db_path: &std::path::Path, kind: &str, fields: Value) {
    crate::realtime_lifecycle_log::record(db_path, kind, fields);
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

fn emit_status(backend_status: &BackendRuntimeStatusPublisher, event: RealtimeStatusEvent<'_>) {
    backend_status.publish_realtime_ws_status(RealtimeWsStatusPayload {
        status: event.status,
        websocket_domain: event.websocket_domain.to_string(),
        at: Utc::now().to_rfc3339(),
        client_run_id: Some(event.client_run_id),
        generation: Some(event.generation),
        session_generation: Some(event.session_generation),
        reason: None,
        status_code: None,
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
            std::future::pending::<std::result::Result<(), vrcx_0_application_core::Error>>(),
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
                Ok::<_, vrcx_0_application_core::Error>(())
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
            std::future::pending::<std::result::Result<(), vrcx_0_application_core::Error>>(),
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
