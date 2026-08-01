#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{BackgroundImageConfigureInput, BackgroundImageProjection};

use crate::{error::AppError, state::AppState};

#[tauri::command]
#[specta::specta]
pub fn app__background_image_state_get(state: State<'_, AppState>) -> BackgroundImageProjection {
    state.desktop.background_image.projection()
}

#[tauri::command]
#[specta::specta]
pub async fn app__background_image_configure(
    state: State<'_, AppState>,
    input: BackgroundImageConfigureInput,
) -> Result<BackgroundImageProjection, AppError> {
    Ok(state
        .desktop
        .community_theme
        .configure_background_image(input)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__background_image_refresh(
    state: State<'_, AppState>,
) -> Result<BackgroundImageProjection, AppError> {
    Ok(state
        .desktop
        .community_theme
        .refresh_background_image(true)
        .await?)
}
