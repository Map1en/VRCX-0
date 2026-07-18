#![allow(non_snake_case)]

pub use vrcx_0_host_desktop::host_capabilities::{
    require_host_capability, HostCapabilities, HostCapability,
};

use vrcx_0_host_desktop::host_capabilities::current_host_capabilities;

#[tauri::command]
#[specta::specta]
pub fn app__get_host_capabilities() -> HostCapabilities {
    current_host_capabilities()
}
