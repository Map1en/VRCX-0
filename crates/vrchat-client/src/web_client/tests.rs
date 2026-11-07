use super::*;

async fn serve_socks5_response() -> (String, tokio::task::JoinHandle<String>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let proxy_url = format!("socks5://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut greeting = [0_u8; 3];
        stream.read_exact(&mut greeting).await.unwrap();
        assert_eq!(greeting, [5, 1, 0]);
        stream.write_all(&[5, 0]).await.unwrap();

        let mut request = [0_u8; 4];
        stream.read_exact(&mut request).await.unwrap();
        assert_eq!(request, [5, 1, 0, 3]);
        let domain_length = stream.read_u8().await.unwrap() as usize;
        let mut domain = vec![0_u8; domain_length];
        stream.read_exact(&mut domain).await.unwrap();
        let mut port = [0_u8; 2];
        stream.read_exact(&mut port).await.unwrap();
        assert_eq!(u16::from_be_bytes(port), 80);
        stream
            .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 0])
            .await
            .unwrap();

        let mut request = Vec::new();
        let mut chunk = [0_u8; 1024];
        loop {
            let read = stream.read(&mut chunk).await.unwrap();
            request.extend_from_slice(&chunk[..read]);
            if read == 0 || request.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
            )
            .await
            .unwrap();
        String::from_utf8(domain).unwrap()
    });
    (proxy_url, server)
}

async fn serve_response(content_type: &str, body: &[u8]) -> (String, tokio::task::JoinHandle<()>) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let content_type = content_type.to_string();
    let body = body.to_vec();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut stream = BufReader::new(stream);
        loop {
            let mut line = String::new();
            stream.read_line(&mut line).await.unwrap();
            if line == "\r\n" {
                break;
            }
        }
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream
            .get_mut()
            .write_all(headers.as_bytes())
            .await
            .unwrap();
        stream.get_mut().write_all(&body).await.unwrap();
    });
    (format!("http://{address}/image"), server)
}

fn legacy_cookie_payload(value: serde_json::Value) -> String {
    B64.encode(serde_json::to_vec(&value).unwrap())
}

#[tokio::test]
async fn socks5_proxy_resolves_default_web_destination_remotely() -> Result<()> {
    let (proxy_url, server) = serve_socks5_response().await;
    let web = WebClient::new(Some(proxy_url), None, env!("CARGO_PKG_VERSION"))?;

    let result = web
        .execute(WebExecuteRequest::new(
            "http://api.test.invalid/status".into(),
            "GET".into(),
        ))
        .await?;

    assert_eq!(result, (200, "ok".into()));
    assert_eq!(server.await.unwrap(), "api.test.invalid");
    Ok(())
}

#[test]
fn validates_legacy_vrchat_cookie_payload() -> Result<()> {
    let payload = legacy_cookie_payload(serde_json::json!([{
        "Name": "auth",
        "Value": "token",
        "Domain": ".vrchat.com",
        "Path": "/"
    }]));

    validate_vrchat_cookies_b64(&payload)
}

#[test]
fn rejects_malformed_legacy_cookie_without_panicking() -> Result<()> {
    let payload = legacy_cookie_payload(serde_json::json!([{
        "Name": "auth",
        "Value": "token; Domain=example.com",
        "Domain": ".vrchat.com",
        "Path": "/"
    }]));
    let web = WebClient::new(None, None, env!("CARGO_PKG_VERSION"))?;

    assert!(validate_vrchat_cookies_b64(&payload).is_err());
    assert!(web.set_cookies(&payload).is_err());
    Ok(())
}

#[test]
fn rejects_non_vrchat_legacy_cookie_domain() {
    let payload = legacy_cookie_payload(serde_json::json!([{
        "Name": "auth",
        "Value": "token",
        "Domain": "example.com",
        "Path": "/"
    }]));

    assert!(validate_vrchat_cookies_b64(&payload).is_err());
}

#[test]
fn rejects_cookie_store_without_domains() {
    let store = CookieStore::default();
    assert!(validate_cookie_store_domains(&store).is_err());
}

#[test]
fn accepts_cookie_store_with_vrchat_domain() {
    let mut store = CookieStore::default();
    let url = reqwest::Url::parse("https://vrchat.com/").unwrap();
    let cookie = RawCookie::parse("auth=token; Domain=vrchat.com; Path=/").unwrap();
    store.insert_raw(&cookie, &url).unwrap();
    assert!(validate_cookie_store_domains(&store).is_ok());
}

#[test]
fn builds_user_agent_with_version() {
    assert_eq!(build_vrcx_user_agent("2.9.2"), "VRCX-0/2.9.2");
    assert_eq!(build_vrcx_user_agent("  2.9.2  "), "VRCX-0/2.9.2");
}

