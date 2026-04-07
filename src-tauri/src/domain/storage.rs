use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, RwLock};
use std::time::Duration;

use crate::error::AppError;

pub struct StorageService {
    data: Arc<RwLock<HashMap<String, String>>>,
    #[allow(dead_code)]
    file_path: PathBuf,
    dirty_tx: mpsc::Sender<()>,
}

impl StorageService {
    pub fn new(file_path: &Path) -> Result<Self, AppError> {
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
        std::thread::spawn(move || debounce_saver(dirty_rx, saver_data, saver_path));

        Ok(Self {
            data,
            file_path: file_path.to_path_buf(),
            dirty_tx,
        })
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.data.read().unwrap().get(key).cloned()
    }

    pub fn set(&self, key: String, value: String) {
        self.data.write().unwrap().insert(key, value);
        let _ = self.dirty_tx.send(());
    }

    pub fn remove(&self, key: &str) -> Option<String> {
        let removed = self.data.write().unwrap().remove(key);
        if removed.is_some() {
            let _ = self.dirty_tx.send(());
        }
        removed
    }

    pub fn get_all(&self) -> HashMap<String, String> {
        self.data.read().unwrap().clone()
    }

    #[allow(dead_code)]
    pub fn save(&self) -> Result<(), AppError> {
        let data = self.data.read().unwrap();
        let json = serde_json::to_string_pretty(&*data)?;
        std::fs::write(&self.file_path, json)?;
        Ok(())
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
                tracing::error!("StorageService: failed to write: {e}");
            }
        }
        Err(e) => tracing::error!("StorageService: failed to serialize: {e}"),
    }
}
