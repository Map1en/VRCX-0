#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{
    CommunityThemeCatalog, CommunityThemeConfigureInput, CommunityThemeProjection,
    CommunityThemeStatsById,
};

use crate::{error::AppError, state::AppState};

#[tauri::command]
#[specta::specta]
pub async fn app__community_theme_state_get(
    state: State<'_, AppState>,
) -> Result<CommunityThemeProjection, AppError> {
    Ok(state.desktop.community_theme.initialize().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__community_theme_catalog_get(
    state: State<'_, AppState>,
) -> Result<CommunityThemeCatalog, AppError> {
    Ok(state.desktop.community_theme.load_catalog().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__community_theme_stats_get(
    state: State<'_, AppState>,
) -> Result<CommunityThemeStatsById, AppError> {
    Ok(state.desktop.community_theme.load_stats().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__community_theme_configure(
    state: State<'_, AppState>,
    input: CommunityThemeConfigureInput,
) -> Result<CommunityThemeProjection, AppError> {
    Ok(state.desktop.community_theme.configure(input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__community_theme_install_report(
    state: State<'_, AppState>,
    theme_id: String,
) -> Result<bool, AppError> {
    Ok(state
        .desktop
        .community_theme
        .report_install(&theme_id)
        .await)
}
