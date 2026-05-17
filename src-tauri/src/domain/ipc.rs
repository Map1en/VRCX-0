#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
mod unsupported;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
pub use linux::IpcServer;
#[cfg(target_os = "macos")]
pub use macos::IpcServer;
#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
pub use unsupported::IpcServer;
pub use vrcx_0_core::ipc::{IpcEventDisposition, IpcPacket};
pub use vrcx_0_host::vrchat_ipc::vrcipc_send;
#[cfg(target_os = "windows")]
pub use windows::IpcServer;

use crate::error::AppError;

pub trait IpcEventSink: Send + Sync {
    fn on_ipc_event(&self, packet: &str) -> Result<IpcEventDisposition, AppError>;
}
