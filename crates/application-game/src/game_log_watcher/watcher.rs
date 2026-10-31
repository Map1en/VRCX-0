use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use chrono::{Local, NaiveDateTime, Utc};
use vrcx_0_core::game_log_parser::LogLocationSnapshot;
use vrcx_0_core::vrchat_log_reader::parse_output_log_file_timestamp;

use crate::game_log_parser::{self, GameLogEvent, LogContext, LogReader, APPLICATION_QUIT_MARKERS};

use super::queue;
use super::sink::GameLogEventSink;

const INACTIVE_POLL_KEEPALIVE: Duration = Duration::from_secs(120);
#[derive(Clone)]
pub struct LogWatcher {
    pub(super) inner: Arc<Inner>,
}

pub trait LogLocationSnapshotScanner: Send + Sync {
    fn scan_current_location_snapshot(&self, log_dir: &Path) -> Option<LogLocationSnapshot>;
}

#[derive(Default)]
pub struct NoopLogLocationSnapshotScanner;

impl LogLocationSnapshotScanner for NoopLogLocationSnapshotScanner {
    fn scan_current_location_snapshot(&self, _log_dir: &Path) -> Option<LogLocationSnapshot> {
        None
    }
}

struct PendingScan {
    events: Vec<GameLogEvent>,
    origin: super::GameLogEventOrigin,
    cursor: super::GameLogScanCursor,
    publish: bool,
}

pub(super) struct Inner {
    pub(super) event_buffer: Mutex<Vec<GameLogEvent>>,
    pub(super) event_sink: Option<Arc<dyn GameLogEventSink>>,
    pub(super) log_dir: RwLock<Option<PathBuf>>,
    resume_cursor: Mutex<Option<super::GameLogScanCursor>>,
    scan_gate: Mutex<()>,
    pending_scan: Mutex<Option<PendingScan>>,
    pub(super) till_date: Mutex<Option<NaiveDateTime>>,
    pub(super) active: Mutex<bool>,
    pub(super) reset_flag: Mutex<bool>,
    pub(super) vrc_closed_gracefully: Mutex<bool>,
    pub(super) game_running: Mutex<bool>,
    pub(super) poll_without_process_monitor: Mutex<bool>,
    pub(super) keep_polling_until: Mutex<Option<Instant>>,
    pub(super) location_snapshot_scanner: Arc<dyn LogLocationSnapshotScanner>,
    pub(super) started: AtomicBool,
    pub(super) stop_requested: AtomicBool,
    pub(super) generation: AtomicU64,
    pub(super) initial_scan_latest_file_only: AtomicBool,
    pub(super) handle: Mutex<Option<JoinHandle<()>>>,
}

impl LogWatcher {
    pub fn new(event_sink: Option<Arc<dyn GameLogEventSink>>) -> Self {
        Self::new_with_location_snapshot_scanner(
            event_sink,
            Arc::new(NoopLogLocationSnapshotScanner),
        )
    }

