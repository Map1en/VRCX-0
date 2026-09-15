#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::social::{NoteExportStartInput, NoteExportStatus};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn app__note_export_start(
    state: State<'_, AppState>,
    input: NoteExportStartInput,
) -> Result<NoteExportStatus, AppError> {
    Ok(state.runtime_host().start_note_export(input)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__note_export_status(state: State<'_, AppState>) -> NoteExportStatus {
    state.runtime_host().note_export_status()
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__note_export_cancel(state: State<'_, AppState>) -> NoteExportStatus {
    state.runtime_host().cancel_note_export()
}
