#![allow(non_snake_case)]

use crate::commands::blocking::run_blocking;
use crate::{error::AppError, state::AppState};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use vrcx_0_host_desktop::vrchat_registry;

use vrcx_0_host_desktop::host_capabilities::{require_host_capability, HostCapability};

#[tauri::command]
#[specta::specta]
pub async fn app__delete_vrchat_registry_folder(app_handle: AppHandle) -> Result<(), AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    let confirmed = super::dialog::show_message(
        app_handle
            .dialog()
            .message("Delete the VRChat registry preferences folder? This cannot be undone.")
            .title("Delete VRChat registry preferences")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Delete".into(),
                "Cancel".into(),
            )),
    )
    .await;
    if !confirmed {
        return Err(AppError::Custom(
            "VRChat registry folder delete was cancelled.".into(),
        ));
    }
    Ok(vrchat_registry::delete_registry_folder()?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_order_get(
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    let scope = state.require_active_scope("Reading the in-game group order")?;
    run_blocking("group order read", move || {
        vrchat_registry::get_group_order(&scope.current_user_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_group_order_set(
    state: State<'_, AppState>,
    group_ids: Vec<String>,
) -> Result<bool, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    let scope = state.require_active_scope("Saving the in-game group order")?;
    run_blocking("group order write", move || {
        vrchat_registry::set_group_order(&scope.current_user_id, &group_ids)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__set_vrchat_registry_key(
    key: String,
    value: serde_json::Value,
    type_int: i32,
) -> Result<bool, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    vrchat_registry::validate_registry_entry(&key, &value, type_int)?;
    run_blocking("registry key write", move || {
        vrchat_registry::set_registry_key(&key, &value, type_int)
    })
    .await
}
