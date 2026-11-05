#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::social::{UserDialogTabCountsInput, UserDialogTabCountsOutput};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__user_dialog_tab_counts_get(
    state: State<'_, AppState>,
    input: UserDialogTabCountsInput,
) -> Result<UserDialogTabCountsOutput, AppError> {
    Ok(state.runtime_host().user_dialog_tab_counts(input).await?)
}
