#![allow(non_snake_case)]

use crate::error::AppError;

use vrcx_0_host_desktop::host_capabilities::{require_host_capability, HostCapability};
use vrcx_0_host_desktop::local_player_moderations;

#[tauri::command(async)]
#[specta::specta]
pub fn app__get_vrchat_user_moderation(
    current_user_id: String,
    user_id: String,
) -> Result<i16, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(local_player_moderations::get_vrchat_user_moderation(
        &current_user_id,
        &user_id,
    )?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__set_vrchat_user_moderation(
    current_user_id: String,
    user_id: String,
    moderation_type: i32,
) -> Result<bool, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(local_player_moderations::set_vrchat_user_moderation(
        &current_user_id,
        &user_id,
        moderation_type,
    )?)
}
