#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::collections::{
    ImportPreview, ShareCollectionCreateInput, ShareCollectionCreateResult,
    SharedCollectionImportStartInput, SharedCollectionImportStatus,
};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__share_collection_create(
    state: State<'_, AppState>,
    input: ShareCollectionCreateInput,
) -> Result<ShareCollectionCreateResult, AppError> {
    Ok(state.runtime_host().share_collection_create(input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__share_collection_open_manage(state: State<'_, AppState>) -> Result<(), AppError> {
    Ok(state
        .runtime_host()
        .open_shared_collection_manager()
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__share_collection_preview(
    state: State<'_, AppState>,
    id: String,
) -> Result<ImportPreview, AppError> {
    Ok(state.runtime_host().preview_shared_collection(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__world_open_register(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .register_world_open_share(world_id)
        .await;
    Ok(())
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__shared_collection_import_start(
    state: State<'_, AppState>,
    input: SharedCollectionImportStartInput,
) -> Result<SharedCollectionImportStatus, AppError> {
    Ok(state.runtime_host().start_shared_collection_import(input)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__shared_collection_import_status(
    state: State<'_, AppState>,
) -> SharedCollectionImportStatus {
    state.runtime_host().shared_collection_import_status()
}
