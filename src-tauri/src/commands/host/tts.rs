#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_host::tts::TtsVoice;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__host_tts_voices(state: State<'_, AppState>) -> Result<Vec<TtsVoice>, AppError> {
    let tts = state.runtime_context.tts.clone();
    tauri::async_runtime::spawn_blocking(move || tts.voices())
        .await
        .map_err(|error| AppError::Custom(format!("TTS voice task failed: {error}")))
}

#[tauri::command]
#[specta::specta]
pub fn app__host_tts_speak(
    state: State<'_, AppState>,
    text: String,
    voice_id: Option<String>,
) -> Result<(), AppError> {
    state
        .runtime_context
        .tts
        .speak(&text, voice_id.as_deref())
        .map_err(AppError::from)
}
