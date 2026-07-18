#![allow(non_snake_case)]

use std::path::Path;

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application_game as screenshot;

use vrcx_0_host_desktop::host_capabilities::{require_host_capability, HostCapability};
use vrcx_0_host_desktop::vrchat_paths;

fn ensure_screenshot_read_allowed(state: &AppState, path: &str) -> Result<(), AppError> {
    state
        .desktop
        .host_file_access
        .ensure_read_allowed(path, &state.paths)?;
    if !screenshot::is_vrchat_screenshot_file_path(Path::new(path)) {
        return Err(AppError::Custom(
            "Screenshot metadata commands require a VRChat PNG screenshot path.".into(),
        ));
    }
    Ok(())
}

fn ensure_screenshot_write_allowed(state: &AppState, path: &str) -> Result<(), AppError> {
    state
        .desktop
        .host_file_access
        .ensure_write_allowed(path, &state.paths)?;
    if !screenshot::is_vrchat_screenshot_file_path(Path::new(path)) {
        return Err(AppError::Custom(
            "Screenshot metadata commands require a VRChat PNG screenshot path.".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__get_extra_screenshot_data(
    state: State<'_, AppState>,
    path: String,
    carousel_cache: bool,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    ensure_screenshot_read_allowed(&state, &path)?;
    Ok(screenshot::extra_screenshot_data(&path, carousel_cache)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__get_screenshot_metadata(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    ensure_screenshot_read_allowed(&state, &path)?;
    Ok(screenshot::screenshot_metadata_json(&path)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__find_screenshots_by_search(
    state: State<'_, AppState>,
    search_query: String,
    search_type: Option<i32>,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    let cache = &state.game.screenshot_cache;
    Ok(screenshot::find_screenshots_json(
        &search_query,
        search_type,
        cache,
        &vrchat_paths::vrchat_photos_location(),
    )?)
}

#[tauri::command]
#[specta::specta]
pub fn app__start_screenshot_library_scan(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<screenshot::ScreenshotLibraryScanStatus, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    let cache = &state.game.screenshot_cache;
    Ok(screenshot::start_screenshot_library_scan(
        cache,
        state.paths.screenshot_thumbs.clone(),
        state.runtime_context.tasks.clone(),
        force.unwrap_or(false),
        vrchat_paths::vrchat_photos_location(),
    ))
}

#[tauri::command]
#[specta::specta]
pub fn app__get_screenshot_library_status(
    state: State<'_, AppState>,
) -> Result<screenshot::ScreenshotLibraryScanStatus, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(state.game.screenshot_cache.scan_status())
}

#[tauri::command]
#[specta::specta]
pub fn app__get_screenshot_folder_tree(
    state: State<'_, AppState>,
) -> Result<screenshot::ScreenshotFolderTree, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    let cache = &state.game.screenshot_cache;
    Ok(screenshot::screenshot_folder_tree(
        cache,
        &vrchat_paths::vrchat_photos_location(),
    )?)
}

#[tauri::command]
#[specta::specta]
pub fn app__get_screenshot_folder_images(
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<Vec<screenshot::ScreenshotLibraryImage>, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    let cache = &state.game.screenshot_cache;
    Ok(screenshot::list_screenshot_folder_images(
        cache,
        &folder_path,
        &vrchat_paths::vrchat_photos_location(),
    )?)
}

#[tauri::command]
#[specta::specta]
pub fn app__get_world_screenshots(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<Vec<screenshot::ScreenshotLibraryImage>, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    let cache = &state.game.screenshot_cache;
    Ok(screenshot::list_world_screenshots(
        cache,
        &world_id,
        &vrchat_paths::vrchat_photos_location(),
    )?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__ensure_screenshot_thumbnail(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    ensure_screenshot_read_allowed(&state, &path)?;
    let cache = state.game.screenshot_cache.clone();
    let cache_dir = state.paths.screenshot_thumbs.clone();
    Ok(tauri::async_runtime::spawn_blocking(move || {
        screenshot::ensure_screenshot_thumbnail(
            &path,
            &cache_dir,
            &cache,
            &vrchat_paths::vrchat_photos_location(),
        )
    })
    .await
    .map_err(|error| AppError::Custom(format!("thumbnail task failed: {error}")))??)
}

#[tauri::command]
#[specta::specta]
pub fn app__get_last_screenshot() -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(screenshot::last_screenshot(
        &vrchat_paths::vrchat_photos_location(),
    ))
}

#[tauri::command]
#[specta::specta]
pub fn app__delete_screenshot_metadata(
    state: State<'_, AppState>,
    path: String,
) -> Result<bool, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    ensure_screenshot_write_allowed(&state, &path)?;
    Ok(screenshot::delete_text_metadata(&path, true))
}

#[tauri::command]
#[specta::specta]
pub fn app__delete_all_screenshot_metadata(state: State<'_, AppState>) -> Result<(), AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    let cache = &state.game.screenshot_cache;
    screenshot::delete_all_screenshot_metadata(
        cache,
        &state.paths.screenshot_thumbs,
        &vrchat_paths::vrchat_photos_location(),
    );
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app__add_screenshot_metadata(
    state: State<'_, AppState>,
    path: String,
    metadata_string: String,
    world_id: String,
    change_filename: Option<bool>,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    ensure_screenshot_write_allowed(&state, &path)?;
    Ok(screenshot::add_screenshot_metadata(
        &path,
        &metadata_string,
        &world_id,
        change_filename.unwrap_or(false),
    ))
}
