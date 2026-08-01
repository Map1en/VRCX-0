#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_core::vrchat_api::favorites::{
    favorite_avatars_get_input, favorite_groups_get_input, favorite_limits_get_input,
    favorite_worlds_get_input, favorites_get_input,
};
use vrcx_0_application_core::vrchat_api::require_text;
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse, VrchatScope};

use super::types::{
    LocalFavoriteGroupInput, LocalFavoriteGroupRenameInput, LocalFavoriteInput,
    VrchatFavoriteAddInput, VrchatFavoriteAvatarsInput, VrchatFavoriteDeleteInput,
    VrchatFavoriteGroupClearInput, VrchatFavoriteGroupSaveInput, VrchatFavoriteGroupsInput,
    VrchatFavoritePagedInput, VrchatFavoriteWorldsInput,
};

async fn execute_favorite_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse, AppError> {
    super::super::execute::execute_vrchat_api(state, command, detail, input, VrchatScope::Vrchat)
        .await
}

fn mutation_deps<'a>(
    state: &'a State<'_, AppState>,
) -> vrcx_0_application::FavoriteRemoteMutationDeps<'a> {
    vrcx_0_application::FavoriteRemoteMutationDeps {
        db: &state.db,
        web: &state.web,
        diagnostics: &state.runtime_context.diagnostics,
        sync: &state.runtime_context.sync,
        realtime: &state.realtime_runtime,
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorite_limits_get(
    state: State<'_, AppState>,
) -> Result<VrchatApiResponse, AppError> {
    execute_favorite_api(
        state,
        "app__vrchat_favorite_limits_get",
        "Getting favorite limits.",
        favorite_limits_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorites_get(
    state: State<'_, AppState>,
    input: VrchatFavoritePagedInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_favorite_api(
        state,
        "app__vrchat_favorites_get",
        format!("Getting favorites offset {}.", input.offset),
        favorites_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), input.n, input.offset),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorite_worlds_get(
    state: State<'_, AppState>,
    input: VrchatFavoriteWorldsInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_favorite_api(
        state,
        "app__vrchat_favorite_worlds_get",
        format!("Getting favorite worlds offset {}.", input.offset),
        favorite_worlds_get_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            input.n,
            input.offset,
            input.owner_id,
            input.user_id,
            input.tag,
        ),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorite_avatars_get(
    state: State<'_, AppState>,
    input: VrchatFavoriteAvatarsInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_favorite_api(
        state,
        "app__vrchat_favorite_avatars_get",
        format!("Getting favorite avatars offset {}.", input.offset),
        favorite_avatars_get_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            input.n,
            input.offset,
            input.tag,
        ),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorite_groups_get(
    state: State<'_, AppState>,
    input: VrchatFavoriteGroupsInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_favorite_api(
        state,
        "app__vrchat_favorite_groups_get",
        format!("Getting favorite groups offset {}.", input.offset),
        favorite_groups_get_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            input.n,
            input.offset,
            input.owner_id,
        ),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorite_add(
    state: State<'_, AppState>,
    input: VrchatFavoriteAddInput,
) -> Result<VrchatApiResponse, AppError> {
    Ok(vrcx_0_application::add_remote_favorite(
        &mutation_deps(&state),
        vrcx_0_application::FavoriteRemoteAddInput {
            endpoint: VRCHAT_API_DEFAULT_ENDPOINT.into(),
            kind: input.type_name,
            entity_id: input.favorite_id,
            tags: input.tags,
        },
    )
    .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorite_delete(
    state: State<'_, AppState>,
    input: VrchatFavoriteDeleteInput,
) -> Result<VrchatApiResponse, AppError> {
    Ok(vrcx_0_application::delete_remote_favorite(
        &mutation_deps(&state),
        vrcx_0_application::FavoriteRemoteDeleteInput {
            endpoint: VRCHAT_API_DEFAULT_ENDPOINT.into(),
            object_id: input.object_id,
        },
    )
    .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_favorite_group_save(
    state: State<'_, AppState>,
    input: VrchatFavoriteGroupSaveInput,
) -> Result<VrchatApiResponse, AppError> {
    Ok(vrcx_0_application::save_remote_favorite_group(
        &mutation_deps(&state),
        vrcx_0_application::FavoriteRemoteGroupSaveInput {
            endpoint: VRCHAT_API_DEFAULT_ENDPOINT.into(),
            owner_id: input.owner_id,
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
    Ok(vrcx_0_application::clear_remote_favorite_group(
        &mutation_deps(&state),
        vrcx_0_application::FavoriteRemoteGroupClearInput {
            endpoint: VRCHAT_API_DEFAULT_ENDPOINT.into(),
            owner_id: input.owner_id,
            kind: input.type_name,
            group: input.group,
        },
    )
    .await?)
}

#[tauri::command]
#[specta::specta]
pub fn app__local_favorite_add(
    state: State<'_, AppState>,
    input: LocalFavoriteInput,
) -> Result<i64, AppError> {
    let kind = require_text(input.kind, "LocalFavoriteAdd requires kind.")?;
    let entity_id = require_text(input.entity_id, "LocalFavoriteAdd requires entityId.")?;
    let group_name = require_text(input.group_name, "LocalFavoriteAdd requires groupName.")?;
    crate::commands::local::favorites::app__favorite_add(state, kind, entity_id, group_name)
}

#[tauri::command]
#[specta::specta]
pub fn app__local_favorite_remove(
    state: State<'_, AppState>,
    input: LocalFavoriteInput,
) -> Result<i64, AppError> {
    let kind = require_text(input.kind, "LocalFavoriteRemove requires kind.")?;
    let entity_id = require_text(input.entity_id, "LocalFavoriteRemove requires entityId.")?;
    let group_name = require_text(input.group_name, "LocalFavoriteRemove requires groupName.")?;
    crate::commands::local::favorites::app__favorite_remove(state, kind, entity_id, group_name)
}

#[tauri::command]
#[specta::specta]
pub fn app__local_favorite_group_create(
    state: State<'_, AppState>,
    input: LocalFavoriteGroupInput,
) -> Result<vrcx_0_application::LocalFavoriteGroupWrite, AppError> {
    let kind = require_text(input.kind, "LocalFavoriteGroupCreate requires kind.")?;
    let group_name = require_text(
        input.group_name,
        "LocalFavoriteGroupCreate requires groupName.",
    )?;
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    let write = vrcx_0_application::create_local_favorite_group(
        state.db.as_ref(),
        &owner_user_id,
        &kind,
        group_name,
    )
    .map_err(AppError::from)?;
    state
        .realtime_runtime
        .notify_favorites_changed(&kind, true, false);
    Ok(write)
}

#[tauri::command]
#[specta::specta]
pub fn app__local_favorite_group_rename(
    state: State<'_, AppState>,
    input: LocalFavoriteGroupRenameInput,
) -> Result<vrcx_0_application::LocalFavoriteGroupWrite, AppError> {
    let kind = require_text(input.kind, "LocalFavoriteGroupRename requires kind.")?;
    let group_name = require_text(
        input.group_name,
        "LocalFavoriteGroupRename requires groupName.",
    )?;
    let new_group_name = require_text(
        input.new_group_name,
        "LocalFavoriteGroupRename requires newGroupName.",
    )?;
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    let write = vrcx_0_application::rename_local_favorite_group(
        state.db.as_ref(),
        &owner_user_id,
        &kind,
        group_name,
        new_group_name,
    )
    .map_err(AppError::from)?;
    state
        .realtime_runtime
        .notify_favorites_changed(&kind, true, false);
    Ok(write)
}

#[tauri::command]
#[specta::specta]
pub fn app__local_favorite_group_delete(
    state: State<'_, AppState>,
    input: LocalFavoriteGroupInput,
) -> Result<vrcx_0_application::LocalFavoriteGroupWrite, AppError> {
    let kind = require_text(input.kind, "LocalFavoriteGroupDelete requires kind.")?;
    let group_name = require_text(
        input.group_name,
        "LocalFavoriteGroupDelete requires groupName.",
    )?;
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;
    let write = vrcx_0_application::delete_local_favorite_group(
        state.db.as_ref(),
        &owner_user_id,
        &kind,
        group_name,
    )
    .map_err(AppError::from)?;
    state
        .realtime_runtime
        .notify_favorites_changed(&kind, true, false);
    Ok(write)
}
