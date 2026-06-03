#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{
    overlay_activity_type_definitions, OverlayActivitySnapshot, OverlayActivityTypeDefinition,
};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn app__overlay_activity_snapshot_get(
    state: State<'_, AppState>,
) -> Result<OverlayActivitySnapshot, AppError> {
    Ok(state.overlay_activity_snapshot())
}

#[tauri::command]
pub fn app__overlay_activity_definitions_get(
) -> Result<Vec<OverlayActivityTypeDefinition>, AppError> {
    Ok(overlay_activity_type_definitions())
}

#[tauri::command]
pub fn app__overlay_activity_filters_reload(state: State<'_, AppState>) -> Result<(), AppError> {
    state.reload_overlay_activity_filters();
    Ok(())
}
