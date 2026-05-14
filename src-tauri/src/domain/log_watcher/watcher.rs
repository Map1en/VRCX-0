use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use chrono::{Local, NaiveDateTime, Utc};
use tauri::AppHandle;

use super::context::LogContext;
use super::event::{GameLogEvent, GameLogEventSink};
use super::parser;
use super::queue;
use super::scanner::{scan_current_location_snapshot, LogLocationSnapshot};

const INACTIVE_POLL_KEEPALIVE: Duration = Duration::from_secs(120);
#[derive(Clone)]
pub struct LogWatcher {
    inner: Arc<Inner>,
}

pub(super) struct Inner {
    pub(super) log_list: RwLock<Vec<Vec<String>>>,
    pub(super) event_buffer: Mutex<Vec<GameLogEvent>>,
    pub(super) event_sink: Option<Arc<dyn GameLogEventSink>>,
    pub(super) log_dir: RwLock<Option<PathBuf>>,
    pub(super) till_date: Mutex<Option<NaiveDateTime>>,
    pub(super) active: Mutex<bool>,
    pub(super) reset_flag: Mutex<bool>,
    pub(super) vrc_closed_gracefully: Mutex<bool>,
    pub(super) game_running: Mutex<bool>,
    pub(super) poll_without_process_monitor: Mutex<bool>,
    pub(super) keep_polling_until: Mutex<Option<Instant>>,
}

impl LogWatcher {
    pub fn new(event_sink: Option<Arc<dyn GameLogEventSink>>) -> Self {
        Self {
            inner: Arc::new(Inner {
                log_list: RwLock::new(Vec::new()),
                event_buffer: Mutex::new(Vec::new()),
                event_sink,
                log_dir: RwLock::new(None),
                till_date: Mutex::new(None),
                active: Mutex::new(false),
                reset_flag: Mutex::new(false),
                vrc_closed_gracefully: Mutex::new(false),
                game_running: Mutex::new(false),
                poll_without_process_monitor: Mutex::new(false),
                keep_polling_until: Mutex::new(None),
            }),
        }
    }

    #[cfg(target_os = "windows")]
    pub fn start(&self, log_dir: PathBuf, app_handle: AppHandle) {
        self.start_with_mode(log_dir, app_handle, false);
    }

    #[cfg(target_os = "linux")]
    pub fn start_without_process_monitor(&self, log_dir: PathBuf, app_handle: AppHandle) {
        self.start_with_mode(log_dir, app_handle, true);
    }

    fn start_with_mode(
        &self,
        log_dir: PathBuf,
        app_handle: AppHandle,
        poll_without_process_monitor: bool,
    ) {
        *self.inner.log_dir.write().unwrap() = Some(log_dir.clone());
        *self.inner.poll_without_process_monitor.lock().unwrap() = poll_without_process_monitor;
        *self.inner.keep_polling_until.lock().unwrap() =
            Some(Instant::now() + INACTIVE_POLL_KEEPALIVE);
        let inner = Arc::clone(&self.inner);
        std::thread::spawn(move || thread_loop(inner, log_dir, app_handle));
    }

    pub fn set_date_till(&self, date: &str) {
        if let Ok(dt) = date.parse::<chrono::DateTime<Utc>>() {
            *self.inner.till_date.lock().unwrap() = Some(dt.naive_utc());
        } else if let Ok(dt) = NaiveDateTime::parse_from_str(date, "%Y-%m-%dT%H:%M:%S%.fZ") {
            *self.inner.till_date.lock().unwrap() = Some(dt);
        }
        *self.inner.active.lock().unwrap() = true;
        *self.inner.keep_polling_until.lock().unwrap() =
            Some(Instant::now() + INACTIVE_POLL_KEEPALIVE);
    }

    pub fn reset(&self) {
        *self.inner.reset_flag.lock().unwrap() = true;
        *self.inner.keep_polling_until.lock().unwrap() =
            Some(Instant::now() + INACTIVE_POLL_KEEPALIVE);
    }

