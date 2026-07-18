use std::sync::Mutex;

#[cfg(unix)]
use std::{
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
};

use serde_json::{json, Value};

use vrcx_0_host::Error;

const DEFAULT_APP_ID: &str = "1510639562177642557";
#[cfg(any(windows, unix))]
const DISCORD_IPC_OPCODE_HANDSHAKE: u32 = 0;
const DISCORD_IPC_OPCODE_FRAME: u32 = 1;
#[cfg(unix)]
const DISCORD_RPC_RESPONSE_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(750);
const DISCORD_RPC_MAX_FRAME_BYTES: usize = 1024 * 1024;

#[derive(Default)]
pub struct DiscordRpc {
    inner: Mutex<DiscordRpcInner>,
}

#[derive(Default)]
struct DiscordRpcInner {
    connection: Option<DiscordRpcConnection>,
    nonce: u64,
    is_active: bool,
}

#[cfg(windows)]
struct DiscordRpcConnection {
    app_id: String,
    file: std::fs::File,
}

#[cfg(unix)]
struct DiscordRpcConnection {
    app_id: String,
    stream: UnixStream,
}

#[cfg(not(any(windows, unix)))]
struct DiscordRpcConnection;

impl DiscordRpc {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_active(&self, active: bool) -> Result<bool, Error> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| Error::Custom("discord rpc mutex poisoned".into()))?;

        if active {
            ensure_connection(&mut inner, DEFAULT_APP_ID)?;
            inner.is_active = true;
            return Ok(true);
        }

        let nonce = next_nonce(&mut inner);
        if let Some(connection) = inner.connection.as_mut() {
            if write_activity(connection, nonce, Value::Null).is_err() {
                inner.connection = None;
            }
        }
        inner.connection = None;
        inner.is_active = false;
        Ok(false)
    }

    pub fn set_assets(&self, payload: Value) -> Result<bool, Error> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| Error::Custom("discord rpc mutex poisoned".into()))?;
        let app_id = payload
            .get("appId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(DEFAULT_APP_ID);
        let activity = payload
            .get("activity")
            .cloned()
            .ok_or_else(|| Error::Custom("discord activity payload is missing".into()))?;
        let nonce = next_nonce(&mut inner);
        if let Err(error) = ensure_connection(&mut inner, app_id)
            .and_then(|connection| write_activity(connection, nonce, activity))
        {
            inner.connection = None;
            inner.is_active = false;
            return Err(error);
        }
        inner.is_active = true;
        Ok(true)
    }
}

fn next_nonce(inner: &mut DiscordRpcInner) -> String {
    inner.nonce = inner.nonce.wrapping_add(1);
    format!("vrcx-0-{}", inner.nonce)
}

fn write_activity(
    connection: &mut DiscordRpcConnection,
    nonce: String,
    activity: Value,
) -> Result<(), Error> {
    let payload = json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": std::process::id(),
            "activity": activity
        },
        "nonce": nonce
    });
    write_frame(
        connection,
        DISCORD_IPC_OPCODE_FRAME,
        &payload,
        payload.get("nonce").and_then(Value::as_str),
    )
}

#[cfg(any(windows, unix))]
fn ensure_connection<'a>(
    inner: &'a mut DiscordRpcInner,
    app_id: &str,
) -> Result<&'a mut DiscordRpcConnection, Error> {
    let reconnect = inner
        .connection
        .as_ref()
        .map(|connection| connection.app_id != app_id)
        .unwrap_or(true);

    if reconnect {
        inner.connection = Some(open_connection(app_id)?);
    }

    inner
        .connection
        .as_mut()
        .ok_or_else(|| Error::Custom("discord rpc unavailable".into()))
}

#[cfg(not(any(windows, unix)))]
fn ensure_connection<'a>(
    inner: &'a mut DiscordRpcInner,
    _app_id: &str,
) -> Result<&'a mut DiscordRpcConnection, Error> {
    inner.connection = None;
    Err(Error::Custom(
        "discord rpc is unsupported on this platform".into(),
    ))
}

