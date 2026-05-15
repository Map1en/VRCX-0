use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use reqwest::header::{HeaderName, HeaderValue, CONTENT_TYPE, REFERER};
use reqwest::multipart::{Form, Part};
use reqwest::{Client, Method, Proxy};
use reqwest_cookie_store::{CookieStore, CookieStoreMutex, RawCookie};
use serde_json::Value;

use crate::domain::image_processing;
use crate::domain::proxy::load_proxy_url;
use crate::domain::storage::StorageService;
use crate::error::AppError;
use vrcx_0_persistence::database::DatabaseService;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "PascalCase")]
struct CookieEntry {
    name: String,
    value: String,
    domain: String,
    path: String,
}

pub struct WebClient {
    client: Client,
    jar: Arc<CookieStoreMutex>,
    last_saved_cookies: Mutex<Option<String>>,
    proxy_url: Option<String>,
}

impl WebClient {
    pub fn new(storage: &StorageService, db: &DatabaseService) -> Result<Self, AppError> {
        let proxy_url = load_proxy_url(storage);

        let cookie_store = reqwest_cookie_store::CookieStore::default();
        let jar = Arc::new(CookieStoreMutex::new(cookie_store));

        let mut builder = Client::builder()
            .cookie_provider(jar.clone())
            .user_agent("VRCX-0")
            .no_proxy()
            .gzip(true)
            .brotli(true)
            .deflate(true)
            .pool_max_idle_per_host(10)
            .pool_idle_timeout(std::time::Duration::from_secs(300));

        if let Some(ref url) = proxy_url {
            builder = builder
                .proxy(Proxy::all(url).map_err(|e| AppError::Custom(format!("bad proxy: {e}")))?);
        }

        let client = builder
            .build()
            .map_err(|e| AppError::Custom(format!("http client: {e}")))?;

        let wc = Self {
            client,
            jar,
            last_saved_cookies: Mutex::new(None),
            proxy_url: proxy_url.clone(),
        };

        wc.load_cookies(db);

        Ok(wc)
    }

    fn load_cookies(&self, db: &DatabaseService) {
        let _ = db.execute_non_query(
            "CREATE TABLE IF NOT EXISTS `cookies` (`key` TEXT PRIMARY KEY, `value` TEXT)",
            &HashMap::new(),
        );

        let rows = db
            .execute("SELECT `value` FROM `cookies` WHERE `key` = @key", &{
                let mut m = HashMap::new();
                m.insert("@key".to_string(), Value::String("default".into()));
                m
            })
            .unwrap_or_default();

        if let Some(b64) = rows
            .first()
            .and_then(|r| r.first())
            .and_then(|v| v.as_str())
        {
            if self.restore_cookies(b64) {
                let mut last_saved = self.last_saved_cookies.lock().unwrap();
                *last_saved = Some(b64.to_string());
            }
        }
    }

    pub fn save_cookies(&self, db: &DatabaseService) {
        if let Some(b64) = self.serialize_cookie_store() {
            let mut last_saved = self.last_saved_cookies.lock().unwrap();
            if last_saved.as_ref() == Some(&b64) {
                return;
            }
            let _ = db.execute_non_query(
                "INSERT OR REPLACE INTO `cookies` (`key`, `value`) VALUES (@key, @value)",
                &{
                    let mut m = HashMap::new();
                    m.insert("@key".to_string(), Value::String("default".into()));
                    m.insert("@value".to_string(), Value::String(b64.clone()));
                    m
                },
            );
            *last_saved = Some(b64);
        }
    }

    fn restore_cookies(&self, b64: &str) -> bool {
        if let Some(store) = Self::deserialize_cookie_store(b64) {
            let mut jar = self.jar.lock().unwrap();
            *jar = store;
            return true;
        }
        if let Some(entries) = Self::deserialize_legacy_cookie_entries(b64) {
            self.apply_cookie_entries(&entries);
            return true;
        }
        false
    }

    fn serialize_cookie_store(&self) -> Option<String> {
        let store = self.jar.lock().unwrap();
        let mut json = Vec::new();
        #[allow(deprecated)]
        store
            .save_incl_expired_and_nonpersistent_json(&mut json)
            .ok()?;
        Some(B64.encode(json))
    }

    fn deserialize_cookie_store(b64: &str) -> Option<CookieStore> {
        let bytes = B64.decode(b64).ok()?;
        #[allow(deprecated)]
        CookieStore::load_json_all(Cursor::new(bytes)).ok()
    }

