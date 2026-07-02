#[cfg(target_os = "windows")]
mod platform {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread::JoinHandle;

    use vrcx_0_core::ipc::IpcPacket;

    pub type LocalIpcEventHandler = Arc<dyn Fn(String) + Send + Sync + 'static>;
    type ClientHandle = Arc<Mutex<ClientState>>;

    struct ClientState {
        write_pipe: Option<std::fs::File>,
        control_pipe: Option<std::fs::File>,
        read_thread: Option<JoinHandle<()>>,
    }

    impl ClientState {
        fn active(&self) -> bool {
            self.write_pipe.is_some()
        }
    }

    pub struct LocalIpcServer {
        clients: Arc<Mutex<Vec<ClientHandle>>>,
        event_handler: Option<LocalIpcEventHandler>,
        stop_requested: Arc<AtomicBool>,
        accept_thread: Mutex<Option<JoinHandle<()>>>,
    }

    impl LocalIpcServer {
        pub fn new(event_handler: Option<LocalIpcEventHandler>) -> Self {
            Self {
                clients: Arc::new(Mutex::new(Vec::new())),
                event_handler,
                stop_requested: Arc::new(AtomicBool::new(false)),
                accept_thread: Mutex::new(None),
            }
        }

        pub fn start(&self) {
            if let Ok(accept_thread) = self.accept_thread.lock() {
                if accept_thread
                    .as_ref()
                    .is_some_and(|handle| !handle.is_finished())
                {
                    return;
                }
            }
            self.stop_requested.store(false, Ordering::Release);
            let clients = self.clients.clone();
            let event_handler = self.event_handler.clone();
            let stop_requested = Arc::clone(&self.stop_requested);

            let handle = std::thread::spawn(move || {
                let pipe_name = get_ipc_name();
                while !stop_requested.load(Ordering::Acquire) {
                    if let Err(error) =
                        accept_one(&pipe_name, &clients, &event_handler, &stop_requested)
                    {
                        if stop_requested.load(Ordering::Acquire) {
                            break;
                        }
                        tracing::warn!("[IPC] accept error: {error}");
                        std::thread::sleep(std::time::Duration::from_secs(1));
                    }
                }
            });
            if let Ok(mut accept_thread) = self.accept_thread.lock() {
                if let Some(previous) = accept_thread.take() {
                    if previous.is_finished() {
                        let _ = previous.join();
                    }
                }
                *accept_thread = Some(handle);
            }
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

            let clients_snapshot = self.clients.lock().unwrap().clone();
            for client_arc in clients_snapshot {
                let mut guard = client_arc.lock().unwrap();
                if let Some(ref mut pipe) = guard.write_pipe {
                    if pipe.write_all(&payload).is_err() {
                        guard.write_pipe = None;
                    }
                }
            }
            let mut clients = self.clients.lock().unwrap();
            clients.retain(|client| client.lock().unwrap().active());
        }

        pub fn stop(&self) {
            self.stop_requested.store(true, Ordering::Release);
            let pipe_name = get_ipc_name();
            let _ = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(pipe_name);
            let client_handles = if let Ok(mut clients) = self.clients.lock() {
                clients.drain(..).collect::<Vec<_>>()
            } else {
                Vec::new()
            };
            for client in client_handles {
                let read_thread = if let Ok(mut guard) = client.lock() {
                    guard.write_pipe = None;
                    if let Some(control_pipe) = guard.control_pipe.take() {
                        disconnect_pipe(&control_pipe);
                    }
                    guard.read_thread.take()
                } else {
                    None
                };
                if let Some(handle) = read_thread {
                    let _ = handle.join();
                }
            }
            if let Ok(mut accept_thread) = self.accept_thread.lock() {
                if let Some(handle) = accept_thread.take() {
                    let _ = handle.join();
                }
            }
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
        stop_requested: &Arc<AtomicBool>,
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
        if stop_requested.load(Ordering::Acquire) {
            unsafe { CloseHandle(handle) };
            return Ok(());
        }
        if connected == 0 {
            let err = unsafe { GetLastError() };
            if err != ERROR_PIPE_CONNECTED {
                unsafe { CloseHandle(handle) };
                return Err(format!("ConnectNamedPipe failed: {err}"));
            }
        }

        use std::os::windows::io::FromRawHandle;
        let pipe_file = unsafe { std::fs::File::from_raw_handle(handle) };
        let write_pipe = pipe_file
            .try_clone()
            .map_err(|error| format!("Clone named pipe handle failed: {error}"))?;
        let control_pipe = pipe_file
            .try_clone()
            .map_err(|error| format!("Clone named pipe control handle failed: {error}"))?;
        let client_arc = Arc::new(Mutex::new(ClientState {
            write_pipe: Some(write_pipe),
            control_pipe: Some(control_pipe),
            read_thread: None,
        }));

        let clients_ref = clients.clone();
        let event_handler = event_handler.clone();
        let stop_requested = Arc::clone(stop_requested);
        let reader_client = Arc::clone(&client_arc);
        let read_thread = std::thread::spawn(move || {
            read_client(
                pipe_file,
                reader_client,
                &clients_ref,
                event_handler,
                stop_requested,
            );
        });
        {
            let mut client = client_arc.lock().unwrap();
            client.read_thread = Some(read_thread);
        }
        clients.lock().unwrap().push(client_arc);

        Ok(())
    }

    fn disconnect_pipe(pipe: &std::fs::File) {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::Pipes::DisconnectNamedPipe;

        unsafe {
            let _ = DisconnectNamedPipe(pipe.as_raw_handle());
        }
    }

    fn read_client(
        mut pipe_file: std::fs::File,
        client_arc: ClientHandle,
        clients: &Arc<Mutex<Vec<ClientHandle>>>,
        event_handler: Option<LocalIpcEventHandler>,
        stop_requested: Arc<AtomicBool>,
    ) {
        use std::io::Read;

        let mut buf = [0u8; 8192];
        let mut pending = String::new();

        while !stop_requested.load(Ordering::Acquire) {
            let bytes_read = match pipe_file.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
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
            guard.write_pipe = None;
            guard.control_pipe = None;
        }
        let mut all = clients.lock().unwrap();
        all.retain(|client| client.lock().unwrap().active());
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

        pub fn stop(&self) {}
    }
}

pub use platform::{LocalIpcEventHandler, LocalIpcServer};