#[test]
fn builds_user_agent_without_version_when_empty() {
    assert_eq!(build_vrcx_user_agent(""), "VRCX-0");
    assert_eq!(build_vrcx_user_agent("   "), "VRCX-0");
}

async fn capture_request_head() -> (std::net::SocketAddr, tokio::task::JoinHandle<String>) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut stream = BufReader::new(stream);
        let mut request = String::new();
        loop {
            let mut line = String::new();
            stream.read_line(&mut line).await.unwrap();
            request.push_str(&line);
            if line == "\r\n" {
                break;
            }
        }
        stream
            .get_mut()
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
            .await
            .unwrap();
        request
    });
    (address, server)
}

#[tokio::test]
async fn transport_sends_owned_user_agent_and_ignores_request_override() -> Result<()> {
    let (address, server) = capture_request_head().await;
    let web = WebClient::new(None, None, "2.9.2")?;
    let mut request = WebExecuteRequest::new(format!("http://{address}/config"), "GET".into());
    request
        .headers
        .push(("User-Agent".into(), "caller-override".into()));

    let response = web.execute(request).await?;
    let captured = server.await.unwrap();

    assert_eq!(response, (200, "ok".into()));
    assert!(captured
        .lines()
        .any(|line| line.eq_ignore_ascii_case("user-agent: VRCX-0/2.9.2")));
    assert!(!captured.contains("caller-override"));
    Ok(())
}

#[tokio::test]
async fn external_transport_sends_app_name_without_version() -> Result<()> {
    for follow_redirects in [true, false] {
        let (address, server) = capture_request_head().await;
        let web = WebClient::new(None, None, "2.9.2")?;
        let mut request = WebExecuteRequest::new(format!("http://{address}/search"), "GET".into());
        request
            .headers
            .push(("User-Agent".into(), "caller-override".into()));

        let response = web.execute_external(request, follow_redirects).await?;
        let captured = server.await.unwrap();

        assert_eq!(response, (200, "ok".into()));
        assert!(captured
            .lines()
            .any(|line| line.eq_ignore_ascii_case("user-agent: VRCX-0")));
        assert!(!captured.contains("2.9.2"));
        assert!(!captured.contains("caller-override"));
    }
    Ok(())
}

#[tokio::test]
async fn no_redirect_transport_does_not_follow_a_loopback_location() -> Result<()> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;

    let target_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target_address = target_listener.local_addr().unwrap();
    let target_hit = Arc::new(AtomicBool::new(false));
    let target_hit_for_server = Arc::clone(&target_hit);
    let target_server = tokio::spawn(async move {
        if let Ok(Ok((_stream, _))) =
            tokio::time::timeout(Duration::from_millis(200), target_listener.accept()).await
        {
            target_hit_for_server.store(true, Ordering::Release);
        }
    });

    let redirect_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let redirect_address = redirect_listener.local_addr().unwrap();
    let redirect_server = tokio::spawn(async move {
        let (stream, _) = redirect_listener.accept().await.unwrap();
        let mut stream = BufReader::new(stream);
        loop {
            let mut line = String::new();
            stream.read_line(&mut line).await.unwrap();
            if line == "\r\n" {
                break;
            }
        }
        let response = format!(
            "HTTP/1.1 302 Found\r\nLocation: http://{target_address}/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        stream
            .get_mut()
            .write_all(response.as_bytes())
            .await
            .unwrap();
    });

    let web = WebClient::new(None, None, env!("CARGO_PKG_VERSION"))?;
    let request = WebExecuteRequest::new(format!("http://{redirect_address}/theme"), "GET".into());
    let (status, _) = web.execute_external(request, false).await?;

    redirect_server.await.unwrap();
    target_server.await.unwrap();
    assert_eq!(status, 302);
    assert!(!target_hit.load(Ordering::Acquire));
    Ok(())
}

#[tokio::test]
async fn transport_preserves_declared_image_mime() -> Result<()> {
    let bytes = [0xFF, 0xD8, 0xFF, 0xD9];
    let (url, server) = serve_response("image/jpeg", &bytes).await;
    let web = WebClient::new(None, None, env!("CARGO_PKG_VERSION"))?;

    let response = web
        .execute(WebExecuteRequest::new(url, "GET".into()))
        .await?;
    server.await.unwrap();

    assert_eq!(response.0, 200);
    assert_eq!(
        response.1,
        format!("data:image/jpeg;base64,{}", B64.encode(bytes))
    );
    Ok(())
}

#[tokio::test]
async fn transport_rejects_responses_above_the_request_limit() -> Result<()> {
    let (url, server) = serve_response("text/plain", b"response-too-large").await;
    let web = WebClient::new(None, None, env!("CARGO_PKG_VERSION"))?;
    let mut request = WebExecuteRequest::new(url, "GET".into());
    request.response_body_limit = Some(8);

    let response = web.execute(request).await?;
    server.await.unwrap();

    assert_eq!(response.0, -1);
    assert!(response.1.contains("8 byte limit"));
    Ok(())
}

