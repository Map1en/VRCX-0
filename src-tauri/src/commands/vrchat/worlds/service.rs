#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    VrchatWorldIdInput, VrchatWorldListByUserInput, VrchatWorldPersistentDataDeleteInput,
    VrchatWorldRatingSetInput, VrchatWorldSaveInput,
};

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_rating_get(
    state: State<'_, AppState>,
    input: VrchatWorldIdInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .worlds()
        .rating_get(input.world_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_rating_set(
    state: State<'_, AppState>,
    input: VrchatWorldRatingSetInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .worlds()
        .rating_set(input.world_id, input.value)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_list_by_user_get(
    state: State<'_, AppState>,
    input: VrchatWorldListByUserInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .worlds()
        .list_by_user(
            input.user_id,
            input.n,
            input.offset,
            input.sort,
            input.order,
            input.release_status,
        )
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_persistent_data_exists(
    state: State<'_, AppState>,
    input: VrchatWorldPersistentDataDeleteInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .worlds()
        .persistent_data_exists(input.user_id, input.world_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_save(
    state: State<'_, AppState>,
    input: VrchatWorldSaveInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .worlds()
        .save(input.world_id, input.params)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_delete(
    state: State<'_, AppState>,
    input: VrchatWorldIdInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .worlds()
        .delete(input.world_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_publish(
    state: State<'_, AppState>,
    input: VrchatWorldIdInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .worlds()
        .publish(input.world_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_unpublish(
    state: State<'_, AppState>,
    input: VrchatWorldIdInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .worlds()
        .unpublish(input.world_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_world_persistent_data_delete(
    state: State<'_, AppState>,
    input: VrchatWorldPersistentDataDeleteInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .worlds()
        .persistent_data_delete(input.user_id, input.world_id)
        .await
        .map_err(AppError::from)
}
