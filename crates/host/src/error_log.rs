use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use chrono::Local;
use serde::Serialize;

const ERROR_LOG_FILE: &str = "error-log.txt";
pub const HEADLESS_ERROR_LOG_FILE: &str = "error-headless.txt";
const MAX_ERROR_LOG_BYTES: u64 = 10 * 1024 * 1024;
static ERROR_LOG_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

pub fn default_app_data_dir() -> Option<PathBuf> {
    crate::app_paths::default_app_data_dir().ok()
}

fn format_timestamp_with_version(app_version: Option<&str>) -> String {
    let now = Local::now();
    let timestamp = format!(
        "[{}] [{}]",
        now.format("%Y-%m-%d %H:%M:%S%.3f %:z"),
        now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    );
    match app_version.map(str::trim).filter(|value| !value.is_empty()) {
        Some(version) => format!("{timestamp} [v{version}]"),
        None => timestamp,
    }
}

const NETWORK_ERROR_MARKERS: &[&str] = &[
    "failed to load resource",
    "web api execution failed",
    "vrchat request failed",
    "github release request failed",
    "translation api error",
    "avatar search failed",
    "media file upload failed",
    "update download failed",
];

fn has_network_error_text(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    NETWORK_ERROR_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
        || (lower.contains("http ") && contains_http_error_status(&lower))
        || (lower.contains("status") && contains_http_error_status(&lower))
        || (lower.contains("request failed") && contains_http_error_status(&lower))
}

fn contains_http_error_status(message: &str) -> bool {
    (400..=599).any(|status| message.contains(&status.to_string()))
}

pub fn should_skip_error_log(message: &str) -> bool {
    has_network_error_text(message)
}

pub fn append_error_log(app_data: &Path, source: &str, message: &str) {
    append_error_log_to_file(app_data, ERROR_LOG_FILE, source, message);
}

pub fn append_error_log_with_version(
    app_data: &Path,
    source: &str,
    message: &str,
    app_version: &str,
) {
    append_error_log_to_file_with_version(app_data, ERROR_LOG_FILE, source, message, app_version);
}

pub fn append_headless_error_log(app_data: &Path, source: &str, message: &str) {
    append_error_log_to_file(app_data, HEADLESS_ERROR_LOG_FILE, source, message);
}

pub fn append_error_log_to_file(app_data: &Path, file_name: &str, source: &str, message: &str) {
    append_error_log_to_file_with_optional_version(app_data, file_name, source, message, None);
}

pub fn append_error_log_to_file_with_version(
    app_data: &Path,
    file_name: &str,
    source: &str,
    message: &str,
    app_version: &str,
) {
    append_error_log_to_file_with_optional_version(
        app_data,
        file_name,
        source,
        message,
        Some(app_version),
    );
}

fn append_error_log_to_file_with_optional_version(
    app_data: &Path,
    file_name: &str,
    source: &str,
    message: &str,
    app_version: Option<&str>,
) {
    if message.trim().is_empty() || should_skip_error_log(message) {
        return;
    }

    let _ = append_error_log_unfiltered_to_file(
        app_data,
        file_name,
        &format!(
            "{} [{}]\n{}\n",
            format_timestamp_with_version(app_version),
            source,
            message.trim_end()
        ),
    );
}

pub fn append_error_log_entry(app_data: &Path, entry: &str) {
    append_error_log_entry_to_file(app_data, ERROR_LOG_FILE, entry);
}

pub fn append_headless_error_log_entry(app_data: &Path, entry: &str) {
    append_error_log_entry_to_file(app_data, HEADLESS_ERROR_LOG_FILE, entry);
}

pub fn append_error_log_entry_to_file(app_data: &Path, file_name: &str, entry: &str) {
    if entry.trim().is_empty() || should_skip_error_log(entry) {
        return;
    }

    let _ = append_error_log_unfiltered_to_file(app_data, file_name, entry.trim_end());
}

