#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{
    derive_share_collection_owner_key, import_shared_collection, preview_shared_collection,
    share_collection_create, ImportCollectionDeps, ImportPreview, ImportResult,
    ShareCollectionCreateInput, ShareCollectionCreateResult, ShareCollectionDeps,
};
use vrcx_0_host::shell_actions;

use crate::error::AppError;
use crate::state::AppState;

const SHARE_EDITOR_ORIGIN: &str = "https://worlds.vrcx-0.dev";

#[tauri::command]
#[specta::specta]
pub async fn app__share_collection_create(
    state: State<'_, AppState>,
    input: ShareCollectionCreateInput,
) -> Result<ShareCollectionCreateResult, AppError> {
    let auth_scope = state.runtime_context.auth_scope.snapshot();
    let display_name = state.snapshot_backend_runtime().auth_display_name;
    Ok(share_collection_create(
        ShareCollectionDeps {
            db: state.db.as_ref(),
            current_user_id: &auth_scope.current_user_id,
            current_user_display_name: &display_name,
        },
        input,
    )
    .await?)
}

#[tauri::command]
#[specta::specta]
pub fn app__share_collection_open_manage(state: State<'_, AppState>) -> Result<(), AppError> {
    let auth_scope = state.runtime_context.auth_scope.snapshot();
    let owner_key = derive_share_collection_owner_key(&auth_scope.current_user_id)?;
    let url = format!("{SHARE_EDITOR_ORIGIN}/mine#k={owner_key}");
    Ok(shell_actions::open_link(&url)?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__share_collection_preview(id: String) -> Result<ImportPreview, AppError> {
    Ok(preview_shared_collection(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__share_collection_import(
    state: State<'_, AppState>,
    id: String,
) -> Result<ImportResult, AppError> {
    let result = import_shared_collection(
        ImportCollectionDeps {
            db: state.db.as_ref(),
        },
        &id,
    )
    .await?;
    state.realtime_runtime.sync_world_cache_favorites_from_db();
    Ok(result)
}