#[cfg(windows)]
fn open_connection(app_id: &str) -> Result<DiscordRpcConnection, Error> {
    let mut last_error = None;
    for index in 0..10 {
        for prefix in [r"\\?\pipe", r"\\.\pipe"] {
            let path = format!(r"{prefix}\discord-ipc-{index}");
            match std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&path)
            {
                Ok(mut file) => {
                    let payload = json!({
                        "v": 1,
                        "client_id": app_id
                    });
                    write_raw_frame(&mut file, DISCORD_IPC_OPCODE_HANDSHAKE, &payload)?;
                    read_response(&mut file, None)?;
                    return Ok(DiscordRpcConnection {
                        app_id: app_id.to_string(),
                        file,
                    });
                }
                Err(error) => {
                    last_error = Some(error);
                }
            }
        }
    }

    Err(Error::Custom(format!(
        "discord rpc pipe unavailable: {}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "unknown error".into())
    )))
}

#[cfg(unix)]
fn open_connection(app_id: &str) -> Result<DiscordRpcConnection, Error> {
    let mut last_error = None;
    for path in discord_ipc_socket_paths() {
        match UnixStream::connect(&path) {
            Ok(mut stream) => {
                let payload = json!({
                    "v": 1,
                    "client_id": app_id
                });
                stream.set_write_timeout(Some(DISCORD_RPC_RESPONSE_TIMEOUT))?;
                write_raw_frame(&mut stream, DISCORD_IPC_OPCODE_HANDSHAKE, &payload)?;
                read_response(&mut stream, None)?;
                return Ok(DiscordRpcConnection {
                    app_id: app_id.to_string(),
                    stream,
                });
            }
            Err(error) => {
                last_error = Some(error);
            }
        }
    }

    Err(Error::Custom(format!(
        "discord rpc socket unavailable: {}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "unknown error".into())
    )))
}

#[cfg(windows)]
fn write_frame(
    connection: &mut DiscordRpcConnection,
    opcode: u32,
    payload: &Value,
    expected_nonce: Option<&str>,
) -> Result<(), Error> {
    write_raw_frame(&mut connection.file, opcode, payload)?;
    read_response(&mut connection.file, expected_nonce)?;
    Ok(())
}

#[cfg(unix)]
fn write_frame(
    connection: &mut DiscordRpcConnection,
    opcode: u32,
    payload: &Value,
    expected_nonce: Option<&str>,
) -> Result<(), Error> {
    write_raw_frame(&mut connection.stream, opcode, payload)?;
    read_response(&mut connection.stream, expected_nonce)?;
    Ok(())
}

#[cfg(not(any(windows, unix)))]
fn write_frame(
    _connection: &mut DiscordRpcConnection,
    _opcode: u32,
    _payload: &Value,
    _expected_nonce: Option<&str>,
) -> Result<(), Error> {
    Err(Error::Custom(
        "discord rpc is unsupported on this platform".into(),
    ))
}

#[cfg(any(windows, unix))]
fn write_raw_frame(
    writer: &mut impl std::io::Write,
    opcode: u32,
    payload: &Value,
) -> Result<(), Error> {
    let bytes = serde_json::to_vec(payload)?;
    writer.write_all(&opcode.to_le_bytes())?;
    writer.write_all(&(bytes.len() as u32).to_le_bytes())?;
    writer.write_all(&bytes)?;
    writer.flush()?;
    Ok(())
}

