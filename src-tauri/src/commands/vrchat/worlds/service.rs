#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_core::vrchat_api::worlds::{
    world_delete_input, world_get_input, world_list_by_user_get_input,
    world_persistent_data_delete_input, world_persistent_data_exists_input, world_publish_input,
    world_save_input, world_unpublish_input,
};

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse};

use super::types::{
    VrchatWorldIdInput, VrchatWorldListByUserInput, VrchatWorldPersistentDataDeleteInput,
    VrchatWorldSaveInput,
};

async fn execute_world_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse, AppError> {
    let diagnostics = state.runtime_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::execute::execute_vrchat_world_api(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status));
        }
        Err(error) => diagnostics.record_command(command, "error", error.to_string()),
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_get(
    state: State<'_, AppState>,
    input: VrchatWorldIdInput,
) -> Result<VrchatApiResponse, AppError> {
    let (world_id, request) = world_get_input(input.endpoint, input.world_id)?;
    execute_world_api(
        state,
        "app__vrchat_world_get",
        format!("Getting world {world_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_list_by_user_get(
    state: State<'_, AppState>,
    input: VrchatWorldListByUserInput,
) -> Result<VrchatApiResponse, AppError> {
    let (user_id, request) = world_list_by_user_get_input(
        input.endpoint,
        input.user_id,
        input.n,
        input.offset,
        input.sort,
        input.order,
        input.release_status,
    )?;
    execute_world_api(
        state,
        "app__vrchat_world_list_by_user_get",
        format!("Getting worlds for {user_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_persistent_data_exists(
    state: State<'_, AppState>,
    input: VrchatWorldPersistentDataDeleteInput,
) -> Result<VrchatApiResponse, AppError> {
    let (user_id, world_id, request) =
        world_persistent_data_exists_input(input.endpoint, input.user_id, input.world_id)?;
    execute_world_api(
        state,
        "app__vrchat_world_persistent_data_exists",
        format!("Checking persistent data for user {user_id} in world {world_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_save(
    state: State<'_, AppState>,
    input: VrchatWorldSaveInput,
) -> Result<VrchatApiResponse, AppError> {
    let (world_id, request) = world_save_input(input.endpoint, input.world_id, input.params)?;
    execute_world_api(
        state,
        "app__vrchat_world_save",
        format!("Saving world {world_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_delete(
    state: State<'_, AppState>,
    input: VrchatWorldIdInput,
) -> Result<VrchatApiResponse, AppError> {
    let (world_id, request) = world_delete_input(input.endpoint, input.world_id)?;
    execute_world_api(
        state,
        "app__vrchat_world_delete",
        format!("Deleting world {world_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_publish(
    state: State<'_, AppState>,
    input: VrchatWorldIdInput,
) -> Result<VrchatApiResponse, AppError> {
    let (world_id, request) = world_publish_input(input.endpoint, input.world_id)?;
    execute_world_api(
        state,
        "app__vrchat_world_publish",
        format!("Publishing world {world_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_unpublish(
    state: State<'_, AppState>,
    input: VrchatWorldIdInput,
) -> Result<VrchatApiResponse, AppError> {
    let (world_id, request) = world_unpublish_input(input.endpoint, input.world_id)?;
    execute_world_api(
        state,
        "app__vrchat_world_unpublish",
        format!("Unpublishing world {world_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_persistent_data_delete(
    state: State<'_, AppState>,
    input: VrchatWorldPersistentDataDeleteInput,
) -> Result<VrchatApiResponse, AppError> {
    let (user_id, world_id, request) =
        world_persistent_data_delete_input(input.endpoint, input.user_id, input.world_id)?;
    execute_world_api(
        state,
        "app__vrchat_world_persistent_data_delete",
        format!("Deleting persistent data for user {user_id} in world {world_id}."),
        request,
    )
    .await
}
