#![allow(non_snake_case)]

use tauri::{AppHandle, Manager, State};
use vrcx_0_application_core::vrchat_api::require_text;

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use super::types::{
    LocalFavoriteGroupCreateInput, LocalFavoriteGroupInput, LocalFavoriteGroupRenameInput,
    LocalFavoriteGroupReorderInput, LocalFavoriteInput, LocalFavoriteReorderInput,
    VrchatFavoriteAddInput, VrchatFavoriteDeleteInput, VrchatFavoriteGroupClearInput,
    VrchatFavoriteGroupSaveInput, VrchatFavoriteGroupsInput, VrchatFavoriteWorldsInput,
};

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorite_worlds_get(
    state: State<'_, AppState>,
    input: VrchatFavoriteWorldsInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .favorite_worlds(
            input.n,
            input.offset,
            input.owner_id,
            input.user_id,
            input.tag,
        )
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorite_groups_get(
    state: State<'_, AppState>,
    input: VrchatFavoriteGroupsInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .favorite_groups(input.n, input.offset, input.owner_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorite_add(
    state: State<'_, AppState>,
    input: VrchatFavoriteAddInput,
) -> Result<VrchatResponse, AppError> {
    Ok(state
        .runtime_host()
        .favorite_add_remote(vrcx_0_application::favorites::FavoriteRemoteAddInput {
            kind: input.type_name,
            entity_id: input.favorite_id,
            tags: input.tags,
        })
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorite_delete(
    state: State<'_, AppState>,
    input: VrchatFavoriteDeleteInput,
) -> Result<VrchatResponse, AppError> {
    Ok(state
        .runtime_host()
        .favorite_delete_remote(vrcx_0_application::favorites::FavoriteRemoteDeleteInput {
            object_id: input.object_id,
        })
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorite_group_save(
    state: State<'_, AppState>,
    input: VrchatFavoriteGroupSaveInput,
) -> Result<VrchatResponse, AppError> {
    Ok(state
        .runtime_host()
        .favorite_group_save_remote(
            vrcx_0_application::favorites::FavoriteRemoteGroupSaveInput {
                kind: input.type_name,
                group: input.group,
                display_name: input.display_name,
                visibility: input.visibility,
            },
        )
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorite_group_clear(
    state: State<'_, AppState>,
    input: VrchatFavoriteGroupClearInput,
) -> Result<VrchatResponse, AppError> {
    Ok(state
        .runtime_host()
        .favorite_group_clear_remote(
            vrcx_0_application::favorites::FavoriteRemoteGroupClearInput {
                kind: input.type_name,
                group: input.group,
            },
        )
        .await?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__local_favorite_add(
    state: State<'_, AppState>,
    input: LocalFavoriteInput,
) -> Result<i64, AppError> {
    let kind = input.kind;
    let entity_id = require_text(input.entity_id, "LocalFavoriteAdd requires entityId.")?;
    crate::commands::local::favorites::favorite_add(state, kind, entity_id, input.group_id)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__local_favorite_remove(
    state: State<'_, AppState>,
    input: LocalFavoriteInput,
) -> Result<i64, AppError> {
    let kind = input.kind;
    let entity_id = require_text(input.entity_id, "LocalFavoriteRemove requires entityId.")?;
    crate::commands::local::favorites::favorite_remove(state, kind, entity_id, input.group_id)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__local_favorite_group_create(
    state: State<'_, AppState>,
    input: LocalFavoriteGroupCreateInput,
) -> Result<vrcx_0_application::favorites::LocalFavoriteGroup, AppError> {
    let name = require_text(input.name, "LocalFavoriteGroupCreate requires name.")?;
    state
        .runtime_host()
        .favorite_local_group_create(input.kind, name)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__local_favorite_group_rename(
    state: State<'_, AppState>,
    input: LocalFavoriteGroupRenameInput,
) -> Result<i64, AppError> {
    let name = require_text(input.name, "LocalFavoriteGroupRename requires name.")?;
    state
        .runtime_host()
        .favorite_local_group_rename(input.kind, input.group_id, name)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__local_favorite_group_delete(
    state: State<'_, AppState>,
    input: LocalFavoriteGroupInput,
) -> Result<i64, AppError> {
    state
        .runtime_host()
        .favorite_local_group_delete(input.kind, input.group_id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__local_favorite_group_reorder(
    app: AppHandle,
    input: LocalFavoriteGroupReorderInput,
) -> Result<Vec<vrcx_0_application::favorites::LocalFavoriteGroup>, AppError> {
    run_blocking("local favorite group reorder", move || {
        let state = app.state::<AppState>();
        state
            .runtime_host()
            .favorite_local_group_reorder(input.kind, input.group_ids)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__local_favorite_reorder(
    app: AppHandle,
    input: LocalFavoriteReorderInput,
) -> Result<i64, AppError> {
    run_blocking("local favorite reorder", move || {
        let state = app.state::<AppState>();
        state
            .runtime_host()
            .favorite_local_reorder(input.kind, input.group_id, input.entity_ids)
    })
    .await
}
