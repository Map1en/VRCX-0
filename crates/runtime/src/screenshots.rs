use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use crate::{Error, Result};
pub use vrcx_0_core::screenshots::{
    ScreenshotFolderTree, ScreenshotLibraryImage, ScreenshotLibraryScanStatus, ScreenshotMetadata,
    ScreenshotSearchType,
};
pub use vrcx_0_host::path_utils::is_path_inside_directory;
use vrcx_0_host::vrchat_paths;
use vrcx_0_media::png;
pub use vrcx_0_media::screenshot_metadata::{
    can_decode_image, delete_text_metadata, get_screenshot_metadata, has_vrcx_metadata,
    is_png_file, read_png_dimensions, write_vrcx_metadata,
};
use vrcx_0_media::screenshot_thumbnail::{
    encode_screenshot_thumbnail_webp, screenshot_thumbnail_cache_key,
    screenshot_thumbnail_cache_size, screenshot_thumbnail_files, screenshot_thumbnail_source_state,
    validate_screenshot_thumbnail_source as validate_thumbnail_media_source,
    write_thumbnail_atomically,
};
pub use vrcx_0_store::screenshot_cache::MetadataCacheDb;
use vrcx_0_store::screenshot_cache::{ScreenshotLibraryEntry, SCREENSHOT_LIBRARY_INDEX_VERSION};

const SCREENSHOT_READY_RETRY_COUNT: usize = 10;
const SCREENSHOT_READY_RETRY_DELAY: Duration = Duration::from_secs(1);
const SCREENSHOT_CONTENT_FOLDERS: [&str; 3] = ["Prints", "Stickers", "Emoji"];
const SCREENSHOT_THUMBNAIL_HARD_LIMIT_BYTES: u64 = 500 * 1024 * 1024;
const SCREENSHOT_THUMBNAIL_TARGET_BYTES: u64 = 256 * 1024 * 1024;
const SCREENSHOT_THUMBNAIL_CLEANUP_INTERVAL_SECONDS: i64 = 60;

static SCREENSHOT_THUMBNAIL_LAST_CLEANUP_AT: AtomicI64 = AtomicI64::new(0);

fn is_vrchat_screenshot_path(path: &Path) -> bool {
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

fn sleep_before_next_screenshot_attempt(attempt: usize) {
    if attempt + 1 < SCREENSHOT_READY_RETRY_COUNT {
        std::thread::sleep(SCREENSHOT_READY_RETRY_DELAY);
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn unix_time_millis(time: std::time::SystemTime) -> i64 {
    time.duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn now_unix_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn now_rfc3339() -> String {
    let now: chrono::DateTime<chrono::Utc> = std::time::SystemTime::now().into();
    now.to_rfc3339()
}

fn option_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn screenshot_path_with_world_id(path: &Path, world_id: &str) -> Option<PathBuf> {
    let file_stem = path.file_stem()?.to_str()?;
    let extension = path.extension()?.to_str()?;
    Some(path.with_file_name(format!("{file_stem}_{world_id}.{extension}")))
}

pub fn extra_screenshot_data(path: &str, carousel_cache: bool) -> Result<String> {
    let p = Path::new(path);
    let mut result = serde_json::Map::new();

    result.insert("filePath".into(), serde_json::json!(path));

    if let Ok(meta) = std::fs::metadata(p) {
        if let Ok(created) = meta.created() {
            let dt: chrono::DateTime<chrono::Utc> = created.into();
            result.insert("creationDate".into(), serde_json::json!(dt.to_rfc3339()));
        }
        result.insert("fileSizeBytes".into(), serde_json::json!(meta.len()));
    }
    if is_png_file(path) {
        let mut png = png::PngFile::open_read(path);
        if let Ok(ref mut png) = png {
            let res = png::read_resolution(png);
            if !res.is_empty() {
                result.insert("resolution".into(), serde_json::json!(res));
            }
        }
    }
    let file_name = p
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default();
    result.insert("fileName".into(), serde_json::json!(file_name));

    if carousel_cache {
        if let Some(parent) = p.parent() {
            if let Ok(entries) = std::fs::read_dir(parent) {
                let mut pngs: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        e.path()
                            .extension()
                            .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
                    })
                    .map(|e| e.path().to_string_lossy().into_owned())
                    .collect();
                pngs.sort();
                if let Some(idx) = pngs.iter().position(|f| f == path) {
                    if idx > 0 {
                        result.insert("previousFilePath".into(), serde_json::json!(pngs[idx - 1]));
                    }
                    if idx + 1 < pngs.len() {
                        result.insert("nextFilePath".into(), serde_json::json!(pngs[idx + 1]));
                    }
                }
            }
        }
    }

    serde_json::to_string(&result).map_err(|e| Error::Custom(format!("serialize: {e}")))
}

fn screenshot_error_json(path: &str, error: &str) -> Result<String> {
    serde_json::to_string(&serde_json::json!({
        "sourceFile": path,
        "error": error,
    }))
    .map_err(|e| Error::Custom(format!("serialize: {e}")))
}

pub fn screenshot_metadata_json(path: &str) -> Result<String> {
    match get_screenshot_metadata(path) {
        Some(meta) => {
            if let Some(error) = meta.error.as_deref() {
                return screenshot_error_json(meta.source_file.as_deref().unwrap_or(path), error);
            }

            serde_json::to_string(&meta).map_err(|e| Error::Custom(format!("serialize: {e}")))
        }
        None => screenshot_error_json(path, "Screenshot contains no metadata."),
    }
}

pub fn find_screenshots_json(
    search_query: &str,
    search_type: Option<i32>,
    cache: &MetadataCacheDb,
) -> Result<String> {
    let st = ScreenshotSearchType::from_i32(search_type.unwrap_or(0));
    let photos_dir = vrchat_paths::vrchat_photos_location();
    if photos_dir.is_empty() {
        return Ok("[]".into());
    }
    let results = find_screenshots(search_query, &photos_dir, st, cache);
    serde_json::to_string(&results).map_err(|e| Error::Custom(format!("serialize: {e}")))
}

fn is_screenshot_content_asset_path(path: &Path) -> bool {
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        SCREENSHOT_CONTENT_FOLDERS
            .iter()
            .any(|folder| name.eq_ignore_ascii_case(folder))
    })
}

