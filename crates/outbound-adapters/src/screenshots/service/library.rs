use super::metadata::is_screenshot_content_asset_path;
use super::paths::{is_png_path, now_rfc3339, option_string, path_string, unix_time_millis};
use super::thumbnail::delete_thumbnail_cache_for_source_paths;
use super::{
    get_screenshot_metadata, read_png_dimensions, HashSet, MetadataCacheDb, Path, PathBuf,
    PngDimensions, Result, ScreenshotFolderTree, ScreenshotLibraryEntry, ScreenshotLibraryImage,
    ScreenshotLibraryScanStatus, ScreenshotTimeWindow, ScreenshotWindowImages,
    SCREENSHOT_LIBRARY_INDEX_VERSION,
};
use vrcx_0_application::media::ScreenshotFavorites;
use vrcx_0_application_core::{RuntimeEventBus, TaskStopToken, TaskSupervisor};

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
    let PngDimensions { width, height } = read_png_dimensions(&path_value);
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
    let captured_at_ms = vrcx_0_core::screenshots::screenshot_captured_at_ms(
        captured_at.as_deref(),
        &file_name,
        modified_at,
    );

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
        captured_at_ms,
        metadata_json,
        error,
    })
}

pub(super) fn scan_screenshot_library_in(
    root: &Path,
    cache: &MetadataCacheDb,
    thumbnail_cache_dir: Option<&Path>,
    force: bool,
    stop_token: Option<&TaskStopToken>,
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
        if stop_token.is_some_and(TaskStopToken::is_stop_requested) {
            status.running = false;
            status.error = Some("Screenshot library scan was stopped.".into());
            status.last_scan_at = Some(now_rfc3339());
            return status;
        }
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
        if !is_png_path(path) || is_screenshot_content_asset_path(path) {
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

    status.indexed = u32::try_from(changed_entries.len()).unwrap_or(u32::MAX);
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
            status.deleted = u32::try_from(deleted).unwrap_or(u32::MAX);
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
    favorites: ScreenshotFavorites,
    thumbnail_cache_dir: PathBuf,
    event_bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    force: bool,
    root: String,
) -> ScreenshotLibraryScanStatus {
    if root.is_empty() {
        let status = ScreenshotLibraryScanStatus {
            running: false,
            error: Some("VRChat photos folder is not configured.".into()),
            last_scan_at: Some(now_rfc3339()),
            ..Default::default()
        };
        cache.set_scan_status(status.clone());
        event_bus.emit(status.clone());
        return status;
    }

    if !cache.try_begin_scan() {
        return cache.scan_status();
    }

    let cache_for_scan = cache.clone();
    let started = ScreenshotLibraryScanStatus {
        running: true,
        ..Default::default()
    };
    cache.set_scan_status(started.clone());
    event_bus.emit(started);
    tasks.spawn_cancellable_thread("screenshot-library-scan", move |stop_token| {
        let status = scan_screenshot_library_in(
            Path::new(&root),
            &cache_for_scan,
            Some(&thumbnail_cache_dir),
            force,
            Some(&stop_token),
        );
        if !stop_token.is_stop_requested() {
            if let Err(error) = favorites.relink_missing(&root) {
                tracing::warn!(%error, "failed to relink missing screenshot favorites");
            }
        }
        cache_for_scan.finish_scan(status.clone());
        event_bus.emit(status);
    });

    cache.scan_status()
}

pub fn screenshot_folder_tree(
    cache: &MetadataCacheDb,
    root_path: &str,
) -> Result<ScreenshotFolderTree> {
    Ok(cache.screenshot_folder_tree_for_root(root_path)?)
}

pub fn list_screenshot_folder_images(
    cache: &MetadataCacheDb,
    folder_path: &str,
    root_path: &str,
) -> Result<Vec<ScreenshotLibraryImage>> {
    Ok(cache.list_screenshot_folder_images_for_root(root_path, folder_path)?)
}

pub fn random_screenshot_path_in_folder_tree(
    cache: &MetadataCacheDb,
    folder_path: &str,
    root_path: &str,
) -> Result<Option<String>> {
    Ok(cache.random_screenshot_path_in_folder_tree_for_root(root_path, folder_path)?)
}

pub fn list_world_screenshots(
    cache: &MetadataCacheDb,
    world_id: &str,
    root_path: &str,
) -> Result<Vec<ScreenshotLibraryImage>> {
    Ok(cache.list_world_screenshots_for_root(root_path, world_id)?)
}

pub fn list_screenshots_in_windows(
    cache: &MetadataCacheDb,
    windows: &[ScreenshotTimeWindow],
    limit_per_window: i64,
    root_path: &str,
) -> Result<Vec<ScreenshotWindowImages>> {
    Ok(cache.list_screenshots_in_windows_for_root(root_path, windows, limit_per_window)?)
}

pub fn forget_screenshot_file(
    cache: &MetadataCacheDb,
    thumbnail_cache_dir: &Path,
    path: &str,
) -> Result<()> {
    cache.delete_screenshot_entry(path)?;
    delete_thumbnail_cache_for_source_paths(thumbnail_cache_dir, cache, &[path.to_owned()]);
    Ok(())
}
