#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::social::{QuickSearchQueryInput, QuickSearchQueryOutput};

use crate::{error::AppError, state::AppState};

#[tauri::command]
#[specta::specta]
pub async fn app__quick_search_query(
    state: State<'_, AppState>,
    input: QuickSearchQueryInput,
) -> Result<QuickSearchQueryOutput, AppError> {
    state.quick_search(input).await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__quick_search_working_set_invalidate(
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.invalidate_quick_search_working_set();
    Ok(())
}