fn screenshot_file_time(path: &Path) -> Option<std::time::SystemTime> {
    let meta = std::fs::metadata(path).ok()?;
    meta.created().or_else(|_| meta.modified()).ok()
}

fn last_screenshot_in(photos_dir: &Path) -> String {
    if !photos_dir.is_dir() {
        return String::new();
    }

    walkdir::WalkDir::new(photos_dir)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.into_path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
                && !is_screenshot_content_asset_path(path)
        })
        .filter_map(|path| screenshot_file_time(&path).map(|time| (path, time)))
        .max_by_key(|(_, time)| *time)
        .map(|(path, _)| path.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub fn last_screenshot() -> String {
    let photos_dir = vrchat_paths::vrchat_photos_location();
    if photos_dir.is_empty() {
        return String::new();
    }
    last_screenshot_in(Path::new(&photos_dir))
}

pub fn delete_all_screenshot_metadata(cache: &MetadataCacheDb, thumbnail_cache_dir: &Path) {
    let photos_dir = vrchat_paths::vrchat_photos_location();
    if photos_dir.is_empty() {
        return;
    }
    for entry in walkdir::WalkDir::new(&photos_dir).into_iter().flatten() {
        if entry.file_type().is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("png"))
        {
            delete_text_metadata(&entry.path().to_string_lossy(), true);
        }
    }
    cache.clear_all();
    delete_all_thumbnail_cache_files(thumbnail_cache_dir, cache);
}

pub fn add_screenshot_metadata(
    path: &str,
    metadata_string: &str,
    world_id: &str,
    change_filename: bool,
) -> String {
    let original_path = PathBuf::from(path);
    if !is_vrchat_screenshot_path(&original_path) {
        return String::new();
    }

    let mut current_path = original_path;
    let mut renamed = false;

    for attempt in 0..SCREENSHOT_READY_RETRY_COUNT {
        let current_path_string = path_string(&current_path);
        if !is_png_file(&current_path_string) || !can_decode_image(&current_path) {
            sleep_before_next_screenshot_attempt(attempt);
            continue;
        }

        if has_vrcx_metadata(&current_path_string) {
            return current_path_string;
        }

        if change_filename && !renamed {
            let Some(next_path) = screenshot_path_with_world_id(&current_path, world_id) else {
                return String::new();
            };

            if next_path != current_path {
                match std::fs::rename(&current_path, &next_path) {
                    Ok(()) => {
                        current_path = next_path;
                    }
                    Err(_) => {
                        sleep_before_next_screenshot_attempt(attempt);
                        continue;
                    }
                }
            }
            renamed = true;
        }

        let current_path_string = path_string(&current_path);
        if write_vrcx_metadata(metadata_string, &current_path_string) {
            return current_path_string;
        }

        sleep_before_next_screenshot_attempt(attempt);
    }

    String::new()
}

