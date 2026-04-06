use std::collections::HashMap;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use reqwest::header::{HeaderName, HeaderValue, CONTENT_TYPE, REFERER};
use reqwest::{Client, Method, Proxy};
use reqwest_cookie_store::CookieStoreMutex;
use serde_json::Value;

use crate::domain::database::DatabaseService;
use crate::domain::storage::StorageService;
use crate::error::AppError;

/// Serialisable cookie entry matching the C# `Cookie` fields the frontend stores.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "PascalCase")]
struct CookieEntry {
    name: String,
    value: String,
    domain: String,
    path: String,
}

/// Persistent HTTP client with cookie jar.
///
/// Replaces C# `WebApi` — handles `Execute`, `ClearCookies`, `GetCookies`, `SetCookies`.
pub struct WebClient {
    client: Client,
    /// reqwest_cookie_store wraps cookie_store::CookieStore in a Mutex
    /// and implements reqwest::cookie::CookieStore.
    jar: Arc<CookieStoreMutex>,
    /// Proxy URL from settings, shared with ImageCache / UpdateManager.
    proxy_url: Option<String>,
}

impl WebClient {
    pub fn new(storage: &StorageService, db: &DatabaseService) -> Result<Self, AppError> {
        let proxy_url = storage
            .get("VRCX-0_ProxyServer")
            .filter(|s| !s.is_empty());

        let cookie_store = reqwest_cookie_store::CookieStore::default();
        let jar = Arc::new(CookieStoreMutex::new(cookie_store));

        let mut builder = Client::builder()
            .cookie_provider(jar.clone())
            .user_agent("VRCX-0")
            .gzip(true)
            .brotli(true)
            .deflate(true)
            .pool_max_idle_per_host(10)
            .pool_idle_timeout(std::time::Duration::from_secs(300));

        if let Some(ref url) = proxy_url {
            builder = builder.proxy(
                Proxy::all(url).map_err(|e| AppError::Custom(format!("bad proxy: {e}")))?,
            );
        }

        let client = builder
            .build()
            .map_err(|e| AppError::Custom(format!("http client: {e}")))?;

        let wc = Self { client, jar, proxy_url: proxy_url.clone() };

        // Load cookies from DB (same table/format as C#)
        wc.load_cookies(db);

        Ok(wc)
    }

    // ------------------------------------------------------------------
    // Cookie persistence  (matches C# cookies table)
    // ------------------------------------------------------------------

    fn load_cookies(&self, db: &DatabaseService) {
        let _ = db.execute_non_query(
            "CREATE TABLE IF NOT EXISTS `cookies` (`key` TEXT PRIMARY KEY, `value` TEXT)",
            &HashMap::new(),
        );

        let rows = db
            .execute(
                "SELECT `value` FROM `cookies` WHERE `key` = @key",
                &{
                    let mut m = HashMap::new();
                    m.insert("@key".to_string(), Value::String("default".into()));
                    m
                },
            )
            .unwrap_or_default();

        if let Some(b64) = rows.first().and_then(|r| r.first()).and_then(|v| v.as_str()) {
            if let Ok(bytes) = B64.decode(b64) {
                if let Ok(entries) = serde_json::from_slice::<Vec<CookieEntry>>(&bytes) {
                    self.apply_cookie_entries(&entries);
                }
            }
        }
    }

    pub fn save_cookies(&self, db: &DatabaseService) {
        let entries = self.snapshot_cookies();
        if entries.is_empty() {
            return;
        }
        if let Ok(json) = serde_json::to_vec(&entries) {
            let b64 = B64.encode(&json);
            let _ = db.execute_non_query(
                "INSERT OR REPLACE INTO `cookies` (`key`, `value`) VALUES (@key, @value)",
                &{
                    let mut m = HashMap::new();
                    m.insert("@key".to_string(), Value::String("default".into()));
                    m.insert("@value".to_string(), Value::String(b64));
                    m
                },
            );
        }
    }

    fn apply_cookie_entries(&self, entries: &[CookieEntry]) {
        let mut store = self.jar.lock().unwrap();
        for e in entries {
            let domain = e.domain.trim_start_matches('.');
            let url_str = format!("https://{}{}", domain, e.path);
            if let Ok(url) = url_str.parse::<reqwest::Url>() {
                let cookie_str = format!(
                    "{}={}; Domain={}; Path={}",
                    e.name, e.value, e.domain, e.path
                );
                store.insert_raw(
                    &reqwest_cookie_store::RawCookie::parse(&cookie_str).unwrap(),
                    &url,
                )
                .ok();
            }
        }
    }

    fn snapshot_cookies(&self) -> Vec<CookieEntry> {
        let store = self.jar.lock().unwrap();
        store
            .iter_unexpired()
            .map(|c| CookieEntry {
                name: c.name().to_string(),
                value: c.value().to_string(),
                domain: c
                    .domain()
                    .map(|d| d.to_string())
                    .unwrap_or_default(),
                path: c
                    .path()
                    .map(|p| p.to_string())
                    .unwrap_or_else(|| "/".into()),
            })
            .collect()
    }

    // ------------------------------------------------------------------
    // Public API matching C# WebApi
    // ------------------------------------------------------------------

    /// Returns a clone of the cookie jar Arc for sharing with other HTTP clients (e.g. ImageCache).
    pub fn cookie_jar(&self) -> Arc<CookieStoreMutex> {
        self.jar.clone()
    }

