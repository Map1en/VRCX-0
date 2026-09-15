#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_core::vrchat_api::require_text;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application_core::vrchat_api::VrchatApiResponse;

use super::types::{
    LocalFavoriteGroupInput, LocalFavoriteGroupRenameInput, LocalFavoriteInput,
    VrchatFavoriteAddInput, VrchatFavoriteDeleteInput, VrchatFavoriteGroupClearInput,
    VrchatFavoriteGroupSaveInput, VrchatFavoriteGroupsInput, VrchatFavoriteWorldsInput,
};

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorite_worlds_get(
    state: State<'_, AppState>,
    input: VrchatFavoriteWorldsInput,
) -> Result<VrchatApiResponse, AppError> {
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
) -> Result<VrchatApiResponse, AppError> {
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
) -> Result<VrchatApiResponse, AppError> {
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
) -> Result<VrchatApiResponse, AppError> {
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
) -> Result<VrchatApiResponse, AppError> {
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
) -> Result<VrchatApiResponse, AppError> {
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
    let group_name = require_text(input.group_name, "LocalFavoriteAdd requires groupName.")?;
    crate::commands::local::favorites::favorite_add(state, kind, entity_id, group_name)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__local_favorite_remove(
    state: State<'_, AppState>,
    input: LocalFavoriteInput,
) -> Result<i64, AppError> {
    let kind = input.kind;
    let entity_id = require_text(input.entity_id, "LocalFavoriteRemove requires entityId.")?;
    let group_name = require_text(input.group_name, "LocalFavoriteRemove requires groupName.")?;
    crate::commands::local::favorites::favorite_remove(state, kind, entity_id, group_name)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__local_favorite_group_create(
    state: State<'_, AppState>,
    input: LocalFavoriteGroupInput,
) -> Result<vrcx_0_application::favorites::LocalFavoriteGroupWrite, AppError> {
    let kind = input.kind;
    let group_name = require_text(
        input.group_name,
        "LocalFavoriteGroupCreate requires groupName.",
    )?;
    state
        .runtime_host()
        .favorite_local_group_create(kind, group_name)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__local_favorite_group_rename(
    state: State<'_, AppState>,
    input: LocalFavoriteGroupRenameInput,
) -> Result<vrcx_0_application::favorites::LocalFavoriteGroupWrite, AppError> {
    let kind = input.kind;
    let group_name = require_text(
        input.group_name,
        "LocalFavoriteGroupRename requires groupName.",
    )?;
    let new_group_name = require_text(
        input.new_group_name,
        "LocalFavoriteGroupRename requires newGroupName.",
    )?;
    state
        .runtime_host()
        .favorite_local_group_rename(kind, group_name, new_group_name)
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__local_favorite_group_delete(
    state: State<'_, AppState>,
    input: LocalFavoriteGroupInput,
) -> Result<vrcx_0_application::favorites::LocalFavoriteGroupWrite, AppError> {
    let kind = input.kind;
    let group_name = require_text(
        input.group_name,
        "LocalFavoriteGroupDelete requires groupName.",
    )?;
    state
        .runtime_host()
        .favorite_local_group_delete(kind, group_name)
        .map_err(AppError::from)
}