pub fn find_screenshots(
    query: &str,
    directory: &str,
    search_type: ScreenshotSearchType,
    cache_db: &MetadataCacheDb,
) -> Vec<String> {
    let dir = Path::new(directory);
    if !dir.exists() {
        return Vec::new();
    }

    let mut result = Vec::new();
    let mut to_cache: Vec<(String, Option<String>)> = Vec::new();

    let files: Vec<String> = walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path()
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
        })
        .map(|e| e.path().to_string_lossy().into_owned())
        .collect();

    for file in &files {
        let metadata = if let Some(cached) = cache_db.get_metadata(file) {
            serde_json::from_str::<ScreenshotMetadata>(&cached).ok()
        } else if cache_db.is_cached(file) {
            None
        } else {
            let m = get_screenshot_metadata(file);
            let json = m
                .as_ref()
                .filter(|m| m.error.is_none())
                .and_then(|m| serde_json::to_string(m).ok());
            to_cache.push((file.clone(), json));
            m.filter(|m| m.error.is_none())
        };

        if let Some(ref meta) = metadata {
            let matched = match search_type {
                ScreenshotSearchType::Username => meta.contains_player_name(query),
                ScreenshotSearchType::UserId => meta.contains_player_id(query),
                ScreenshotSearchType::WorldName => meta
                    .world
                    .name
                    .as_ref()
                    .is_some_and(|n| n.to_lowercase().contains(&query.to_lowercase())),
                ScreenshotSearchType::WorldId => meta.world.id == query,
            };
            if matched {
                if let Some(ref sf) = meta.source_file {
                    result.push(sf.clone());
                } else {
                    result.push(file.clone());
                }
            }
        }
    }

    if !to_cache.is_empty() {
        cache_db.bulk_add(&to_cache);
    }

    result
}

fn screenshot_library_entry_from_path(
    scan_root: &str,
    path: &Path,
) -> Option<ScreenshotLibraryEntry> {
    let metadata = std::fs::metadata(path).ok()?;
    let path_value = path_string(path);
    let folder_path = path.parent().map(path_string).unwrap_or_default();
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let modified_at = metadata
        .modified()
        .map(unix_time_millis)
        .unwrap_or_default();
    let created_at = metadata.created().ok().map(unix_time_millis);
    let (width, height) = read_png_dimensions(&path_value);
    let screenshot_metadata = get_screenshot_metadata(&path_value);
    let error = screenshot_metadata
        .as_ref()
        .and_then(|metadata| metadata.error.clone());
    let metadata_json = screenshot_metadata
        .as_ref()
        .filter(|metadata| metadata.error.is_none())
        .and_then(|metadata| serde_json::to_string(metadata).ok());
    let (world_id, world_name, captured_at) = screenshot_metadata
        .as_ref()
        .filter(|metadata| metadata.error.is_none())
        .map(|metadata| {
            (
                option_string(&metadata.world.id),
                metadata
                    .world
                    .name
                    .clone()
                    .filter(|value| !value.is_empty()),
                metadata.timestamp.clone().filter(|value| !value.is_empty()),
            )
        })
        .unwrap_or_default();

    Some(ScreenshotLibraryEntry {
        scan_root: scan_root.to_string(),
        path: path_value,
        folder_path,
        file_name,
        size_bytes: metadata.len() as i64,
        modified_at,
        created_at,
        width,
        height,
        world_id,
        world_name,
        captured_at,
        metadata_json,
        error,
    })
}

