#![allow(non_snake_case)]

pub use vrcx_0_host::host_capabilities::{
    require_host_capability, HostCapabilities, HostCapability,
};

use vrcx_0_host::host_capabilities::current_host_capabilities;

#[tauri::command]
pub fn app__get_host_capabilities() -> HostCapabilities {
    current_host_capabilities()
}