    fn deserialize_legacy_cookie_entries(b64: &str) -> Option<Vec<CookieEntry>> {
        let bytes = B64.decode(b64).ok()?;
        serde_json::from_slice::<Vec<CookieEntry>>(&bytes).ok()
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
                store
                    .insert_raw(&RawCookie::parse(&cookie_str).unwrap(), &url)
                    .ok();
            }
        }
    }

    pub fn cookie_jar(&self) -> Arc<CookieStoreMutex> {
        self.jar.clone()
    }

    pub fn proxy_url(&self) -> Option<&str> {
        self.proxy_url.as_deref()
    }

    pub fn clear_cookies(&self) {
        let mut store = self.jar.lock().unwrap();
        store.clear();
    }

    pub fn get_cookies(&self) -> String {
        self.serialize_cookie_store().unwrap_or_default()
    }

    pub fn set_cookies(&self, b64: &str) {
        self.restore_cookies(b64);
    }

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
            Err(e) => Ok((-1, e.to_string())),
        }
    }

    async fn do_execute(
        &self,
        url: &str,
        options: &HashMap<String, Value>,
    ) -> Result<(i32, String), AppError> {
        let is_file_put = options.contains_key("uploadFilePUT");
        let is_image_legacy = options.contains_key("uploadImageLegacy");
        let is_image_upload = options.contains_key("uploadImage");
        let is_print_upload = options.contains_key("uploadImagePrint");

        let request = if is_file_put {
            self.build_file_put_request(url, options)?
        } else if is_image_legacy {
            self.build_legacy_image_upload_request(url, options)?
        } else if is_image_upload {
            self.build_image_upload_request(url, options)?
        } else if is_print_upload {
            self.build_print_image_upload_request(url, options)?
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

        if method != Method::GET {
            if let Some(body) = options.get("body").and_then(|v| v.as_str()) {
                let ct = content_type_override
                    .as_deref()
                    .unwrap_or("application/json; charset=utf-8");
                builder = builder.header(CONTENT_TYPE, ct).body(body.to_string());
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

        let bytes = B64
            .decode(file_data)
            .map_err(|e| AppError::Custom(format!("bad base64: {e}")))?;

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

    fn build_legacy_image_upload_request(
        &self,
        url: &str,
        options: &HashMap<String, Value>,
    ) -> Result<reqwest::Request, AppError> {
        let image_data = options
            .get("imageData")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Custom("missing imageData".into()))?;
        let resized = image_processing::resize_upload_image_bytes(image_data, false)?;

        let mut form = Form::new().part(
            "image",
            Part::bytes(resized)
                .file_name("image.png")
                .mime_str("image/png")
                .map_err(|e| AppError::Custom(format!("image mime: {e}")))?,
        );

        if let Some(post_data) = options.get("postData").and_then(|v| v.as_str()) {
            form = form.text("data", post_data.to_string());
        }

        self.client
            .post(url)
            .multipart(form)
            .build()
            .map_err(|e| AppError::Custom(format!("build legacy upload: {e}")))
    }

    fn build_image_upload_request(
        &self,
        url: &str,
        options: &HashMap<String, Value>,
    ) -> Result<reqwest::Request, AppError> {
        let image_data = options
            .get("imageData")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Custom("missing imageData".into()))?;
        let matching_dimensions = options
            .get("matchingDimensions")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let resized = image_processing::resize_upload_image_bytes(image_data, matching_dimensions)?;

        let mut form = Form::new().part(
            "file",
            Part::bytes(resized)
                .file_name("blob")
                .mime_str("image/png")
                .map_err(|e| AppError::Custom(format!("image mime: {e}")))?,
        );

        if let Some(post_data) = options.get("postData").and_then(|v| v.as_str()) {
            let json = serde_json::from_str::<serde_json::Map<String, Value>>(post_data)
                .map_err(|e| AppError::Custom(format!("bad postData: {e}")))?;
            for (key, value) in json {
                let text = match value {
                    Value::String(s) => s,
                    other => other.to_string(),
                };
                form = form.text(key, text);
            }
        }

        self.client
            .post(url)
            .multipart(form)
            .build()
            .map_err(|e| AppError::Custom(format!("build image upload: {e}")))
    }

    fn build_print_image_upload_request(
        &self,
        url: &str,
        options: &HashMap<String, Value>,
    ) -> Result<reqwest::Request, AppError> {
        let mut image_data = options
            .get("imageData")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Custom("missing imageData".into()))?
            .to_string();

        if options
            .get("cropWhiteBorder")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            image_data = image_processing::crop_print_base64(&image_data)?;
        }

        let resized = image_processing::resize_print_image_bytes(&image_data)?;
        let mut form = Form::new().part(
            "image",
            Part::bytes(resized)
                .file_name("image")
                .mime_str("image/png")
                .map_err(|e| AppError::Custom(format!("print image mime: {e}")))?,
        );

        if let Some(post_data) = options.get("postData").and_then(|v| v.as_str()) {
            let json = serde_json::from_str::<HashMap<String, String>>(post_data)
                .map_err(|e| AppError::Custom(format!("bad postData: {e}")))?;
            for (key, value) in json {
                form = form.text(key, value);
            }
        }

        self.client
            .post(url)
            .multipart(form)
            .build()
            .map_err(|e| AppError::Custom(format!("build print upload: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::storage::StorageService;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread::JoinHandle;
    use std::time::{Duration, Instant};
    use vrcx_0_persistence::database::DatabaseService;

    struct TestDir {
        path: std::path::PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn spawn_text_server(body: &'static [u8]) -> (String, JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{addr}/api/1");
        let handle = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let mut buffer = [0u8; 1024];
                        let _ = stream.read(&mut buffer);
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        let _ = stream.write_all(response.as_bytes());
                        let _ = stream.write_all(body);
                        break;
                    }
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        (url, handle)
    }

    #[test]
    fn execute_returns_success_status_and_body_for_daily_get() -> Result<(), AppError> {
        let dir = TestDir::new("web-client-daily");
        let storage = StorageService::new(&dir.path.join("VRCX-0.json"))?;
        let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
        let web = WebClient::new(&storage, &db)?;
        let (url, server) = spawn_text_server(br#"{"ok":true}"#);

        let mut options = HashMap::new();
        options.insert("url".to_string(), serde_json::json!(url));
        let result = tauri::async_runtime::block_on(web.execute(options));
        server.join().unwrap();

        let (status, body) = result?;
        assert_eq!(status, 200);
        assert_eq!(body, r#"{"ok":true}"#);
        Ok(())
    }
}
