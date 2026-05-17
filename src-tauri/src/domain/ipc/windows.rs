use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter};
use vrcx_0_host::local_ipc_server::{LocalIpcEventHandler, LocalIpcServer};

use super::{IpcEventDisposition, IpcEventSink, IpcPacket};

pub struct IpcServer {
    inner: LocalIpcServer,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
}

impl IpcServer {
    pub fn new(event_sink: Option<Arc<dyn IpcEventSink>>) -> Self {
        let app_handle: Arc<Mutex<Option<AppHandle>>> = Arc::new(Mutex::new(None));
        let app_handle_for_handler = Arc::clone(&app_handle);
        let event_handler: LocalIpcEventHandler = Arc::new(move |packet_str| {
            let should_forward = match &event_sink {
                Some(sink) => match sink.on_ipc_event(&packet_str) {
                    Ok(IpcEventDisposition::Handled) => false,
                    Ok(IpcEventDisposition::Forward) => true,
                    Err(error) => {
                        tracing::warn!("IPC backend handler failed: {error}");
                        true
                    }
                },
                None => true,
            };
            if should_forward {
                if let Some(app_handle) = app_handle_for_handler.lock().unwrap().clone() {
                    let _ = app_handle.emit("ipcEvent", &packet_str);
                } else {
                    tracing::warn!("IPC event received before Tauri AppHandle was attached");
                }
            }
        });

        Self {
            inner: LocalIpcServer::new(Some(event_handler)),
            app_handle,
        }
    }

    pub fn start(&self, app_handle: AppHandle) {
        *self.app_handle.lock().unwrap() = Some(app_handle);
        self.inner.start();
    }

    pub fn send(&self, packet: &IpcPacket) {
        self.inner.send(packet);
    }
}