#[tokio::test]
async fn octet_stream_only_becomes_image_data_url_when_magic_matches() -> Result<()> {
    let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    let (image_url, image_server) = serve_response("application/octet-stream", &png).await;
    let web = WebClient::new(None, None, env!("CARGO_PKG_VERSION"))?;

    let image_response = web
        .execute(WebExecuteRequest::new(image_url, "GET".into()))
        .await?;
    image_server.await.unwrap();
    assert_eq!(
        image_response.1,
        format!("data:image/png;base64,{}", B64.encode(png))
    );

    let (text_url, text_server) = serve_response("application/octet-stream", b"not an image").await;
    let text_response = web
        .execute(WebExecuteRequest::new(text_url, "GET".into()))
        .await?;
    text_server.await.unwrap();
    assert_eq!(text_response, (200, "not an image".into()));
    Ok(())
}

#[test]
fn file_put_decodes_body_and_ignores_reserved_header_overrides() -> Result<()> {
    let web = WebClient::new(None, None, env!("CARGO_PKG_VERSION"))?;
    let mut request = WebExecuteRequest::new(
        "https://api.vrchat.cloud/api/1/file/file_1/1/file".into(),
        "PUT".into(),
    );
    request
        .headers
        .push(("cOnTeNt-TyPe".into(), "text/plain".into()));
    request
        .headers
        .push(("uSeR-aGeNt".into(), "caller-override".into()));
    let payload = b"payload";

    let built =
        web.build_file_put_request(&request, payload.to_vec(), "application/octet-stream", None)?;

    assert_eq!(
        built
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("application/octet-stream")
    );
    assert_ne!(
        built
            .headers()
            .get(reqwest::header::USER_AGENT)
            .and_then(|value| value.to_str().ok()),
        Some("caller-override")
    );
    assert_eq!(
        built.body().and_then(|body| body.as_bytes()),
        Some(&payload[..])
    );
    Ok(())
}

#[test]
fn rejects_invalid_file_md5_before_building_upload_request() -> Result<()> {
    let web = WebClient::new(None, None, env!("CARGO_PKG_VERSION"))?;
    let request = WebExecuteRequest::new(
        "https://api.vrchat.cloud/api/1/file/file_1/1/file".into(),
        "PUT".into(),
    );

    let error = web
        .build_file_put_request(
            &request,
            b"payload".to_vec(),
            "application/octet-stream",
            Some("not-base64!"),
        )
        .expect_err("invalid file MD5 should be rejected");

    assert!(error.to_string().contains("bad file MD5 base64"));
    Ok(())
}

#[tokio::test]
async fn fresh_standard_request_sends_runtime_cookie_jar() -> Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut stream = BufReader::new(stream);
        let mut request = String::new();
        loop {
            let mut line = String::new();
            stream.read_line(&mut line).await.unwrap();
            request.push_str(&line);
            if line == "\r\n" {
                break;
            }
        }
        stream
            .get_mut()
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
            .await
            .unwrap();
        request
    });

    let web = WebClient::new(None, None, env!("CARGO_PKG_VERSION"))?;
    let url = reqwest::Url::parse(&format!("http://{address}/")).unwrap();
    web.jar.update(|store| {
        store
            .insert_raw(&RawCookie::parse("auth=token").unwrap(), &url)
            .unwrap();
    });

    let response = web
        .execute_fresh_standard(WebExecuteRequest::new(
            format!("http://{address}/auth/user"),
            "GET".into(),
        ))
        .await?;
    let captured = server.await.unwrap();

    assert_eq!(response, (200, "ok".into()));
    assert!(captured
        .lines()
        .any(|line| line.eq_ignore_ascii_case("cookie: auth=token")));
    Ok(())
}

#[test]
fn clear_auth_cookies_drops_auth_keeps_two_factor() -> Result<()> {
    let payload = legacy_cookie_payload(serde_json::json!([
        {"Name": "auth", "Value": "a", "Domain": ".vrchat.cloud", "Path": "/"},
        {"Name": "auth", "Value": "b", "Domain": "api.vrchat.cloud", "Path": "/"},
        {"Name": "twoFactorAuth", "Value": "t", "Domain": ".vrchat.cloud", "Path": "/"}
    ]));
    let web = WebClient::new(None, Some(&payload), env!("CARGO_PKG_VERSION"))?;

    web.clear_auth_cookies();

    let store = deserialize_cookie_store(&web.get_cookies())
        .ok_or_else(|| Error::Custom("cookie store did not round-trip".into()))?;
    let names: Vec<&str> = store.iter_any().map(|cookie| cookie.name()).collect();
    assert!(!names.contains(&"auth"));
    assert!(names.contains(&"twoFactorAuth"));
    Ok(())
}
