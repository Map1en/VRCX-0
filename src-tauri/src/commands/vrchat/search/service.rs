#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use super::types::{
    VrchatSearchGroupsInput, VrchatSearchShortNameInput, VrchatSearchUsersInput,
    VrchatSearchWorldsInput,
};

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_search_worlds_get(
    state: State<'_, AppState>,
    input: VrchatSearchWorldsInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .search_worlds(input.params, input.option)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_search_users_get(
    state: State<'_, AppState>,
    input: VrchatSearchUsersInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .search_users(input.params)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_search_groups_get(
    state: State<'_, AppState>,
    input: VrchatSearchGroupsInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .search_groups(input.params)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_search_groups_strict_get(
    state: State<'_, AppState>,
    input: VrchatSearchGroupsInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .search_groups_strict(input.params)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_search_instance_short_name_get(
    state: State<'_, AppState>,
    input: VrchatSearchShortNameInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .search_instance_short_name(input.short_name)
        .await
        .map_err(AppError::from)
}
