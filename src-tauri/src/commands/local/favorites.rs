#![allow(non_snake_case)]

use tauri::State;

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_application::favorites::{
    FavoriteRow, LocalFavoriteSnapshot, LocalWorldDetailsRefreshOutput,
};
use vrcx_0_application_core::FavoriteEntityKind;
use vrcx_0_contracts::{
    SavedGroupCollectionCreateInput, SavedGroupCollectionDeleteInput, SavedGroupFavoriteAddInput,
    SavedGroupFavoriteRemoveInput, SavedGroupFavoritesSnapshot,
};

#[tauri::command(async)]
#[specta::specta]
pub fn app__favorite_list(
    state: State<'_, AppState>,
    kind: FavoriteEntityKind,
) -> Result<Vec<FavoriteRow>, AppError> {
    state
        .runtime_host()
        .local_data()
        .favorite_list(kind)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__favorite_local_custom_order(
    state: State<'_, AppState>,
    kind: FavoriteEntityKind,
) -> Result<Vec<FavoriteRow>, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("favorite local custom order", move || {
        local_data.favorite_custom_order(kind)
    })
    .await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__favorite_local_snapshot(
    state: State<'_, AppState>,
    kind: FavoriteEntityKind,
) -> Result<LocalFavoriteSnapshot, AppError> {
    state
        .runtime_host()
        .local_data()
        .favorite_snapshot(kind)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__favorite_local_world_details_refresh(
    state: State<'_, AppState>,
) -> Result<LocalWorldDetailsRefreshOutput, AppError> {
    state.refresh_local_world_favorite_details().await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__saved_group_favorites_get(
    state: State<'_, AppState>,
) -> Result<SavedGroupFavoritesSnapshot, AppError> {
    state
        .runtime_host()
        .local_data()
        .saved_group_favorites_snapshot()
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__saved_group_collection_create(
    state: State<'_, AppState>,
    input: SavedGroupCollectionCreateInput,
) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .saved_group_collection_create(input)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__saved_group_collection_delete(
    state: State<'_, AppState>,
    input: SavedGroupCollectionDeleteInput,
) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .saved_group_collection_delete(input)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__saved_group_favorite_add(
    state: State<'_, AppState>,
    input: SavedGroupFavoriteAddInput,
) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .saved_group_favorite_add(input)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__saved_group_favorite_remove(
    state: State<'_, AppState>,
    input: SavedGroupFavoriteRemoveInput,
) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .saved_group_favorite_remove(input)
        .map_err(AppError::from)
}

pub fn favorite_add(
    state: State<'_, AppState>,
    kind: FavoriteEntityKind,
    entity_id: String,
    group_name: String,
) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .favorite_add_local(kind, entity_id, group_name)
        .map_err(AppError::from)
}

pub fn favorite_remove(
    state: State<'_, AppState>,
    kind: FavoriteEntityKind,
    entity_id: String,
    group_name: String,
) -> Result<i64, AppError> {
    state
        .runtime_host()
        .local_data()
        .favorite_remove_local(kind, entity_id, group_name)
        .map_err(AppError::from)
}
