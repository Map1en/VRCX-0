use std::sync::{Arc, Mutex};

use tauri::AppHandle;
use tauri::Emitter;

pub struct IpcServer {
    #[cfg_attr(not(windows), allow(dead_code))]
    clients: Arc<Mutex<Vec<ClientHandle>>>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct IpcPacket {
    #[serde(rename = "Type")]
    pub type_field: String,
    #[serde(rename = "Data", skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(rename = "MsgType", skip_serializing_if = "Option::is_none")]
    pub msg_type: Option<String>,
}

#[cfg(windows)]
type ClientHandle = Arc<Mutex<Option<std::fs::File>>>;

#[cfg(windows)]
impl IpcServer {
    pub fn new() -> Self {
        Self {
            clients: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn start(&self, app_handle: AppHandle) {
        let clients = self.clients.clone();

        std::thread::spawn(move || {
            let pipe_name = get_ipc_name();
            loop {
                if let Err(e) = accept_one(&pipe_name, &clients, &app_handle) {
                    tracing::error!("[IPC] accept error: {e}");
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
            }
        });
    }

    pub fn send(&self, packet: &IpcPacket) {
        use std::io::Write;

        let json = match serde_json::to_string(packet) {
            Ok(j) => j,
            Err(e) => {
                tracing::error!("[IPC] serialize error: {e}");
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

#[cfg(windows)]
fn get_ipc_name() -> String {
    let username = std::env::var("USERNAME").unwrap_or_default();
    let hash: u32 = username.chars().map(|c| c as u32).sum();
    format!(r"\\.\pipe\vrcx-0-ipc-{hash}")
}

#[cfg(windows)]
fn accept_one(
    pipe_name: &str,
    clients: &Arc<Mutex<Vec<ClientHandle>>>,
    app_handle: &AppHandle,
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
            std::ptr::null() as *const windows_sys::Win32::Security::SECURITY_ATTRIBUTES,
        )
    };

    if handle == INVALID_HANDLE_VALUE {
        return Err("CreateNamedPipeW failed".into());
    }

    let connected = unsafe {
        ConnectNamedPipe(
            handle,
            std::ptr::null_mut() as *mut windows_sys::Win32::System::IO::OVERLAPPED,
        )
    };
    if connected == 0 {
        let err = unsafe { GetLastError() };
        if err != ERROR_PIPE_CONNECTED {
            unsafe { CloseHandle(handle) };
            return Err(format!("ConnectNamedPipe failed: {err}"));
        }
    }

    use std::os::windows::io::FromRawHandle;
    let pipe_file = unsafe { std::fs::File::from_raw_handle(handle as *mut std::ffi::c_void) };
    let client_arc = Arc::new(Mutex::new(Some(pipe_file)));

    clients.lock().unwrap().push(client_arc.clone());

    let app_handle = app_handle.clone();
    let clients_ref = clients.clone();
    std::thread::spawn(move || {
        read_client(client_arc, &clients_ref, &app_handle);
    });

    Ok(())
}

#[cfg(windows)]
fn read_client(
    client_arc: ClientHandle,
    clients: &Arc<Mutex<Vec<ClientHandle>>>,
    app_handle: &AppHandle,
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
                let _ = app_handle.emit("ipcEvent", &packet_str);
            }
        }
    }

    {
        let mut guard = client_arc.lock().unwrap();
        *guard = None;
    }
    let mut all = clients.lock().unwrap();
    all.retain(|c| c.lock().unwrap().is_some());
}

#[cfg(windows)]
pub fn vrcipc_send(message: &str) -> bool {
    use std::io::{Read, Write};
    use std::time::Duration;

    let pipe_path = r"\\.\pipe\VRChatURLLaunchPipe";

    let mut pipe = match open_pipe_client(pipe_path, Duration::from_secs(1)) {
        Some(p) => p,
        None => return false,
    };

    let bytes = message.as_bytes();
    if pipe.write_all(bytes).is_err() {
        return false;
    }

    let mut result = [0u8; 1];
    if pipe.read_exact(&mut result).is_err() {
        return false;
    }

    result[0] == 1
}

#[cfg(windows)]
fn open_pipe_client(pipe_path: &str, timeout: std::time::Duration) -> Option<std::fs::File> {
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::Storage::FileSystem::*;
    use windows_sys::Win32::System::Pipes::*;

    let wide: Vec<u16> = pipe_path.encode_utf16().chain(std::iter::once(0)).collect();
    let deadline = std::time::Instant::now() + timeout;

    loop {
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                std::ptr::null() as *const windows_sys::Win32::Security::SECURITY_ATTRIBUTES,
                OPEN_EXISTING,
                0,
                std::ptr::null_mut() as HANDLE,
            )
        };

        if handle != INVALID_HANDLE_VALUE {
            use std::os::windows::io::FromRawHandle;
            return Some(unsafe {
                std::fs::File::from_raw_handle(handle as *mut std::ffi::c_void)
            });
        }

        if std::time::Instant::now() >= deadline {
            return None;
        }

        let ok = unsafe { WaitNamedPipeW(wide.as_ptr(), 1000) };
        if ok == 0 && std::time::Instant::now() >= deadline {
            return None;
        }
    }
}

#[cfg(not(windows))]
type ClientHandle = ();

#[cfg(not(windows))]
impl IpcServer {
    pub fn new() -> Self {
        Self {
            clients: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn start(&self, _app_handle: AppHandle) {}

    pub fn send(&self, _packet: &IpcPacket) {}
}

#[cfg(not(windows))]
pub fn vrcipc_send(_message: &str) -> bool {
    false
}
