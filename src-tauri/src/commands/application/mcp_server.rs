#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_host_desktop::shell_actions;
use vrcx_0_mcp::{McpInstallClient, McpServerStatus};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__mcp_server_status(
    state: State<'_, AppState>,
) -> Result<McpServerStatus, AppError> {
    state
        .mcp_controller()
        .status()
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__mcp_server_set_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<McpServerStatus, AppError> {
    state
        .mcp_controller()
        .set_enabled(enabled)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__mcp_server_set_allow_vrchat_writes(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<McpServerStatus, AppError> {
    state
        .mcp_controller()
        .set_allow_vrchat_writes(enabled)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__mcp_server_set_allow_lan_connections(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<McpServerStatus, AppError> {
    state
        .mcp_controller()
        .set_allow_lan_connections(enabled)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__mcp_server_set_port(
    state: State<'_, AppState>,
    port: u16,
) -> Result<McpServerStatus, AppError> {
    state
        .mcp_controller()
        .set_port(port)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__mcp_server_open_client_install(
    state: State<'_, AppState>,
    client: McpInstallClient,
) -> Result<(), AppError> {
    let url = state.mcp_controller().client_install_url(client).await?;
    Ok(shell_actions::open_secret_uri(&url)?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__mcp_server_rotate_token(
    state: State<'_, AppState>,
) -> Result<McpServerStatus, AppError> {
    state
        .mcp_controller()
        .rotate_token()
        .await
        .map_err(AppError::from)
}
