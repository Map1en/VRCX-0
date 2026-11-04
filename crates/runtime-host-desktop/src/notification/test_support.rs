use std::{path::PathBuf, sync::Arc};

use vrcx_0_outbound_adapters::LocalConfigStore;
use vrcx_0_persistence::{config::ConfigRepository, storage::StorageService, DatabaseService};

pub(crate) struct TestDir(PathBuf);

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-notification-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(crate) fn test_config(name: &str) -> (TestDir, ConfigRepository) {
    let (dir, config, _) = test_config_with_store(name);
    (dir, config)
}

pub(crate) fn test_config_with_store(
    name: &str,
) -> (TestDir, ConfigRepository, Arc<LocalConfigStore>) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap());
    let storage = Arc::new(StorageService::new(&dir.0.join("storage.json")).unwrap());
    let config_store = Arc::new(LocalConfigStore::new(Arc::clone(&db), storage));
    (dir, ConfigRepository::new(db), config_store)
}