    pub fn new_with_location_snapshot_scanner(
        event_sink: Option<Arc<dyn GameLogEventSink>>,
        location_snapshot_scanner: Arc<dyn LogLocationSnapshotScanner>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                event_buffer: Mutex::new(Vec::new()),
                event_sink,
                log_dir: RwLock::new(None),
                resume_cursor: Mutex::new(None),
                scan_gate: Mutex::new(()),
                pending_scan: Mutex::new(None),
                till_date: Mutex::new(None),
                active: Mutex::new(false),
                reset_flag: Mutex::new(false),
                vrc_closed_gracefully: Mutex::new(false),
                game_running: Mutex::new(false),
                poll_without_process_monitor: Mutex::new(false),
                keep_polling_until: Mutex::new(None),
                location_snapshot_scanner,
                started: AtomicBool::new(false),
                stop_requested: AtomicBool::new(false),
                generation: AtomicU64::new(0),
                initial_scan_latest_file_only: AtomicBool::new(false),
                handle: Mutex::new(None),
            }),
        }
    }

    #[cfg(target_os = "windows")]
    pub fn start(&self, log_dir: PathBuf) {
        self.start_with_mode(log_dir, false);
    }

    #[cfg(target_os = "linux")]
    pub fn start_without_process_monitor(&self, log_dir: PathBuf) {
        self.start_with_mode(log_dir, true);
    }

    fn start_with_mode(&self, log_dir: PathBuf, poll_without_process_monitor: bool) {
        if self
            .inner
            .started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
            && !self.inner.stop_requested.load(Ordering::Acquire)
        {
            tracing::debug!("log watcher is already active");
            return;
        }
        let generation = self.inner.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.inner.stop_requested.store(false, Ordering::Release);
        *self.inner.log_dir.write().unwrap() = Some(log_dir.clone());
        *self.inner.poll_without_process_monitor.lock().unwrap() = poll_without_process_monitor;
        *self.inner.keep_polling_until.lock().unwrap() =
            Some(Instant::now() + INACTIVE_POLL_KEEPALIVE);
        let inner = Arc::clone(&self.inner);
        let handle = std::thread::spawn(move || thread_loop(inner, log_dir, generation));
        if let Ok(mut current) = self.inner.handle.lock() {
            if let Some(previous) = current.take() {
                if previous.is_finished() {
                    let _ = previous.join();
                }
            }
            *current = Some(handle);
        }
    }

    pub fn stop(&self) {
        self.inner.generation.fetch_add(1, Ordering::AcqRel);
        self.inner.stop_requested.store(true, Ordering::Release);
        self.inner.started.store(false, Ordering::Release);
        if let Ok(mut handle) = self.inner.handle.lock() {
            if let Some(handle) = handle.take() {
                let _ = handle.join();
            }
        }
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

    pub fn set_initial_scan_latest_file_only(&self, enabled: bool) {
        self.inner
            .initial_scan_latest_file_only
            .store(enabled, Ordering::Release);
    }

    pub fn resume_from(&self, cursor: super::GameLogScanCursor) {
        self.set_date_till(&cursor.cutoff);
        *self.inner.resume_cursor.lock().unwrap() = Some(cursor);
    }

    pub fn with_paused_scan<T>(
        &self,
        action: impl FnOnce() -> crate::Result<T>,
    ) -> crate::Result<T> {
        let _guard = self
            .inner
            .scan_gate
            .lock()
            .map_err(|error| crate::Error::Custom(error.to_string()))?;
        action()
    }

    pub fn clear_resume_cursor(&self) {
        *self.inner.resume_cursor.lock().unwrap() = None;
    }

    pub fn reset(&self) {
        *self.inner.pending_scan.lock().unwrap() = None;
        *self.inner.reset_flag.lock().unwrap() = true;
        *self.inner.keep_polling_until.lock().unwrap() =
            Some(Instant::now() + INACTIVE_POLL_KEEPALIVE);
    }

    pub fn vrc_closed_gracefully(&self) -> bool {
        *self.inner.vrc_closed_gracefully.lock().unwrap()
    }

    pub fn current_location_snapshot(&self) -> Option<LogLocationSnapshot> {
        let log_dir = self.inner.log_dir.read().unwrap().clone()?;
        self.inner
            .location_snapshot_scanner
            .scan_current_location_snapshot(&log_dir)
    }

    pub fn set_game_running(&self, running: bool) {
        *self.inner.game_running.lock().unwrap() = running;
        if !running {
            *self.inner.keep_polling_until.lock().unwrap() =
                Some(Instant::now() + INACTIVE_POLL_KEEPALIVE);
        }
    }
}

fn thread_loop(inner: Arc<Inner>, log_dir: PathBuf, generation: u64) {
    let mut contexts: HashMap<String, LogContext> = HashMap::new();
    let mut reader = LogReader::new();
    let mut first_run = true;

    while !inner.stop_requested.load(Ordering::Acquire)
        && inner.generation.load(Ordering::Acquire) == generation
    {
        let active = *inner.active.lock().unwrap();

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
            let saw_new_data = update(&inner, &log_dir, &mut reader, &mut contexts, &mut first_run);
            if saw_new_data {
                *inner.keep_polling_until.lock().unwrap() =
                    Some(Instant::now() + INACTIVE_POLL_KEEPALIVE);
            }
        }

        crate::sleep_interruptibly(Duration::from_secs(1), || {
            !inner.stop_requested.load(Ordering::Acquire)
                && inner.generation.load(Ordering::Acquire) == generation
        });
    }

    if inner.generation.load(Ordering::Acquire) == generation {
        inner.started.store(false, Ordering::Release);
    }
}

