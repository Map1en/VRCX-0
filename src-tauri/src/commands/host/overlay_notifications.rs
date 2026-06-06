#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn app__xs_notification(
    title: String,
    content: String,
    timeout: i32,
    opacity: f64,
    image: Option<String>,
) -> Result<(), AppError> {
    vrcx_0_host::overlay_notifications::send_xs_notification(
        &title,
        &content,
        timeout,
        opacity,
        image.as_deref(),
    )
    .map_err(|error| AppError::Custom(format!("XSOverlay notification: {error}")))?;
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn app__ovrt_notification(
    state: State<'_, AppState>,
    hud_notification: bool,
    wrist_notification: bool,
    title: String,
    body: String,
    timeout: i32,
    opacity: f64,
    image: Option<String>,
) -> Result<(), AppError> {
    state.ovr_toolkit.send_notification(
        hud_notification,
        wrist_notification,
        &title,
        &body,
        timeout,
        opacity,
        image.as_deref(),
    );
    Ok(())
}
