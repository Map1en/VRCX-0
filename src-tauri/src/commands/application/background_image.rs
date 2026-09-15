#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::profile::{BackgroundImageConfigureInput, BackgroundImageProjection};

use crate::{error::AppError, state::AppState};

#[tauri::command(async)]
#[specta::specta]
pub fn app__background_image_state_get(state: State<'_, AppState>) -> BackgroundImageProjection {
    state.runtime_host().background_image_projection()
}

#[tauri::command]
#[specta::specta]
pub async fn app__background_image_configure(
    state: State<'_, AppState>,
    input: BackgroundImageConfigureInput,
) -> Result<BackgroundImageProjection, AppError> {
    Ok(state
        .runtime_host()
        .configure_background_image(input)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__background_image_refresh(
    state: State<'_, AppState>,
) -> Result<BackgroundImageProjection, AppError> {
    Ok(state.runtime_host().refresh_background_image(true).await?)
}
