use super::paths::{
    now_unix_seconds, path_string, SCREENSHOT_THUMBNAIL_CLEANUP_INTERVAL_SECONDS,
    SCREENSHOT_THUMBNAIL_HARD_LIMIT_BYTES, SCREENSHOT_THUMBNAIL_LAST_CLEANUP_AT,
    SCREENSHOT_THUMBNAIL_TARGET_BYTES,
};
use super::*;

fn remove_thumbnail_file(path: &Path, cache_dir: &Path, cache: &MetadataCacheDb) -> u64 {
    if path.exists() && !is_path_inside_directory(path, cache_dir) {
        return 0;
    }
    let size = std::fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let _ = std::fs::remove_file(path);
    cache.delete_thumbnail_cache_record(&path_string(path));
    size
}

pub(super) fn delete_thumbnail_cache_for_source_paths(
    cache_dir: &Path,
    cache: &MetadataCacheDb,
    source_paths: &[String],
) {
    if source_paths.is_empty() {
        return;
    }
    let source_path_set = source_paths
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    for entry in cache.thumbnail_cache_entries() {
        if source_path_set.contains(entry.source_path.as_str()) {
            remove_thumbnail_file(&PathBuf::from(entry.thumb_path), cache_dir, cache);
        }
    }
}

fn delete_stale_thumbnail_cache_for_source(
    cache_dir: &Path,
    cache: &MetadataCacheDb,
    source_path: &str,
    current_cache_key: &str,
) {
    for entry in cache.thumbnail_cache_entries_for_source(source_path) {
        if entry.cache_key != current_cache_key {
            remove_thumbnail_file(&PathBuf::from(entry.thumb_path), cache_dir, cache);
        }
    }
}

pub(super) fn delete_all_thumbnail_cache_files(cache_dir: &Path, cache: &MetadataCacheDb) {
    for file in screenshot_thumbnail_files(cache_dir) {
        remove_thumbnail_file(&file.path, cache_dir, cache);
    }
}

fn cleanup_screenshot_thumbnail_cache(cache_dir: &Path, cache: &MetadataCacheDb) {
    SCREENSHOT_THUMBNAIL_LAST_CLEANUP_AT.store(now_unix_seconds(), Ordering::Release);
    let mut total_size = screenshot_thumbnail_cache_size(cache_dir);

    for entry in cache.thumbnail_cache_entries() {
        let thumb_path = PathBuf::from(&entry.thumb_path);
        let source_path = PathBuf::from(&entry.source_path);
        let source_state = screenshot_thumbnail_source_state(&source_path).ok();
        let source_stale = source_state
            .map(|(size_bytes, modified_at)| {
                size_bytes != entry.size_bytes
                    || modified_at != entry.modified_at
                    || screenshot_thumbnail_cache_key(&entry.source_path, size_bytes, modified_at)
                        != entry.cache_key
            })
            .unwrap_or(true);
        if source_stale || !thumb_path.is_file() {
            total_size =
                total_size.saturating_sub(remove_thumbnail_file(&thumb_path, cache_dir, cache));
        }
    }

    if total_size <= SCREENSHOT_THUMBNAIL_HARD_LIMIT_BYTES {
        return;
    }

    if total_size <= SCREENSHOT_THUMBNAIL_TARGET_BYTES {
        return;
    }

    let last_used_by_path = cache.thumbnail_last_used_map();
    let mut files = screenshot_thumbnail_files(cache_dir);
    files.sort_by_key(|file| {
        last_used_by_path
            .get(&path_string(&file.path))
            .copied()
            .unwrap_or(file.modified_at)
    });

    for file in files {
        if total_size <= SCREENSHOT_THUMBNAIL_TARGET_BYTES {
            break;
        }
        total_size = total_size.saturating_sub(remove_thumbnail_file(&file.path, cache_dir, cache));
    }
}

fn cleanup_screenshot_thumbnail_cache_if_due(cache_dir: &Path, cache: &MetadataCacheDb) {
    let now = now_unix_seconds();
    let last_cleanup = SCREENSHOT_THUMBNAIL_LAST_CLEANUP_AT.load(Ordering::Relaxed);
    if now.saturating_sub(last_cleanup) < SCREENSHOT_THUMBNAIL_CLEANUP_INTERVAL_SECONDS {
        return;
    }
    if SCREENSHOT_THUMBNAIL_LAST_CLEANUP_AT
        .compare_exchange(last_cleanup, now, Ordering::AcqRel, Ordering::Relaxed)
        .is_ok()
    {
        cleanup_screenshot_thumbnail_cache(cache_dir, cache);
    }
}

fn validate_screenshot_thumbnail_source(
    path: &Path,
    source_root: &Path,
    size_bytes: i64,
) -> Result<(u32, u32)> {
    if source_root.as_os_str().is_empty() {
        return Err(Error::Custom(
            "VRChat photos folder is not configured.".into(),
        ));
    }
    if !is_path_inside_directory(path, source_root) {
        return Err(Error::Custom(
            "Screenshot thumbnail source is outside the VRChat photos folder.".into(),
        ));
    }

    Ok(validate_thumbnail_media_source(path, size_bytes)?)
}

pub fn ensure_screenshot_thumbnail(
    path: &str,
    cache_dir: &Path,
    cache: &MetadataCacheDb,
    source_root: &str,
) -> Result<String> {
    ensure_screenshot_thumbnail_in_root(path, cache_dir, cache, Path::new(source_root))
}

fn ensure_screenshot_thumbnail_in_root(
    path: &str,
    cache_dir: &Path,
    cache: &MetadataCacheDb,
    source_root: &Path,
) -> Result<String> {
    let source_path = PathBuf::from(path);
    if !source_path.is_file() || !is_png_file(path) {
        return Err(Error::Custom("Screenshot file is not a PNG.".into()));
    }

    let (size_bytes, modified_at) = screenshot_thumbnail_source_state(&source_path)?;

    validate_screenshot_thumbnail_source(&source_path, source_root, size_bytes)?;

    let cache_key = screenshot_thumbnail_cache_key(path, size_bytes, modified_at);
    let thumb_path = cache_dir.join(format!("{cache_key}.webp"));
    let thumb_path_string = path_string(&thumb_path);

    if thumb_path.is_file() {
        cache.record_thumbnail_cache(
            path,
            &thumb_path_string,
            &cache_key,
            size_bytes,
            modified_at,
        );
        cleanup_screenshot_thumbnail_cache_if_due(cache_dir, cache);
        return Ok(thumb_path_string);
    }

    std::fs::create_dir_all(cache_dir)?;
    delete_stale_thumbnail_cache_for_source(cache_dir, cache, path, &cache_key);

    let encoded_bytes = encode_screenshot_thumbnail_webp(&source_path)?;
    write_thumbnail_atomically(&thumb_path, &encoded_bytes)?;

    cache.record_thumbnail_cache(
        path,
        &thumb_path_string,
        &cache_key,
        size_bytes,
        modified_at,
    );
    cleanup_screenshot_thumbnail_cache_if_due(cache_dir, cache);

    Ok(thumb_path_string)
}

#[cfg(test)]
#[path = "../../tests/screenshots/thumbnail_tests.rs"]
mod tests;
