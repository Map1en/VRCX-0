#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{
    load_quick_search_catalog, QuickSearchCatalogDeps, QuickSearchCatalogSnapshot,
};

use crate::{error::AppError, state::AppState};

#[tauri::command]
#[specta::specta]
pub async fn app__quick_search_catalog_get(
    state: State<'_, AppState>,
) -> Result<QuickSearchCatalogSnapshot, AppError> {
    load_quick_search_catalog(QuickSearchCatalogDeps {
        db: state.db.clone(),
        web: state.web.clone(),
        auth_scope: state.runtime_context.auth_scope.clone(),
        diagnostics: state.runtime_context.diagnostics.clone(),
        sync: state.runtime_context.sync.clone(),
    })
    .await
    .map_err(AppError::from)
}
