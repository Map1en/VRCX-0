#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{
    get_or_create_share_owner_token, preview_shared_collection, share_collection_create,
    ImportPreview, ShareCollectionCreateInput, ShareCollectionCreateResult, ShareCollectionDeps,
    SharedCollectionImportStartInput, SharedCollectionImportStatus,
};
use vrcx_0_host_desktop::shell_actions;

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
pub async fn app__share_collection_open_manage(state: State<'_, AppState>) -> Result<(), AppError> {
    let auth_scope = state.runtime_context.auth_scope.snapshot();
    let owner_token =
        get_or_create_share_owner_token(state.db.as_ref(), &auth_scope.current_user_id).await?;
    let url = format!("{SHARE_EDITOR_ORIGIN}/mine#k={owner_token}");
    Ok(shell_actions::open_link(&url)?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__share_collection_preview(id: String) -> Result<ImportPreview, AppError> {
    Ok(preview_shared_collection(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub fn app__shared_collection_import_start(
    state: State<'_, AppState>,
    input: SharedCollectionImportStartInput,
) -> Result<SharedCollectionImportStatus, AppError> {
    Ok(state.shared_collection_import.start(input)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__shared_collection_import_status(
    state: State<'_, AppState>,
) -> SharedCollectionImportStatus {
    state.shared_collection_import.status()
}

#[tauri::command]
#[specta::specta]
pub fn app__shared_collection_import_cancel(
    state: State<'_, AppState>,
) -> SharedCollectionImportStatus {
    state.shared_collection_import.cancel()
}
