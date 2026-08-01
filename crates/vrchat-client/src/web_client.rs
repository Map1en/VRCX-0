use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use cookie_store::{CookieStore, RawCookie};
use reqwest::header::{HeaderName, HeaderValue, CONTENT_TYPE, REFERER};
use reqwest::multipart::{Form, Part};
use reqwest::redirect::Policy;
use reqwest::{Client, Method, Proxy};
use vrcx_0_core::image_sniff::sniff_image_mime;
use vrcx_0_core::vrchat_endpoints::{VRCHAT_CLOUD_ROOT_HOST, VRCHAT_SITE_HOST};

pub type Result<T> = std::result::Result<T, WebClientError>;
pub(crate) const BASE_USER_AGENT: &str = "VRCX-0";

#[derive(Debug, thiserror::Error)]
pub enum WebClientError {
    #[error("{0}")]
    Custom(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

use crate::cookies::{CookieEntry, CookieJar};
use WebClientError as Error;

pub use crate::cookies::{
    deserialize_cookie_store, deserialize_legacy_cookie_entries, serialize_cookie_store,
};

pub(crate) fn build_vrcx_user_agent(app_version: &str) -> String {
    let app_version = app_version.trim();
    if app_version.is_empty() {
        BASE_USER_AGENT.into()
    } else {
        format!("{BASE_USER_AGENT}/{app_version}")
    }
}

#[derive(Clone, Debug)]
pub struct AuthCookieState {
    pub domain: String,
    pub expired: bool,
}

#[derive(Clone, Debug)]
pub struct AuthCookieSummary {
    pub total_cookie_count: usize,
    pub auth_cookies: Vec<AuthCookieState>,
}

#[derive(Clone, Debug, Default)]
pub enum WebUploadMode {
    #[default]
    None,
    FilePut {
        file_data: String,
        file_mime: String,
        file_md5: Option<String>,
    },
    LegacyImage {
        image_data: String,
        post_data: Option<String>,
    },
    Image {
        image_data: String,
        post_data: Option<String>,
    },
    PrintImage {
        image_data: String,
        post_data: Option<String>,
    },
}

#[derive(Clone, Debug)]
pub struct WebExecuteRequest {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub upload: WebUploadMode,
    pub response_body_limit: Option<usize>,
}

impl WebExecuteRequest {
    pub fn new(url: String, method: String) -> Self {
        Self {
            url,
            method,
            headers: Vec::new(),
            body: None,
            upload: WebUploadMode::None,
            response_body_limit: None,
        }
    }
}

pub fn validate_vrchat_cookies_b64(b64: &str) -> Result<()> {
    const MAX_COOKIE_STORE_BYTES: usize = 1024 * 1024;

    let value = b64.trim();
    if value.is_empty() {
        return Ok(());
    }

    let bytes = B64
        .decode(value)
        .map_err(|error| Error::Custom(format!("bad cookie payload: {error}")))?;
    if bytes.len() > MAX_COOKIE_STORE_BYTES {
        return Err(Error::Custom("cookie payload is too large".into()));
    }

    if let Ok(entries) = serde_json::from_slice::<Vec<CookieEntry>>(&bytes) {
        return validate_legacy_cookie_entries(&entries);
    }

    let store = load_cookie_store(&bytes)?;
    validate_cookie_store_domains(&store)
}

fn load_cookie_store(bytes: &[u8]) -> Result<CookieStore> {
    #[allow(deprecated)]
    CookieStore::load_json_all(Cursor::new(bytes))
        .map_err(|error| Error::Custom(format!("bad cookie store JSON: {error}")))
}

fn validate_cookie_store_domains(store: &CookieStore) -> Result<()> {
    let mut saw_domain = false;
    for domain in store.iter_any().filter_map(|cookie| cookie.domain.as_cow()) {
        saw_domain = true;
        if !is_vrchat_cookie_domain(&domain) {
            return Err(Error::Custom(format!(
                "cookie domain is not allowed: {domain}"
            )));
        }
    }

    if !saw_domain {
        return Err(Error::Custom(
            "cookie payload does not contain any cookie domains".into(),
        ));
    }

    Ok(())
}

fn validate_legacy_cookie_entries(entries: &[CookieEntry]) -> Result<()> {
    if entries.is_empty() {
        return Err(Error::Custom(
            "cookie payload does not contain any cookie domains".into(),
        ));
    }
    for entry in entries {
        legacy_cookie_url(entry)?;
        legacy_raw_cookie(entry)?;
    }
    Ok(())
}

fn legacy_cookie_url(entry: &CookieEntry) -> Result<reqwest::Url> {
    if !is_vrchat_cookie_domain(&entry.domain) {
        return Err(Error::Custom(format!(
            "cookie domain is not allowed: {}",
            entry.domain
        )));
    }
    if entry.path.is_empty()
        || !entry.path.starts_with('/')
        || entry.path.chars().any(|ch| ch.is_control() || ch == ';')
    {
        return Err(Error::Custom("cookie path is not allowed".into()));
    }
    let domain = entry.domain.trim().trim_start_matches('.');
    format!("https://{}{}", domain, entry.path)
        .parse::<reqwest::Url>()
        .map_err(|error| Error::Custom(format!("bad cookie URL: {error}")))
}

fn legacy_raw_cookie(entry: &CookieEntry) -> Result<RawCookie<'static>> {
    if entry.name.is_empty()
        || entry
            .name
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '=' | ';'))
        || entry.value.chars().any(|ch| ch.is_control() || ch == ';')
    {
        return Err(Error::Custom(
            "legacy cookie name or value is not allowed".into(),
        ));
    }
    let cookie_str = format!(
        "{}={}; Domain={}; Path={}",
        entry.name, entry.value, entry.domain, entry.path
    );
    RawCookie::parse(cookie_str)
        .map(|cookie| cookie.into_owned())
        .map_err(|error| Error::Custom(format!("bad legacy cookie entry: {error}")))
}

