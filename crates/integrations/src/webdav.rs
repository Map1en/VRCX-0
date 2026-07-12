use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use digest_auth::{AuthContext, HttpMethod, Qop, WwwAuthenticateHeader};
use futures_util::StreamExt;
use quick_xml::events::Event;
use quick_xml::Reader;
use reqwest::header::{
    HeaderName, HeaderValue, AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE, RANGE, WWW_AUTHENTICATE,
};
use reqwest::{Body, Client, Method, Proxy, Response, StatusCode, Url};
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READ_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_PROPFIND_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_PROPERTY_VALUE_BYTES: usize = 4096;

#[derive(Debug, thiserror::Error)]
pub enum WebDavError {
    #[error("cloud_backup.invalid_url: {0}")]
    InvalidUrl(String),
    #[error("cloud_backup.network: {0}")]
    Network(String),
    #[error("cloud_backup.auth_failed: WebDAV authentication failed.")]
    AuthenticationFailed,
    #[error("cloud_backup.unsupported_auth: {0}")]
    UnsupportedAuthentication(String),
    #[error("cloud_backup.remote_error: WebDAV returned HTTP {status}: {detail}")]
    Remote { status: u16, detail: String },
    #[error("cloud_backup.invalid_response: {0}")]
    InvalidResponse(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, WebDavError>;

fn network_error(error: &reqwest::Error) -> WebDavError {
    let detail = if error.is_timeout() {
        "The HTTPS request timed out."
    } else if error.is_connect() {
        "The HTTPS connection could not be established."
    } else if error.is_redirect() {
        "The HTTPS redirect was rejected."
    } else {
        "The HTTPS request failed."
    };
    WebDavError::Network(detail.into())
}

fn method_allows_authentication_retry(method: &Method) -> bool {
    method == Method::GET
        || method == Method::HEAD
        || method == Method::OPTIONS
        || method.as_str() == "PROPFIND"
}

fn move_headers(destination: &Url) -> Result<Vec<(HeaderName, HeaderValue)>> {
    let destination_value = HeaderValue::from_str(destination.as_str())
        .map_err(|error| WebDavError::InvalidUrl(error.to_string()))?;
    Ok(vec![
        (HeaderName::from_static("destination"), destination_value),
        (
            HeaderName::from_static("overwrite"),
            HeaderValue::from_static("T"),
        ),
    ])
}

#[derive(Clone, Debug, Default)]
pub struct RemoteFileInfo {
    pub exists: bool,
    pub content_length: Option<u64>,
    pub last_modified: Option<String>,
}

#[derive(Clone)]
enum RequestBody {
    Empty,
    Bytes(Vec<u8>),
    File(PathBuf),
}

enum AuthenticationState {
    Unknown,
    Basic,
    Digest(WwwAuthenticateHeader),
}

pub struct WebDavClient {
    client: Client,
    username: String,
    password: String,
    authentication: Mutex<AuthenticationState>,
}

impl WebDavClient {
    pub fn new(
        base_url: &Url,
        username: impl Into<String>,
        password: impl Into<String>,
        proxy_url: Option<&str>,
        user_agent: &str,
    ) -> Result<Self> {
        if base_url.scheme() != "https" {
            return Err(WebDavError::InvalidUrl(
                "WebDAV server URL must use HTTPS.".into(),
            ));
        }
        let expected_host = base_url.host_str().map(str::to_owned);
        let expected_port = base_url.port_or_known_default();
        let redirect_policy = reqwest::redirect::Policy::custom(move |attempt| {
            let next = attempt.url();
            let same_origin = next.scheme() == "https"
                && next.host_str() == expected_host.as_deref()
                && next.port_or_known_default() == expected_port
                && next.username().is_empty()
                && next.password().is_none();
            if same_origin && attempt.previous().len() < 5 {
                attempt.follow()
            } else {
                attempt.stop()
            }
        });
        let mut builder = Client::builder()
            .user_agent(user_agent)
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .redirect(redirect_policy)
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd();
        if let Some(proxy_url) = proxy_url {
            builder =
                builder
                    .no_proxy()
                    .proxy(Proxy::all(proxy_url).map_err(|_| {
                        WebDavError::Network("Invalid proxy configuration.".into())
                    })?);
        }
        let client = builder
            .build()
            .map_err(|_| WebDavError::Network("Unable to initialize the HTTPS client.".into()))?;
        Ok(Self {
            client,
            username: username.into(),
            password: password.into(),
            authentication: Mutex::new(AuthenticationState::Unknown),
        })
    }

    async fn build_request(
        &self,
        method: &Method,
        url: &Url,
        headers: &[(HeaderName, HeaderValue)],
        body: &RequestBody,
        authorization: Option<&str>,
    ) -> Result<reqwest::RequestBuilder> {
        let mut request = self.client.request(method.clone(), url.clone());
        for (name, value) in headers {
            request = request.header(name, value);
        }
        if let Some(authorization) = authorization {
            request = request.header(AUTHORIZATION, authorization);
        } else if !self.username.is_empty() {
            request = request.basic_auth(&self.username, Some(&self.password));
        }
        request = match body {
            RequestBody::Empty => request,
            RequestBody::Bytes(bytes) => request.body(bytes.clone()),
            RequestBody::File(path) => {
                let size = tokio::fs::metadata(path).await?.len();
                let file = tokio::fs::File::open(path).await?;
                request
                    .header(CONTENT_LENGTH, size)
                    .body(Body::wrap_stream(ReaderStream::new(file)))
            }
        };
        Ok(request)
    }

    fn digest_challenge(response: &Response) -> Option<String> {
        for header in response.headers().get_all(WWW_AUTHENTICATE) {
            let Ok(value) = header.to_str() else {
                continue;
            };
            if value
                .trim_start()
                .to_ascii_lowercase()
                .starts_with("digest ")
            {
                return Some(value.to_string());
            }
        }
        None
    }

    fn parse_digest_prompt(digest_header: &str) -> Result<WwwAuthenticateHeader> {
        let mut prompt = digest_auth::parse(digest_header)
            .map_err(|error| WebDavError::UnsupportedAuthentication(error.to_string()))?;
        if let Some(qops) = prompt.qop.as_mut() {
            if !qops.contains(&Qop::AUTH) {
                return Err(WebDavError::UnsupportedAuthentication(
                    "The server only offers Digest qop=auth-int; qop=auth is required.".into(),
                ));
            }
            qops.clear();
            qops.push(Qop::AUTH);
        }
        Ok(prompt)
    }

    fn digest_authorization_for_prompt(
        &self,
        prompt: &mut WwwAuthenticateHeader,
        method: &Method,
        url: &Url,
    ) -> Result<String> {
        let request_uri = match url.query() {
            Some(query) => format!("{}?{query}", url.path()),
            None => url.path().to_string(),
        };
        let context = AuthContext::new_with_method(
            self.username.clone(),
            self.password.clone(),
            request_uri,
            None::<Vec<u8>>,
            HttpMethod::from(method.as_str().to_string()),
        );
        let authorization = prompt
            .respond(&context)
            .map_err(|error| WebDavError::UnsupportedAuthentication(error.to_string()))?;
        Ok(authorization.to_string())
    }

    async fn send(
        &self,
        method: Method,
        url: &Url,
        headers: Vec<(HeaderName, HeaderValue)>,
        body: RequestBody,
    ) -> Result<Response> {
        let (authorization, was_unknown) = {
            let mut authentication = self
                .authentication
                .lock()
                .map_err(|_| WebDavError::Network("Authentication state is unavailable.".into()))?;
            match &mut *authentication {
                AuthenticationState::Digest(prompt) => (
                    Some(self.digest_authorization_for_prompt(prompt, &method, url)?),
                    false,
                ),
                AuthenticationState::Unknown => (None, true),
                AuthenticationState::Basic => (None, false),
            }
        };
        let response = self
            .build_request(&method, url, &headers, &body, authorization.as_deref())
            .await?
            .send()
            .await
            .map_err(|error| network_error(&error))?;
        if response.status() != StatusCode::UNAUTHORIZED {
            if was_unknown {
                *self.authentication.lock().map_err(|_| {
                    WebDavError::Network("Authentication state is unavailable.".into())
                })? = AuthenticationState::Basic;
            }
            return Ok(response);
        }
        if !method_allows_authentication_retry(&method) {
            return Err(WebDavError::AuthenticationFailed);
        }
        let Some(challenge) = Self::digest_challenge(&response) else {
            return Err(WebDavError::AuthenticationFailed);
        };
        let mut prompt = Self::parse_digest_prompt(&challenge)?;
        let authorization = self.digest_authorization_for_prompt(&mut prompt, &method, url)?;
        let response = self
            .build_request(&method, url, &headers, &body, Some(&authorization))
            .await?
            .send()
            .await
            .map_err(|error| network_error(&error))?;
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(WebDavError::AuthenticationFailed);
        }
        *self
            .authentication
            .lock()
            .map_err(|_| WebDavError::Network("Authentication state is unavailable.".into()))? =
            AuthenticationState::Digest(prompt);
        Ok(response)
    }

    fn remote_error(response: Response) -> WebDavError {
        let status = response.status().as_u16();
        let detail = response
            .status()
            .canonical_reason()
            .unwrap_or("WebDAV request failed")
            .to_string();
        WebDavError::Remote { status, detail }
    }

    pub async fn test_connection(&self, base_url: &Url) -> Result<()> {
        let response = self
            .send(Method::OPTIONS, base_url, Vec::new(), RequestBody::Empty)
            .await?;
        if !response.status().is_success() {
            return Err(Self::remote_error(response));
        }
        Ok(())
    }

    pub async fn propfind(&self, url: &Url) -> Result<RemoteFileInfo> {
        let method = Method::from_bytes(b"PROPFIND").expect("valid WebDAV method");
        let body = br#"<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>"#.to_vec();
        let headers = vec![
            (
                HeaderName::from_static("depth"),
                HeaderValue::from_static("0"),
            ),
            (
                CONTENT_TYPE,
                HeaderValue::from_static("application/xml; charset=utf-8"),
            ),
        ];
        let response = self
            .send(method, url, headers, RequestBody::Bytes(body))
            .await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(RemoteFileInfo::default());
        }
        if response.status() != StatusCode::MULTI_STATUS && !response.status().is_success() {
            return Err(Self::remote_error(response));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_PROPFIND_RESPONSE_BYTES as u64)
        {
            return Err(WebDavError::InvalidResponse(
                "PROPFIND response exceeds its size limit.".into(),
            ));
        }
        let mut body = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| network_error(&error))?;
            if body.len().saturating_add(chunk.len()) > MAX_PROPFIND_RESPONSE_BYTES {
                return Err(WebDavError::InvalidResponse(
                    "PROPFIND response exceeds its size limit.".into(),
                ));
            }
            body.extend_from_slice(&chunk);
        }
        parse_propfind(&body)
    }

    pub async fn mkcol(&self, url: &Url) -> Result<()> {
        let method = Method::from_bytes(b"MKCOL").expect("valid WebDAV method");
        let response = self
            .send(method, url, Vec::new(), RequestBody::Empty)
            .await?;
        if response.status() == StatusCode::CREATED
            || response.status() == StatusCode::METHOD_NOT_ALLOWED
        {
            return Ok(());
        }
        Err(Self::remote_error(response))
    }

    pub async fn put_file(&self, url: &Url, path: &Path) -> Result<()> {
        let response = self
            .send(
                Method::PUT,
                url,
                vec![(
                    CONTENT_TYPE,
                    HeaderValue::from_static("application/octet-stream"),
                )],
                RequestBody::File(path.to_path_buf()),
            )
            .await?;
        if matches!(response.status().as_u16(), 200 | 201 | 204) {
            return Ok(());
        }
        Err(Self::remote_error(response))
    }

    pub async fn move_resource(&self, source: &Url, destination: &Url) -> Result<()> {
        let method = Method::from_bytes(b"MOVE").expect("valid WebDAV method");
        let headers = move_headers(destination)?;
        let response = self
            .send(method, source, headers, RequestBody::Empty)
            .await?;
        if matches!(response.status().as_u16(), 201 | 204) {
            return Ok(());
        }
        Err(Self::remote_error(response))
    }

    pub async fn delete(&self, url: &Url) -> Result<()> {
        let response = self
            .send(Method::DELETE, url, Vec::new(), RequestBody::Empty)
            .await?;
        if response.status().is_success() || response.status() == StatusCode::NOT_FOUND {
            return Ok(());
        }
        Err(Self::remote_error(response))
    }

    pub async fn get_prefix(&self, url: &Url, limit: usize) -> Result<Vec<u8>> {
        let range = HeaderValue::from_str(&format!("bytes=0-{}", limit.saturating_sub(1)))
            .map_err(|error| WebDavError::InvalidResponse(error.to_string()))?;
        let response = self
            .send(Method::GET, url, vec![(RANGE, range)], RequestBody::Empty)
            .await?;
        if response.status() != StatusCode::OK && response.status() != StatusCode::PARTIAL_CONTENT {
            return Err(Self::remote_error(response));
        }
        let mut output = Vec::with_capacity(limit);
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| network_error(&error))?;
            let remaining = limit.saturating_sub(output.len());
            output.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
            if output.len() >= limit {
                break;
            }
        }
        Ok(output)
    }

    pub async fn get_to_file(&self, url: &Url, destination: &Path, max_bytes: u64) -> Result<u64> {
        let response = self
            .send(Method::GET, url, Vec::new(), RequestBody::Empty)
            .await?;
        if response.status() != StatusCode::OK {
            return Err(Self::remote_error(response));
        }
        if response
            .content_length()
            .is_some_and(|length| length > max_bytes)
        {
            return Err(WebDavError::InvalidResponse(
                "Remote backup exceeds the configured size limit.".into(),
            ));
        }
        let mut output = tokio::fs::File::create(destination).await?;
        let mut total = 0_u64;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| network_error(&error))?;
            if total.saturating_add(chunk.len() as u64) > max_bytes {
                return Err(WebDavError::InvalidResponse(
                    "Remote backup exceeds the configured size limit.".into(),
                ));
            }
            output.write_all(&chunk).await?;
            total = total.saturating_add(chunk.len() as u64);
        }
        output.flush().await?;
        output.sync_all().await?;
        Ok(total)
    }
}

