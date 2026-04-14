use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use sha2::{Digest, Sha256};

const UPDATE_PROGRESS_IDLE: i32 = 0;
const UPDATE_PROGRESS_ERROR: i32 = -1;
// IPC progress contract: 0..=100 is visible download percent, 101 means ready to install.
const UPDATE_PROGRESS_READY: i32 = 101;

pub struct UpdateManager {
    app_data: PathBuf,
    progress: Arc<AtomicI32>,
    cancel: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
    finalize_lock: Arc<Mutex<()>>,
    proxy_url: Option<String>,
}

impl UpdateManager {
    pub fn new(app_data: PathBuf, proxy_url: Option<&str>) -> Self {
        Self {
            app_data,
            progress: Arc::new(AtomicI32::new(0)),
            cancel: Arc::new(AtomicBool::new(false)),
            generation: Arc::new(AtomicU64::new(0)),
            finalize_lock: Arc::new(Mutex::new(())),
            proxy_url: proxy_url.map(|s| s.to_string()),
        }
    }

    pub fn check_and_install_update(&self) {
        let update_exe = self.app_data.join("update.exe");
        let setup_exe = self.app_data.join("VRCX-0_Setup.exe");
        let temp_download = self.app_data.join("tempDownload");

        let mut sys = sysinfo::System::new();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        for proc in sys.processes().values() {
            if proc.name().to_string_lossy().starts_with("VRCX-0_Setup") {
                std::process::exit(0);
            }
        }

        let _ = std::fs::remove_file(&temp_download);
        if let Ok(entries) = std::fs::read_dir(&self.app_data) {
            for entry in entries.flatten() {
                let path = entry.path();
                let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
                if file_name.starts_with("tempDownload-") {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
        let _ = std::fs::remove_file(&setup_exe);

        if !update_exe.exists() {
            return;
        }

        if let Err(e) = std::fs::rename(&update_exe, &setup_exe) {
            tracing::error!("Failed to rename update.exe: {e}");
            return;
        }

        match std::process::Command::new(&setup_exe)
            .current_dir(&self.app_data)
            .spawn()
        {
            Ok(_) => std::process::exit(0),
            Err(e) => {
                tracing::error!("Failed to launch installer: {e}");
            }
        }
    }

    pub fn start_download(&self, file_url: String, hash_string: String, download_size: i32) {
        let app_data = self.app_data.clone();
        let progress = self.progress.clone();
        let cancel = self.cancel.clone();
        let generation_state = self.generation.clone();
        let finalize_lock = self.finalize_lock.clone();
        let proxy_url = self.proxy_url.clone();
        let generation = {
            let _guard = self.finalize_lock.lock().unwrap_or_else(|e| e.into_inner());
            let generation = generation_state.fetch_add(1, Ordering::SeqCst) + 1;
            progress.store(UPDATE_PROGRESS_IDLE, Ordering::Relaxed);
            cancel.store(false, Ordering::Relaxed);
            generation
        };

        tokio::spawn(async move {
            if let Err(e) = do_download(
                &app_data,
                &file_url,
                &hash_string,
                download_size,
                &progress,
                &cancel,
                &generation_state,
                generation,
                &finalize_lock,
                proxy_url.as_deref(),
            )
            .await
            {
                if generation_state.load(Ordering::SeqCst) == generation {
                    tracing::error!("Update download error: {e}");
                    progress.store(UPDATE_PROGRESS_ERROR, Ordering::Relaxed);
                } else {
                    tracing::debug!("Superseded update download stopped: {e}");
                }
            }
        });
    }

    pub fn cancel_download(&self) {
        self.cancel.store(true, Ordering::Relaxed);
        self.progress.store(UPDATE_PROGRESS_IDLE, Ordering::Relaxed);

        let temp = self.app_data.join("tempDownload");
        let _ = std::fs::remove_file(&temp);
        let temp = self
            .app_data
            .join(format!("tempDownload-{}", self.generation.load(Ordering::SeqCst)));
        let _ = std::fs::remove_file(&temp);
    }

    pub fn check_progress(&self) -> i32 {
        self.progress.load(Ordering::Relaxed)
    }
}

async fn do_download(
    app_data: &std::path::Path,
    file_url: &str,
    hash_string: &str,
    download_size: i32,
    progress: &AtomicI32,
    cancel: &AtomicBool,
    generation_state: &AtomicU64,
    generation: u64,
    finalize_lock: &Mutex<()>,
    proxy_url: Option<&str>,
) -> Result<(), String> {
    let temp_path = app_data.join(format!("tempDownload-{generation}"));
    let update_path = app_data.join("update.exe");

    let _ = std::fs::remove_file(&temp_path);

    let mut builder = reqwest::Client::builder().user_agent("VRCX-0");

    if let Some(proxy) = proxy_url {
        builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|e| format!("proxy: {e}"))?);
    }

    let client = builder.build().map_err(|e| format!("http client: {e}"))?;

    let response = client
        .get(file_url)
        .send()
        .await
        .map_err(|e| format!("download request: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("download status: {}", response.status()));
    }

    let content_length = response.content_length();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("download read: {e}"))?;

    if cancel.load(Ordering::Relaxed) || generation_state.load(Ordering::SeqCst) != generation {
        return Err("cancelled".into());
    }

    let total = content_length.unwrap_or(bytes.len() as u64);
    let chunk_size = 8192usize;
    let mut written = 0usize;

    let mut file = std::fs::File::create(&temp_path).map_err(|e| format!("create temp: {e}"))?;

    for chunk in bytes.chunks(chunk_size) {
        if cancel.load(Ordering::Relaxed) || generation_state.load(Ordering::SeqCst) != generation {
            drop(file);
            let _ = std::fs::remove_file(&temp_path);
            return Err("cancelled".into());
        }

        use std::io::Write;
        file.write_all(chunk).map_err(|e| format!("write: {e}"))?;

        written += chunk.len();
        let pct = ((written as f64 / total as f64) * 100.0).round() as i32;
        if generation_state.load(Ordering::SeqCst) == generation {
            progress.store(pct.min(100), Ordering::Relaxed);
        }
    }

    drop(file);

    let actual_size = std::fs::metadata(&temp_path)
        .map_err(|e| format!("stat temp: {e}"))?
        .len();

    if download_size > 0 && actual_size != download_size as u64 {
        let _ = std::fs::remove_file(&temp_path);
        return Err("Downloaded file size does not match expected size".into());
    }

    if !hash_string.is_empty() {
        let file_data = std::fs::read(&temp_path).map_err(|e| format!("read for hash: {e}"))?;
        let mut hasher = Sha256::new();
        hasher.update(&file_data);
        let result = hasher.finalize();
        let file_hash = hex::encode(result);

        if !file_hash.eq_ignore_ascii_case(hash_string) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!(
                "Hash check failed file:{file_hash} web:{hash_string}"
            ));
        }
    }

    {
        let _guard = finalize_lock.lock().map_err(|e| format!("update finalize lock: {e}"))?;
        if cancel.load(Ordering::Relaxed) || generation_state.load(Ordering::SeqCst) != generation {
            let _ = std::fs::remove_file(&temp_path);
            return Err("cancelled".into());
        }

        let _ = std::fs::remove_file(&update_path);
        std::fs::rename(&temp_path, &update_path).map_err(|e| format!("move to update.exe: {e}"))?;

        if generation_state.load(Ordering::SeqCst) == generation {
            progress.store(UPDATE_PROGRESS_READY, Ordering::Relaxed);
        }
    }
    Ok(())
}
