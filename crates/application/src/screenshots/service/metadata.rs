use super::library::find_screenshots;
use super::paths::{
    is_vrchat_screenshot_path, path_string, screenshot_path_with_world_id,
    sleep_before_next_screenshot_attempt, SCREENSHOT_CONTENT_FOLDERS, SCREENSHOT_READY_RETRY_COUNT,
};
use super::thumbnail::delete_all_thumbnail_cache_files;
use super::*;

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
    photos_dir: &str,
) -> Result<String> {
    let st = ScreenshotSearchType::from_i32(search_type.unwrap_or(0));
    if photos_dir.is_empty() {
        return Ok("[]".into());
    }
    let results = find_screenshots(search_query, photos_dir, st, cache);
    serde_json::to_string(&results).map_err(|e| Error::Custom(format!("serialize: {e}")))
}

pub(super) fn is_screenshot_content_asset_path(path: &Path) -> bool {
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        SCREENSHOT_CONTENT_FOLDERS
            .iter()
            .any(|folder| name.eq_ignore_ascii_case(folder))
    })
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::is_screenshot_content_asset_path;

    #[test]
    fn detects_screenshot_content_asset_folders_by_path_component() {
        assert!(is_screenshot_content_asset_path(Path::new(
            "Pictures/VRChat/Prints/VRChat_2026.png"
        )));
        assert!(is_screenshot_content_asset_path(Path::new(
            "/home/about/Pictures/VRChat/stickers/asset.png"
        )));
        assert!(is_screenshot_content_asset_path(Path::new(
            "/home/about/Pictures/VRChat/Emoji/asset.png"
        )));
        assert!(!is_screenshot_content_asset_path(Path::new(
            "/home/about/Pictures/VRChat/Printscreens/VRChat_2026.png"
        )));
        assert!(!is_screenshot_content_asset_path(Path::new(
            "/home/about/Pictures/VRChat/VRChat_2026.png"
        )));
    }
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

pub fn last_screenshot(photos_dir: &str) -> String {
    if photos_dir.is_empty() {
        return String::new();
    }
    last_screenshot_in(Path::new(&photos_dir))
}

pub fn delete_all_screenshot_metadata(
    cache: &MetadataCacheDb,
    thumbnail_cache_dir: &Path,
    photos_dir: &str,
) {
    if photos_dir.is_empty() {
        return;
    }
    for entry in walkdir::WalkDir::new(photos_dir).into_iter().flatten() {
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
