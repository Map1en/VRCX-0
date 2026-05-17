use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use chrono::Local;

const ERROR_LOG_FILE: &str = "error-log.txt";
const MAX_ERROR_LOG_BYTES: u64 = 10 * 1024 * 1024;
static ERROR_LOG_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

pub fn default_app_data_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|path| path.join("VRCX-0"))
}

fn format_timestamp() -> String {
    let now = Local::now();
    format!(
        "[{}] [{}]",
        now.format("%Y-%m-%d %H:%M:%S%.3f %:z"),
        now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    )
}

fn has_network_error_text(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("failed to load resource")
        || lower.contains("web api execution failed")
        || lower.contains("vrchat request failed")
        || lower.contains("github release request failed")
        || lower.contains("translation api error")
        || lower.contains("avatar search failed")
        || lower.contains("media file upload failed")
        || lower.contains("update download failed")
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
    if message.trim().is_empty() || should_skip_error_log(message) {
        return;
    }

    let _ = append_error_log_unfiltered(
        app_data,
        &format!(
            "{} [{}]\n{}\n",
            format_timestamp(),
            source,
            message.trim_end()
        ),
    );
}

pub fn append_error_log_entry(app_data: &Path, entry: &str) {
    if entry.trim().is_empty() || should_skip_error_log(entry) {
        return;
    }

    let _ = append_error_log_unfiltered(app_data, entry.trim_end());
}

fn append_error_log_unfiltered(app_data: &Path, entry: &str) -> std::io::Result<()> {
    let mutex = ERROR_LOG_MUTEX.get_or_init(|| Mutex::new(()));
    let _guard = mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    std::fs::create_dir_all(app_data)?;
    let path = app_data.join(ERROR_LOG_FILE);
    {
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        writeln!(file, "{entry}\n")?;
    }
    trim_error_log_if_needed(&path)?;
    Ok(())
}

fn trim_error_log_if_needed(path: &Path) -> std::io::Result<()> {
    let metadata = std::fs::metadata(path)?;
    if metadata.len() <= MAX_ERROR_LOG_BYTES {
        return Ok(());
    }

    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(metadata.len() - MAX_ERROR_LOG_BYTES))?;

    let mut tail = Vec::with_capacity(MAX_ERROR_LOG_BYTES as usize);
    file.read_to_end(&mut tail)?;
    let keep_from = tail
        .windows(2)
        .position(|window| window == b"\n\n")
        .map(|offset| offset + 2)
        .unwrap_or(0);

    std::fs::write(path, &tail[keep_from..])
}

pub struct ErrorLogWriter {
    app_data: PathBuf,
    buffer: Vec<u8>,
}

impl ErrorLogWriter {
    pub fn new(app_data: PathBuf) -> Self {
        Self {
            app_data,
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
        append_error_log(&self.app_data, "rust:tracing", &message);
    }
}
