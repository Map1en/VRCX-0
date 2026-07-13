use backtrace::{Backtrace, BacktraceFrame};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::panic::PanicHookInfo;
use std::path::{Path, PathBuf};

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
    fn new(
        app_version: String,
        date: DateTime<Utc>,
        info: &PanicHookInfo,
        ip: *const std::ffi::c_void,
    ) -> Self {
        let mut frames = Vec::new();
        backtrace::trace(|frame| {
            let mut bt_frame = BacktraceFrame::from(frame.clone());
            bt_frame.resolve();
            frames.push(bt_frame);

            #[cfg(target_vendor = "apple")]
            let symbol_addr = {
                // FIXME: https://github.com/rust-lang/rust/issues/74771
                unsafe extern "C" {
                    pub fn _Unwind_FindEnclosingFunction(
                        pc: *mut std::ffi::c_void,
                    ) -> *mut std::ffi::c_void;
                }
                unsafe { _Unwind_FindEnclosingFunction(frame.ip()) }
            };
            #[cfg(not(target_vendor = "apple"))]
            let symbol_addr = frame.symbol_address();
            // clear inner frames, and start with call site.
            if std::ptr::eq(symbol_addr, ip) {
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

#[inline(never)]
pub fn handle(app_data_dir: &Path, panic_info: &PanicHookInfo, app_version: &str) {
    let panic_dir = panic_dir(app_data_dir);

    if std::fs::create_dir_all(&panic_dir).is_ok() {
        let snapshot =
            PanicSnapshot::new(app_version.to_string(), Utc::now(), panic_info, handle as _);

        let snapshot_str = serde_json::to_string(&snapshot).unwrap();

        crate::error_log::append_error_log_with_version(
            app_data_dir,
            "rust:panic",
            &snapshot_str,
            app_version,
        );

        match write_panic_snapshot(&panic_dir, snapshot.date, snapshot_str.as_bytes()) {
            Ok(path) => {
                eprintln!("panic info saved to {}", path.display());
            }
            Err(err) => {
                eprintln!("failed to save panic info: {}", err);
                std::process::abort();
            }
        }
    }
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

fn write_panic_snapshot(
    panic_dir: &Path,
    date: DateTime<Utc>,
    snapshot_bin: &[u8],
) -> Result<PathBuf, std::io::Error> {
    let snapshot_path = panic_dir.join(dated_snapshot_name(date));

    std::fs::write(&snapshot_path, snapshot_bin)?;

    let tmp_path = panic_dir.join("latest.tmp");

    std::fs::hard_link(&snapshot_path, &tmp_path)?;
    std::fs::rename(&tmp_path, panic_dir.join(LATEST_PANIC_NAME))?;

    Ok(snapshot_path)
}

pub fn panic_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(PANIC_DIR)
}

pub fn dated_snapshot_name(datetime: DateTime<Utc>) -> String {
    format!("{}.json", datetime.format("%Y-%m-%d_%H-%M-%S%.3f"))
}
