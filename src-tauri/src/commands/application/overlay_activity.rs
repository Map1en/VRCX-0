#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_activity::notification::{
    NotificationActivityFiltersSetInput, OverlayActivityPreferenceFilters,
};
use vrcx_0_application_activity::{
    overlay_activity_type_definitions, OverlayActivityTypeDefinition,
};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn app__overlay_activity_definitions_get(
) -> Result<Vec<OverlayActivityTypeDefinition>, AppError> {
    Ok(overlay_activity_type_definitions())
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__overlay_activity_filters_set(
    state: State<'_, AppState>,
    filters: OverlayActivityPreferenceFilters,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .set_overlay_activity_filters(filters)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__notification_activity_filters_set(
    state: State<'_, AppState>,
    input: NotificationActivityFiltersSetInput,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .set_notification_activity_filters(input)
        .map_err(AppError::from)
}
