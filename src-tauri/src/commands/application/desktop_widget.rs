#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_runtime_host_desktop::desktop_widget::DesktopWidgetSnapshot;

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__desktop_widget_enabled_set(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<DesktopWidgetSnapshot, AppError> {
    let widget = state.runtime_host().desktop_widget();
    run_blocking("desktop widget enable", move || widget.set_enabled(enabled)).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__desktop_widget_pinned_toggle(
    state: State<'_, AppState>,
) -> Result<DesktopWidgetSnapshot, AppError> {
    let widget = state.runtime_host().desktop_widget();
    run_blocking("desktop widget pin", move || widget.toggle_pinned()).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__desktop_widget_click_through_toggle(
    state: State<'_, AppState>,
) -> Result<DesktopWidgetSnapshot, AppError> {
    let widget = state.runtime_host().desktop_widget();
    run_blocking("desktop widget click-through", move || {
        widget.toggle_click_through()
    })
    .await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__desktop_widget_show(state: State<'_, AppState>) {
    state.runtime_host().desktop_widget().bring_to_front();
}
