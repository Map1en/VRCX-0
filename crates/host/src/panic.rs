use backtrace::{Backtrace, BacktraceFrame};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::panic::PanicHookInfo;
use std::path::{Path, PathBuf};

#[derive(thiserror::Error, Debug)]
enum Error {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde error: {0}")]
    SerdeJson(#[from] serde_json::Error),
}

pub const LATEST_PANIC_NAME: &str = "latest.json";
pub const PANIC_DIR: &str = "crashes";

pub enum MaybeResolvedBacktrace {
    Resolved(Backtrace),
    NotAvailable,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PanicSnapshot {
    app_version: String,
    date: DateTime<Utc>,
    message: Option<String>,
    location: Option<String>,
    backtrace: Backtrace,
}

impl PanicSnapshot {
    fn new(app_version: String, date: DateTime<Utc>, info: &PanicHookInfo, ip: *const ()) -> Self {
        let mut frames = Vec::new();
        backtrace::trace(|frame| {
            frames.push(BacktraceFrame::from(frame.clone()));

            // clear inner frames, and start with call site.
            if std::ptr::eq(frame.symbol_address(), ip as _) {
                frames.clear();
            }

            true
        });
        frames.shrink_to_fit();

        Self {
            app_version,
            date,
            message: info.payload_as_str().map(ToOwned::to_owned),
            location: info.location().map(ToString::to_string),
            backtrace: Backtrace::from(frames),
        }
    }

    pub fn app_version(&self) -> &str {
        &self.app_version
    }

    pub fn date(&self) -> &DateTime<Utc> {
        &self.date
    }

    pub fn message(&self) -> Option<&str> {
        self.message.as_deref()
    }

    pub fn location(&self) -> Option<&str> {
        self.location.as_deref()
    }

    pub fn backtrace(&self) -> &Backtrace {
        &self.backtrace
    }

    pub fn maybe_resolve_backtrace(&self, current_app_version: &str) -> MaybeResolvedBacktrace {
        if self.app_version != current_app_version {
            // Different builds could have different symbol allocations
            // thus symbol locations could be different,
            // making the resolved symbol names incorrect.
            // If app versions do not match,
            // do not attempt to resolve symbols.
            return MaybeResolvedBacktrace::NotAvailable;
        }
        let mut backtrace = self.backtrace.clone();
        backtrace.resolve();
        MaybeResolvedBacktrace::Resolved(backtrace)
    }
}

pub fn handle(app_data_dir: &Path, panic_info: &PanicHookInfo, app_version: &str) {
    let panic_dir = panic_dir(app_data_dir);
    if std::fs::create_dir_all(&panic_dir).is_ok() {
        match write_panic_info(&panic_dir, panic_info, app_version) {
            Ok(path) => {
                eprintln!("panic info saved to {}", path.display());
            }
            Err(err) => {
                eprintln!("failed to save crash info: {}", err);
                std::process::abort();
            }
        }
    }

    crate::error_log::append_error_log_with_version(
        app_data_dir,
        "rust:panic",
        &panic_info.to_string(),
        app_version,
    );
}

pub fn take_last(app_data_dir: &Path) -> Option<PanicSnapshot> {
    let panic_dir = panic_dir(app_data_dir);
    let path = panic_dir.join(LATEST_PANIC_NAME);
    if let Ok(data) = std::fs::read(&path) {
        let maybe_snapshot = serde_json::from_slice::<PanicSnapshot>(&data).ok();
        let _ = std::fs::remove_file(&path);
        return maybe_snapshot;
    }
    None
}

fn write_panic_info(
    panic_dir: &Path,
    panic_info: &PanicHookInfo,
    app_version: &str,
) -> Result<PathBuf, Error> {
    let now = Utc::now();

    let panic_info_path = dated_snapshot_path(panic_dir, now);

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .create(true)
        .open(&panic_info_path)?;

    file.write_all(&serde_json::to_vec(&PanicSnapshot::new(
        app_version.to_string(),
        now,
        panic_info,
        write_panic_info as _,
    ))?)?;
    drop(file);

    let tmp_path = panic_dir.join("latest.tmp");
    std::fs::hard_link(&panic_info_path, &tmp_path)?;
    std::fs::rename(&tmp_path, panic_dir.join(LATEST_PANIC_NAME))?;

    Ok(panic_info_path)
}

pub fn panic_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(PANIC_DIR)
}

pub fn dated_snapshot_path(panic_dir: &Path, datetime: DateTime<Utc>) -> PathBuf {
    panic_dir.join(format!("{}.json", datetime.format("%Y-%m-%d_%H-%M-%S%.3f")))
}
