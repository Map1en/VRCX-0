use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// Environment variable that enables raw WebSocket event capture for replay debugging.
/// Set to `1` to enable; the capture is written to `ws-events.jsonl` next to the database.
const WS_EVENT_LOG_ENV: &str = "VRCX_0_WS_EVENT_LOG";
const DEFAULT_FILE_NAME: &str = "ws-events.jsonl";

static ENABLED: OnceLock<bool> = OnceLock::new();
static WRITE_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();
static ANNOUNCED: OnceLock<()> = OnceLock::new();

fn enabled() -> bool {
    *ENABLED.get_or_init(|| {
        std::env::var(WS_EVENT_LOG_ENV)
            .map(|value| value.trim() == "1")
            .unwrap_or(false)
    })
}

/// Resolves the capture file path, or `None` when capture is disabled.
///
/// `db_path` anchors the location so the capture lands in the active app data
/// directory (including portable installs), mirroring where the database lives.
pub(crate) fn resolve_path(db_path: &Path) -> Option<PathBuf> {
    if !enabled() {
        return None;
    }

    let path = db_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(DEFAULT_FILE_NAME);

    if ANNOUNCED.set(()).is_ok() {
        tracing::info!(path = %path.display(), "[Realtime] raw ws event capture enabled");
    }
    Some(path)
}

/// Appends a connection boundary marker so a replay tool can segment the file into
/// independent WebSocket sessions. Emitted once per (re)connect, because the file is
/// appended across reconnects and process restarts, and each connection starts a fresh
/// realtime parser whose stream must not be replayed across the boundary.
pub(crate) fn append_connect_marker(
    path: &Path,
    at: &str,
    generation: u64,
    session_generation: u64,
) {
    let line = serde_json::json!({
        "kind": "connect",
        "at": at,
        "generation": generation,
        "sessionGeneration": session_generation,
    });
    write_or_warn(path, &line);
}

/// Appends one raw WebSocket text frame as a JSONL line.
///
/// `raw` is stored as a JSON string (not embedded as parsed JSON) so the capture is
/// lossless even for frames that fail to parse, letting a replay tool feed each line
/// straight back through the realtime parser with its original timestamp.
pub(crate) fn append(path: &Path, received_at: &str, raw: &str) {
    let line = serde_json::json!({
        "kind": "message",
        "receivedAt": received_at,
        "raw": raw,
    });
    write_or_warn(path, &line);
}

fn write_or_warn(path: &Path, line: &serde_json::Value) {
    if let Err(error) = write_line(path, &line.to_string()) {
        tracing::warn!(error = %error, path = %path.display(), "[Realtime] failed to write ws event log");
    }
}

fn write_line(path: &Path, line: &str) -> std::io::Result<()> {
    let mutex = WRITE_MUTEX.get_or_init(|| Mutex::new(()));
    let _guard = mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{line}")
}