fn scan_screenshot_library_in(
    root: &Path,
    cache: &MetadataCacheDb,
    thumbnail_cache_dir: Option<&Path>,
    force: bool,
) -> ScreenshotLibraryScanStatus {
    let mut status = ScreenshotLibraryScanStatus {
        running: true,
        ..Default::default()
    };

    if !root.is_dir() {
        status.running = false;
        status.error = Some("Screenshot folder does not exist.".into());
        status.last_scan_at = Some(now_rfc3339());
        return status;
    }

    let root_string = path_string(root);
    let existing = cache.library_file_states(&root_string);
    let mut seen = HashSet::new();
    let mut changed_entries = Vec::new();
    let mut traversal_error_count = 0usize;
    let mut file_error_count = 0usize;

    for entry in walkdir::WalkDir::new(root).into_iter() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                traversal_error_count += 1;
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if !path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
            || is_screenshot_content_asset_path(path)
        {
            continue;
        }

        status.scanned += 1;
        let path_value = path_string(path);
        seen.insert(path_value.clone());
        let Ok(metadata) = std::fs::metadata(path) else {
            file_error_count += 1;
            continue;
        };
        let size_bytes = metadata.len() as i64;
        let modified_at = metadata
            .modified()
            .map(unix_time_millis)
            .unwrap_or_default();

        if !force
            && existing.get(&path_value).is_some_and(|cached| {
                cached.size_bytes == size_bytes
                    && cached.modified_at == modified_at
                    && cached.index_version >= SCREENSHOT_LIBRARY_INDEX_VERSION
            })
        {
            status.skipped += 1;
            continue;
        }

        if let Some(library_entry) = screenshot_library_entry_from_path(&root_string, path) {
            changed_entries.push(library_entry);
            status.changed += 1;
        } else {
            file_error_count += 1;
        }
    }

    status.indexed = changed_entries.len();
    let prune_missing = traversal_error_count == 0 && file_error_count == 0;
    let deleted_source_paths = if prune_missing {
        existing
            .keys()
            .filter(|path| !seen.contains(*path))
            .cloned()
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let mut errors = Vec::new();
    match cache.replace_library_entries(&root_string, &seen, &changed_entries, prune_missing) {
        Ok(deleted) => {
            status.deleted = deleted;
            if deleted > 0 {
                if let Some(cache_dir) = thumbnail_cache_dir {
                    delete_thumbnail_cache_for_source_paths(
                        cache_dir,
                        cache,
                        &deleted_source_paths,
                    );
                }
            }
        }
        Err(error) => {
            errors.push(error.to_string());
        }
    }
    if traversal_error_count > 0 {
        errors.push(format!(
            "Failed to read {traversal_error_count} screenshot entries; skipped pruning missing files."
        ));
    }
    if file_error_count > 0 {
        errors.push(format!(
            "Failed to read {file_error_count} screenshot files; skipped pruning missing files."
        ));
    }
    if !errors.is_empty() {
        status.error = Some(errors.join(" "));
    }
    status.running = false;
    status.last_scan_at = Some(now_rfc3339());
    status
}

pub fn start_screenshot_library_scan(
    cache: &MetadataCacheDb,
    thumbnail_cache_dir: PathBuf,
    force: bool,
) -> ScreenshotLibraryScanStatus {
    let root = vrchat_paths::vrchat_photos_location();
    if root.is_empty() {
        let status = ScreenshotLibraryScanStatus {
            running: false,
            error: Some("VRChat photos folder is not configured.".into()),
            last_scan_at: Some(now_rfc3339()),
            ..Default::default()
        };
        cache.set_scan_status(status.clone());
        return status;
    }

    if !cache.try_begin_scan() {
        return cache.scan_status();
    }

    let cache_for_scan = cache.clone();
    cache.set_scan_status(ScreenshotLibraryScanStatus {
        running: true,
        ..Default::default()
    });
    std::thread::spawn(move || {
        let status = scan_screenshot_library_in(
            Path::new(&root),
            &cache_for_scan,
            Some(&thumbnail_cache_dir),
            force,
        );
        cache_for_scan.finish_scan(status);
    });

    cache.scan_status()
}

pub fn screenshot_folder_tree(cache: &MetadataCacheDb) -> Result<ScreenshotFolderTree> {
    let root_path = vrchat_paths::vrchat_photos_location();
    Ok(cache.screenshot_folder_tree_for_root(&root_path)?)
}

pub fn list_screenshot_folder_images(
    cache: &MetadataCacheDb,
    folder_path: &str,
) -> Result<Vec<ScreenshotLibraryImage>> {
    let root_path = vrchat_paths::vrchat_photos_location();
    Ok(cache.list_screenshot_folder_images_for_root(&root_path, folder_path)?)
}

pub fn list_world_screenshots(
    cache: &MetadataCacheDb,
    world_id: &str,
) -> Result<Vec<ScreenshotLibraryImage>> {
    let root_path = vrchat_paths::vrchat_photos_location();
    Ok(cache.list_world_screenshots_for_root(&root_path, world_id)?)
}

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

