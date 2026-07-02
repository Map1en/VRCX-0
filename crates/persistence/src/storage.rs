use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, RwLock};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::Error;

pub struct StorageService {
    data: Arc<RwLock<HashMap<String, String>>>,
    file_path: PathBuf,
    dirty_tx: Option<mpsc::Sender<()>>,
    saver_handle: Option<JoinHandle<()>>,
}

impl StorageService {
    pub fn new(file_path: &Path) -> Result<Self, Error> {
        let data = if file_path.exists() {
            let content = std::fs::read_to_string(file_path)?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            HashMap::new()
        };

        let data = Arc::new(RwLock::new(data));
        let (dirty_tx, dirty_rx) = mpsc::channel::<()>();

        let saver_data = Arc::clone(&data);
        let saver_path = file_path.to_path_buf();
        let saver_handle =
            std::thread::spawn(move || debounce_saver(dirty_rx, saver_data, saver_path));

        Ok(Self {
            data,
            file_path: file_path.to_path_buf(),
            dirty_tx: Some(dirty_tx),
            saver_handle: Some(saver_handle),
        })
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.data.read().unwrap().get(key).cloned()
    }

    pub fn set(&self, key: String, value: String) {
        self.data.write().unwrap().insert(key, value);
        if let Some(dirty_tx) = &self.dirty_tx {
            let _ = dirty_tx.send(());
        }
    }

    pub fn remove(&self, key: &str) -> Option<String> {
        let removed = self.data.write().unwrap().remove(key);
        if removed.is_some() {
            if let Some(dirty_tx) = &self.dirty_tx {
                let _ = dirty_tx.send(());
            }
        }
        removed
    }

    pub fn get_all(&self) -> HashMap<String, String> {
        self.data.read().unwrap().clone()
    }

    pub fn save(&self) -> Result<(), Error> {
        let data = self.data.read().unwrap();
        let json = serde_json::to_string_pretty(&*data)?;
        std::fs::write(&self.file_path, json)?;
        Ok(())
    }
}

impl Drop for StorageService {
    fn drop(&mut self) {
        self.dirty_tx.take();
        if let Some(handle) = self.saver_handle.take() {
            let _ = handle.join();
        }
    }
}

fn debounce_saver(
    rx: mpsc::Receiver<()>,
    data: Arc<RwLock<HashMap<String, String>>>,
    path: PathBuf,
) {
    const DEBOUNCE: Duration = Duration::from_millis(500);
    loop {
        match rx.recv() {
            Ok(()) => {}
            Err(_) => return,
        }
        loop {
            match rx.recv_timeout(DEBOUNCE) {
                Ok(()) => continue,
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    do_save(&data, &path);
                    return;
                }
            }
        }
        do_save(&data, &path);
    }
}

fn do_save(data: &Arc<RwLock<HashMap<String, String>>>, path: &Path) {
    let data = data.read().unwrap();
    match serde_json::to_string_pretty(&*data) {
        Ok(json) => {
            if let Err(e) = std::fs::write(path, json) {
                tracing::warn!("StorageService: failed to write: {e}");
            }
        }
        Err(e) => tracing::error!("StorageService: failed to serialize: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir {
        path: PathBuf,
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

    #[test]
    fn loads_and_flushes_daily_app_settings() -> Result<(), Error> {
        let dir = TestDir::new("storage-daily");
        let config_path = dir.path.join("VRCX-0.json");
        std::fs::write(
            &config_path,
            r#"{"VRCX_CloseToTray":"true","VRCX_ProxyServer":""}"#,
        )?;

        let storage = StorageService::new(&config_path)?;
        assert_eq!(storage.get("VRCX_CloseToTray").as_deref(), Some("true"));
        assert_eq!(storage.get("VRCX_ProxyServer").as_deref(), Some(""));

        storage.set("VRCX_StartAsMinimizedState".into(), "false".into());
        assert_eq!(
            storage
                .get_all()
                .get("VRCX_StartAsMinimizedState")
                .map(String::as_str),
            Some("false")
        );
        assert_eq!(storage.remove("VRCX_ProxyServer").as_deref(), Some(""));
        storage.save()?;
        drop(storage);

        let reloaded = StorageService::new(&config_path)?;
        assert_eq!(
            reloaded.get("VRCX_StartAsMinimizedState").as_deref(),
            Some("false")
        );
        assert_eq!(reloaded.get("VRCX_ProxyServer"), None);
        Ok(())
    }
}
