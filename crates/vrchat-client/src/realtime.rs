use std::time::Duration;

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
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;

const DEFAULT_WEBSOCKET_DOMAIN: &str = "wss://pipeline.vrchat.cloud";
const VRCHAT_WEBSOCKET_HOST: &str = "pipeline.vrchat.cloud";
const BROWSER_WEBSOCKET_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const TCP_KEEPALIVE_IDLE: Duration = Duration::from_secs(30);
const TCP_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);
const TCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

pub type RealtimeWebSocketStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RealtimeConnectionOptions {
    pub origin: String,
    pub proxy_url: Option<String>,
}

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

pub fn normalize_websocket_domain(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        DEFAULT_WEBSOCKET_DOMAIN.to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn validated_websocket_domain(value: &str) -> Result<String, Error> {
    let domain = normalize_websocket_domain(value);
    let url = Url::parse(&domain)
        .map_err(|error| Error::Other(format!("bad websocket domain: {error}")))?;
    if url.scheme() != "wss" || url.host_str() != Some(VRCHAT_WEBSOCKET_HOST) {
        return Err(Error::Other(
            "VRChat realtime websocket must be wss://pipeline.vrchat.cloud.".into(),
        ));
    }
    Ok(domain)
}

fn normalize_endpoint(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        VRCHAT_API_DEFAULT_ENDPOINT.to_string()
    } else {
        trimmed.to_string()
    }
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

pub fn build_auth_url(endpoint: &str) -> String {
    format!("{}/auth", normalize_endpoint(endpoint))
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
mod tests {
    use super::{
        auth_token_from_response, build_auth_url, build_browser_websocket_request,
        build_transport_url, connect_direct_tcp, connect_http_proxy, connect_socks5_proxy,
        encode_uri_component, extract_auth_token, normalize_websocket_domain,
        websocket_connect_error, Error,
    };
    use std::time::Duration;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::handshake::client::Response;
    use tokio_tungstenite::tungstenite::Error as TungstenError;
    use url::Url;

    #[test]
    fn builds_default_transport_url() {
        assert_eq!(
            build_transport_url("", "token value").unwrap(),
            "wss://pipeline.vrchat.cloud/?auth=token%20value"
        );
    }

    #[test]
    fn rejects_non_vrchat_transport_domain() {
        assert!(build_transport_url("wss://example.test", "token").is_err());
        assert!(build_transport_url("ws://pipeline.vrchat.cloud", "token").is_err());
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
        let request = build_browser_websocket_request(
            "wss://pipeline.vrchat.cloud/?auth=abc",
            "https://app.example",
        )
        .unwrap();

        assert!(request.headers()["User-Agent"]
            .to_str()
            .unwrap()
            .contains("Mozilla/5.0"));
        assert_eq!(request.headers()["Origin"], "https://app.example");
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
    fn classifies_auth_token_bootstrap_statuses() {
        enum Expected {
            Success,
            AuthFailure,
            TransportFailure,
        }

        let cases = [
            (200, Expected::Success),
            (302, Expected::TransportFailure),
            (401, Expected::AuthFailure),
            (403, Expected::AuthFailure),
            (429, Expected::TransportFailure),
            (500, Expected::TransportFailure),
        ];

        for (status, expected) in cases {
            let result = auth_token_from_response(status, r#"{"ok":true,"token":"abc"}"#);
            match (expected, result) {
                (Expected::Success, Ok(token)) => assert_eq!(token, "abc"),
                (
                    Expected::AuthFailure,
                    Err(Error::AuthFailure {
                        status_code,
                        reason,
                    }),
                ) => {
                    assert_eq!(status_code, Some(status));
                    assert!(reason.contains(&status.to_string()));
                }
                (Expected::TransportFailure, Err(Error::Other(reason))) => {
                    assert!(reason.contains(&status.to_string()));
                }
                (_, other) => panic!("unexpected classification for {status}: {other:?}"),
            }
        }
    }

    #[test]
    fn classifies_missing_auth_token_as_transport_error() {
        match auth_token_from_response(200, r#"{"ok":true}"#) {
            Err(Error::Other(reason)) => {
                assert!(reason.contains("websocket token"));
            }
            other => panic!("expected non-auth transport error, got {other:?}"),
        }
    }

    #[test]
    fn classifies_unauthorized_websocket_handshake_as_auth_failure() {
        let mut response = Response::new(None);
        *response.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::FORBIDDEN;

        match websocket_connect_error("websocket connect", TungstenError::Http(Box::new(response)))
        {
            Error::AuthFailure {
                status_code,
                reason,
            } => {
                assert_eq!(status_code, Some(403));
                assert!(reason.contains("websocket connect"));
            }
            other => panic!("expected auth failure, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn direct_connector_accepts_https_target() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let accept = tokio::spawn(async move { listener.accept().await.unwrap() });

        let stream = connect_direct_tcp(&address.ip().to_string(), address.port())
            .await
            .unwrap();

        assert_eq!(stream.peer_addr().unwrap(), address);
        accept.await.unwrap();
    }

    #[tokio::test]
    async fn http_proxy_connector_establishes_tunnel() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy_url = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();

        let result = tokio::time::timeout(Duration::from_secs(2), async {
            let client = connect_http_proxy(&proxy_url, "pipeline.vrchat.cloud", 443);
            let server = async {
                let (stream, _) = listener.accept().await.unwrap();
                let mut stream = BufReader::new(stream);
                let mut line = String::new();
                stream.read_line(&mut line).await.unwrap();
                assert_eq!(line, "CONNECT pipeline.vrchat.cloud:443 HTTP/1.1\r\n");
                while line != "\r\n" {
                    line.clear();
                    stream.read_line(&mut line).await.unwrap();
                }
                stream
                    .get_mut()
                    .write_all(b"HTTP/1.1 200 OK\r\n\r\n")
                    .await
                    .unwrap();
            };
            tokio::join!(client, server).0
        })
        .await
        .expect("HTTP proxy connector timed out");

        result.unwrap();
    }

    #[tokio::test]
    async fn socks5_proxy_connector_keeps_target_dns_remote() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy_url =
            Url::parse(&format!("socks5://{}", listener.local_addr().unwrap())).unwrap();

        let result = tokio::time::timeout(Duration::from_secs(2), async {
            let client = connect_socks5_proxy(&proxy_url, "pipeline.vrchat.cloud", 443);
            let server = async {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut greeting = [0u8; 3];
                stream.read_exact(&mut greeting).await.unwrap();
                assert_eq!(greeting, [0x05, 0x01, 0x00]);
                stream.write_all(&[0x05, 0x00]).await.unwrap();

                let mut header = [0u8; 5];
                stream.read_exact(&mut header).await.unwrap();
                assert_eq!(header, [0x05, 0x01, 0x00, 0x03, 21]);
                let mut destination = [0u8; 23];
                stream.read_exact(&mut destination).await.unwrap();
                assert_eq!(&destination[..21], b"pipeline.vrchat.cloud");
                assert_eq!(&destination[21..], &443u16.to_be_bytes());
                stream
                    .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                    .await
                    .unwrap();
            };
            tokio::join!(client, server).0
        })
        .await
        .expect("SOCKS5 proxy connector timed out");

        result.unwrap();
    }
}