pub(super) fn update(
    inner: &Inner,
    log_dir: &Path,
    reader: &mut LogReader,
    contexts: &mut HashMap<String, LogContext>,
    first_run: &mut bool,
) -> bool {
    let _scan_guard = inner.scan_gate.lock().unwrap();
    if std::mem::take(&mut *inner.reset_flag.lock().unwrap()) {
        *first_run = true;
        contexts.clear();
        inner.event_buffer.lock().unwrap().clear();
    }
    if let Some(event_sink) = &inner.event_sink {
        if let Err(error) = event_sink.retry_pending_game_log() {
            tracing::warn!("GameLog persistence remains pending: {error}");
            return true;
        }
        let mut pending = inner.pending_scan.lock().unwrap();
        if let Some(scan) = pending.as_ref() {
            if let Err(error) = event_sink.ingest_game_log_scan(
                &scan.events,
                scan.origin,
                scan.cursor.clone(),
                scan.publish,
            ) {
                tracing::warn!("GameLog scan remains pending: {error}");
                return true;
            }
            let scan = pending.take().expect("pending GameLog scan");
            *inner.resume_cursor.lock().unwrap() = Some(scan.cursor.clone());
            contexts.insert(scan.cursor.file_name, scan.cursor.context);
        }
    }
    if !log_dir.exists() {
        *first_run = false;
        return false;
    }

    let mut entries: Vec<_> = fs::read_dir(log_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter_map(|entry| {
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();
            parse_output_log_file_timestamp(&name)?;
            let name = name.into_owned();
            Some((entry, file_name, name))
        })
        .collect();

    if (!*first_run || inner.initial_scan_latest_file_only.load(Ordering::Acquire))
        && entries.len() > 1
    {
        entries = vec![followed_entry(inner, entries)];
    } else {
        entries.sort_by(|left, right| left.1.cmp(&right.1));
    }

    let till_date_utc = inner
        .till_date
        .lock()
        .unwrap()
        .unwrap_or(chrono::DateTime::UNIX_EPOCH.naive_utc());

    let till_date = chrono::TimeZone::from_utc_datetime(&Local, &till_date_utc).naive_local();

    let latest_name = entries.last().map(|(_, _, name)| name.clone());
    let resume_cursor = inner
        .resume_cursor
        .lock()
        .unwrap()
        .clone()
        .filter(|cursor| {
            fs::metadata(log_dir.join(&cursor.file_name)).is_ok_and(|metadata| {
                metadata.is_file()
                    && metadata.len() >= cursor.context.position
                    && file_created_at(&metadata) == cursor.file_created_at
            })
        });
    let mut sink = queue::WatcherParseSink { inner };
    let mut saw_new_data = false;
    let mut present = HashSet::with_capacity(entries.len());
    for (entry, _, name) in entries {
        if latest_name.as_ref() != Some(&name)
            && resume_cursor
                .as_ref()
                .is_some_and(|cursor| name < cursor.file_name)
        {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        if let Ok(last_write) = meta.modified() {
            let lwt: chrono::DateTime<Local> = last_write.into();
            if lwt.naive_local() < till_date
                && (inner.event_sink.is_none() || latest_name.as_ref() != Some(&name))
            {
                continue;
            }
        }

        if !contexts.contains_key(&name) {
            let context = resume_cursor
                .as_ref()
                .filter(|cursor| cursor.file_name == name)
                .map(|cursor| cursor.context.clone())
                .unwrap_or_else(LogContext::new);
            contexts.insert(name.clone(), context);
        }
        let rebuild = resume_cursor
            .as_ref()
            .filter(|cursor| cursor.file_name == name)
            .map(|cursor| cursor.rebuild)
            .unwrap_or(inner.event_sink.is_some() && latest_name.as_ref() == Some(&name));
        let read_cutoff = if rebuild {
            chrono::DateTime::UNIX_EPOCH.naive_utc()
        } else {
            till_date
        };
        let ctx = contexts
            .get_mut(&name)
            .expect("GameLog context was inserted");

        let created_at = file_created_at(&meta);
        if ctx.position > meta.len()
            || (ctx.file_created_at.is_some() && ctx.file_created_at != created_at)
        {
            *ctx = LogContext::new();
        }
        ctx.file_created_at = created_at;
        loop {
            if inner.stop_requested.load(Ordering::Acquire) {
                return saw_new_data;
            }
            let previous_context = ctx.clone();
            let changed = game_log_parser::parse_log(
                reader,
                &mut sink,
                &entry.path(),
                &name,
                ctx,
                read_cutoff,
            );
            if ctx.read_failed {
                *ctx = previous_context;
                inner.event_buffer.lock().unwrap().clear();
                break;
            }
            saw_new_data |= changed;
            if changed || *first_run {
                if let Some(event_sink) = &inner.event_sink {
                    let events = std::mem::take(&mut *inner.event_buffer.lock().unwrap());
                    let cursor = super::GameLogScanCursor {
                        file_name: name.clone(),
                        start_position: previous_context.position,
                        file_created_at: file_created_at(&meta),
                        rebuild,
                        context: ctx.clone(),
                        cutoff: chrono::DateTime::<Utc>::from_naive_utc_and_offset(
                            till_date_utc,
                            Utc,
                        )
                        .to_rfc3339(),
                    };
                    let origin = if *first_run {
                        super::GameLogEventOrigin::InitialScan
                    } else {
                        super::GameLogEventOrigin::Live
                    };
                    let publish = latest_name.as_ref() == Some(&name) && ctx.at_end;
                    if let Err(error) =
                        event_sink.ingest_game_log_scan(&events, origin, cursor.clone(), publish)
                    {
                        tracing::warn!("failed to process GameLog scan; retrying from the same position: {error}");
                        *ctx = previous_context;
                        *inner.pending_scan.lock().unwrap() = Some(PendingScan {
                            events,
                            origin,
                            cursor,
                            publish,
                        });
                        return true;
                    }
                    *inner.resume_cursor.lock().unwrap() = Some(cursor);
                }
            }
            if !changed || ctx.at_end {
                break;
            }
        }
        present.insert(name);
    }

    contexts.retain(|name, _| present.contains(name));

    queue::flush_game_log_events(inner, *first_run);
    *first_run = false;
    saw_new_data
}

type LogEntry = (fs::DirEntry, std::ffi::OsString, String);

fn followed_entry(inner: &Inner, entries: Vec<LogEntry>) -> LogEntry {
    let mut entries: Vec<_> = entries
        .into_iter()
        .map(|entry| {
            let modified = entry.0.metadata().and_then(|meta| meta.modified()).ok();
            (entry, modified)
        })
        .collect();
    entries.sort_by(|left, right| right.0 .1.cmp(&left.0 .1));
    let mut followed = 0;
    while let Some(last_write) = entries[followed].1 {
        let Some(later) = entries
            .iter()
            .position(|(_, modified)| modified.is_some_and(|modified| modified > last_write))
        else {
            break;
        };
        if !log_has_application_quit(&entries[followed].0 .0.path()) {
            break;
        }
        let quit_at = chrono::DateTime::<Utc>::from(last_write).naive_utc();
        let mut till_date = inner.till_date.lock().unwrap();
        if till_date.is_none_or(|till_date| till_date < quit_at) {
            *till_date = Some(quit_at);
        }
        followed = later;
    }
    entries.swap_remove(followed).0
}

fn log_has_application_quit(path: &Path) -> bool {
    let read_tail = || -> std::io::Result<Vec<u8>> {
        let mut file = fs::File::open(path)?;
        let len = file.metadata()?.len();
        file.seek(SeekFrom::Start(len.saturating_sub(64 * 1024)))?;
        let mut tail = Vec::new();
        file.read_to_end(&mut tail)?;
        Ok(tail)
    };
    read_tail().is_ok_and(|tail| {
        let tail = String::from_utf8_lossy(&tail);
        APPLICATION_QUIT_MARKERS
            .iter()
            .any(|marker| tail.contains(marker))
    })
}

fn file_created_at(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .created()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_nanos()).ok())
}
