#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::game::{InstanceLaunchInput, InstanceLaunchOutcome};

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_contracts::vrchat_api::VrchatResponse;
use vrcx_0_contracts::vrchat_requests::InstanceCreateOptions;
use vrcx_0_core::json::RawJson;

use super::types::{
    VrchatInstanceCalendarLinkInput, VrchatInstanceCloseInput, VrchatInstanceCreateInput,
    VrchatInstanceDisplayNameInput, VrchatInstanceIdentityInput, VrchatInstanceSelfInviteInput,
    VrchatInstanceShortNameInput,
};

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_get(
    state: State<'_, AppState>,
    input: VrchatInstanceIdentityInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .instance_get(input.world_id, input.instance_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_short_name_get(
    state: State<'_, AppState>,
    input: VrchatInstanceShortNameInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .instance_short_name(input.world_id, input.instance_id, input.short_name)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_create(
    state: State<'_, AppState>,
    input: VrchatInstanceCreateInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .instance_create(input.params)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_create_options_get(
    state: State<'_, AppState>,
) -> Result<InstanceCreateOptions, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .instance_create_options()
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_self_invite(
    state: State<'_, AppState>,
    input: VrchatInstanceSelfInviteInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .instance_self_invite(input.world_id, input.instance_id, input.short_name)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_join(
    state: State<'_, AppState>,
    input: InstanceLaunchInput,
) -> Result<InstanceLaunchOutcome, AppError> {
    state
        .runtime_host()
        .instance_launch()
        .join(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_display_name_set(
    state: State<'_, AppState>,
    input: VrchatInstanceDisplayNameInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .instance_display_name(input.location, input.display_name)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_count_get(
    state: State<'_, AppState>,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .instance_count()
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instances_active_get(
    state: State<'_, AppState>,
) -> Result<Vec<RawJson>, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .active_instances()
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instances_discover_get(
    state: State<'_, AppState>,
) -> Result<Vec<RawJson>, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .discover_instances()
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_calendar_link_set(
    state: State<'_, AppState>,
    input: VrchatInstanceCalendarLinkInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .instance_calendar_link(input.location, input.calendar_entry_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_close(
    state: State<'_, AppState>,
    input: VrchatInstanceCloseInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .instance_close(input.location, input.hard_close)
        .await
        .map_err(AppError::from)
}
