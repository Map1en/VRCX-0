use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use reqwest::header::{HeaderName, HeaderValue, CONTENT_TYPE, REFERER};
use reqwest::multipart::{Form, Part};
use reqwest::{Client, Method, Proxy};
use reqwest_cookie_store::{CookieStore, CookieStoreMutex, RawCookie};
use serde_json::Value;

use crate::domain::database::DatabaseService;
use crate::domain::storage::StorageService;
use crate::error::AppError;

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
        let proxy_url = storage.get("VRCX-0_ProxyServer").filter(|s| !s.is_empty());

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
        store.save_incl_expired_and_nonpersistent_json(&mut json).ok()?;
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
                    .insert_raw(
                        &RawCookie::parse(&cookie_str).unwrap(),
                        &url,
                    )
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
        let resized = resize_image_to_fit_limits_bytes(image_data, false)?;

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
        let resized = resize_image_to_fit_limits_bytes(image_data, matching_dimensions)?;

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
            image_data = crop_print_base64(&image_data)?;
        }

        let resized = resize_print_image_bytes(&image_data)?;
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

fn resize_image_to_fit_limits_bytes(
    base64data: &str,
    matching_dimensions: bool,
) -> Result<Vec<u8>, AppError> {
    resize_image_to_limits(base64data, matching_dimensions, 2000, 2000, 10_000_000)
}

fn resize_image_to_limits(
    base64data: &str,
    matching_dimensions: bool,
    max_width: u32,
    max_height: u32,
    max_size: usize,
) -> Result<Vec<u8>, AppError> {
    let raw = B64
        .decode(base64data)
        .map_err(|e| AppError::Custom(format!("base64 decode: {e}")))?;
    let format = image::guess_format(&raw).ok();
    let mut img =
        image::load_from_memory(&raw).map_err(|e| AppError::Custom(format!("load image: {e}")))?;

    if (!matching_dimensions || img.width() == img.height())
        && matches!(format, Some(image::ImageFormat::Png))
        && raw.len() < max_size
        && img.width() <= max_width
        && img.height() <= max_height
    {
        return Ok(raw);
    }

    if img.width() > max_width {
        let factor = img.width() as f64 / max_width as f64;
        let new_height = (img.height() as f64 / factor).round() as u32;
        img = img.resize_exact(max_width, new_height, image::imageops::FilterType::Lanczos3);
    }
    if img.height() > max_height {
        let factor = img.height() as f64 / max_height as f64;
        let new_width = (img.width() as f64 / factor).round() as u32;
        img = img.resize_exact(new_width, max_height, image::imageops::FilterType::Lanczos3);
    }
    if matching_dimensions && img.width() != img.height() {
        let new_size = img.width().max(img.height());
        let x = (new_size - img.width()) / 2;
        let y = (new_size - img.height()) / 2;
        let rgba = img.to_rgba8();
        let mut padded = image::RgbaImage::new(new_size, new_size);
        image::imageops::overlay(&mut padded, &rgba, i64::from(x), i64::from(y));
        img = image::DynamicImage::ImageRgba8(padded);
    }

    let mut output = encode_png(&img)?;
    for _ in 0..250 {
        if output.len() < max_size {
            break;
        }
        let (w, h) = (img.width(), img.height());
        let (new_w, new_h) = if w > h {
            let new_w = w.saturating_sub(25);
            let new_h = (h as f64 / (w as f64 / new_w as f64)).round() as u32;
            (new_w, new_h)
        } else {
            let new_h = h.saturating_sub(25);
            let new_w = (w as f64 / (h as f64 / new_h as f64)).round() as u32;
            (new_w, new_h)
        };
        img = img.resize_exact(
            new_w.max(1),
            new_h.max(1),
            image::imageops::FilterType::Lanczos3,
        );
        output = encode_png(&img)?;
    }

    if output.len() >= max_size {
        return Err(AppError::Custom(
            "Failed to get image into target filesize.".into(),
        ));
    }

    Ok(output)
}

fn resize_print_image_bytes(base64data: &str) -> Result<Vec<u8>, AppError> {
    let input = resize_image_to_limits(base64data, false, 1920, 1080, 10_000_000)?;
    let mut img = image::load_from_memory(&input)
        .map_err(|e| AppError::Custom(format!("load print image: {e}")))?;

    if img.width() < 1920 || img.height() < 1080 {
        let mut new_width = img.width();
        let mut new_height = img.height();
        if img.width() < 1920 {
            new_width = 1920;
            new_height =
                (img.height() as f64 / (img.width() as f64 / new_width as f64)).round() as u32;
        }
        if img.height() < 1080 {
            new_height = 1080;
            new_width =
                (img.width() as f64 / (img.height() as f64 / new_height as f64)).round() as u32;
        }

        let resized =
            img.resize_exact(new_width, new_height, image::imageops::FilterType::Lanczos3);
        let mut canvas =
            image::RgbaImage::from_pixel(1920, 1080, image::Rgba([255, 255, 255, 255]));
        let x = i64::from((1920 - new_width) / 2);
        let y = i64::from((1080 - new_height) / 2);
        image::imageops::overlay(&mut canvas, &resized.to_rgba8(), x, y);
        img = image::DynamicImage::ImageRgba8(canvas);
    }

    let mut bordered = image::RgbaImage::from_pixel(2048, 1440, image::Rgba([255, 255, 255, 255]));
    image::imageops::overlay(&mut bordered, &img.to_rgba8(), 64, 69);
    encode_png(&image::DynamicImage::ImageRgba8(bordered))
}

fn crop_print_base64(base64data: &str) -> Result<String, AppError> {
    let raw = B64
        .decode(base64data)
        .map_err(|e| AppError::Custom(format!("base64 decode: {e}")))?;
    let img =
        image::load_from_memory(&raw).map_err(|e| AppError::Custom(format!("load image: {e}")))?;
    if img.width() != 2048 || img.height() != 1440 {
        return Ok(base64data.to_string());
    }
    let cropped = img.crop_imm(64, 69, 1920, 1080);
    Ok(B64.encode(encode_png(&cropped)?))
}

fn encode_png(img: &image::DynamicImage) -> Result<Vec<u8>, AppError> {
    let mut buf = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buf);
    img.write_with_encoder(encoder)
        .map_err(|e| AppError::Custom(format!("png encode: {e}")))?;
    Ok(buf)
}
