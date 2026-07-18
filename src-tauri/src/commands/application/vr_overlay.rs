#![allow(non_snake_case)]

use tauri::{AppHandle, Manager};
use vrcx_0_runtime_host_desktop::vr_overlay::VrOverlayRuntimeSnapshot;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__vr_overlay_status_get(
    app: AppHandle,
) -> Result<VrOverlayRuntimeSnapshot, AppError> {
    run_vr_overlay_task(app, "VR overlay status task", |state| {
        Ok(state.vr_overlay_snapshot()?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vr_overlay_enabled_set(
    app: AppHandle,
    enabled: bool,
) -> Result<VrOverlayRuntimeSnapshot, AppError> {
    run_vr_overlay_task(app, "VR overlay enabled task", move |state| {
        Ok(state.set_vr_overlay_enabled(enabled)?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vr_overlay_config_reload(
    app: AppHandle,
) -> Result<VrOverlayRuntimeSnapshot, AppError> {
    run_vr_overlay_task(app, "VR overlay config reload task", |state| {
        Ok(state.reload_vr_overlay_config()?)
    })
    .await
}

async fn run_vr_overlay_task<Run>(
    app: AppHandle,
    task_name: &'static str,
    run: Run,
) -> Result<VrOverlayRuntimeSnapshot, AppError>
where
    Run: FnOnce(&AppState) -> Result<VrOverlayRuntimeSnapshot, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        run(&state)
    })
    .await
    .map_err(|error| AppError::Custom(format!("{task_name} failed: {error}")))?
}