    pub fn get(&self) -> Vec<Vec<String>> {
        let mut list = self.inner.log_list.write().unwrap();
        if list.is_empty() {
            return Vec::new();
        }
        let n = list.len().min(1000);
        let items: Vec<Vec<String>> = list.drain(..n).collect();
        items
    }

    pub fn vrc_closed_gracefully(&self) -> bool {
        *self.inner.vrc_closed_gracefully.lock().unwrap()
    }

    pub fn current_location_snapshot(&self) -> Option<LogLocationSnapshot> {
        let log_dir = self.inner.log_dir.read().unwrap().clone()?;
        scan_current_location_snapshot(&log_dir)
    }

    pub fn set_game_running(&self, running: bool) {
        *self.inner.game_running.lock().unwrap() = running;
        if !running {
            *self.inner.keep_polling_until.lock().unwrap() =
                Some(Instant::now() + INACTIVE_POLL_KEEPALIVE);
        }
    }
}

fn thread_loop(inner: Arc<Inner>, log_dir: PathBuf, app_handle: AppHandle) {
    let mut contexts: HashMap<String, LogContext> = HashMap::new();
    let mut first_run = true;

    loop {
        let active = *inner.active.lock().unwrap();

        {
            let mut reset = inner.reset_flag.lock().unwrap();
            if *reset {
                first_run = true;
                *reset = false;
                contexts.clear();
                inner.log_list.write().unwrap().clear();
                inner.event_buffer.lock().unwrap().clear();
            }
        }

        let should_poll = if active {
            let poll_without_process_monitor = *inner.poll_without_process_monitor.lock().unwrap();
            if poll_without_process_monitor {
                true
            } else {
                let game_running = *inner.game_running.lock().unwrap();
                let keep_polling_until = *inner.keep_polling_until.lock().unwrap();
                game_running
                    || keep_polling_until.is_some_and(|deadline| Instant::now() <= deadline)
            }
        } else {
            false
        };

        if should_poll {
            let saw_new_data = update(&inner, &log_dir, &app_handle, &mut contexts, &mut first_run);
            if saw_new_data {
                *inner.keep_polling_until.lock().unwrap() =
                    Some(Instant::now() + INACTIVE_POLL_KEEPALIVE);
            }
        }

        std::thread::sleep(Duration::from_secs(1));
    }
}

fn update(
    inner: &Inner,
    log_dir: &Path,
    app_handle: &AppHandle,
    contexts: &mut HashMap<String, LogContext>,
    first_run: &mut bool,
) -> bool {
    let till_date_utc = inner
        .till_date
        .lock()
        .unwrap()
        .unwrap_or(chrono::DateTime::UNIX_EPOCH.naive_utc());

    let till_date = chrono::TimeZone::from_utc_datetime(&Local, &till_date_utc).naive_local();

    let mut deleted: HashSet<String> = contexts.keys().cloned().collect();

    if !log_dir.exists() {
        *first_run = false;
        return false;
    }

    let mut entries: Vec<_> = fs::read_dir(log_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name().to_string_lossy().starts_with("output_log_")
                && e.file_name().to_string_lossy().ends_with(".txt")
        })
        .collect();

    entries.sort_by_key(|e| e.metadata().and_then(|m| m.created()).ok());

    let mut saw_new_data = false;
    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        if let Ok(last_write) = meta.modified() {
            let lwt: chrono::DateTime<Local> = last_write.into();
            if lwt.naive_local() < till_date {
                continue;
            }
        }

        deleted.remove(&name);

        let ctx = contexts.entry(name.clone()).or_insert_with(LogContext::new);

        saw_new_data |= parser::parse_log(
            inner,
            app_handle,
            &entry.path(),
            &name,
            ctx,
            till_date,
            *first_run,
        );
    }

    for name in deleted {
        contexts.remove(&name);
    }

    queue::flush_game_log_events(inner);
    *first_run = false;
    saw_new_data
}
