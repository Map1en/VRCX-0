use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use futures_util::StreamExt;
use reqwest::Url;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Request;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{client_async_tls, connect_async, MaybeTlsStream, WebSocketStream};

use crate::backend::context::BackendContext;
use crate::backend::event_bus::BackendEventBus;
use crate::error::AppError;

use super::parser::RealtimeMessageParser;
use super::types::{RealtimeSessionContext, RealtimeWsStatusPayload};

const DEFAULT_ENDPOINT_DOMAIN: &str = "https://api.vrchat.cloud/api/1";
const DEFAULT_WEBSOCKET_DOMAIN: &str = "wss://pipeline.vrchat.cloud";
const BROWSER_WEBSOCKET_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const RECONNECT_DELAY: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_PROXY_CONNECT_RESPONSE: usize = 8192;

type RealtimeWebSocketStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

enum ConnectionEnd {
    Closed,
    Stopped,
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

pub fn normalize_websocket_domain(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        DEFAULT_WEBSOCKET_DOMAIN.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_endpoint(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        DEFAULT_ENDPOINT_DOMAIN.to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn build_transport_url(websocket: &str, token: &str) -> String {
    format!(
        "{}/?auth={}",
        normalize_websocket_domain(websocket),
        encode_uri_component(token)
    )
}

fn encode_uri_component(value: &str) -> String {
    const ENCODE_SET: &percent_encoding::AsciiSet = &percent_encoding::CONTROLS
        .add(b' ')
        .add(b'"')
        .add(b'#')
        .add(b'$')
        .add(b'%')
        .add(b'&')
        .add(b'+')
        .add(b',')
        .add(b'/')
        .add(b':')
        .add(b';')
        .add(b'<')
        .add(b'=')
        .add(b'>')
        .add(b'?')
        .add(b'@')
        .add(b'[')
        .add(b'\\')
        .add(b']')
        .add(b'^')
        .add(b'`')
        .add(b'{')
        .add(b'|')
        .add(b'}');
    percent_encoding::utf8_percent_encode(value, ENCODE_SET).to_string()
}

fn build_auth_url(endpoint: &str) -> String {
    format!("{}/auth", normalize_endpoint(endpoint))
}

fn extract_auth_token(body: &str) -> Result<String, AppError> {
    let json: Value = serde_json::from_str(body)
        .map_err(|error| AppError::Custom(format!("auth response json: {error}")))?;
    let ok = json.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let token = json
        .get("token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if ok && !token.is_empty() {
        return Ok(token.to_string());
    }
    Err(AppError::Custom(
        "The auth transport bootstrap did not return a websocket token.".into(),
    ))
}

fn auth_token_from_response(status: i32, body: &str) -> Result<String, RealtimeConnectionError> {
    if status == 401 {
        return Err(RealtimeConnectionError::AuthFailure {
            reason: format!("auth transport bootstrap failed (401): {body}"),
            status_code: Some(status),
        });
    }

    if status >= 400 || status < 0 {
        return Err(RealtimeConnectionError::Other(AppError::Custom(format!(
            "auth transport bootstrap failed ({status})"
        ))));
    }

    extract_auth_token(body).map_err(RealtimeConnectionError::Other)
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
    auth_token_from_response(status, &body)
}

pub async fn run_realtime_transport(
    context: Arc<BackendContext>,
    generation: u64,
    session: RealtimeSessionContext,
    mut cancel_rx: watch::Receiver<u64>,
) {
    let event_bus = context.event_bus.clone();
    let websocket_domain = normalize_websocket_domain(&session.websocket);
    let mut reconnect_attempt = 0usize;

    loop {
        if is_cancelled(&cancel_rx, generation) {
            emit_status(&event_bus, "disconnected", &websocket_domain, None, None);
            return;
        }

        emit_status(
            &event_bus,
            if reconnect_attempt == 0 {
                "connecting"
            } else {
                "reconnecting"
            },
            &websocket_domain,
            None,
            None,
        );

        match connect_once(
            Arc::clone(&context),
            &session,
            generation,
            &mut cancel_rx,
            &event_bus,
        )
        .await
        {
            Ok(ConnectionEnd::Stopped) => {
                emit_status(&event_bus, "disconnected", &websocket_domain, None, None);
                return;
            }
            Ok(ConnectionEnd::Closed) => {
                reconnect_attempt += 1;
                tracing::warn!(
                    generation,
                    reconnect_attempt,
                    "[Realtime] websocket closed; scheduling reconnect"
                );
                emit_status(
                    &event_bus,
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
                if changed.is_err() || is_cancelled(&cancel_rx, generation) {
                    emit_status(
                        &event_bus,
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
    session: &RealtimeSessionContext,
    generation: u64,
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
        connect_websocket(&url, context.web.proxy_url()),
        cancel_rx,
        generation,
        CONNECT_TIMEOUT,
        |timeout| timeout_error("websocket connect", timeout),
    )
    .await
    .map_err(RealtimeConnectionError::Other)?
    else {
        return Ok(ConnectionEnd::Stopped);
    };
    if is_cancelled(cancel_rx, generation) {
        return Ok(ConnectionEnd::Stopped);
    }
    emit_status(event_bus, "connected", &websocket_domain, None, None);

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
                        if let Some(payload) = parser.parse_text(&text.to_string()) {
                            let message_type = payload
                                .json
                                .get("type")
                                .and_then(|value| value.as_str())
                                .unwrap_or("<missing>");
                            if message_type == "<missing>" {
                                log_untyped_message_summary(generation, &payload.json);
                            }
                            event_bus.emit_realtime_ws_message(payload);
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

async fn connect_websocket(
    url: &str,
    proxy_url: Option<&str>,
) -> Result<RealtimeWebSocketStream, AppError> {
    let request = build_browser_websocket_request(url)?;
    let websocket_url = parse_url(url, "websocket URL")?;
    let (target_host, target_port) = websocket_target(&websocket_url)?;
    let Some(proxy_url) = proxy_url else {
        return connect_async(request)
            .await
            .map(|(stream, _)| stream)
            .map_err(|error| AppError::Custom(format!("websocket connect: {error}")));
    };

    let proxy_url = parse_url(proxy_url, "proxy URL")?;
    let stream = match proxy_url.scheme() {
        "http" => connect_http_proxy(&proxy_url, &target_host, target_port).await?,
        "socks5" => connect_socks5_proxy(&proxy_url, &target_host, target_port).await?,
        scheme => {
            return Err(AppError::Custom(format!(
                "Unsupported realtime proxy scheme: {scheme}"
            )));
        }
    };

    client_async_tls(request, stream)
        .await
        .map(|(stream, _)| stream)
        .map_err(|error| AppError::Custom(format!("websocket proxy connect: {error}")))
}

fn build_browser_websocket_request(url: &str) -> Result<Request, AppError> {
    let mut request = url
        .into_client_request()
        .map_err(|error| AppError::Custom(format!("websocket request: {error}")))?;
    request
        .headers_mut()
        .insert("User-Agent", BROWSER_WEBSOCKET_USER_AGENT.parse().unwrap());
    request
        .headers_mut()
        .insert("Origin", frontend_origin().parse().unwrap());
    Ok(request)
}

fn frontend_origin() -> &'static str {
    if cfg!(debug_assertions) {
        "http://localhost:9000"
    } else {
        "http://tauri.localhost"
    }
}

fn parse_url(value: &str, label: &str) -> Result<Url, AppError> {
    Url::parse(value).map_err(|error| AppError::Custom(format!("invalid {label}: {error}")))
}

fn websocket_target(url: &Url) -> Result<(String, u16), AppError> {
    let host = url
        .host_str()
        .ok_or_else(|| AppError::Custom("websocket URL is missing a host".into()))?
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| AppError::Custom("websocket URL is missing a port".into()))?;
    Ok((host, port))
}

fn proxy_target(proxy_url: &Url) -> Result<(String, u16), AppError> {
    let host = proxy_url
        .host_str()
        .ok_or_else(|| AppError::Custom("proxy URL is missing a host".into()))?
        .to_string();
    let port = proxy_url
        .port_or_known_default()
        .ok_or_else(|| AppError::Custom("proxy URL is missing a port".into()))?;
    Ok((host, port))
}

async fn open_proxy_tcp_stream(proxy_url: &Url) -> Result<TcpStream, AppError> {
    let (proxy_host, proxy_port) = proxy_target(proxy_url)?;
    TcpStream::connect((proxy_host.as_str(), proxy_port))
        .await
        .map_err(|error| AppError::Custom(format!("proxy tcp connect: {error}")))
}

async fn connect_http_proxy(
    proxy_url: &Url,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, AppError> {
    let mut stream = open_proxy_tcp_stream(proxy_url).await?;
    let request = build_http_proxy_connect_request(target_host, target_port);
    stream
        .write_all(&request)
        .await
        .map_err(|error| AppError::Custom(format!("http proxy write: {error}")))?;

    let response = read_http_proxy_connect_response(&mut stream).await?;
    let status_line = response.lines().next().unwrap_or_default();
    if status_line.split_whitespace().nth(1) != Some("200") {
        return Err(AppError::Custom(format!(
            "http proxy CONNECT failed: {status_line}"
        )));
    }

    Ok(stream)
}

async fn read_http_proxy_connect_response(stream: &mut TcpStream) -> Result<String, AppError> {
    let mut response = Vec::new();
    let mut buffer = [0u8; 512];
    loop {
        let read = stream
            .read(&mut buffer)
            .await
            .map_err(|error| AppError::Custom(format!("http proxy read: {error}")))?;
        if read == 0 {
            return Err(AppError::Custom(
                "http proxy closed before CONNECT response".into(),
            ));
        }
        response.extend_from_slice(&buffer[..read]);
        if response.windows(4).any(|window| window == b"\r\n\r\n") {
            return Ok(String::from_utf8_lossy(&response).into_owned());
        }
        if response.len() > MAX_PROXY_CONNECT_RESPONSE {
            return Err(AppError::Custom(
                "http proxy CONNECT response is too large".into(),
            ));
        }
    }
}

fn host_for_authority(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

fn build_http_proxy_connect_request(target_host: &str, target_port: u16) -> Vec<u8> {
    let authority = format!("{}:{target_port}", host_for_authority(target_host));
    format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n").into_bytes()
}

async fn connect_socks5_proxy(
    proxy_url: &Url,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, AppError> {
    let mut stream = open_proxy_tcp_stream(proxy_url).await?;
    stream
        .write_all(&[0x05, 0x01, 0x00])
        .await
        .map_err(|error| AppError::Custom(format!("socks5 greeting write: {error}")))?;
    let mut auth_response = [0u8; 2];
    stream
        .read_exact(&mut auth_response)
        .await
        .map_err(|error| AppError::Custom(format!("socks5 greeting read: {error}")))?;
    if auth_response != [0x05, 0x00] {
        return Err(AppError::Custom(format!(
            "socks5 proxy rejected no-auth method: {auth_response:?}"
        )));
    }

    let request = build_socks5_connect_request(target_host, target_port)?;
    stream
        .write_all(&request)
        .await
        .map_err(|error| AppError::Custom(format!("socks5 connect write: {error}")))?;
    read_socks5_connect_response(&mut stream).await?;
    Ok(stream)
}

fn build_socks5_connect_request(target_host: &str, target_port: u16) -> Result<Vec<u8>, AppError> {
    let host = target_host.as_bytes();
    if host.len() > u8::MAX as usize {
        return Err(AppError::Custom("socks5 target host is too long".into()));
    }

    let mut request = Vec::with_capacity(7 + host.len());
    request.extend_from_slice(&[0x05, 0x01, 0x00, 0x03, host.len() as u8]);
    request.extend_from_slice(host);
    request.extend_from_slice(&target_port.to_be_bytes());
    Ok(request)
}

async fn read_socks5_connect_response(stream: &mut TcpStream) -> Result<(), AppError> {
    let mut header = [0u8; 4];
    stream
        .read_exact(&mut header)
        .await
        .map_err(|error| AppError::Custom(format!("socks5 connect read: {error}")))?;
    if header[0] != 0x05 {
        return Err(AppError::Custom(format!(
            "invalid socks5 response version: {}",
            header[0]
        )));
    }
    if header[1] != 0x00 {
        return Err(AppError::Custom(format!(
            "socks5 CONNECT failed with status: {}",
            header[1]
        )));
    }

    match header[3] {
        0x01 => read_discard(stream, 4).await?,
        0x03 => {
            let mut len = [0u8; 1];
            stream
                .read_exact(&mut len)
                .await
                .map_err(|error| AppError::Custom(format!("socks5 domain read: {error}")))?;
            read_discard(stream, len[0] as usize).await?;
        }
        0x04 => read_discard(stream, 16).await?,
        value => {
            return Err(AppError::Custom(format!(
                "unsupported socks5 address type: {value}"
            )));
        }
    }
    read_discard(stream, 2).await
}

async fn read_discard(stream: &mut TcpStream, len: usize) -> Result<(), AppError> {
    let mut buffer = vec![0u8; len];
    stream
        .read_exact(&mut buffer)
        .await
        .map_err(|error| AppError::Custom(format!("proxy response read: {error}")))?;
    Ok(())
}

fn is_cancelled(cancel_rx: &watch::Receiver<u64>, generation: u64) -> bool {
    *cancel_rx.borrow() != generation
}

fn emit_status(
    event_bus: &BackendEventBus,
    status: &str,
    websocket_domain: &str,
    reason: Option<String>,
    status_code: Option<i32>,
) {
    event_bus.emit_realtime_ws_status(RealtimeWsStatusPayload {
        status: status.to_string(),
        websocket_domain: websocket_domain.to_string(),
        at: Utc::now().to_rfc3339(),
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
    use super::{
        auth_token_from_response, build_auth_url, build_browser_websocket_request,
        build_http_proxy_connect_request, build_socks5_connect_request, build_transport_url,
        encode_uri_component, extract_auth_token, normalize_websocket_domain, timeout_error,
        wait_for_result_or_cancel, RealtimeConnectionError,
    };

    #[test]
    fn builds_default_transport_url() {
        assert_eq!(
            build_transport_url("", "token value"),
            "wss://pipeline.vrchat.cloud/?auth=token%20value"
        );
    }

    #[test]
    fn encodes_token_like_javascript_encode_uri_component() {
        assert_eq!(
            encode_uri_component("authcookie_a-b.c_d~e!*'()"),
            "authcookie_a-b.c_d~e!*'()"
        );
        assert_eq!(encode_uri_component("a b&c=d"), "a%20b%26c%3Dd");
    }

    #[test]
    fn trims_custom_websocket_domain() {
        assert_eq!(
            normalize_websocket_domain("wss://example.test///"),
            "wss://example.test"
        );
    }

    #[test]
    fn builds_auth_url_from_default_or_custom_endpoint() {
        assert_eq!(build_auth_url(""), "https://api.vrchat.cloud/api/1/auth");
        assert_eq!(
            build_auth_url("https://api.example.test/api/1/"),
            "https://api.example.test/api/1/auth"
        );
    }

    #[test]
    fn browser_websocket_request_includes_browser_headers() {
        let request =
            build_browser_websocket_request("wss://pipeline.vrchat.cloud/?auth=abc").unwrap();

        assert!(request.headers()["User-Agent"]
            .to_str()
            .unwrap()
            .contains("Mozilla/5.0"));
        assert_eq!(request.headers()["Origin"], "http://localhost:9000");
    }

    #[test]
    fn extracts_valid_auth_token() {
        assert_eq!(
            extract_auth_token(r#"{"ok":true,"token":"abc"}"#).unwrap(),
            "abc"
        );
        assert!(extract_auth_token(r#"{"ok":false,"token":"abc"}"#).is_err());
        assert!(extract_auth_token(r#"{"ok":true}"#).is_err());
    }

    #[test]
    fn classifies_unauthorized_auth_response() {
        match auth_token_from_response(401, r#"{"error":{"message":"Missing Credentials"}}"#) {
            Err(RealtimeConnectionError::AuthFailure {
                status_code,
                reason,
            }) => {
                assert_eq!(status_code, Some(401));
                assert!(reason.contains("Missing Credentials"));
            }
            other => panic!("expected auth failure, got {other:?}"),
        }
    }

    #[test]
    fn classifies_missing_auth_token_as_transport_error() {
        match auth_token_from_response(200, r#"{"ok":true}"#) {
            Err(RealtimeConnectionError::Other(error)) => {
                let reason = error.to_string();
                assert!(reason.contains("websocket token"));
            }
            other => panic!("expected non-auth transport error, got {other:?}"),
        }
    }

    #[test]
    fn builds_http_proxy_connect_request() {
        assert_eq!(
            build_http_proxy_connect_request("pipeline.vrchat.cloud", 443),
            b"CONNECT pipeline.vrchat.cloud:443 HTTP/1.1\r\nHost: pipeline.vrchat.cloud:443\r\n\r\n"
        );
    }

    #[test]
    fn builds_socks5_connect_request_with_remote_dns() {
        assert_eq!(
            build_socks5_connect_request("pipeline.vrchat.cloud", 443).unwrap(),
            [
                vec![0x05, 0x01, 0x00, 0x03, 21],
                b"pipeline.vrchat.cloud".to_vec(),
                vec![0x01, 0xbb],
            ]
            .concat()
        );
    }

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