fn is_vrchat_cookie_domain(domain: &str) -> bool {
    let domain = domain
        .trim()
        .trim_start_matches('.')
        .trim_end_matches('.')
        .to_ascii_lowercase();
    is_domain_or_subdomain(&domain, VRCHAT_SITE_HOST)
        || is_domain_or_subdomain(&domain, VRCHAT_CLOUD_ROOT_HOST)
}

fn is_domain_or_subdomain(domain: &str, root: &str) -> bool {
    domain == root
        || domain
            .strip_suffix(root)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

pub struct WebClient {
    client: Client,
    jar: Arc<CookieJar>,
    proxy_url: Option<String>,
    user_agent: String,
}

fn build_http_client(
    jar: Arc<CookieJar>,
    proxy_url: Option<&str>,
    user_agent: &str,
) -> Result<Client> {
    build_http_client_with_redirects(jar, proxy_url, user_agent, true)
}

fn build_http_client_with_redirects(
    jar: Arc<CookieJar>,
    proxy_url: Option<&str>,
    user_agent: &str,
    follow_redirects: bool,
) -> Result<Client> {
    let mut builder = Client::builder()
        .cookie_provider(jar)
        .user_agent(user_agent)
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(std::time::Duration::from_secs(300))
        .tcp_keepalive(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(10))
        .read_timeout(std::time::Duration::from_secs(30));
    if !follow_redirects {
        builder = builder.redirect(Policy::none());
    }

    if let Some(url) = proxy_url {
        builder = builder
            .no_proxy()
            .proxy(Proxy::all(url).map_err(|e| Error::Custom(format!("bad proxy: {e}")))?);
    }

    builder
        .build()
        .map_err(|e| Error::Custom(format!("http client: {e}")))
}

fn normalize_execute_result(result: Result<(i32, String)>) -> Result<(i32, String)> {
    match result {
        Ok(pair) => Ok(pair),
        Err(error) => Ok((-1, error.to_string())),
    }
}

fn response_body_from_bytes(status: i32, content_type: &str, bytes: &[u8]) -> (i32, String) {
    if content_type.starts_with("image/") {
        return (
            status,
            format!("data:{content_type};base64,{}", B64.encode(bytes)),
        );
    }
    if content_type == "application/octet-stream" {
        if let Some(image_mime) = sniff_image_mime(bytes) {
            return (
                status,
                format!("data:{image_mime};base64,{}", B64.encode(bytes)),
            );
        }
    }
    (status, String::from_utf8_lossy(bytes).into_owned())
}

async fn execute_request(
    client: &Client,
    request: reqwest::Request,
    response_body_limit: Option<usize>,
) -> Result<(i32, String)> {
    let mut response = client
        .execute(request)
        .await
        .map_err(|e| Error::Custom(e.to_string()))?;
    let status = response.status().as_u16() as i32;
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    if let Some(max_bytes) = response_body_limit {
        if response
            .content_length()
            .is_some_and(|content_length| content_length > max_bytes as u64)
        {
            return Err(Error::Custom(format!(
                "HTTP response body exceeds the {max_bytes} byte limit"
            )));
        }
        let mut bytes = Vec::with_capacity(
            response
                .content_length()
                .unwrap_or_default()
                .min(max_bytes as u64) as usize,
        );
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| Error::Custom(error.to_string()))?
        {
            if bytes.len().saturating_add(chunk.len()) > max_bytes {
                return Err(Error::Custom(format!(
                    "HTTP response body exceeds the {max_bytes} byte limit"
                )));
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(response_body_from_bytes(status, &content_type, &bytes));
    }

    if content_type.starts_with("image/") || content_type == "application/octet-stream" {
        let bytes = response
            .bytes()
            .await
            .map_err(|e| Error::Custom(e.to_string()))?;
        Ok(response_body_from_bytes(status, &content_type, &bytes))
    } else {
        let body = response
            .text()
            .await
            .map_err(|e| Error::Custom(e.to_string()))?;
        Ok((status, body))
    }
}

impl WebClient {
    pub fn new(
        proxy_url: Option<String>,
        cookies_b64: Option<&str>,
        app_version: &str,
    ) -> Result<Self> {
        let cookie_store = CookieStore::default();
        let jar = Arc::new(CookieJar::new(cookie_store));
        let user_agent = build_vrcx_user_agent(app_version);
        let client = build_http_client(jar.clone(), proxy_url.as_deref(), &user_agent)?;

        let wc = Self {
            client,
            jar,
            proxy_url,
            user_agent,
        };

        if let Some(cookies_b64) = cookies_b64 {
            let _ = wc.restore_cookies(cookies_b64);
            wc.jar.clear_dirty();
        }

        Ok(wc)
    }

    fn restore_cookies(&self, b64: &str) -> Result<bool> {
        if let Some(new_store) = crate::cookies::deserialize_cookie_store(b64) {
            self.jar.update(|store_mut| *store_mut = new_store);
            return Ok(true);
        }
        if let Some(entries) = crate::cookies::deserialize_legacy_cookie_entries(b64) {
            self.apply_cookie_entries(&entries)?;
            return Ok(true);
        }
        Ok(false)
    }

    fn cookies_snapshot_b64(&self) -> Option<String> {
        self.jar.read_with(crate::cookies::serialize_cookie_store)
    }

    fn apply_cookie_entries(&self, entries: &[CookieEntry]) -> Result<()> {
        self.jar.update(|store| {
            for e in entries {
                let url = legacy_cookie_url(e)?;
                let cookie = legacy_raw_cookie(e)?;
                store
                    .insert_raw(&cookie, &url)
                    .map_err(|error| Error::Custom(format!("insert legacy cookie: {error}")))?;
            }
            Ok(())
        })
    }

    pub fn cookie_jar(&self) -> Arc<CookieJar> {
        self.jar.clone()
    }

    pub fn proxy_url(&self) -> Option<&str> {
        self.proxy_url.as_deref()
    }

    pub fn clear_cookies(&self) {
        self.jar.update(|store| store.clear());
    }

    pub fn clear_auth_cookies(&self) {
        self.jar.update(|store| {
            let targets: Vec<(String, String)> = store
                .iter_any()
                .filter(|cookie| cookie.name() == "auth")
                .map(|cookie| (String::from(&cookie.domain), String::from(&cookie.path)))
                .collect();
            for (domain, path) in &targets {
                store.remove(domain, path, "auth");
            }
        });
    }

    pub fn auth_cookie_summary(&self) -> AuthCookieSummary {
        self.jar.read_with(|store| {
            let total_cookie_count = store.iter_any().count();
            let auth_cookies = store
                .iter_any()
                .filter(|cookie| cookie.name() == "auth")
                .map(|cookie| AuthCookieState {
                    domain: String::from(&cookie.domain),
                    expired: cookie.is_expired(),
                })
                .collect();
            AuthCookieSummary {
                total_cookie_count,
                auth_cookies,
            }
        })
    }

    pub fn auth_cookie_value(&self) -> Option<String> {
        self.jar.read_with(|store| {
            store
                .iter_any()
                .filter(|cookie| cookie.name() == "auth" && !cookie.is_expired())
                .map(|cookie| cookie.value().to_string())
                .next()
        })
    }

    pub fn get_cookies(&self) -> String {
        self.cookies_snapshot_b64().unwrap_or_default()
    }

    pub fn set_cookies(&self, b64: &str) -> Result<()> {
        if b64.trim().is_empty() {
            return Ok(());
        }
        validate_vrchat_cookies_b64(b64)?;
        if self.restore_cookies(b64)? {
            Ok(())
        } else {
            Err(Error::Custom("cookie payload could not be restored".into()))
        }
    }

    pub async fn execute(&self, request: WebExecuteRequest) -> Result<(i32, String)> {
        let result = self.do_execute(&request).await;

        normalize_execute_result(result)
    }

    pub async fn execute_without_redirects(
        &self,
        request: WebExecuteRequest,
    ) -> Result<(i32, String)> {
        let result = self
            .do_execute_fresh_standard_with_redirects(&request, false)
            .await;

        normalize_execute_result(result)
    }

    pub async fn execute_fresh_standard(
        &self,
        request: WebExecuteRequest,
    ) -> Result<(i32, String)> {
        let result = self.do_execute_fresh_standard(&request).await;

        normalize_execute_result(result)
    }

    async fn do_execute_fresh_standard(
        &self,
        request: &WebExecuteRequest,
    ) -> Result<(i32, String)> {
        self.do_execute_fresh_standard_with_redirects(request, true)
            .await
    }

    async fn do_execute_fresh_standard_with_redirects(
        &self,
        request: &WebExecuteRequest,
        follow_redirects: bool,
    ) -> Result<(i32, String)> {
        if !matches!(&request.upload, WebUploadMode::None) {
            return Err(Error::Custom(
                "fresh HTTP client execution does not support uploads".into(),
            ));
        }
        let client = build_http_client_with_redirects(
            Arc::clone(&self.jar),
            self.proxy_url.as_deref(),
            &self.user_agent,
            follow_redirects,
        )?;
        let response_body_limit = request.response_body_limit;
        let request = self.build_standard_request_with(&client, request)?;
        execute_request(&client, request, response_body_limit).await
    }

    async fn do_execute(&self, request: &WebExecuteRequest) -> Result<(i32, String)> {
        let response_body_limit = request.response_body_limit;
        let request = match &request.upload {
            WebUploadMode::None => self.build_standard_request(request)?,
            WebUploadMode::FilePut {
                file_data,
                file_mime,
                file_md5,
            } => self.build_file_put_request(request, file_data, file_mime, file_md5.as_deref())?,
            WebUploadMode::LegacyImage {
                image_data,
                post_data,
            } => {
                self.build_legacy_image_upload_request(request, image_data, post_data.as_deref())?
            }
            WebUploadMode::Image {
                image_data,
                post_data,
            } => self.build_image_upload_request(request, image_data, post_data.as_deref())?,
            WebUploadMode::PrintImage {
                image_data,
                post_data,
            } => {
                self.build_print_image_upload_request(request, image_data, post_data.as_deref())?
            }
        };

        execute_request(&self.client, request, response_body_limit).await
    }

    fn build_standard_request(&self, request: &WebExecuteRequest) -> Result<reqwest::Request> {
        self.build_standard_request_with(&self.client, request)
    }

    fn build_standard_request_with(
        &self,
        client: &Client,
        request: &WebExecuteRequest,
    ) -> Result<reqwest::Request> {
        let method = Method::from_bytes(request.method.as_bytes())
            .map_err(|e| Error::Custom(format!("bad method: {e}")))?;

        let mut builder = client.request(method.clone(), &request.url);

        let mut content_type_override: Option<String> = None;
        for (key, val_str) in &request.headers {
            let key_lower = key.to_lowercase();
            if key_lower == "content-type" {
                content_type_override = Some(val_str.to_string());
                continue;
            }
            if key_lower == "user-agent" {
                continue;
            }
            if key_lower == "referer" {
                builder = builder.header(REFERER, val_str);
            } else if let (Ok(name), Ok(value)) = (
                HeaderName::from_bytes(key.as_bytes()),
                HeaderValue::from_str(val_str),
            ) {
                builder = builder.header(name, value);
            }
        }

        if method != Method::GET {
            if let Some(body) = request.body.as_deref() {
                let ct = content_type_override
                    .as_deref()
                    .unwrap_or("application/json; charset=utf-8");
                builder = builder.header(CONTENT_TYPE, ct).body(body.to_string());
            }
        }

        builder
            .build()
            .map_err(|e| Error::Custom(format!("build request: {e}")))
    }

    fn build_file_put_request(
        &self,
        request: &WebExecuteRequest,
        file_data: &str,
        file_mime: &str,
        file_md5: Option<&str>,
    ) -> Result<reqwest::Request> {
        let bytes = B64
            .decode(file_data)
            .map_err(|e| Error::Custom(format!("bad base64: {e}")))?;

        let mut builder = self
            .client
            .put(&request.url)
            .header(CONTENT_TYPE, file_mime)
            .body(bytes.clone());

        if let Some(md5) = file_md5 {
            let md5_bytes = B64
                .decode(md5)
                .map_err(|e| Error::Custom(format!("bad file MD5 base64: {e}")))?;
            builder = builder.header("Content-MD5", B64.encode(&md5_bytes));
        }

        for (key, val_str) in &request.headers {
            let key_lower = key.to_lowercase();
            if key_lower == "content-type" {
                continue;
            }
            if key_lower == "user-agent" {
                continue;
            }
            if let (Ok(name), Ok(value)) = (
                HeaderName::from_bytes(key.as_bytes()),
                HeaderValue::from_str(val_str),
            ) {
                builder = builder.header(name, value);
            }
        }

        builder
            .build()
            .map_err(|e| Error::Custom(format!("build PUT: {e}")))
    }

    fn build_legacy_image_upload_request(
        &self,
        request: &WebExecuteRequest,
        image_data: &str,
        post_data: Option<&str>,
    ) -> Result<reqwest::Request> {
        let image_bytes = B64
            .decode(image_data)
            .map_err(|e| Error::Custom(format!("bad imageData base64: {e}")))?;

        let mut form = Form::new().part(
            "image",
            Part::bytes(image_bytes)
                .file_name("image.png")
                .mime_str("image/png")
                .map_err(|e| Error::Custom(format!("image mime: {e}")))?,
        );

        if let Some(post_data) = post_data {
            form = form.text("data", post_data.to_string());
        }

        self.client
            .post(&request.url)
            .multipart(form)
            .build()
            .map_err(|e| Error::Custom(format!("build legacy upload: {e}")))
    }

    fn build_image_upload_request(
        &self,
        request: &WebExecuteRequest,
        image_data: &str,
        post_data: Option<&str>,
    ) -> Result<reqwest::Request> {
        let image_bytes = B64
            .decode(image_data)
            .map_err(|e| Error::Custom(format!("bad imageData base64: {e}")))?;

        let mut form = Form::new().part(
            "file",
            Part::bytes(image_bytes)
                .file_name("blob")
                .mime_str("image/png")
                .map_err(|e| Error::Custom(format!("image mime: {e}")))?,
        );

        if let Some(post_data) = post_data {
            let json =
                serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(post_data)
                    .map_err(|e| Error::Custom(format!("bad postData: {e}")))?;
            for (key, value) in json {
                let text = match value {
                    serde_json::Value::String(s) => s,
                    other => other.to_string(),
                };
                form = form.text(key, text);
            }
        }

        self.client
            .post(&request.url)
            .multipart(form)
            .build()
            .map_err(|e| Error::Custom(format!("build image upload: {e}")))
    }

    fn build_print_image_upload_request(
        &self,
        request: &WebExecuteRequest,
        image_data: &str,
        post_data: Option<&str>,
    ) -> Result<reqwest::Request> {
        let image_bytes = B64
            .decode(image_data)
            .map_err(|e| Error::Custom(format!("bad imageData base64: {e}")))?;
        let mut form = Form::new().part(
            "image",
            Part::bytes(image_bytes)
                .file_name("image")
                .mime_str("image/png")
                .map_err(|e| Error::Custom(format!("print image mime: {e}")))?,
        );

        if let Some(post_data) = post_data {
            let json = serde_json::from_str::<HashMap<String, String>>(post_data)
                .map_err(|e| Error::Custom(format!("bad postData: {e}")))?;
            for (key, value) in json {
                form = form.text(key, value);
            }
        }

        self.client
            .post(&request.url)
            .multipart(form)
            .build()
            .map_err(|e| Error::Custom(format!("build print upload: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn serve_response(
        content_type: &str,
        body: &[u8],
    ) -> (String, tokio::task::JoinHandle<()>) {
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

    #[tokio::test]
    async fn transport_sends_owned_user_agent_and_ignores_request_override() -> Result<()> {
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
        let request =
            WebExecuteRequest::new(format!("http://{redirect_address}/theme"), "GET".into());
        let (status, _) = web.execute_without_redirects(request).await?;

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

        let (text_url, text_server) =
            serve_response("application/octet-stream", b"not an image").await;
        let text_response = web
            .execute(WebExecuteRequest::new(text_url, "GET".into()))
            .await?;
        text_server.await.unwrap();
        assert_eq!(text_response, (200, "not an image".into()));
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
                &B64.encode(b"payload"),
                "application/octet-stream",
                Some("not-base64!"),
            )
            .expect_err("invalid file MD5 should be rejected");

        assert!(error.to_string().contains("bad file MD5 base64"));
        Ok(())
    }

    #[test]
    fn fresh_http_client_reuses_runtime_cookie_jar() -> Result<()> {
        let web = WebClient::new(None, None, "2.9.2")?;
        let initial_references = Arc::strong_count(&web.jar);
        let fresh = build_http_client(
            Arc::clone(&web.jar),
            web.proxy_url.as_deref(),
            &web.user_agent,
        )?;
        let mut request = WebExecuteRequest::new(
            "https://api.vrchat.cloud/api/1/auth/user".into(),
            "GET".into(),
        );
        request
            .headers
            .push(("user-agent".into(), "caller-override".into()));
        let built = web.build_standard_request_with(&fresh, &request)?;

        assert!(Arc::strong_count(&web.jar) > initial_references);
        assert_eq!(web.user_agent, "VRCX-0/2.9.2");
        assert!(built.headers().get(reqwest::header::USER_AGENT).is_none());
        drop(fresh);
        assert_eq!(Arc::strong_count(&web.jar), initial_references);
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
}
