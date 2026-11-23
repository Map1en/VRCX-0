use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, RwLock};
use std::thread::JoinHandle;
use std::time::Duration;

use vrcx_0_platform::path_utils::replace_file_atomically;

use crate::Error;

pub struct StorageService {
    data: Arc<RwLock<HashMap<String, String>>>,
    file_path: PathBuf,
    dirty_tx: Option<mpsc::Sender<()>>,
    saver_handle: Option<JoinHandle<()>>,
}

impl StorageService {
    pub fn new(file_path: &Path) -> Result<Self, Error> {
        let data = Arc::new(RwLock::new(load(file_path)?));
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
        write_atomically(&self.data, &self.file_path)
    }
}

fn load(file_path: &Path) -> Result<HashMap<String, String>, Error> {
    if !file_path.exists() {
        return Ok(HashMap::new());
    }
    let content = std::fs::read_to_string(file_path)?;
    match serde_json::from_str(&content) {
        Ok(data) => Ok(data),
        Err(error) => {
            let corrupt_path = sibling_path(file_path, "corrupt");
            replace_file_atomically(file_path, &corrupt_path)?;
            tracing::warn!(
                "StorageService: {} is not valid JSON ({error}); kept it as {} and started empty",
                file_path.display(),
                corrupt_path.display()
            );
            Ok(HashMap::new())
        }
    }
}

fn sibling_path(file_path: &Path, suffix: &str) -> PathBuf {
    let mut name = file_path.as_os_str().to_owned();
    name.push(".");
    name.push(suffix);
    PathBuf::from(name)
}

fn write_atomically(data: &RwLock<HashMap<String, String>>, path: &Path) -> Result<(), Error> {
    let json = serde_json::to_string_pretty(&*data.read().unwrap())?;
    let temp_path = sibling_path(path, "tmp");
    std::fs::write(&temp_path, json)?;
    if let Err(error) = replace_file_atomically(&temp_path, path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error.into());
    }
    Ok(())
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

fn do_save(data: &RwLock<HashMap<String, String>>, path: &Path) {
    if let Err(e) = write_atomically(data, path) {
        tracing::warn!("StorageService: failed to write: {e}");
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
    fn starts_clean_in_a_restored_profile_without_a_config_file() -> Result<(), Error> {
        let dir = TestDir::new("storage-restored-profile");
        std::fs::write(dir.path.join("VRCX-0.sqlite3"), b"restored database")?;
        let config_path = dir.path.join("VRCX-0.json");

        let storage = StorageService::new(&config_path)?;
        assert_eq!(storage.get("VRCX_ProfileBackupAutoEnabled"), None);
        assert!(storage.get_all().is_empty());

        storage.set("VRCX_ProfileBackupLastAutoAt".into(), "".into());
        storage.save()?;
        drop(storage);

        let reloaded = StorageService::new(&config_path)?;
        assert_eq!(
            reloaded.get("VRCX_ProfileBackupLastAutoAt").as_deref(),
            Some("")
        );
        Ok(())
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

    #[test]
    fn keeps_a_corrupt_config_file_aside_instead_of_overwriting_it() -> Result<(), Error> {
        let dir = TestDir::new("storage-corrupt");
        let config_path = dir.path.join("VRCX-0.json");
        let truncated = br#"{"VRCX_CloseToTray":"true","VRCX_Prox"#;
        std::fs::write(&config_path, truncated)?;

        let storage = StorageService::new(&config_path)?;
        assert!(storage.get_all().is_empty());
        storage.set("VRCX_StartAsMinimizedState".into(), "false".into());
        storage.save()?;
        drop(storage);

        assert_eq!(
            std::fs::read(dir.path.join("VRCX-0.json.corrupt"))?,
            truncated
        );
        let reloaded = StorageService::new(&config_path)?;
        assert_eq!(
            reloaded.get("VRCX_StartAsMinimizedState").as_deref(),
            Some("false")
        );
        Ok(())
    }

    #[test]
    fn saving_replaces_the_file_without_leaving_a_temporary_copy() -> Result<(), Error> {
        let dir = TestDir::new("storage-atomic");
        let config_path = dir.path.join("VRCX-0.json");
        std::fs::write(&config_path, r#"{"VRCX_CloseToTray":"true"}"#)?;

        let storage = StorageService::new(&config_path)?;
        storage.set("VRCX_CloseToTray".into(), "false".into());
        storage.save()?;
        drop(storage);

        let names = std::fs::read_dir(&dir.path)?
            .map(|entry| entry.map(|entry| entry.file_name().to_string_lossy().into_owned()))
            .collect::<Result<Vec<_>, _>>()?;
        assert_eq!(names, vec!["VRCX-0.json".to_string()]);
        let saved: HashMap<String, String> =
            serde_json::from_str(&std::fs::read_to_string(&config_path)?)?;
        assert_eq!(
            saved.get("VRCX_CloseToTray").map(String::as_str),
            Some("false")
        );
        Ok(())
    }
}
