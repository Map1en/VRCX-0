#![allow(non_snake_case)]

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_core::screenshots::{
    ScreenshotExportProgress, ScreenshotFolderTree, ScreenshotLibraryImage,
    ScreenshotLibraryScanStatus, ScreenshotSearchResult,
};

use vrcx_0_host_desktop::host_capabilities::{require_host_capability, HostCapability};

fn ensure_screenshot_read_allowed(state: &AppState, path: &str) -> Result<(), AppError> {
    state
        .runtime_host()
        .screenshots()
        .ensure_read_allowed(path)?;
    Ok(())
}

fn ensure_screenshot_write_allowed(state: &AppState, path: &str) -> Result<(), AppError> {
    state
        .runtime_host()
        .screenshots()
        .ensure_write_allowed(path)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__get_extra_screenshot_data(
    state: State<'_, AppState>,
    path: String,
    carousel_cache: bool,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    ensure_screenshot_read_allowed(&state, &path)?;
    let screenshots = state.runtime_host().screenshots().clone();
    run_blocking("screenshot extra data", move || {
        screenshots.extra_data(&path, carousel_cache)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__get_screenshot_metadata(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    ensure_screenshot_read_allowed(&state, &path)?;
    let screenshots = state.runtime_host().screenshots().clone();
    run_blocking("screenshot metadata", move || {
        screenshots.metadata_json(&path)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__find_screenshots_by_search(
    state: State<'_, AppState>,
    search_query: String,
    search_type: Option<i32>,
) -> Result<Vec<ScreenshotSearchResult>, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    let screenshots = state.runtime_host().screenshots().clone();
    run_blocking("screenshot search", move || {
        Ok::<_, AppError>(screenshots.find(&search_query, search_type))
    })
    .await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__start_screenshot_library_scan(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<ScreenshotLibraryScanStatus, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(state
        .runtime_host()
        .start_screenshot_library_scan(force.unwrap_or(false)))
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__get_screenshot_library_status(
    state: State<'_, AppState>,
) -> Result<ScreenshotLibraryScanStatus, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(state.runtime_host().screenshots().scan_status())
}

#[tauri::command]
#[specta::specta]
pub async fn app__get_screenshot_folder_tree(
    state: State<'_, AppState>,
) -> Result<ScreenshotFolderTree, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    let screenshots = state.runtime_host().screenshots().clone();
    run_blocking("screenshot folder tree", move || screenshots.folder_tree()).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__get_screenshot_folder_images(
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<Vec<ScreenshotLibraryImage>, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    let screenshots = state.runtime_host().screenshots().clone();
    run_blocking("screenshot folder images", move || {
        screenshots.folder_images(&folder_path)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__get_world_screenshots(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<Vec<ScreenshotLibraryImage>, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    let screenshots = state.runtime_host().screenshots().clone();
    run_blocking("world screenshots", move || {
        screenshots.world_screenshots(&world_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__ensure_screenshot_thumbnail(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    ensure_screenshot_read_allowed(&state, &path)?;
    let screenshots = state.runtime_host().screenshots().clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || screenshots.ensure_thumbnail(&path))
            .await
            .map_err(|error| AppError::Custom(format!("thumbnail task failed: {error}")))??,
    )
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__get_last_screenshot(state: State<'_, AppState>) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    Ok(state.runtime_host().screenshots().last())
}

#[tauri::command]
#[specta::specta]
pub async fn app__delete_screenshot_metadata(
    state: State<'_, AppState>,
    path: String,
) -> Result<bool, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    ensure_screenshot_write_allowed(&state, &path)?;
    let screenshots = state.runtime_host().screenshots().clone();
    run_blocking("screenshot metadata delete", move || {
        Ok::<_, AppError>(screenshots.delete_metadata(&path))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__delete_screenshot_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<(), AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    let screenshots = state.runtime_host().screenshots().clone();
    tauri::async_runtime::spawn_blocking(move || screenshots.delete_file(&path))
        .await
        .map_err(|error| AppError::Custom(format!("screenshot delete task failed: {error}")))??;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__delete_all_screenshot_metadata(
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    let screenshots = state.runtime_host().screenshots().clone();
    run_blocking("screenshot metadata clear", move || {
        screenshots.delete_all_metadata();
        Ok::<_, AppError>(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__add_screenshot_metadata(
    state: State<'_, AppState>,
    path: String,
    metadata_string: String,
    world_id: String,
    change_filename: Option<bool>,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    ensure_screenshot_write_allowed(&state, &path)?;
    let screenshots = state.runtime_host().screenshots().clone();
    tauri::async_runtime::spawn_blocking(move || {
        screenshots.add_metadata(
            &path,
            &metadata_string,
            &world_id,
            change_filename.unwrap_or(false),
        )
    })
    .await
    .map_err(|error| AppError::Custom(format!("screenshot metadata task failed: {error}")))
}

#[tauri::command]
#[specta::specta]
pub async fn app__export_screenshots_zip(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
    group_by_folder: bool,
) -> Result<String, AppError> {
    use tauri_plugin_dialog::DialogExt;

    require_host_capability(HostCapability::ScreenshotCache)?;
    let screenshots = state.runtime_host().screenshots().clone();
    let plan = screenshots.plan_export(&paths, group_by_folder)?;
    let total_files = plan.entries.len() as u32;
    let total_bytes = plan.total_bytes;

    let selected = super::dialog::save_file(
        app_handle
            .dialog()
            .file()
            .set_file_name(&plan.file_name)
            .add_filter("Zip Archive", &["zip"]),
    )
    .await;

    let Some(selected) = selected else {
        return Ok(String::new());
    };
    let output_path = match selected {
        tauri_plugin_dialog::FilePath::Path(path) => path,
        other => PathBuf::from(other.to_string()),
    };
    state.runtime_host().register_host_file_access(&output_path);

    screenshots.emit_export_progress(ScreenshotExportProgress {
        running: true,
        total_files,
        total_bytes,
        ..Default::default()
    });

    let export_screenshots = screenshots.clone();
    let output_for_task = output_path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        export_screenshots.export_zip(&plan, &output_for_task)
    })
    .await
    .map_err(|error| AppError::Custom(format!("screenshot export task failed: {error}")));

    let outcome = match result {
        Ok(Ok(outcome)) => outcome,
        Ok(Err(error)) => {
            screenshots.emit_export_progress(ScreenshotExportProgress {
                total_files,
                total_bytes,
                error: Some(error.to_string()),
                ..Default::default()
            });
            return Err(error.into());
        }
        Err(error) => {
            screenshots.emit_export_progress(ScreenshotExportProgress {
                total_files,
                total_bytes,
                error: Some(error.to_string()),
                ..Default::default()
            });
            return Err(error);
        }
    };

    let output_display = output_path.to_string_lossy().into_owned();
    screenshots.emit_export_progress(ScreenshotExportProgress {
        running: false,
        finalizing: false,
        total_files,
        written_files: outcome.written_files,
        skipped_files: outcome.skipped_files,
        total_bytes,
        written_bytes: outcome.written_bytes,
        cancelled: outcome.cancelled,
        error: None,
        output_path: Some(output_display.clone()),
    });

    if outcome.cancelled {
        return Ok(String::new());
    }
    Ok(output_display)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__cancel_screenshot_export(state: State<'_, AppState>) -> Result<(), AppError> {
    require_host_capability(HostCapability::ScreenshotCache)?;
    state.runtime_host().screenshots().request_export_cancel();
    Ok(())
}
