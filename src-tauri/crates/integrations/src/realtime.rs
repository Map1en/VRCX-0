use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Request;
use tokio_tungstenite::{client_async_tls, connect_async, MaybeTlsStream, WebSocketStream};
use url::Url;

const DEFAULT_ENDPOINT_DOMAIN: &str = "https://api.vrchat.cloud/api/1";
const DEFAULT_WEBSOCKET_DOMAIN: &str = "wss://pipeline.vrchat.cloud";
const BROWSER_WEBSOCKET_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const MAX_PROXY_CONNECT_RESPONSE: usize = 8192;

pub type RealtimeWebSocketStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

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
    let json: Value =
        serde_json::from_str(body).map_err(|error| Error::Other(format!("auth response json: {error}")))?;
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
    if status == 401 {
        return Err(Error::AuthFailure {
            reason: format!("auth transport bootstrap failed (401): {body}"),
            status_code: Some(status),
        });
    }

    if !(0..400).contains(&status) {
        return Err(Error::Other(format!(
            "auth transport bootstrap failed ({status})"
        )));
    }

    extract_auth_token(body)
}

pub async fn connect_websocket(
    url: &str,
    proxy_url: Option<&str>,
) -> Result<RealtimeWebSocketStream, Error> {
    let request = build_browser_websocket_request(url)?;
    let websocket_url = parse_url(url, "websocket URL")?;
    let (target_host, target_port) = websocket_target(&websocket_url)?;
    let Some(proxy_url) = proxy_url else {
        return connect_async(request)
            .await
            .map(|(stream, _)| stream)
            .map_err(|error| Error::Other(format!("websocket connect: {error}")));
    };

    let proxy_url = parse_url(proxy_url, "proxy URL")?;
    let stream = match proxy_url.scheme() {
        "http" => connect_http_proxy(&proxy_url, &target_host, target_port).await?,
        "socks5" => connect_socks5_proxy(&proxy_url, &target_host, target_port).await?,
        scheme => {
            return Err(Error::Other(format!(
                "Unsupported realtime proxy scheme: {scheme}"
            )));
        }
    };

    client_async_tls(request, stream)
        .await
        .map(|(stream, _)| stream)
        .map_err(|error| Error::Other(format!("websocket proxy connect: {error}")))
}

