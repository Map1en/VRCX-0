#![allow(non_snake_case)]

use crate::error::AppError;

use vrcx_0_host_desktop::host_capabilities::{require_host_capability, HostCapability};

#[tauri::command]
#[specta::specta]
pub fn app__try_open_instance_in_vrc(launch_url: String) -> Result<bool, AppError> {
    require_host_capability(HostCapability::VrchatLaunchPipe)?;
    Ok(crate::adapters::ipc::vrcipc_send(&launch_url))
}
