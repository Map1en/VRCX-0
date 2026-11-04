use std::time::Duration;

use futures_util::SinkExt;
use hyper_util::client::legacy::connect::proxy::{SocksV5, Tunnel};
use hyper_util::client::legacy::connect::HttpConnector;
use serde_json::Value;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Request;
use tokio_tungstenite::tungstenite::http::Uri;
use tokio_tungstenite::tungstenite::Error as TungsteniteError;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{client_async_tls, MaybeTlsStream, WebSocketStream};
use tower_service::Service;
use url::Url;

const VRCHAT_WEBSOCKET_HOST: &str = "pipeline.vrchat.cloud";
const BROWSER_WEBSOCKET_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const TCP_KEEPALIVE_IDLE: Duration = Duration::from_secs(30);
const TCP_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);
const TCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const HEARTBEAT_DEADLINE: Duration = Duration::from_secs(90);
const HEARTBEAT_PING_TIMEOUT: Duration = Duration::from_secs(10);

pub use vrcx_0_contracts::RealtimeConnectionOptions;
pub type RealtimeWebSocketStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RealtimeFrame {
    Text(String),
    Close(String),
    Other,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{reason}")]
    AuthFailure {
        reason: String,
        status_code: Option<i32>,
    },
    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn reason(&self) -> String {
        match self {
            Self::AuthFailure { reason, .. } => reason.clone(),
            Self::Other(reason) => reason.clone(),
        }
    }

    pub fn status_code(&self) -> Option<i32> {
        match self {
            Self::AuthFailure { status_code, .. } => *status_code,
            Self::Other(_) => None,
        }
    }

    pub fn is_auth_failure(&self) -> bool {
        matches!(self, Self::AuthFailure { .. })
    }
}

use vrcx_0_core::vrchat_endpoints::normalize_vrchat_websocket_endpoint;

pub fn validated_websocket_domain(value: &str) -> Result<String, Error> {
    let domain = normalize_vrchat_websocket_endpoint(value);
    let url = Url::parse(&domain)
        .map_err(|error| Error::Other(format!("bad websocket domain: {error}")))?;
    if url.scheme() != "wss" || url.host_str() != Some(VRCHAT_WEBSOCKET_HOST) {
        return Err(Error::Other(
            "VRChat realtime websocket must be wss://pipeline.vrchat.cloud.".into(),
        ));
    }
    Ok(domain)
}

pub fn build_transport_url(websocket: &str, token: &str) -> Result<String, Error> {
    Ok(format!(
        "{}/?auth={}",
        validated_websocket_domain(websocket)?,
        encode_uri_component(token)
    ))
}

