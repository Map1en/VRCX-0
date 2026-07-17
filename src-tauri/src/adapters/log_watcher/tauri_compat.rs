use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use tauri::AppHandle;

use super::LogWatcher;

pub struct LogWatcherCompatBridge {
    started: AtomicBool,
    stop_requested: Arc<AtomicBool>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl LogWatcherCompatBridge {
    pub fn new() -> Self {
        Self {
            started: AtomicBool::new(false),
            stop_requested: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
        }
    }

    pub fn start(&self, app_handle: AppHandle, log_watcher: LogWatcher) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }

        self.stop_requested.store(false, Ordering::SeqCst);
        let stop_requested = Arc::clone(&self.stop_requested);
        let handle = thread::spawn(move || loop {
            for payload in log_watcher.drain_compat_event_payloads() {
                crate::bootstrap::emit_to_main_window_if_visible(
                    &app_handle,
                    "addGameLogEvent",
                    payload,
                );
            }
            if stop_requested.load(Ordering::SeqCst) {
                break;
            }
            thread::park_timeout(Duration::from_millis(250));
        });

        if let Ok(mut current) = self.handle.lock() {
            *current = Some(handle);
        } else {
            self.stop_requested.store(true, Ordering::SeqCst);
        }
    }

    pub fn stop(&self) {
        self.stop_requested.store(true, Ordering::SeqCst);
        if let Ok(mut current) = self.handle.lock() {
            if let Some(handle) = current.take() {
                handle.thread().unpark();
                let _ = handle.join();
            }
        }
        self.started.store(false, Ordering::SeqCst);
    }
}

impl Default for LogWatcherCompatBridge {
    fn default() -> Self {
        Self::new()
    }
}
