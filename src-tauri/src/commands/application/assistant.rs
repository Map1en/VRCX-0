#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_harness::{
    AssistantRuntimeSelection, AssistantRuntimeStatus, PlaybookMode, Session, SessionSummary,
};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_send_message(
    state: State<'_, AppState>,
    sessionId: Option<String>,
    text: String,
    locale: Option<String>,
) -> Result<vrcx_0_harness::SendResult, AppError> {
    state
        .assistant()
        .await?
        .send_message(sessionId, text, locale)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_cancel(
    state: State<'_, AppState>,
    sessionId: String,
) -> Result<(), AppError> {
    state.assistant().await?.cancel(&sessionId);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<SessionSummary>, AppError> {
    Ok(state.assistant().await?.list_sessions())
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_get_session(
    state: State<'_, AppState>,
    sessionId: String,
) -> Result<Option<Session>, AppError> {
    Ok(state.assistant().await?.get_session(&sessionId))
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_new_session(state: State<'_, AppState>) -> Result<Session, AppError> {
    Ok(state.assistant().await?.new_session())
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_delete_session(
    state: State<'_, AppState>,
    sessionId: String,
) -> Result<(), AppError> {
    state.assistant().await?.delete_session(&sessionId);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_set_panel_open(
    state: State<'_, AppState>,
    sessionId: String,
    open: bool,
) -> Result<(), AppError> {
    state
        .assistant()
        .await?
        .set_entity_panel_open(&sessionId, open);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_runtime_status(
    state: State<'_, AppState>,
) -> Result<AssistantRuntimeStatus, AppError> {
    state
        .assistant()
        .await?
        .runtime_status()
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_set_session_runtime(
    state: State<'_, AppState>,
    sessionId: String,
    endpointId: Option<String>,
    model: Option<String>,
    allowWrites: bool,
    playbookMode: PlaybookMode,
) -> Result<Session, AppError> {
    state
        .assistant()
        .await?
        .set_session_runtime(
            &sessionId,
            endpointId,
            model
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            allowWrites,
            playbookMode,
        )
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_set_default_runtime(
    state: State<'_, AppState>,
    endpointId: Option<String>,
    model: Option<String>,
    allowWrites: bool,
    playbookMode: PlaybookMode,
) -> Result<AssistantRuntimeSelection, AppError> {
    state
        .assistant()
        .await?
        .set_default_runtime(
            endpointId,
            model
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            allowWrites,
            playbookMode,
        )
        .map_err(AppError::from)
}
