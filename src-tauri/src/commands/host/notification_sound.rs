#![allow(non_snake_case)]

use std::collections::BTreeMap;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use vrcx_0_contracts::NotificationSoundRule;
use vrcx_0_host_desktop::notification_sound::validate_notification_sound_file;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn app__host_notification_sound_rules(
    state: State<'_, AppState>,
) -> Result<BTreeMap<String, NotificationSoundRule>, AppError> {
    Ok(state.runtime_host().notification_sound_rules()?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__host_notification_sound_set_rule(
    state: State<'_, AppState>,
    event: String,
    rule: Option<NotificationSoundRule>,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .set_notification_sound_rule(event, rule)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__host_notification_sound_choose_file(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<Option<String>, AppError> {
    let picker = app_handle
        .dialog()
        .file()
        .add_filter("WAV / MP3 / OGG / FLAC", &["wav", "mp3", "ogg", "flac"]);
    let path = match super::dialog::pick_file(picker).await {
        Some(FilePath::Path(path)) => path,
        Some(_) => return Err(AppError::Custom("Select a local audio file.".into())),
        None => return Ok(None),
    };
    let path = tauri::async_runtime::spawn_blocking(move || {
        let path = path
            .canonicalize()?
            .into_os_string()
            .into_string()
            .map_err(|_| AppError::Custom("The audio file path is not valid Unicode.".into()))?;
        validate_notification_sound_file(&path).map_err(AppError::Custom)?;
        Ok::<String, AppError>(path)
    })
    .await
    .map_err(|error| AppError::Custom(format!("Audio file validation failed: {error}")))??;
    state.runtime_host().register_host_file_access(&path);
    Ok(Some(path))
}

#[tauri::command]
#[specta::specta]
pub async fn app__host_notification_sound_preview(
    state: State<'_, AppState>,
    rule: NotificationSoundRule,
) -> Result<(), AppError> {
    let player = state
        .runtime_host()
        .notification_sound_preview_player(&rule)?;
    tauri::async_runtime::spawn_blocking(move || player.preview(rule))
        .await
        .map_err(|error| AppError::Custom(format!("Audio preview failed: {error}")))?
        .map_err(AppError::Custom)
}
