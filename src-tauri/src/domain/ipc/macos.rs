use tauri::AppHandle;

use super::{IpcEventSink, IpcPacket};

pub struct IpcServer;

impl IpcServer {
    pub fn new(_event_sink: Option<std::sync::Arc<dyn IpcEventSink>>) -> Self {
        Self
    }

    pub fn start(&self, _app_handle: AppHandle) {}

    pub fn send(&self, _packet: &IpcPacket) {}
}

pub fn vrcipc_send(_message: &str) -> bool {
    false
}
