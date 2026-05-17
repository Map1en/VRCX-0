#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_runtime::screenshots as screenshot;

use vrcx_0_host::host_capabilities::{require_host_capability, HostCapability};

#[tauri::command]
pub fn app__get_extra_screenshot_data(
    path: String,
    carousel_cache: bool,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(screenshot::extra_screenshot_data(&path, carousel_cache)?)
}

#[tauri::command]
pub fn app__get_screenshot_metadata(path: String) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(screenshot::screenshot_metadata_json(&path)?)
}

#[tauri::command]
pub fn app__find_screenshots_by_search(
    state: State<'_, AppState>,
    search_query: String,
    search_type: Option<i32>,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(screenshot::find_screenshots_json(
        &search_query,
        search_type,
        &state.screenshot_cache,
    )?)
}

#[tauri::command]
pub fn app__start_screenshot_library_scan(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<screenshot::ScreenshotLibraryScanStatus, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(screenshot::start_screenshot_library_scan(
        &state.screenshot_cache,
        state.paths.screenshot_thumbs.clone(),
        force.unwrap_or(false),
    ))
}

#[tauri::command]
pub fn app__get_screenshot_library_status(
    state: State<'_, AppState>,
) -> Result<screenshot::ScreenshotLibraryScanStatus, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(state.screenshot_cache.scan_status())
}

#[tauri::command]
pub fn app__get_screenshot_folder_tree(
    state: State<'_, AppState>,
) -> Result<screenshot::ScreenshotFolderTree, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(screenshot::screenshot_folder_tree(&state.screenshot_cache)?)
}

#[tauri::command]
pub fn app__get_screenshot_folder_images(
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<Vec<screenshot::ScreenshotLibraryImage>, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(screenshot::list_screenshot_folder_images(
        &state.screenshot_cache,
        &folder_path,
    )?)
}

#[tauri::command]
pub fn app__get_world_screenshots(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<Vec<screenshot::ScreenshotLibraryImage>, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(screenshot::list_world_screenshots(
        &state.screenshot_cache,
        &world_id,
    )?)
}

#[tauri::command]
pub async fn app__ensure_screenshot_thumbnail(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    let cache = state.screenshot_cache.clone();
    let cache_dir = state.paths.screenshot_thumbs.clone();
    Ok(tauri::async_runtime::spawn_blocking(move || {
        screenshot::ensure_screenshot_thumbnail(&path, &cache_dir, &cache)
    })
    .await
    .map_err(|error| AppError::Custom(format!("thumbnail task failed: {error}")))??)
}

#[tauri::command]
pub fn app__get_last_screenshot() -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(screenshot::last_screenshot())
}

#[tauri::command]
pub fn app__delete_screenshot_metadata(path: String) -> Result<bool, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(screenshot::delete_text_metadata(&path, true))
}

#[tauri::command]
pub fn app__delete_all_screenshot_metadata(state: State<'_, AppState>) -> Result<(), AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    screenshot::delete_all_screenshot_metadata(
        &state.screenshot_cache,
        &state.paths.screenshot_thumbs,
    );
    Ok(())
}

#[tauri::command]
pub fn app__add_screenshot_metadata(
    path: String,
    metadata_string: String,
    world_id: String,
    change_filename: Option<bool>,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(screenshot::add_screenshot_metadata(
        &path,
        &metadata_string,
        &world_id,
        change_filename.unwrap_or(false),
    ))
}
