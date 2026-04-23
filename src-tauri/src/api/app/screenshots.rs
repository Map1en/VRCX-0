#![allow(non_snake_case)]

use tauri::State;

use crate::domain::screenshot::{self, SearchType};
use crate::error::AppError;
use crate::state::AppState;

use super::paths::app__get_vrchat_photos_location;

#[tauri::command]
pub fn app__get_extra_screenshot_data(
    path: String,
    _carousel_cache: bool,
) -> Result<String, AppError> {
    let p = std::path::Path::new(&path);
    let mut result = serde_json::Map::new();

    result.insert("filePath".into(), serde_json::json!(path));

    if let Ok(meta) = std::fs::metadata(p) {
        if let Ok(created) = meta.created() {
            let dt: chrono::DateTime<chrono::Utc> = created.into();
            result.insert("creationDate".into(), serde_json::json!(dt.to_rfc3339()));
        }
        result.insert("fileSizeBytes".into(), serde_json::json!(meta.len()));
    }
    if screenshot::is_png_file(&path) {
        let mut png = crate::domain::png::PngFile::open_read(&path);
        if let Ok(ref mut png) = png {
            let res = crate::domain::png::read_resolution(png);
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

    if _carousel_cache {
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
                if let Some(idx) = pngs.iter().position(|f| f == &path) {
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

    serde_json::to_string(&result).map_err(|e| AppError::Custom(format!("serialize: {e}")))
}

#[tauri::command]
pub fn app__get_screenshot_metadata(path: String) -> Result<String, AppError> {
    match screenshot::get_screenshot_metadata(&path) {
        Some(meta) => {
            serde_json::to_string(&meta).map_err(|e| AppError::Custom(format!("serialize: {e}")))
        }
        None => Ok(String::new()),
    }
}

#[tauri::command]
pub fn app__find_screenshots_by_search(
    state: State<'_, AppState>,
    search_query: String,
    search_type: Option<i32>,
) -> Result<String, AppError> {
    let st = SearchType::from_i32(search_type.unwrap_or(0));
    let photos_dir = app__get_vrchat_photos_location();
    if photos_dir.is_empty() {
        return Ok("[]".into());
    }
    let results =
        screenshot::find_screenshots(&search_query, &photos_dir, st, &state.screenshot_cache);
    serde_json::to_string(&results).map_err(|e| AppError::Custom(format!("serialize: {e}")))
}

#[tauri::command]
pub fn app__get_last_screenshot() -> Result<String, AppError> {
    let photos_dir = app__get_vrchat_photos_location();
    if photos_dir.is_empty() {
        return Ok(String::new());
    }
    let mut newest: Option<(String, std::time::SystemTime)> = None;
    if let Ok(entries) = walkdir::WalkDir::new(&photos_dir)
        .into_iter()
        .collect::<Result<Vec<_>, _>>()
    {
        for entry in entries {
            if entry.file_type().is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("png"))
            {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(modified) = meta.modified() {
                        if newest.as_ref().is_none_or(|(_, t)| modified > *t) {
                            newest = Some((entry.path().to_string_lossy().into_owned(), modified));
                        }
                    }
                }
            }
        }
    }
    Ok(newest.map(|(p, _)| p).unwrap_or_default())
}

#[tauri::command]
pub fn app__delete_screenshot_metadata(path: String) -> Result<bool, AppError> {
    screenshot::delete_text_metadata(&path, false);
    Ok(true)
}

#[tauri::command]
pub fn app__delete_all_screenshot_metadata(state: State<'_, AppState>) {
    let photos_dir = app__get_vrchat_photos_location();
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
            screenshot::delete_text_metadata(&entry.path().to_string_lossy(), true);
        }
    }
    state.screenshot_cache.clear_all();
}

#[tauri::command]
pub fn app__add_screenshot_metadata(
    path: String,
    metadata_string: String,
    _world_id: String,
    _change_filename: Option<bool>,
) -> Result<String, AppError> {
    if screenshot::has_vrcx_metadata(&path) {
        return Ok(path);
    }
    screenshot::write_vrcx_metadata(&metadata_string, &path);
    Ok(path)
}
