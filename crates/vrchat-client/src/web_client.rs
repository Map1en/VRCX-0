use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use cookie_store::{CookieStore, RawCookie};
use reqwest::header::{HeaderName, HeaderValue, CONTENT_TYPE, REFERER};
use reqwest::multipart::{Form, Part};
use reqwest::redirect::Policy;
use reqwest::{Client, Method, Proxy};
use vrcx_0_core::vrchat_endpoints::{VRCHAT_CLOUD_ROOT_HOST, VRCHAT_SITE_HOST};
use vrcx_0_core::{image_sniff::sniff_image_mime, proxy::with_remote_dns};

pub type Result<T> = std::result::Result<T, WebClientError>;
pub(crate) const BASE_USER_AGENT: &str = "VRCX-0";

#[derive(Debug, thiserror::Error)]
pub enum WebClientError {
    #[error("{0}")]
    Custom(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl vrcx_0_contracts::ApplicationErrorSource for WebClientError {
    fn into_application_error(self) -> vrcx_0_contracts::ApplicationErrorPayload {
        use vrcx_0_contracts::ApplicationErrorPayload;

        match self {
            Self::Custom(message) => ApplicationErrorPayload::WebClient(message),
            Self::Io(error) => ApplicationErrorPayload::Io(error),
        }
    }
}

use crate::cookies::{CookieEntry, CookieJar};
use WebClientError as Error;

pub use crate::cookies::{
    deserialize_cookie_store, deserialize_legacy_cookie_entries, serialize_cookie_store,
};
pub use vrcx_0_contracts::{WebExecuteRequest, WebUploadMode};

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
        builder = builder.no_proxy().proxy(
            Proxy::all(with_remote_dns(url).as_ref())
                .map_err(|e| Error::Custom(format!("bad proxy: {e}")))?,
        );
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
        let result = self.do_execute(request).await;

        normalize_execute_result(result)
    }

    pub async fn execute_without_redirects(
        &self,
        request: WebExecuteRequest,
    ) -> Result<(i32, String)> {
        let result = self
            .do_execute_fresh_standard_with_redirects(request, false)
            .await;

        normalize_execute_result(result)
    }

    pub async fn execute_fresh_standard(
        &self,
        request: WebExecuteRequest,
    ) -> Result<(i32, String)> {
        let result = self.do_execute_fresh_standard(request).await;

        normalize_execute_result(result)
    }

    async fn do_execute_fresh_standard(&self, request: WebExecuteRequest) -> Result<(i32, String)> {
        self.do_execute_fresh_standard_with_redirects(request, true)
            .await
    }

    async fn do_execute_fresh_standard_with_redirects(
        &self,
        mut request: WebExecuteRequest,
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
        let request = self.build_standard_request_with(&client, &mut request)?;
        execute_request(&client, request, response_body_limit).await
    }

    async fn do_execute(&self, mut request: WebExecuteRequest) -> Result<(i32, String)> {
        let response_body_limit = request.response_body_limit;
        let upload = std::mem::take(&mut request.upload);
        let request = match upload {
            WebUploadMode::None => self.build_standard_request(&mut request)?,
            WebUploadMode::FilePut {
                file_data,
                file_mime,
                file_md5,
            } => {
                self.build_file_put_request(&request, file_data, &file_mime, file_md5.as_deref())?
            }
            WebUploadMode::LegacyImage {
                image_data,
                post_data,
            } => {
                self.build_legacy_image_upload_request(&request, &image_data, post_data.as_deref())?
            }
            WebUploadMode::Image {
                image_data,
                post_data,
            } => self.build_image_upload_request(&request, &image_data, post_data.as_deref())?,
            WebUploadMode::PrintImage {
                image_data,
                post_data,
            } => {
                self.build_print_image_upload_request(&request, &image_data, post_data.as_deref())?
            }
        };

        execute_request(&self.client, request, response_body_limit).await
    }

    fn build_standard_request(&self, request: &mut WebExecuteRequest) -> Result<reqwest::Request> {
        self.build_standard_request_with(&self.client, request)
    }

    fn build_standard_request_with(
        &self,
        client: &Client,
        request: &mut WebExecuteRequest,
    ) -> Result<reqwest::Request> {
        let method = Method::from_bytes(request.method.as_bytes())
            .map_err(|e| Error::Custom(format!("bad method: {e}")))?;

        let mut builder = client.request(method.clone(), &request.url);

        let mut content_type_override: Option<String> = None;
        for (key, val_str) in &request.headers {
            if key.eq_ignore_ascii_case("content-type") {
                content_type_override = Some(val_str.to_string());
                continue;
            }
            if key.eq_ignore_ascii_case("user-agent") {
                continue;
            }
            if key.eq_ignore_ascii_case("referer") {
                builder = builder.header(REFERER, val_str);
            } else if let (Ok(name), Ok(value)) = (
                HeaderName::from_bytes(key.as_bytes()),
                HeaderValue::from_str(val_str),
            ) {
                builder = builder.header(name, value);
            }
        }

        if method != Method::GET {
            if let Some(body) = request.body.take() {
                let ct = content_type_override
                    .as_deref()
                    .unwrap_or("application/json; charset=utf-8");
                builder = builder.header(CONTENT_TYPE, ct).body(body);
            }
        }

        builder
            .build()
            .map_err(|e| Error::Custom(format!("build request: {e}")))
    }

    fn build_file_put_request(
        &self,
        request: &WebExecuteRequest,
        file_data: Vec<u8>,
        file_mime: &str,
        file_md5: Option<&str>,
    ) -> Result<reqwest::Request> {
        let mut builder = self
            .client
            .put(&request.url)
            .header(CONTENT_TYPE, file_mime)
            .body(file_data);

        if let Some(md5) = file_md5 {
            let md5_bytes = B64
                .decode(md5)
                .map_err(|e| Error::Custom(format!("bad file MD5 base64: {e}")))?;
            builder = builder.header("Content-MD5", B64.encode(&md5_bytes));
        }

        for (key, val_str) in &request.headers {
            if key.eq_ignore_ascii_case("content-type") {
                continue;
            }
            if key.eq_ignore_ascii_case("user-agent") {
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
mod tests;
