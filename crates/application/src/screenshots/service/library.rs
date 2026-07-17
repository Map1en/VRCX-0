use super::metadata::is_screenshot_content_asset_path;
use super::paths::{now_rfc3339, option_string, path_string, unix_time_millis};
use super::thumbnail::delete_thumbnail_cache_for_source_paths;
use super::*;
use crate::task_supervisor::{TaskStopToken, TaskSupervisor};

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
    tasks.spawn_cancellable_thread("screenshot-library-scan", move |stop_token| {
        let status = scan_screenshot_library_in(
            Path::new(&root),
            &cache_for_scan,
            Some(&thumbnail_cache_dir),
            force,
            Some(&stop_token),
        );
        cache_for_scan.finish_scan(status);
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

pub fn list_world_screenshots(
    cache: &MetadataCacheDb,
    world_id: &str,
    root_path: &str,
) -> Result<Vec<ScreenshotLibraryImage>> {
    Ok(cache.list_world_screenshots_for_root(root_path, world_id)?)
}
