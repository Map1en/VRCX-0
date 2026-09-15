#![allow(non_snake_case)]

use vrcx_0_host_desktop::vrchat_log::{
    self, VrchatLogEntriesReadInput, VrchatLogEntriesReadOutput, VrchatLogFileOutput,
    VrchatLogTailReadInput,
};

use crate::commands::blocking::run_blocking;
use crate::error::AppError;

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_log_files_list() -> Result<Vec<VrchatLogFileOutput>, AppError> {
    run_blocking("VRChat log files list", vrchat_log::files_list).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_log_entries_read(
    input: VrchatLogEntriesReadInput,
) -> Result<VrchatLogEntriesReadOutput, AppError> {
    run_blocking("VRChat log entries read", move || {
        vrchat_log::entries_read(input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_log_tail_read(
    input: VrchatLogTailReadInput,
) -> Result<VrchatLogEntriesReadOutput, AppError> {
    run_blocking("VRChat log tail read", move || vrchat_log::tail_read(input)).await
}
