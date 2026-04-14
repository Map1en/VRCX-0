use std::sync::Mutex;

use serde_json::{json, Value};

use crate::error::AppError;

const DEFAULT_APP_ID: &str = "883308884863901717";
const DISCORD_IPC_OPCODE_HANDSHAKE: u32 = 0;
const DISCORD_IPC_OPCODE_FRAME: u32 = 1;

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

#[cfg(not(windows))]
struct DiscordRpcConnection;

impl DiscordRpc {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_active(&self, active: bool) -> Result<bool, AppError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| AppError::Custom("discord rpc mutex poisoned".into()))?;

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
        inner.is_active = false;
        Ok(false)
    }

    pub fn set_assets(&self, payload: Value) -> Result<bool, AppError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| AppError::Custom("discord rpc mutex poisoned".into()))?;
        let app_id = payload
            .get("appId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(DEFAULT_APP_ID);
        let activity = payload
            .get("activity")
            .cloned()
            .ok_or_else(|| AppError::Custom("discord activity payload is missing".into()))?;
        let nonce = next_nonce(&mut inner);
        let connection = ensure_connection(&mut inner, app_id)?;
        write_activity(connection, nonce, activity)?;
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
) -> Result<(), AppError> {
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

#[cfg(windows)]
fn ensure_connection<'a>(
    inner: &'a mut DiscordRpcInner,
    app_id: &str,
) -> Result<&'a mut DiscordRpcConnection, AppError> {
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
        .ok_or_else(|| AppError::Custom("discord rpc unavailable".into()))
}

#[cfg(not(windows))]
fn ensure_connection<'a>(
    inner: &'a mut DiscordRpcInner,
    _app_id: &str,
) -> Result<&'a mut DiscordRpcConnection, AppError> {
    inner.connection = Some(DiscordRpcConnection);
    inner
        .connection
        .as_mut()
        .ok_or_else(|| AppError::Custom("discord rpc unavailable".into()))
}

#[cfg(windows)]
fn open_connection(app_id: &str) -> Result<DiscordRpcConnection, AppError> {
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

    Err(AppError::Custom(format!(
        "discord rpc pipe unavailable: {}",
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
) -> Result<(), AppError> {
    write_raw_frame(&mut connection.file, opcode, payload)?;
    read_response(&mut connection.file, expected_nonce)?;
    Ok(())
}

#[cfg(not(windows))]
fn write_frame(
    _connection: &mut DiscordRpcConnection,
    _opcode: u32,
    _payload: &Value,
    _expected_nonce: Option<&str>,
) -> Result<(), AppError> {
    Ok(())
}

#[cfg(windows)]
fn write_raw_frame(file: &mut std::fs::File, opcode: u32, payload: &Value) -> Result<(), AppError> {
    use std::io::Write;

    let bytes = serde_json::to_vec(payload)?;
    file.write_all(&opcode.to_le_bytes())?;
    file.write_all(&(bytes.len() as u32).to_le_bytes())?;
    file.write_all(&bytes)?;
    file.flush()?;
    Ok(())
}

#[cfg(windows)]
fn read_response(file: &mut std::fs::File, expected_nonce: Option<&str>) -> Result<(), AppError> {
    use std::time::{Duration, Instant};

    let deadline = Instant::now() + Duration::from_millis(750);
    loop {
        if let Some(payload) = read_next_frame(file)? {
            if let Some(message) = discord_response_error(&payload) {
                return Err(AppError::Custom(message));
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
            return Err(AppError::Custom("discord rpc response timed out".into()));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(windows)]
fn read_next_frame(file: &mut std::fs::File) -> Result<Option<Value>, AppError> {
    let Some((header, available)) = peek_frame_header(file)? else {
        return Ok(None);
    };
    let length = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
    if length > 1024 * 1024 {
        return Err(AppError::Custom("discord rpc response is too large".into()));
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

#[cfg(windows)]
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

#[cfg(windows)]
fn peek_frame_header(file: &std::fs::File) -> Result<Option<([u8; 8], usize)>, AppError> {
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
fn read_exact_from_pipe(file: &std::fs::File, buffer: &mut [u8]) -> Result<(), AppError> {
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
            return Err(AppError::Custom("discord rpc pipe closed".into()));
        }
        offset += read as usize;
    }
    Ok(())
}
