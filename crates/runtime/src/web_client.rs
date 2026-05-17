use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use reqwest_cookie_store::CookieStoreMutex;
use serde_json::Value;
use vrcx_0_store::cookies;
use vrcx_0_store::database::DatabaseService;
use vrcx_0_store::storage::StorageService;
use vrcx_0_vrchat::web_client as transport;

use crate::Result;

pub struct WebClient {
    inner: transport::WebClient,
    last_saved_cookies: Mutex<Option<String>>,
}

impl WebClient {
    pub fn new(storage: &StorageService, db: &DatabaseService) -> Result<Self> {
        let proxy_url = crate::proxy::load_proxy_url(storage);
        let persisted_cookies = cookies::get_default_cookies(db)?;
        let inner = transport::WebClient::new(proxy_url, persisted_cookies.as_deref())?;
        Ok(Self {
            inner,
            last_saved_cookies: Mutex::new(persisted_cookies),
        })
    }

    pub fn save_cookies(&self, db: &DatabaseService) {
        let b64 = self.inner.get_cookies();
        let mut last_saved = self.last_saved_cookies.lock().unwrap();
        if last_saved.as_ref() == Some(&b64) {
            return;
        }
        if let Err(error) = cookies::save_default_cookies(db, &b64) {
            tracing::warn!("failed to persist cookies: {error}");
            return;
        }
        *last_saved = Some(b64);
    }

    pub fn cookie_jar(&self) -> Arc<CookieStoreMutex> {
        self.inner.cookie_jar()
    }

    pub fn proxy_url(&self) -> Option<&str> {
        self.inner.proxy_url()
    }

    pub fn clear_cookies(&self) {
        self.inner.clear_cookies();
    }

    pub fn get_cookies(&self) -> String {
        self.inner.get_cookies()
    }

    pub fn set_cookies(&self, b64: &str) {
        self.inner.set_cookies(b64);
    }

    pub async fn execute(&self, options: HashMap<String, Value>) -> Result<(i32, String)> {
        Ok(self.inner.execute(options).await?)
    }
}
