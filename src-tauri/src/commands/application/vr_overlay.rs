#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_runtime_host::vr_overlay::VrOverlayRuntimeSnapshot;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn app__vr_overlay_status_get(
    state: State<'_, AppState>,
) -> Result<VrOverlayRuntimeSnapshot, AppError> {
    Ok(state.vr_overlay_snapshot())
}

#[tauri::command]
pub fn app__vr_overlay_enabled_set(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<VrOverlayRuntimeSnapshot, AppError> {
    Ok(state.set_vr_overlay_enabled(enabled)?)
}

#[tauri::command]
pub fn app__vr_overlay_config_reload(
    state: State<'_, AppState>,
) -> Result<VrOverlayRuntimeSnapshot, AppError> {
    Ok(state.reload_vr_overlay_config())
}
