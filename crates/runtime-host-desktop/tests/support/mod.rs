#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use vrcx_0_application_core::{
    ConfigStore, FileCache, MemoryConfigStore, MemoryFileCachePort, MemoryWorldCachePort,
    RuntimeAuthScope, RuntimeEventBus, WorldCache,
};
use vrcx_0_outbound_adapters::LocalConfigStore;
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_runtime_host_desktop::feed_logger::DesktopFeedLoggerRuntime;

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
    pub config: Arc<dyn ConfigStore>,
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
    let storage = Arc::new(StorageService::new(&dir.join("storage.json")).unwrap());
    let config: Arc<dyn ConfigStore> = Arc::new(LocalConfigStore::new(Arc::clone(&db), storage));
    if let Some(settings) = settings {
        config.set_string("feedLogger", settings).unwrap();
    }
    let event_bus = RuntimeEventBus::new();
    let auth_scope = RuntimeAuthScope::new();
    let runtime = DesktopFeedLoggerRuntime::new(
        Arc::clone(&db),
        Arc::clone(&config),
        Arc::new(WorldCache::new(MemoryWorldCachePort::default())),
        FileCache::new(MemoryFileCachePort::default()),
        event_bus.clone(),
        auth_scope.clone(),
        Arc::new(MemoryConfigStore::default()),
    );
    FeedLoggerDesktop {
        dir: TestDir(dir),
        db,
        config,
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
