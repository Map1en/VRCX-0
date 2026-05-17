#![allow(non_snake_case)]

use tauri::State;

use crate::domain::ipc::IpcPacket;
use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_host::host_capabilities::{
    require_host_capability, require_host_capability_supported, HostCapability,
};

#[tauri::command]
pub fn app__ipc_announce_start(state: State<'_, AppState>) -> Result<(), AppError> {
    require_host_capability(HostCapability::Ipc)?;
    let packet = IpcPacket {
        type_field: "N/A".into(),
        data: Some("Start".into()),
        msg_type: Some("N/A".into()),
    };
    state.ipc.send(&packet);
    Ok(())
}

#[tauri::command]
pub fn app__send_ipc(
    state: State<'_, AppState>,
    type_name: String,
    data: String,
) -> Result<(), AppError> {
    require_host_capability(HostCapability::Ipc)?;
    let packet = IpcPacket {
        type_field: type_name,
        data: Some(data),
        msg_type: None,
    };
    state.ipc.send(&packet);
    Ok(())
}

#[tauri::command]
pub fn app__set_app_launcher_settings(
    state: State<'_, AppState>,
    enabled: bool,
    kill_on_exit: bool,
    run_process_once: bool,
) -> Result<(), AppError> {
    require_host_capability_supported(HostCapability::GameLaunch)?;
    state
        .auto_launch
        .set_settings(enabled, kill_on_exit, run_process_once);
    Ok(())
}

#[tauri::command]
pub fn app__try_open_instance_in_vrc(launch_url: String) -> Result<bool, AppError> {
    require_host_capability(HostCapability::VrchatLaunchPipe)?;
    Ok(crate::domain::ipc::vrcipc_send(&launch_url))
}