fn parse_propfind(body: &[u8]) -> Result<RemoteFileInfo> {
    let mut reader = Reader::from_reader(body);
    reader.config_mut().trim_text(true);
    let mut current = String::new();
    let mut content_length = None;
    let mut last_modified = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) => {
                current = String::from_utf8_lossy(start.local_name().as_ref()).to_ascii_lowercase();
            }
            Ok(Event::Text(text)) => {
                let value = text
                    .decode()
                    .map_err(|error| WebDavError::InvalidResponse(error.to_string()))?
                    .into_owned();
                if value.len() > MAX_PROPERTY_VALUE_BYTES {
                    return Err(WebDavError::InvalidResponse(
                        "PROPFIND property value exceeds its size limit.".into(),
                    ));
                }
                match current.as_str() {
                    "getcontentlength" => content_length = value.trim().parse().ok(),
                    "getlastmodified" => last_modified = Some(value.trim().to_string()),
                    _ => {}
                }
            }
            Ok(Event::End(_)) => current.clear(),
            Ok(Event::Eof) => break,
            Err(error) => return Err(WebDavError::InvalidResponse(error.to_string())),
            _ => {}
        }
    }
    Ok(RemoteFileInfo {
        exists: true,
        content_length,
        last_modified,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_namespaced_propfind_properties() {
        let xml = br#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:getcontentlength>42</d:getcontentlength><d:getlastmodified>Sun, 12 Jul 2026 00:00:00 GMT</d:getlastmodified></d:prop></d:propstat></d:response></d:multistatus>"#;
        let parsed = parse_propfind(xml).unwrap();
        assert!(parsed.exists);
        assert_eq!(parsed.content_length, Some(42));
    }

    #[tokio::test]
    async fn uses_https_basic_auth_without_putting_plaintext_in_the_url() {
        let base = Url::parse("https://dav.example.test/root/").unwrap();
        let client = WebDavClient::new(&base, "alice", "secret", None, "test").unwrap();
        let request = client
            .build_request(&Method::GET, &base, &[], &RequestBody::Empty, None)
            .await
            .unwrap()
            .build()
            .unwrap();
        let authorization = request
            .headers()
            .get(AUTHORIZATION)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(authorization.starts_with("Basic "));
        assert!(!authorization.contains("secret"));
        assert!(request.url().username().is_empty());
        assert!(request.url().password().is_none());
    }

    #[test]
    fn supports_digest_auth_and_rejects_auth_int_only() {
        let base = Url::parse("https://dav.example.test/root/file").unwrap();
        let client = WebDavClient::new(&base, "alice", "secret", None, "test").unwrap();
        let mut prompt = WebDavClient::parse_digest_prompt(
            r#"Digest realm="dav", nonce="abc123", algorithm=MD5, qop="auth""#,
        )
        .unwrap();
        let authorization = client
            .digest_authorization_for_prompt(&mut prompt, &Method::GET, &base)
            .unwrap();
        assert!(authorization.starts_with("Digest "));
        assert!(authorization.contains("qop=auth"));
        assert!(!authorization.contains("secret"));

        let mut reusable_prompt = WebDavClient::parse_digest_prompt(
            r#"Digest realm="dav", nonce="reusable", algorithm=MD5, qop="auth""#,
        )
        .unwrap();
        let first = client
            .digest_authorization_for_prompt(&mut reusable_prompt, &Method::GET, &base)
            .unwrap();
        let second = client
            .digest_authorization_for_prompt(&mut reusable_prompt, &Method::GET, &base)
            .unwrap();
        assert!(first.contains("nc=00000001"));
        assert!(second.contains("nc=00000002"));

        let error = WebDavClient::parse_digest_prompt(
            r#"Digest realm="dav", nonce="abc123", algorithm=MD5, qop="auth-int""#,
        )
        .unwrap_err();
        assert!(error.to_string().contains("qop=auth-int"));
    }

    #[test]
    fn never_authentication_retries_webdav_write_methods() {
        assert!(method_allows_authentication_retry(&Method::GET));
        assert!(method_allows_authentication_retry(
            &Method::from_bytes(b"PROPFIND").unwrap()
        ));
        assert!(!method_allows_authentication_retry(&Method::PUT));
        assert!(!method_allows_authentication_retry(
            &Method::from_bytes(b"MKCOL").unwrap()
        ));
        assert!(!method_allows_authentication_retry(
            &Method::from_bytes(b"MOVE").unwrap()
        ));
        assert!(!method_allows_authentication_retry(&Method::DELETE));
    }

    #[test]
    fn move_replacement_always_requests_overwrite() {
        let destination = Url::parse("https://dav.example.test/VRCX-0/latest.vrcx0backup").unwrap();
        let headers = move_headers(&destination).unwrap();
        assert_eq!(
            headers
                .iter()
                .find(|(name, _)| name.as_str() == "overwrite")
                .unwrap()
                .1,
            "T"
        );
        assert_eq!(
            headers
                .iter()
                .find(|(name, _)| name.as_str() == "destination")
                .unwrap()
                .1,
            destination.as_str()
        );
    }
}