fn append_error_log_unfiltered_to_file(
    app_data: &Path,
    file_name: &str,
    entry: &str,
) -> std::io::Result<()> {
    let mutex = ERROR_LOG_MUTEX.get_or_init(|| Mutex::new(()));
    let _guard = mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    std::fs::create_dir_all(app_data)?;
    let path = app_data.join(safe_log_file_name(file_name));
    {
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        writeln!(file, "{entry}\n")?;
    }
    trim_error_log_to_bytes_if_needed(&path, MAX_ERROR_LOG_BYTES)?;
    Ok(())
}

fn trim_error_log_to_bytes_if_needed(path: &Path, max_bytes: u64) -> std::io::Result<()> {
    let metadata = std::fs::metadata(path)?;
    if metadata.len() <= max_bytes {
        return Ok(());
    }

    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(metadata.len() - max_bytes))?;

    let mut tail = Vec::with_capacity(max_bytes as usize);
    file.read_to_end(&mut tail)?;
    let keep_from = tail
        .windows(2)
        .position(|window| window == b"\n\n")
        .map(|offset| offset + 2)
        .unwrap_or(0);

    std::fs::write(path, &tail[keep_from..])
}

fn safe_log_file_name(file_name: &str) -> &str {
    let trimmed = file_name.trim();
    if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') {
        ERROR_LOG_FILE
    } else {
        trimmed
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ClientErrorLogEntry {
    pub ts_iso: String,
    pub app_version: Option<String>,
    pub source: String,
    pub message: String,
}

pub fn drain_client_error_log(
    app_data: &Path,
    since_iso: Option<&str>,
    limit: usize,
) -> Vec<ClientErrorLogEntry> {
    let limit = limit.clamp(1, 100);
    let path = app_data.join(ERROR_LOG_FILE);
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    text.split("\n\n")
        .filter_map(parse_client_error_log_entry)
        .filter(|entry| entry.source == "rust:panic" || entry.source == "rust:tracing")
        .filter(|entry| since_iso.is_none_or(|since| entry.ts_iso.as_str() > since))
        .take(limit)
        .collect()
}

fn parse_client_error_log_entry(raw: &str) -> Option<ClientErrorLogEntry> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let mut lines = raw.lines();
    let header = lines.next()?.trim();
    let fields = bracket_fields(header);
    if fields.len() < 3 {
        return None;
    }
    let ts_iso = fields.get(1)?.trim().to_string();
    if ts_iso.is_empty() {
        return None;
    }
    let (app_version, source) = match (fields.get(2), fields.get(3)) {
        (Some(version), Some(source)) if version.starts_with('v') => (
            Some(version.trim_start_matches('v').trim().to_string())
                .filter(|value| !value.is_empty()),
            source.trim().to_string(),
        ),
        (Some(source), _) => (None, source.trim().to_string()),
        _ => return None,
    };
    if source.is_empty() {
        return None;
    }
    let message = lines.collect::<Vec<_>>().join("\n").trim_end().to_string();
    if message.is_empty() {
        return None;
    }
    Some(ClientErrorLogEntry {
        ts_iso,
        app_version,
        source,
        message,
    })
}

fn bracket_fields(header: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut rest = header;
    while let Some(start) = rest.find('[') {
        let after_start = &rest[start + 1..];
        let Some(end) = after_start.find(']') else {
            break;
        };
        fields.push(after_start[..end].to_string());
        rest = &after_start[end + 1..];
    }
    fields
}

pub struct ErrorLogWriter {
    app_data: PathBuf,
    file_name: &'static str,
    app_version: Option<&'static str>,
    buffer: Vec<u8>,
}

impl ErrorLogWriter {
    pub fn new(app_data: PathBuf) -> Self {
        Self::with_file_name(app_data, ERROR_LOG_FILE)
    }