#[cfg(windows)]
fn read_response(file: &mut std::fs::File, expected_nonce: Option<&str>) -> Result<(), Error> {
    use std::time::{Duration, Instant};

    let deadline = Instant::now() + Duration::from_millis(750);
    loop {
        if let Some(payload) = read_next_frame(file)? {
            if let Some(message) = discord_response_error(&payload) {
                return Err(Error::Custom(message));
            }
            if expected_nonce
                .map(|nonce| payload.get("nonce").and_then(Value::as_str) == Some(nonce))
                .unwrap_or(true)
            {
                return Ok(());
            }
            continue;
        }

        if Instant::now() >= deadline {
            return Err(Error::Custom("discord rpc response timed out".into()));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(unix)]
fn read_response(stream: &mut UnixStream, expected_nonce: Option<&str>) -> Result<(), Error> {
    let deadline = std::time::Instant::now() + DISCORD_RPC_RESPONSE_TIMEOUT;
    loop {
        let payload = read_next_frame(stream, deadline)?;
        if let Some(message) = discord_response_error(&payload) {
            return Err(Error::Custom(message));
        }
        if expected_nonce
            .map(|nonce| payload.get("nonce").and_then(Value::as_str) == Some(nonce))
            .unwrap_or(true)
        {
            return Ok(());
        }
    }
}

#[cfg(windows)]
fn read_next_frame(file: &mut std::fs::File) -> Result<Option<Value>, Error> {
    let Some((header, available)) = peek_frame_header(file)? else {
        return Ok(None);
    };
    let length = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
    if length > DISCORD_RPC_MAX_FRAME_BYTES {
        return Err(Error::Custom("discord rpc response is too large".into()));
    }
    if available < 8usize.saturating_add(length) {
        return Ok(None);
    }

    let mut header = [0u8; 8];
    read_exact_from_pipe(file, &mut header)?;
    let mut payload = vec![0u8; length];
    read_exact_from_pipe(file, &mut payload)?;
    Ok(Some(serde_json::from_slice(&payload)?))
}

#[cfg(unix)]
fn read_next_frame(stream: &mut UnixStream, deadline: std::time::Instant) -> Result<Value, Error> {
    let mut header = [0u8; 8];
    read_exact_from_stream(stream, &mut header, deadline)?;
    let length = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
    if length > DISCORD_RPC_MAX_FRAME_BYTES {
        return Err(Error::Custom("discord rpc response is too large".into()));
    }

    let mut payload = vec![0u8; length];
    read_exact_from_stream(stream, &mut payload, deadline)?;
    Ok(serde_json::from_slice(&payload)?)
}

#[cfg(any(windows, unix))]
fn discord_response_error(payload: &Value) -> Option<String> {
    let event = payload.get("evt").and_then(Value::as_str).unwrap_or("");
    let command = payload.get("cmd").and_then(Value::as_str).unwrap_or("");
    if !event.eq_ignore_ascii_case("ERROR") && !command.eq_ignore_ascii_case("ERROR") {
        return None;
    }

    let data = payload.get("data").unwrap_or(&Value::Null);
    let code = data
        .get("code")
        .and_then(Value::as_i64)
        .map(|value| format!(" {value}"))
        .unwrap_or_default();
    let message = data
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("unknown Discord RPC error");
    Some(format!("discord rpc error{code}: {message}"))
}

#[cfg(unix)]
fn discord_ipc_socket_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut dirs = Vec::new();
    for key in ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"] {
        if let Some(value) = std::env::var_os(key).filter(|value| !value.is_empty()) {
            push_unique_path(&mut dirs, PathBuf::from(value));
        }
    }
    push_unique_path(&mut dirs, PathBuf::from("/tmp"));

    for dir in dirs {
        add_discord_ipc_paths(&mut paths, &dir);
        add_named_runtime_child_paths(&mut paths, &dir);
        add_flatpak_app_paths(&mut paths, &dir);
    }
    paths
}

#[cfg(unix)]
fn add_discord_ipc_paths(paths: &mut Vec<PathBuf>, dir: &Path) {
    for index in 0..10 {
        push_unique_path(paths, dir.join(format!("discord-ipc-{index}")));
    }
}

#[cfg(unix)]
fn add_named_runtime_child_paths(paths: &mut Vec<PathBuf>, dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if name.contains("discord") || name.contains("vesktop") || name.contains("legcord") {
            add_discord_ipc_paths(paths, &entry.path());
        }
    }
}

