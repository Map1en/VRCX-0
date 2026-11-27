#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_game::chatbox::{
    ChatboxConfig, ChatboxEditorState, ChatboxLinePreviewInput, ChatboxSendOutcome, ChatboxStatus,
};

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn app__chatbox_editor_state_get(state: State<'_, AppState>) -> ChatboxEditorState {
    state.runtime_host().chatbox().editor_state()
}

#[tauri::command]
#[specta::specta]
pub async fn app__chatbox_config_set(
    state: State<'_, AppState>,
    config: ChatboxConfig,
) -> Result<ChatboxConfig, AppError> {
    let chatbox = state.runtime_host().chatbox();
    run_blocking("chatbox config", move || chatbox.set_config(config)).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__chatbox_enabled_set(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<ChatboxConfig, AppError> {
    let chatbox = state.runtime_host().chatbox();
    run_blocking("chatbox enabled", move || chatbox.set_enabled(enabled)).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__chatbox_status_enabled_set(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<ChatboxConfig, AppError> {
    let chatbox = state.runtime_host().chatbox();
    run_blocking("chatbox status enabled", move || {
        chatbox.set_status_enabled(enabled)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__chatbox_page_enabled_set(
    state: State<'_, AppState>,
    page_id: String,
    enabled: bool,
) -> Result<ChatboxConfig, AppError> {
    let chatbox = state.runtime_host().chatbox();
    run_blocking("chatbox page enabled", move || {
        chatbox.set_page_enabled(&page_id, enabled)
    })
    .await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__chatbox_status_get(state: State<'_, AppState>) -> Option<ChatboxStatus> {
    state.runtime_host().chatbox().status()
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__chatbox_previewing_set(state: State<'_, AppState>, previewing: bool) {
    state.runtime_host().chatbox().set_previewing(previewing);
}

#[tauri::command]
#[specta::specta]
pub async fn app__chatbox_send(
    state: State<'_, AppState>,
    text: String,
) -> Result<ChatboxSendOutcome, AppError> {
    let chatbox = state.runtime_host().chatbox();
    run_blocking("chatbox send", move || chatbox.send_manual(&text)).await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__chatbox_afk_set(state: State<'_, AppState>, afk: bool) {
    state.runtime_host().chatbox().set_manual_afk(afk);
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__chatbox_typing_set(state: State<'_, AppState>, typing: bool) {
    state.runtime_host().chatbox().set_typing(typing);
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__chatbox_samples_render(
    state: State<'_, AppState>,
    lines: Vec<ChatboxLinePreviewInput>,
) -> Vec<String> {
    state.runtime_host().chatbox().render_samples(&lines)
}