    pub fn new_with_version(app_data: PathBuf, app_version: &'static str) -> Self {
        Self::with_file_name_and_version(app_data, ERROR_LOG_FILE, Some(app_version))
    }

    pub fn with_file_name(app_data: PathBuf, file_name: &'static str) -> Self {
        Self::with_file_name_and_version(app_data, file_name, None)
    }

    pub fn with_file_name_and_version(
        app_data: PathBuf,
        file_name: &'static str,
        app_version: Option<&'static str>,
    ) -> Self {
        Self {
            app_data,
            file_name,
            app_version,
            buffer: Vec::new(),
        }
    }
}

impl Write for ErrorLogWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.buffer.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Drop for ErrorLogWriter {
    fn drop(&mut self) {
        if self.buffer.is_empty() {
            return;
        }

        let message = String::from_utf8_lossy(&self.buffer);
        append_error_log_to_file_with_optional_version(
            &self.app_data,
            self.file_name,
            "rust:tracing",
            &message,
            self.app_version,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("vrcx-error-log-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn appends_to_named_log_and_keeps_network_noise_filtered() {
        let dir = test_dir("named");
        append_headless_error_log(&dir, "headless:test", "runtime failed");
        append_headless_error_log(&dir, "headless:test", "request failed with HTTP 404");

        let headless_log = dir.join(HEADLESS_ERROR_LOG_FILE);
        let text = std::fs::read_to_string(headless_log).unwrap();
        assert!(text.contains("[headless:test]"));
        assert!(text.contains("runtime failed"));
        assert!(!text.contains("HTTP 404"));

        let default_log = dir.join(ERROR_LOG_FILE);
        assert!(!default_log.exists());
    }

    #[test]
    fn trims_log_from_byte_tail_boundary() {
        let dir = test_dir("trim");
        let path = dir.join("trim.txt");
        std::fs::write(&path, b"old entry\n\nmiddle entry\n\nnew entry").unwrap();

        trim_error_log_to_bytes_if_needed(&path, 16).unwrap();

        let text = std::fs::read_to_string(path).unwrap();
        assert_eq!(text, "new entry");
    }

    #[test]
    fn writes_versioned_rust_error_entries() {
        let dir = test_dir("versioned");
        append_error_log_with_version(&dir, "rust:panic", "panic detail", "2.9.2");

        let text = std::fs::read_to_string(dir.join(ERROR_LOG_FILE)).unwrap();
        assert!(text.contains("[v2.9.2] [rust:panic]"));
        assert!(text.contains("panic detail"));
    }

    #[test]
    fn drains_rust_error_entries_after_cursor_and_keeps_old_version_optional() {
        let dir = test_dir("drain");
        std::fs::write(
            dir.join(ERROR_LOG_FILE),
            "[2026-07-01 00:00:00.001 +00:00] [2026-07-01T00:00:00.001Z] [v2.9.1] [rust:panic]\nfirst panic\n\n\
[2026-07-01 00:00:00.002 +00:00] [2026-07-01T00:00:00.002Z] [v2.9.2] [rust:tracing]\nsecond error\n\n\
[2026-07-01 00:00:00.003 +00:00] [2026-07-01T00:00:00.003Z] [js:error]\nnot rust\n\n\
[2026-07-01 00:00:00.004 +00:00] [2026-07-01T00:00:00.004Z] [rust:panic]\nold panic\n\n",
        )
        .unwrap();

        let entries = drain_client_error_log(&dir, Some("2026-07-01T00:00:00.001Z"), 10);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].ts_iso, "2026-07-01T00:00:00.002Z");
        assert_eq!(entries[0].app_version.as_deref(), Some("2.9.2"));
        assert_eq!(entries[0].source, "rust:tracing");
        assert_eq!(entries[0].message, "second error");
        assert_eq!(entries[1].ts_iso, "2026-07-01T00:00:00.004Z");
        assert_eq!(entries[1].app_version, None);
    }
}