pub fn build_browser_websocket_request(url: &str) -> Result<Request, Error> {
    let mut request = url
        .into_client_request()
        .map_err(|error| Error::Other(format!("websocket request: {error}")))?;
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

fn proxy_target(proxy_url: &Url) -> Result<(String, u16), Error> {
    let host = proxy_url
        .host_str()
        .ok_or_else(|| Error::Other("proxy URL is missing a host".into()))?
        .to_string();
    let port = proxy_url
        .port_or_known_default()
        .ok_or_else(|| Error::Other("proxy URL is missing a port".into()))?;
    Ok((host, port))
}

async fn open_proxy_tcp_stream(proxy_url: &Url) -> Result<TcpStream, Error> {
    let (proxy_host, proxy_port) = proxy_target(proxy_url)?;
    TcpStream::connect((proxy_host.as_str(), proxy_port))
        .await
        .map_err(|error| Error::Other(format!("proxy tcp connect: {error}")))
}

async fn connect_http_proxy(
    proxy_url: &Url,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, Error> {
    let mut stream = open_proxy_tcp_stream(proxy_url).await?;
    let request = build_http_proxy_connect_request(target_host, target_port);
    stream
        .write_all(&request)
        .await
        .map_err(|error| Error::Other(format!("http proxy write: {error}")))?;

    let response = read_http_proxy_connect_response(&mut stream).await?;
    let status_line = response.lines().next().unwrap_or_default();
    if status_line.split_whitespace().nth(1) != Some("200") {
        return Err(Error::Other(format!(
            "http proxy CONNECT failed: {status_line}"
        )));
    }

    Ok(stream)
}

async fn read_http_proxy_connect_response(stream: &mut TcpStream) -> Result<String, Error> {
    let mut response = Vec::new();
    let mut buffer = [0u8; 512];
    loop {
        let read = stream
            .read(&mut buffer)
            .await
            .map_err(|error| Error::Other(format!("http proxy read: {error}")))?;
        if read == 0 {
            return Err(Error::Other(
                "http proxy closed before CONNECT response".into(),
            ));
        }
        response.extend_from_slice(&buffer[..read]);
        if response.windows(4).any(|window| window == b"\r\n\r\n") {
            return Ok(String::from_utf8_lossy(&response).into_owned());
        }
        if response.len() > MAX_PROXY_CONNECT_RESPONSE {
            return Err(Error::Other(
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

pub fn build_http_proxy_connect_request(target_host: &str, target_port: u16) -> Vec<u8> {
    let authority = format!("{}:{target_port}", host_for_authority(target_host));
    format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n").into_bytes()
}

async fn connect_socks5_proxy(
    proxy_url: &Url,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, Error> {
    let mut stream = open_proxy_tcp_stream(proxy_url).await?;
    stream
        .write_all(&[0x05, 0x01, 0x00])
        .await
        .map_err(|error| Error::Other(format!("socks5 greeting write: {error}")))?;
    let mut auth_response = [0u8; 2];
    stream
        .read_exact(&mut auth_response)
        .await
        .map_err(|error| Error::Other(format!("socks5 greeting read: {error}")))?;
    if auth_response != [0x05, 0x00] {
        return Err(Error::Other(format!(
            "socks5 proxy rejected no-auth method: {auth_response:?}"
        )));
    }

    let request = build_socks5_connect_request(target_host, target_port)?;
    stream
        .write_all(&request)
        .await
        .map_err(|error| Error::Other(format!("socks5 connect write: {error}")))?;
    read_socks5_connect_response(&mut stream).await?;
    Ok(stream)
}

pub fn build_socks5_connect_request(target_host: &str, target_port: u16) -> Result<Vec<u8>, Error> {
    let host = target_host.as_bytes();
    if host.len() > u8::MAX as usize {
        return Err(Error::Other("socks5 target host is too long".into()));
    }

    let mut request = Vec::with_capacity(7 + host.len());
    request.extend_from_slice(&[0x05, 0x01, 0x00, 0x03, host.len() as u8]);
    request.extend_from_slice(host);
    request.extend_from_slice(&target_port.to_be_bytes());
    Ok(request)
}

async fn read_socks5_connect_response(stream: &mut TcpStream) -> Result<(), Error> {
    let mut header = [0u8; 4];
    stream
        .read_exact(&mut header)
        .await
        .map_err(|error| Error::Other(format!("socks5 connect read: {error}")))?;
    if header[0] != 0x05 {
        return Err(Error::Other(format!(
            "invalid socks5 response version: {}",
            header[0]
        )));
    }
    if header[1] != 0x00 {
        return Err(Error::Other(format!(
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
                .map_err(|error| Error::Other(format!("socks5 domain read: {error}")))?;
            read_discard(stream, len[0] as usize).await?;
        }
        0x04 => read_discard(stream, 16).await?,
        value => {
            return Err(Error::Other(format!(
                "unsupported socks5 address type: {value}"
            )));
        }
    }
    read_discard(stream, 2).await
}

async fn read_discard(stream: &mut TcpStream, len: usize) -> Result<(), Error> {
    let mut buffer = vec![0u8; len];
    stream
        .read_exact(&mut buffer)
        .await
        .map_err(|error| Error::Other(format!("proxy response read: {error}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        auth_token_from_response, build_auth_url, build_browser_websocket_request,
        build_http_proxy_connect_request, build_socks5_connect_request, build_transport_url,
        encode_uri_component, extract_auth_token, normalize_websocket_domain, Error,
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
            Err(Error::AuthFailure {
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
            Err(Error::Other(reason)) => {
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
}
