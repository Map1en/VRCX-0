use std::{path::PathBuf, sync::Arc};

use vrcx_0_application_core::ConfigStore;
use vrcx_0_outbound_adapters::LocalConfigStore;
use vrcx_0_persistence::{storage::StorageService, DatabaseService};

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

pub(crate) fn test_config(name: &str) -> (TestDir, Arc<dyn ConfigStore>) {
    let (dir, config) = test_local_config(name);
    (dir, config)
}

pub(crate) fn test_local_config(name: &str) -> (TestDir, Arc<LocalConfigStore>) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap());
    let storage = Arc::new(StorageService::new(&dir.0.join("storage.json")).unwrap());
    (dir, Arc::new(LocalConfigStore::new(db, storage)))
}