pub fn encode_uri_component(value: &str) -> String {
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

pub fn extract_auth_token(body: &str) -> Result<String, Error> {
    let json: Value = serde_json::from_str(body)
        .map_err(|error| Error::Other(format!("auth response json: {error}")))?;
    let ok = json.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let token = json
        .get("token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if ok && !token.is_empty() {
        return Ok(token.to_string());
    }
    Err(Error::Other(
        "The auth transport bootstrap did not return a websocket token.".into(),
    ))
}

pub fn auth_token_from_response(status: i32, body: &str) -> Result<String, Error> {
    if matches!(status, 401 | 403) {
        return Err(Error::AuthFailure {
            reason: format!("auth transport bootstrap failed ({status}): {body}"),
            status_code: Some(status),
        });
    }

    if status != 200 {
        return Err(Error::Other(format!(
            "auth transport bootstrap failed ({status})"
        )));
    }

    extract_auth_token(body)
}

pub async fn connect_websocket(
    url: &str,
    options: &RealtimeConnectionOptions,
) -> Result<RealtimeWebSocketStream, Error> {
    let request = build_browser_websocket_request(url, &options.origin)?;
    let websocket_url = parse_url(url, "websocket URL")?;
    let (target_host, target_port) = websocket_target(&websocket_url)?;
    let stream =
        resolve_tcp_stream(&target_host, target_port, options.proxy_url.as_deref()).await?;

    client_async_tls(request, stream)
        .await
        .map(|(stream, _)| stream)
        .map_err(|error| websocket_connect_error("websocket connect", error))
}

async fn resolve_tcp_stream(
    target_host: &str,
    target_port: u16,
    proxy_url: Option<&str>,
) -> Result<TcpStream, Error> {
    let Some(proxy_url) = proxy_url else {
        return connect_direct_tcp(target_host, target_port).await;
    };

    let proxy_url = parse_url(proxy_url, "proxy URL")?;
    match proxy_url.scheme() {
        "http" => connect_http_proxy(&proxy_url, target_host, target_port).await,
        "socks5" => connect_socks5_proxy(&proxy_url, target_host, target_port).await,
        scheme => Err(Error::Other(format!(
            "Unsupported realtime proxy scheme: {scheme}"
        ))),
    }
}

fn websocket_connect_error(context: &str, error: TungsteniteError) -> Error {
    if let TungsteniteError::Http(response) = &error {
        let status_code = response.status().as_u16() as i32;
        if matches!(status_code, 401 | 403) {
            return Error::AuthFailure {
                reason: format!("{context} failed ({status_code})"),
                status_code: Some(status_code),
            };
        }
    }
    Error::Other(format!("{context}: {error}"))
}

pub fn build_browser_websocket_request(url: &str, origin: &str) -> Result<Request, Error> {
    let mut request = url
        .into_client_request()
        .map_err(|error| Error::Other(format!("websocket request: {error}")))?;
    request
        .headers_mut()
        .insert("User-Agent", BROWSER_WEBSOCKET_USER_AGENT.parse().unwrap());
    request
        .headers_mut()
        .insert("Origin", origin.parse().unwrap());
    Ok(request)
}

pub fn classify_websocket_frame(frame: Message) -> RealtimeFrame {
    match frame {
        Message::Text(text) => RealtimeFrame::Text(text.to_string()),
        Message::Close(close) => RealtimeFrame::Close(format!("{close:?}")),
        Message::Binary(_) | Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {
            RealtimeFrame::Other
        }
    }
}

pub async fn heartbeat(
    stream: &mut RealtimeWebSocketStream,
    last_inbound_at: tokio::time::Instant,
) -> Result<(), String> {
    let silent = last_inbound_at.elapsed();
    if silent >= HEARTBEAT_DEADLINE {
        return Err(format!(
            "websocket heartbeat timed out after {} seconds",
            silent.as_secs()
        ));
    }
    match tokio::time::timeout(HEARTBEAT_PING_TIMEOUT, send_websocket_ping(stream)).await {
        Ok(result) => result.map_err(|error| error.reason()),
        Err(_) => Err(format!(
            "websocket ping timed out after {} seconds",
            HEARTBEAT_PING_TIMEOUT.as_secs()
        )),
    }
}

async fn send_websocket_ping(stream: &mut RealtimeWebSocketStream) -> Result<(), Error> {
    stream
        .send(Message::Ping(Default::default()))
        .await
        .map_err(|error| Error::Other(format!("websocket ping: {error}")))
}

fn parse_url(value: &str, label: &str) -> Result<Url, Error> {
    Url::parse(value).map_err(|error| Error::Other(format!("invalid {label}: {error}")))
}

fn websocket_target(url: &Url) -> Result<(String, u16), Error> {
    let host = url
        .host_str()
        .ok_or_else(|| Error::Other("websocket URL is missing a host".into()))?
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| Error::Other("websocket URL is missing a port".into()))?;
    Ok((host, port))
}

fn proxy_connector_uri(proxy_url: &Url) -> Result<Uri, Error> {
    let host = proxy_url
        .host_str()
        .ok_or_else(|| Error::Other("proxy URL is missing a host".into()))?;
    let port = proxy_url
        .port_or_known_default()
        .ok_or_else(|| Error::Other("proxy URL is missing a port".into()))?;
    endpoint_uri("http", host, port, "proxy URL")
}

fn tcp_connector() -> HttpConnector {
    let mut connector = HttpConnector::new();
    connector.set_keepalive(Some(TCP_KEEPALIVE_IDLE));
    connector.set_keepalive_interval(Some(TCP_KEEPALIVE_INTERVAL));
    connector.set_connect_timeout(Some(TCP_CONNECT_TIMEOUT));
    connector
}

async fn connect_direct_tcp(target_host: &str, target_port: u16) -> Result<TcpStream, Error> {
    let target = endpoint_uri("https", target_host, target_port, "websocket target")?;
    let mut connector = tcp_connector();
    connector.enforce_http(false);
    let stream = connector
        .call(target)
        .await
        .map_err(|error| Error::Other(format!("websocket tcp connect: {error}")))?
        .into_inner();
    Ok(stream)
}

async fn connect_http_proxy(
    proxy_url: &Url,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, Error> {
    let proxy = proxy_connector_uri(proxy_url)?;
    let target = endpoint_uri("https", target_host, target_port, "websocket proxy target")?;
    let stream = Tunnel::new(proxy, tcp_connector())
        .call(target)
        .await
        .map_err(|error| Error::Other(format!("http proxy CONNECT: {error}")))?
        .into_inner();
    Ok(stream)
}

fn host_for_authority(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

fn endpoint_uri(scheme: &str, host: &str, port: u16, label: &str) -> Result<Uri, Error> {
    format!("{scheme}://{}:{port}", host_for_authority(host))
        .parse()
        .map_err(|error| Error::Other(format!("invalid {label}: {error}")))
}

async fn connect_socks5_proxy(
    proxy_url: &Url,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, Error> {
    let proxy = proxy_connector_uri(proxy_url)?;
    let target = endpoint_uri("https", target_host, target_port, "websocket proxy target")?;
    let stream = SocksV5::new(proxy, tcp_connector())
        .local_dns(false)
        .call(target)
        .await
        .map_err(|error| Error::Other(format!("socks5 proxy CONNECT: {error}")))?
        .into_inner();
    Ok(stream)
}

#[cfg(test)]
mod tests;
