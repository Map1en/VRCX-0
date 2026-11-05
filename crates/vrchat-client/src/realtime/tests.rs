use super::{
    auth_token_from_response, build_browser_websocket_request, build_transport_url,
    connect_direct_tcp, connect_http_proxy, connect_socks5_proxy, encode_uri_component,
    extract_auth_token, websocket_connect_error, Error,
};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::handshake::client::Response;
use tokio_tungstenite::tungstenite::Error as TungstenError;
use url::Url;
use vrcx_0_core::vrchat_endpoints::normalize_vrchat_websocket_endpoint;

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
        normalize_vrchat_websocket_endpoint("wss://example.test///"),
        "wss://example.test"
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

    match websocket_connect_error("websocket connect", TungstenError::Http(Box::new(response))) {
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
    let proxy_url = Url::parse(&format!("socks5://{}", listener.local_addr().unwrap())).unwrap();

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
