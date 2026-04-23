#![allow(non_snake_case)]

use tauri::State;

use crate::domain::ipc::IpcPacket;
use crate::state::AppState;

#[tauri::command]
pub fn app__ipc_announce_start(state: State<'_, AppState>) {
    let packet = IpcPacket {
        type_field: "N/A".into(),
        data: Some("Start".into()),
        msg_type: Some("N/A".into()),
    };
    state.ipc.send(&packet);
}

#[tauri::command]
pub fn app__send_ipc(state: State<'_, AppState>, type_name: String, data: String) {
    let packet = IpcPacket {
        type_field: type_name,
        data: Some(data),
        msg_type: None,
    };
    state.ipc.send(&packet);
}

#[tauri::command]
pub fn app__set_app_launcher_settings(
    state: State<'_, AppState>,
    enabled: bool,
    kill_on_exit: bool,
    run_process_once: bool,
) {
    state
        .auto_launch
        .set_settings(enabled, kill_on_exit, run_process_once);
}

#[tauri::command]
pub fn app__try_open_instance_in_vrc(launch_url: String) -> bool {
    crate::domain::ipc::vrcipc_send(&launch_url)
}
