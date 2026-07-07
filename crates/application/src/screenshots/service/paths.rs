use super::*;

pub(super) const SCREENSHOT_READY_RETRY_COUNT: usize = 10;
pub(super) const SCREENSHOT_READY_RETRY_DELAY: Duration = Duration::from_secs(1);
pub(super) const SCREENSHOT_CONTENT_FOLDERS: [&str; 3] = ["Prints", "Stickers", "Emoji"];
pub(super) const SCREENSHOT_THUMBNAIL_HARD_LIMIT_BYTES: u64 = 500 * 1024 * 1024;
pub(super) const SCREENSHOT_THUMBNAIL_TARGET_BYTES: u64 = 256 * 1024 * 1024;
pub(super) const SCREENSHOT_THUMBNAIL_CLEANUP_INTERVAL_SECONDS: i64 = 60;

pub(super) static SCREENSHOT_THUMBNAIL_LAST_CLEANUP_AT: AtomicI64 = AtomicI64::new(0);

pub(super) fn is_vrchat_screenshot_path(path: &Path) -> bool {
    let is_png = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("png"));
    let has_vrchat_prefix = path
        .file_stem()
        .and_then(|file_stem| file_stem.to_str())
        .is_some_and(|file_stem| file_stem.starts_with("VRChat_"));

    is_png && has_vrchat_prefix
}

pub(super) fn sleep_before_next_screenshot_attempt(attempt: usize) {
    if attempt + 1 < SCREENSHOT_READY_RETRY_COUNT {
        std::thread::sleep(SCREENSHOT_READY_RETRY_DELAY);
    }
}

pub(super) fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub(super) fn unix_time_millis(time: std::time::SystemTime) -> i64 {
    time.duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub(super) fn now_unix_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub(super) fn now_rfc3339() -> String {
    let now: chrono::DateTime<chrono::Utc> = std::time::SystemTime::now().into();
    now.to_rfc3339()
}

pub(super) fn option_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(super) fn screenshot_path_with_world_id(path: &Path, world_id: &str) -> Option<PathBuf> {
    let file_stem = path.file_stem()?.to_str()?;
    let extension = path.extension()?.to_str()?;
    Some(path.with_file_name(format!("{file_stem}_{world_id}.{extension}")))
}
