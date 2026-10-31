#![allow(dead_code)]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use vrcx_0_application::auth::{AuthCredentialStore, SealedAuthSecret};
use vrcx_0_application_core::{
    FileCache, MemoryFileCachePort, MemoryWorldCachePort, NoopWebClientPort, Result,
    RuntimeAuthScope, RuntimeEventBus, WebClient, WorldCache,
};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_runtime_host_desktop::feed_logger::DesktopFeedLoggerRuntime;

#[derive(Default)]
pub struct MemoryCredentials {
    values: Mutex<HashMap<String, String>>,
}

impl AuthCredentialStore for MemoryCredentials {
    fn get_raw(&self, key: &str) -> Result<Option<String>> {
        Ok(self.values.lock().unwrap().get(key).cloned())
    }
    fn get_string(&self, key: &str, default_value: &str) -> Result<String> {
        Ok(self
            .get_raw(key)?
            .unwrap_or_else(|| default_value.to_string()))
    }
    fn get_bool(&self, key: &str, default_value: bool) -> Result<bool> {
        Ok(self
            .get_raw(key)?
            .and_then(|value| value.parse().ok())
            .unwrap_or(default_value))
    }
    fn set_string(&self, key: &str, value: &str) -> Result<()> {
        self.values
            .lock()
            .unwrap()
            .insert(key.to_string(), value.to_string());
        Ok(())
    }
    fn remove(&self, key: &str) -> Result<()> {
        self.values.lock().unwrap().remove(key);
        Ok(())
    }
    fn is_encrypting_writes(&self) -> bool {
        false
    }
    fn is_secret_store_initialized(&self) -> bool {
        false
    }
    fn open_secret(&self, stored: &str) -> Option<String> {
        Some(stored.to_string())
    }
    fn seal_secret(&self, _previous: Option<&str>, plaintext: &str) -> SealedAuthSecret {
        SealedAuthSecret {
            stored: plaintext.to_string(),
            encrypted: false,
        }
    }
    fn is_sealed_secret(&self, _value: &str) -> bool {
        false
    }
    fn is_other_machine_secret(&self, _value: &str) -> bool {
        false
    }
    fn is_own_secret_behind_other_machines(&self, _value: &str) -> bool {
        false
    }
}

pub struct TestDir(PathBuf);

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub const SAVED_RECORDER: &str = r#"{"address":"http://127.0.0.1:8787","password":"password123"}"#;

pub struct FeedLoggerDesktop {
    pub dir: TestDir,
    pub db: Arc<DatabaseService>,
    pub event_bus: RuntimeEventBus,
    pub auth_scope: RuntimeAuthScope,
    pub runtime: DesktopFeedLoggerRuntime,
}

static NEXT_TEST_DIR: AtomicUsize = AtomicUsize::new(0);

pub fn feed_logger_desktop(settings: Option<&str>) -> FeedLoggerDesktop {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "vrcx-0-feed-logger-{}-{}-{nonce}",
        std::process::id(),
        NEXT_TEST_DIR.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let db = Arc::new(DatabaseService::new(&dir.join("VRCX-0.sqlite3")).unwrap());
    if let Some(settings) = settings {
        ConfigRepository::new(Arc::clone(&db))
            .set_raw("feedLogger", settings)
            .unwrap();
    }
    let event_bus = RuntimeEventBus::new();
    let auth_scope = RuntimeAuthScope::new();
    let runtime = DesktopFeedLoggerRuntime::new(
        Arc::clone(&db),
        Arc::new(WorldCache::new(MemoryWorldCachePort::default())),
        FileCache::new(MemoryFileCachePort::default()),
        Arc::new(WebClient::new(NoopWebClientPort)),
        event_bus.clone(),
        auth_scope.clone(),
        Arc::new(MemoryCredentials::default()),
    );
    FeedLoggerDesktop {
        dir: TestDir(dir),
        db,
        event_bus,
        auth_scope,
        runtime,
    }
}

pub fn desktop() -> (TestDir, DesktopFeedLoggerRuntime) {
    desktop_with_saved_settings(None)
}

pub fn desktop_with_saved_settings(settings: Option<&str>) -> (TestDir, DesktopFeedLoggerRuntime) {
    let desktop = feed_logger_desktop(settings);
    (desktop.dir, desktop.runtime)
}
