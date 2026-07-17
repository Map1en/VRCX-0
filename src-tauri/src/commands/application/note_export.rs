#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{NoteExportStartInput, NoteExportStatus};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn app__note_export_start(
    state: State<'_, AppState>,
    input: NoteExportStartInput,
) -> Result<NoteExportStatus, AppError> {
    Ok(state.note_export.start(input)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__note_export_status(state: State<'_, AppState>) -> NoteExportStatus {
    state.note_export.status()
}

#[tauri::command]
#[specta::specta]
pub fn app__note_export_cancel(state: State<'_, AppState>) -> NoteExportStatus {
    state.note_export.cancel()
}