#[cfg(unix)]
fn add_flatpak_app_paths(paths: &mut Vec<PathBuf>, dir: &Path) {
    let app_dir = dir.join("app");
    let Ok(entries) = std::fs::read_dir(app_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            add_discord_ipc_paths(paths, &entry.path());
        }
    }
}

#[cfg(unix)]
fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| existing == &path) {
        paths.push(path);
    }
}

#[cfg(unix)]
fn read_exact_from_stream(
    stream: &mut UnixStream,
    buffer: &mut [u8],
    deadline: std::time::Instant,
) -> Result<(), Error> {
    use std::io::{ErrorKind, Read};

    let remaining = deadline.saturating_duration_since(std::time::Instant::now());
    if remaining.is_zero() {
        return Err(Error::Custom("discord rpc response timed out".into()));
    }
    stream.set_read_timeout(Some(remaining))?;
    match stream.read_exact(buffer) {
        Ok(()) => Ok(()),
        Err(error) if matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) => {
            Err(Error::Custom("discord rpc response timed out".into()))
        }
        Err(error) if error.kind() == ErrorKind::UnexpectedEof => {
            Err(Error::Custom("discord rpc socket closed".into()))
        }
        Err(error) => Err(error.into()),
    }
}

#[cfg(windows)]
fn peek_frame_header(file: &std::fs::File) -> Result<Option<([u8; 8], usize)>, Error> {
    use std::os::windows::io::AsRawHandle;
    use std::ptr::null_mut;

    use windows_sys::Win32::System::Pipes::PeekNamedPipe;

    let handle = file.as_raw_handle();
    let mut header = [0u8; 8];
    let mut bytes_read = 0u32;
    let mut available = 0u32;
    let ok = unsafe {
        PeekNamedPipe(
            handle,
            header.as_mut_ptr().cast(),
            header.len() as u32,
            &mut bytes_read,
            &mut available,
            null_mut(),
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    if bytes_read < header.len() as u32 || available < header.len() as u32 {
        return Ok(None);
    }
    Ok(Some((header, available as usize)))
}

#[cfg(windows)]
fn read_exact_from_pipe(file: &std::fs::File, buffer: &mut [u8]) -> Result<(), Error> {
    use std::os::windows::io::AsRawHandle;
    use std::ptr::null_mut;

    use windows_sys::Win32::Storage::FileSystem::ReadFile;

    let handle = file.as_raw_handle();
    let mut offset = 0usize;
    while offset < buffer.len() {
        let remaining = (buffer.len() - offset) as u32;
        let mut read = 0u32;
        let ok = unsafe {
            ReadFile(
                handle,
                buffer[offset..].as_mut_ptr(),
                remaining,
                &mut read,
                null_mut(),
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        if read == 0 {
            return Err(Error::Custom("discord rpc pipe closed".into()));
        }
        offset += read as usize;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(any(windows, unix))]
    #[test]
    fn set_assets_discards_connection_after_io_failure() {
        let rpc = DiscordRpc {
            inner: Mutex::new(DiscordRpcInner {
                connection: Some(connection_that_rejects_activity()),
                nonce: 0,
                is_active: true,
            }),
        };

        let result = rpc.set_assets(json!({
            "appId": DEFAULT_APP_ID,
            "activity": { "details": "VRChat" }
        }));

        assert!(result.is_err());
        let inner = rpc.inner.lock().unwrap();
        assert!(inner.connection.is_none());
        assert!(!inner.is_active);
    }

    #[cfg(windows)]
    fn connection_that_rejects_activity() -> DiscordRpcConnection {
        DiscordRpcConnection {
            app_id: DEFAULT_APP_ID.into(),
            file: std::fs::File::open(std::env::current_exe().unwrap()).unwrap(),
        }
    }

    #[cfg(unix)]
    fn connection_that_rejects_activity() -> DiscordRpcConnection {
        use std::net::Shutdown;

        let (stream, peer) = UnixStream::pair().unwrap();
        stream.shutdown(Shutdown::Both).unwrap();
        drop(peer);
        DiscordRpcConnection {
            app_id: DEFAULT_APP_ID.into(),
            stream,
        }
    }
}