fn delete_thumbnail_cache_for_source_paths(
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

fn delete_all_thumbnail_cache_files(cache_dir: &Path, cache: &MetadataCacheDb) {
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
) -> Result<String> {
    let root = vrchat_paths::vrchat_photos_location();
    ensure_screenshot_thumbnail_in_root(path, cache_dir, cache, Path::new(&root))
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
mod tests {
    use super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn write_test_png(path: &Path) -> Result<()> {
        write_test_png_with_size(path, 2, 2)
    }

    fn write_test_png_with_size(path: &Path, width: u32, height: u32) -> Result<()> {
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            width,
            height,
            image::Rgba([12, 34, 56, 255]),
        ));
        let mut buf = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut buf);
        img.write_with_encoder(encoder)
            .map_err(|e| Error::Custom(format!("png encode: {e}")))?;
        std::fs::write(path, buf)?;
        Ok(())
    }

    fn write_text_chunk(path: &Path, keyword: &str, text: &str) -> Result<()> {
        let path_str = path.to_string_lossy();
        let mut png = png::PngFile::open_rw(&path_str)
            .map_err(|e| Error::Custom(format!("png open: {e}")))?;
        let chunk = png::generate_text_chunk(keyword, text);
        assert!(png.write_chunk(&chunk));
        Ok(())
    }

    #[test]
    fn get_screenshot_metadata_reads_legacy_lfs_world_and_players_from_png() -> Result<()> {
        let dir = TestDir::new("screenshot-legacy-lfs");
        let path = dir.path.join("legacy.png");
        write_test_png(&path)?;
        write_text_chunk(
            &path,
            "Description",
            "lfs|2|author:usr_author,Ava|world:wrld_legacy,12345,Legacy World|pos:1.5,2.5,3.5|players:usr_one,1,2,3,Player One;usr_two,4.5,5.5,6.5,Player Two",
        )?;

        let path_str = path.to_string_lossy();
        let metadata = get_screenshot_metadata(&path_str).expect("metadata");

        assert_eq!(metadata.application.as_deref(), Some("lfs"));
        assert_eq!(metadata.world.id, "wrld_legacy");
        assert_eq!(metadata.world.name.as_deref(), Some("Legacy World"));
        assert_eq!(metadata.world.instance_id, "wrld_legacy:12345");
        assert_eq!(metadata.players.len(), 2);
        assert_eq!(metadata.players[0].id, "usr_one");
        assert_eq!(metadata.players[0].display_name, "Player One");
        assert_eq!(metadata.players[0].pos, Some([1.0, 2.0, 3.0]));
        assert_eq!(metadata.players[1].id, "usr_two");
        assert_eq!(metadata.players[1].display_name, "Player Two");
        assert_eq!(metadata.players[1].pos, Some([4.5, 5.5, 6.5]));
        Ok(())
    }

    #[test]
    fn add_screenshot_metadata_writes_vrcx_world_and_players_for_new_screenshot() -> Result<()> {
        let dir = TestDir::new("screenshot-vrcx-metadata");
        let path = dir
            .path
            .join("VRChat_2026-05-08_00-00-00.000_3840x2160.png");
        write_test_png(&path)?;
        let path_str = path.to_string_lossy().into_owned();
        let metadata_json = serde_json::json!({
            "application": "VRCX-0",
            "version": 1,
            "author": {
                "id": "usr_author",
                "displayName": "Ava"
            },
            "world": {
                "id": "wrld_new",
                "name": "New Screenshot World",
                "instanceId": "wrld_new:98765~region(us)"
            },
            "players": [
                {
                    "id": "usr_friend",
                    "displayName": "Friend One"
                }
            ]
        })
        .to_string();

        let written_path = add_screenshot_metadata(&path_str, &metadata_json, "wrld_new", false);
        let metadata = get_screenshot_metadata(&path_str).expect("metadata");

        assert_eq!(written_path, path_str);
        assert!(has_vrcx_metadata(&path_str));
        assert_eq!(metadata.application.as_deref(), Some("VRCX-0"));
        assert_eq!(metadata.world.id, "wrld_new");
        assert_eq!(metadata.world.name.as_deref(), Some("New Screenshot World"));
        assert_eq!(metadata.world.instance_id, "wrld_new:98765~region(us)");
        assert_eq!(metadata.players.len(), 1);
        assert_eq!(metadata.players[0].id, "usr_friend");
        assert_eq!(metadata.players[0].display_name, "Friend One");
        Ok(())
    }

    #[test]
    fn get_screenshot_metadata_merges_vrchat_world_name_with_vrcx_players() -> Result<()> {
        let dir = TestDir::new("screenshot-vrchat-vrcx-merge");
        let path = dir
            .path
            .join("VRChat_2026-05-08_00-00-01.000_3840x2160.png");
        write_test_png(&path)?;
        write_text_chunk(
            &path,
            "XML:com.adobe.xmp",
            r#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><CreatorTool>VRChat</CreatorTool><Author>VRChat User</Author><AuthorID>usr_author</AuthorID><DateTime>2026-05-08T00:00:01.000Z</DateTime><WorldID>wrld_current</WorldID><WorldDisplayName>Current World Friends</WorldDisplayName></x:xmpmeta>"#,
        )?;
        let path_str = path.to_string_lossy().into_owned();
        let metadata_json = serde_json::json!({
            "application": "VRCX-0",
            "version": 1,
            "author": {
                "id": "usr_author",
                "displayName": "Ava"
            },
            "world": {
                "id": "wrld_current",
                "name": "JSON World",
                "instanceId": "wrld_current:12345~hidden(usr_hidden)~region(us)"
            },
            "players": [
                {
                    "id": "usr_one",
                    "displayName": "Player One"
                },
                {
                    "id": "usr_two",
                    "displayName": "Player Two"
                }
            ]
        })
        .to_string();

        assert_eq!(
            add_screenshot_metadata(&path_str, &metadata_json, "wrld_current", false),
            path_str
        );
        let metadata = get_screenshot_metadata(&path_str).expect("metadata");

        assert_eq!(metadata.application.as_deref(), Some("VRChat"));
        assert_eq!(metadata.author.id, "usr_author");
        assert_eq!(metadata.author.display_name.as_deref(), Some("VRChat User"));
        assert_eq!(
            metadata.timestamp.as_deref(),
            Some("2026-05-08T00:00:01.000Z")
        );
        assert_eq!(metadata.world.id, "wrld_current");
        assert_eq!(
            metadata.world.name.as_deref(),
            Some("Current World Friends")
        );
        assert_eq!(
            metadata.world.instance_id,
            "wrld_current:12345~hidden(usr_hidden)~region(us)"
        );
        assert_eq!(
            metadata
                .players
                .iter()
                .map(|player| player.display_name.as_str())
                .collect::<Vec<_>>(),
            vec!["Player One", "Player Two"]
        );
        Ok(())
    }

    #[test]
    fn screenshot_library_scan_indexes_skips_and_deletes_png_files() -> Result<()> {
        let dir = TestDir::new("screenshot-library");
        let photos_dir = dir.path.join("photos");
        let nested_dir = photos_dir.join("nested");
        std::fs::create_dir_all(&nested_dir)?;
        let db_path = dir.path.join("metadataCache.db");
        let cache = MetadataCacheDb::new(&db_path)?;
        let image_path = nested_dir.join("VRChat_2026-05-08_00-00-02.000_3840x2160.png");
        write_test_png(&image_path)?;
        let metadata_json = serde_json::json!({
            "application": "VRCX-0",
            "version": 1,
            "author": {
                "id": "usr_author",
                "displayName": "Ava"
            },
            "world": {
                "id": "wrld_library",
                "name": "Library World",
                "instanceId": "wrld_library:12345"
            },
            "players": [],
            "timestamp": "2026-05-08T00:00:02.000Z"
        })
        .to_string();
        write_text_chunk(&image_path, "Description", &metadata_json)?;

        let thumb_dir = dir.path.join("thumbs");
        let first_status = scan_screenshot_library_in(&photos_dir, &cache, Some(&thumb_dir), false);
        assert_eq!(first_status.scanned, 1);
        assert_eq!(first_status.indexed, 1);
        assert_eq!(first_status.changed, 1);
        assert_eq!(first_status.skipped, 0);
        assert_eq!(first_status.deleted, 0);
        assert_eq!(first_status.error, None);

        let folder_images = cache.list_screenshot_folder_images_for_root(
            &photos_dir.to_string_lossy(),
            &nested_dir.to_string_lossy(),
        )?;
        assert_eq!(folder_images.len(), 1);
        assert_eq!(
            folder_images[0].path,
            image_path.to_string_lossy().into_owned()
        );
        assert_eq!(folder_images[0].world_id.as_deref(), Some("wrld_library"));
        assert_eq!(
            folder_images[0].world_name.as_deref(),
            Some("Library World")
        );
        assert_eq!(folder_images[0].width, Some(2));
        assert_eq!(folder_images[0].height, Some(2));

        let world_images =
            cache.list_world_screenshots_for_root(&photos_dir.to_string_lossy(), "wrld_library")?;
        assert_eq!(world_images.len(), 1);
        assert_eq!(
            world_images[0].path,
            image_path.to_string_lossy().into_owned()
        );

        let image_path_string = image_path.to_string_lossy().into_owned();
        let thumb_path = ensure_screenshot_thumbnail_in_root(
            &image_path_string,
            &thumb_dir,
            &cache,
            &photos_dir,
        )?;
        assert!(Path::new(&thumb_path).is_file());

        let second_status =
            scan_screenshot_library_in(&photos_dir, &cache, Some(&thumb_dir), false);
        assert_eq!(second_status.scanned, 1);
        assert_eq!(second_status.indexed, 0);
        assert_eq!(second_status.changed, 0);
        assert_eq!(second_status.skipped, 1);
        assert_eq!(second_status.deleted, 0);

        std::fs::remove_file(&image_path)?;
        let third_status = scan_screenshot_library_in(&photos_dir, &cache, Some(&thumb_dir), false);
        assert_eq!(third_status.scanned, 0);
        assert_eq!(third_status.deleted, 1);
        assert!(cache
            .list_screenshot_folder_images_for_root(
                &photos_dir.to_string_lossy(),
                &nested_dir.to_string_lossy()
            )?
            .is_empty());
        assert!(cache
            .list_world_screenshots_for_root(&photos_dir.to_string_lossy(), "wrld_library")?
            .is_empty());
        assert!(!Path::new(&thumb_path).exists());
        Ok(())
    }

    #[test]
    fn screenshot_library_scan_repairs_stale_rows_without_metadata() -> Result<()> {
        let dir = TestDir::new("screenshot-library-stale-metadata");
        let photos_dir = dir.path.join("photos");
        std::fs::create_dir_all(&photos_dir)?;
        let db_path = dir.path.join("metadataCache.db");
        let cache = MetadataCacheDb::new(&db_path)?;
        let image_path = photos_dir.join("VRChat_2026-05-08_00-00-06.000_3840x2160.png");
        write_test_png(&image_path)?;
        let metadata_json = serde_json::json!({
            "application": "VRCX-0",
            "version": 1,
            "author": {
                "id": "usr_author",
                "displayName": "Ava"
            },
            "world": {
                "id": "wrld_repaired",
                "name": "Repaired World",
                "instanceId": "wrld_repaired:12345"
            },
            "players": []
        })
        .to_string();
        write_text_chunk(&image_path, "Description", &metadata_json)?;

        let file_metadata = std::fs::metadata(&image_path)?;
        let modified_at = file_metadata
            .modified()
            .map(unix_time_millis)
            .unwrap_or_default();
        let image_path_string = image_path.to_string_lossy().into_owned();
        cache.replace_library_entries(
            &photos_dir.to_string_lossy(),
            &HashSet::from([image_path_string.clone()]),
            &[ScreenshotLibraryEntry {
                scan_root: photos_dir.to_string_lossy().into_owned(),
                path: image_path_string.clone(),
                folder_path: photos_dir.to_string_lossy().into_owned(),
                file_name: "VRChat_2026-05-08_00-00-06.000_3840x2160.png".into(),
                size_bytes: file_metadata.len() as i64,
                modified_at,
                created_at: None,
                width: None,
                height: None,
                world_id: None,
                world_name: None,
                captured_at: None,
                metadata_json: None,
                error: None,
            }],
            false,
        )?;
        cache.mark_library_entry_stale_for_test(&image_path_string)?;

        let status = scan_screenshot_library_in(&photos_dir, &cache, None, false);
        assert_eq!(status.scanned, 1);
        assert_eq!(status.indexed, 1);
        assert_eq!(status.changed, 1);
        assert_eq!(status.skipped, 0);

        let folder_images = cache.list_screenshot_folder_images_for_root(
            &photos_dir.to_string_lossy(),
            &photos_dir.to_string_lossy(),
        )?;
        assert_eq!(folder_images.len(), 1);
        assert_eq!(
            folder_images[0].world_name.as_deref(),
            Some("Repaired World")
        );
        Ok(())
    }

    #[test]
    fn screenshot_library_queries_are_scoped_to_scan_root() -> Result<()> {
        let dir = TestDir::new("screenshot-library-root-scope");
        let root_a = dir.path.join("root-a");
        let root_b = dir.path.join("root-b");
        std::fs::create_dir_all(&root_a)?;
        std::fs::create_dir_all(&root_b)?;
        let cache = MetadataCacheDb::new(&dir.path.join("metadataCache.db"))?;
        let image_path = root_a.join("VRChat_2026-05-08_00-00-03.000_3840x2160.png");
        write_test_png(&image_path)?;
        let metadata_json = serde_json::json!({
            "application": "VRCX-0",
            "version": 1,
            "author": {
                "id": "usr_author",
                "displayName": "Ava"
            },
            "world": {
                "id": "wrld_scoped",
                "name": "Scoped World",
                "instanceId": "wrld_scoped:12345"
            },
            "players": []
        })
        .to_string();
        write_text_chunk(&image_path, "Description", &metadata_json)?;

        let status_a = scan_screenshot_library_in(&root_a, &cache, None, false);
        assert_eq!(status_a.indexed, 1);
        let status_b = scan_screenshot_library_in(&root_b, &cache, None, false);
        assert_eq!(status_b.scanned, 0);

        assert_eq!(
            cache
                .list_world_screenshots_for_root(&root_a.to_string_lossy(), "wrld_scoped")?
                .len(),
            1
        );
        assert!(cache
            .list_world_screenshots_for_root(&root_b.to_string_lossy(), "wrld_scoped")?
            .is_empty());
        assert!(cache
            .screenshot_folder_tree_for_root(&root_b.to_string_lossy())?
            .folders
            .iter()
            .all(|folder| folder.total_image_count == 0));
        Ok(())
    }

    #[test]
    fn ensure_screenshot_thumbnail_generates_and_reuses_webp_cache() -> Result<()> {
        let dir = TestDir::new("screenshot-thumbnail-cache");
        let cache = MetadataCacheDb::new(&dir.path.join("metadataCache.db"))?;
        let source_path = dir
            .path
            .join("VRChat_2026-05-08_00-00-04.000_3840x2160.png");
        let thumb_dir = dir.path.join("thumbs");
        write_test_png_with_size(&source_path, 64, 32)?;
        let source_path_string = source_path.to_string_lossy().into_owned();

        let first_thumb = ensure_screenshot_thumbnail_in_root(
            &source_path_string,
            &thumb_dir,
            &cache,
            &dir.path,
        )?;
        assert!(Path::new(&first_thumb).is_file());
        assert!(first_thumb.ends_with(".webp"));

        let second_thumb = ensure_screenshot_thumbnail_in_root(
            &source_path_string,
            &thumb_dir,
            &cache,
            &dir.path,
        )?;
        assert_eq!(first_thumb, second_thumb);

        write_test_png_with_size(&source_path, 65, 32)?;
        let third_thumb = ensure_screenshot_thumbnail_in_root(
            &source_path_string,
            &thumb_dir,
            &cache,
            &dir.path,
        )?;
        assert!(Path::new(&third_thumb).is_file());
        assert_ne!(first_thumb, third_thumb);
        assert!(!Path::new(&first_thumb).exists());
        Ok(())
    }

    #[test]
    fn ensure_screenshot_thumbnail_rejects_sources_outside_root() -> Result<()> {
        let dir = TestDir::new("screenshot-thumbnail-root");
        let cache = MetadataCacheDb::new(&dir.path.join("metadataCache.db"))?;
        let source_root = dir.path.join("photos");
        let outside_root = dir.path.join("outside");
        let thumb_dir = dir.path.join("thumbs");
        std::fs::create_dir_all(&source_root)?;
        std::fs::create_dir_all(&outside_root)?;
        let outside_path = outside_root.join("VRChat_2026-05-08_00-00-05.000_3840x2160.png");
        write_test_png(&outside_path)?;

        let result = ensure_screenshot_thumbnail_in_root(
            &outside_path.to_string_lossy(),
            &thumb_dir,
            &cache,
            &source_root,
        );
        assert!(result.is_err());
        assert!(!thumb_dir.exists());
        Ok(())
    }

    #[test]
    fn is_path_inside_directory_rejects_sibling_paths() -> Result<()> {
        let dir = TestDir::new("screenshot-thumbnail-containment");
        let root = dir.path.join("thumbs");
        let sibling = dir.path.join("thumbs-sibling");
        std::fs::create_dir_all(&root)?;
        std::fs::create_dir_all(&sibling)?;
        let inside = root.join("inside.webp");
        let outside = sibling.join("outside.webp");
        std::fs::write(&inside, b"webp")?;
        std::fs::write(&outside, b"webp")?;

        assert!(is_path_inside_directory(&inside, &root));
        assert!(!is_path_inside_directory(&outside, &root));
        Ok(())
    }
}