    /// Returns the proxy URL if one was configured, for use by ImageCache / UpdateManager.
    pub fn proxy_url(&self) -> Option<&str> {
        self.proxy_url.as_deref()
    }

    pub fn clear_cookies(&self) {
        let mut store = self.jar.lock().unwrap();
        store.clear();
    }

    pub fn get_cookies(&self) -> String {
        let entries = self.snapshot_cookies();
        let json = serde_json::to_vec(&entries).unwrap_or_default();
        B64.encode(&json)
    }

    pub fn set_cookies(&self, b64: &str) {
        if let Ok(bytes) = B64.decode(b64) {
            if let Ok(entries) = serde_json::from_slice::<Vec<CookieEntry>>(&bytes) {
                self.apply_cookie_entries(&entries);
            }
        }
    }

    /// Execute an HTTP request. Returns `(status_code, response_body)`.
    ///
    /// `options` is the same JSON object the frontend passes in C#:
    /// `{ url, method?, headers?, body?, uploadFilePUT?, fileData?, fileMIME?, fileMD5?, ... }`
    pub async fn execute(
        &self,
        options: HashMap<String, Value>,
    ) -> Result<(i32, String), AppError> {
        let url = options
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Custom("Missing request URL".into()))?
            .to_string();

        let result = self.do_execute(&url, &options).await;

        match result {
            Ok(pair) => Ok(pair),
            Err(e) => {
                // Match C# behavior: return (-1, errorMessage) instead of propagating
                Ok((-1, e.to_string()))
            }
        }
    }

    async fn do_execute(
        &self,
        url: &str,
        options: &HashMap<String, Value>,
    ) -> Result<(i32, String), AppError> {
        // Determine if this is a special upload type
        let is_file_put = options.contains_key("uploadFilePUT");

        let request = if is_file_put {
            self.build_file_put_request(url, options)?
        } else {
            self.build_standard_request(url, options)?
        };

        let response = self
            .client
            .execute(request)
            .await
            .map_err(|e| AppError::Custom(e.to_string()))?;

        let status = response.status().as_u16() as i32;
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if content_type.contains("image/") || content_type.contains("application/octet-stream") {
            let bytes = response
                .bytes()
                .await
                .map_err(|e| AppError::Custom(e.to_string()))?;
            let b64 = B64.encode(&bytes);
            Ok((status, format!("data:image/png;base64,{b64}")))
        } else {
            let body = response
                .text()
                .await
                .map_err(|e| AppError::Custom(e.to_string()))?;
            Ok((status, body))
        }
    }

    fn build_standard_request(
        &self,
        url: &str,
        options: &HashMap<String, Value>,
    ) -> Result<reqwest::Request, AppError> {
        let method = options
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or("GET");

        let method = Method::from_bytes(method.as_bytes())
            .map_err(|e| AppError::Custom(format!("bad method: {e}")))?;

        let mut builder = self.client.request(method.clone(), url);

        // Headers
        let mut content_type_override: Option<String> = None;
        if let Some(headers) = options.get("headers").and_then(|v| v.as_object()) {
            for (key, val) in headers {
                let val_str = val.as_str().unwrap_or("");
                let key_lower = key.to_lowercase();
                if key_lower == "content-type" {
                    content_type_override = Some(val_str.to_string());
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
        }

        // Body for non-GET
        if method != Method::GET {
            if let Some(body) = options.get("body").and_then(|v| v.as_str()) {
                let ct = content_type_override
                    .as_deref()
                    .unwrap_or("application/json; charset=utf-8");
                builder = builder
                    .header(CONTENT_TYPE, ct)
                    .body(body.to_string());
            }
        }

        builder
            .build()
            .map_err(|e| AppError::Custom(format!("build request: {e}")))
    }

    fn build_file_put_request(
        &self,
        url: &str,
        options: &HashMap<String, Value>,
    ) -> Result<reqwest::Request, AppError> {
        let file_data = options
            .get("fileData")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Custom("missing fileData".into()))?;
        let file_mime = options
            .get("fileMIME")
            .and_then(|v| v.as_str())
            .unwrap_or("application/octet-stream");

        let bytes = B64.decode(file_data).map_err(|e| AppError::Custom(format!("bad base64: {e}")))?;

        let mut builder = self
            .client
            .put(url)
            .header(CONTENT_TYPE, file_mime)
            .body(bytes.clone());

        if let Some(md5) = options.get("fileMD5").and_then(|v| v.as_str()) {
            if let Ok(md5_bytes) = B64.decode(md5) {
                builder = builder.header("Content-MD5", B64.encode(&md5_bytes));
            }
        }

        // Apply custom headers
        if let Some(headers) = options.get("headers").and_then(|v| v.as_object()) {
            for (key, val) in headers {
                let val_str = val.as_str().unwrap_or("");
                let key_lower = key.to_lowercase();
                if key_lower == "content-type" {
                    continue;
                }
                if let (Ok(name), Ok(value)) = (
                    HeaderName::from_bytes(key.as_bytes()),
                    HeaderValue::from_str(val_str),
                ) {
                    builder = builder.header(name, value);
                }
            }
        }

        builder
            .build()
            .map_err(|e| AppError::Custom(format!("build PUT: {e}")))
    }
}
