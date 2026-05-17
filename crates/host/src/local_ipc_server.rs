#[cfg(target_os = "windows")]
mod platform {
    use std::sync::{Arc, Mutex};

    use vrcx_0_core::ipc::IpcPacket;

    pub type LocalIpcEventHandler = Arc<dyn Fn(String) + Send + Sync + 'static>;
    type ClientHandle = Arc<Mutex<Option<std::fs::File>>>;

    pub struct LocalIpcServer {
        clients: Arc<Mutex<Vec<ClientHandle>>>,
        event_handler: Option<LocalIpcEventHandler>,
    }

    impl LocalIpcServer {
        pub fn new(event_handler: Option<LocalIpcEventHandler>) -> Self {
            Self {
                clients: Arc::new(Mutex::new(Vec::new())),
                event_handler,
            }
        }

        pub fn start(&self) {
            let clients = self.clients.clone();
            let event_handler = self.event_handler.clone();

            std::thread::spawn(move || {
                let pipe_name = get_ipc_name();
                loop {
                    if let Err(error) = accept_one(&pipe_name, &clients, &event_handler) {
                        tracing::error!("[IPC] accept error: {error}");
                        std::thread::sleep(std::time::Duration::from_secs(1));
                    }
                }
            });
        }

        pub fn send(&self, packet: &IpcPacket) {
            use std::io::Write;

            let json = match serde_json::to_string(packet) {
                Ok(json) => json,
                Err(error) => {
                    tracing::error!("[IPC] serialize error: {error}");
                    return;
                }
            };

            let mut payload = json.into_bytes();
            payload.push(0x00);

            let mut clients = self.clients.lock().unwrap();
            clients.retain(|client_arc| {
                let mut guard = client_arc.lock().unwrap();
                if let Some(ref mut pipe) = *guard {
                    if pipe.write_all(&payload).is_err() {
                        *guard = None;
                        return false;
                    }
                    true
                } else {
                    false
                }
            });
        }
    }

    fn get_ipc_name() -> String {
        let username = std::env::var("USERNAME").unwrap_or_default();
        let hash: u32 = username.chars().map(|c| c as u32).sum();
        format!(r"\\.\pipe\vrcx-0-ipc-{hash}")
    }

    fn accept_one(
        pipe_name: &str,
        clients: &Arc<Mutex<Vec<ClientHandle>>>,
        event_handler: &Option<LocalIpcEventHandler>,
    ) -> Result<(), String> {
        use windows_sys::Win32::Foundation::*;
        use windows_sys::Win32::Storage::FileSystem::*;
        use windows_sys::Win32::System::Pipes::*;

        let wide_name: Vec<u16> = pipe_name.encode_utf16().chain(std::iter::once(0)).collect();

        let handle = unsafe {
            CreateNamedPipeW(
                wide_name.as_ptr(),
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                PIPE_UNLIMITED_INSTANCES,
                8192,
                8192,
                0,
                std::ptr::null(),
            )
        };

        if handle == INVALID_HANDLE_VALUE {
            return Err("CreateNamedPipeW failed".into());
        }

        let connected = unsafe { ConnectNamedPipe(handle, std::ptr::null_mut()) };
        if connected == 0 {
            let err = unsafe { GetLastError() };
            if err != ERROR_PIPE_CONNECTED {
                unsafe { CloseHandle(handle) };
                return Err(format!("ConnectNamedPipe failed: {err}"));
            }
        }

        use std::os::windows::io::FromRawHandle;
        let pipe_file = unsafe { std::fs::File::from_raw_handle(handle) };
        let client_arc = Arc::new(Mutex::new(Some(pipe_file)));

        clients.lock().unwrap().push(client_arc.clone());

        let clients_ref = clients.clone();
        let event_handler = event_handler.clone();
        std::thread::spawn(move || {
            read_client(client_arc, &clients_ref, event_handler);
        });

        Ok(())
    }

    fn read_client(
        client_arc: ClientHandle,
        clients: &Arc<Mutex<Vec<ClientHandle>>>,
        event_handler: Option<LocalIpcEventHandler>,
    ) {
        use std::io::Read;

        let mut buf = [0u8; 8192];
        let mut pending = String::new();

        loop {
            let bytes_read = {
                let mut guard = client_arc.lock().unwrap();
                match guard.as_mut() {
                    Some(pipe) => match pipe.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => n,
                        Err(_) => break,
                    },
                    None => break,
                }
            };

            pending.push_str(&String::from_utf8_lossy(&buf[..bytes_read]));

            while let Some(pos) = pending.find('\0') {
                let packet_str: String = pending.drain(..pos).collect();
                pending.drain(..1);

                if !packet_str.is_empty() {
                    if let Some(handler) = &event_handler {
                        handler(packet_str);
                    }
                }
            }
        }

        {
            let mut guard = client_arc.lock().unwrap();
            *guard = None;
        }
        let mut all = clients.lock().unwrap();
        all.retain(|client| client.lock().unwrap().is_some());
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use std::sync::Arc;

    use vrcx_0_core::ipc::IpcPacket;

    pub type LocalIpcEventHandler = Arc<dyn Fn(String) + Send + Sync + 'static>;

    pub struct LocalIpcServer;

    impl LocalIpcServer {
        pub fn new(_event_handler: Option<LocalIpcEventHandler>) -> Self {
            Self
        }

        pub fn start(&self) {}

        pub fn send(&self, _packet: &IpcPacket) {}
    }
}

pub use platform::{LocalIpcEventHandler, LocalIpcServer};
