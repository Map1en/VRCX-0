#[cfg(target_os = "windows")]
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

#[cfg(target_os = "windows")]
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
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut() as HANDLE,
            )
        };

        if handle != INVALID_HANDLE_VALUE {
            use std::os::windows::io::FromRawHandle;
            return Some(unsafe { std::fs::File::from_raw_handle(handle) });
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

#[cfg(target_os = "linux")]
pub fn vrcipc_send(message: &str) -> bool {
    match linux_vrcipc_send(message) {
        Ok(result) => result,
        Err(error) => {
            tracing::warn!(%error, "Linux VRChat launch pipe bridge failed");
            false
        }
    }
}

#[cfg(target_os = "linux")]
fn linux_vrcipc_send(message: &str) -> Result<bool, String> {
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    struct TempLaunchPipeDir {
        path: PathBuf,
    }

    impl TempLaunchPipeDir {
        fn new() -> Result<Self, String> {
            let base = std::env::temp_dir();
            for attempt in 0..16 {
                let path = base.join(format!(
                    "vrcx-launch-pipe-{}-{}-{attempt}",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|duration| duration.as_nanos())
                        .unwrap_or_default()
                ));
                match fs::create_dir(&path) {
                    Ok(()) => {
                        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
                            .map_err(|e| format!("secure VRChat launch temp dir: {e}"))?;
                        return Ok(Self { path });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => {
                        return Err(format!("create VRChat launch temp dir: {error}"));
                    }
                }
            }
            Err("create VRChat launch temp dir: exhausted unique path attempts".into())
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempLaunchPipeDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| format!("create private VRChat launch temp file: {e}"))?;
        file.write_all(bytes)
            .map_err(|e| format!("write private VRChat launch temp file: {e}"))
    }

    fn wait_for_child(child: &mut Child, timeout: Duration) -> Result<bool, String> {
        let deadline = Instant::now() + timeout;
        loop {
            match child
                .try_wait()
                .map_err(|e| format!("wait for Wine launch pipe bridge: {e}"))?
            {
                Some(status) => return Ok(status.success()),
                None if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(false);
                }
                None => std::thread::sleep(Duration::from_millis(25)),
            }
        }
    }

    let context = crate::linux_registry::discover_linux_registry_context()
        .map_err(|reason| format!("VRChat launch pipe bridge unavailable: {reason}"))?;

    let temp_dir = TempLaunchPipeDir::new()?;
    let payload_path = temp_dir.path().join("payload.txt");
    let script_path = temp_dir.path().join("launch.cmd");

    write_private_file(&payload_path, message.as_bytes())?;
    let payload_wine_path = linux_path_to_wine_z_path(&payload_path);
    write_private_file(
        &script_path,
        linux_launch_pipe_script(&payload_wine_path).as_bytes(),
    )?;
    let script_wine_path = linux_path_to_wine_z_path(&script_path);

    let mut child = Command::new(&context.wine_path)
        .env("WINEPREFIX", &context.wine_prefix)
        .env("WINEFSYNC", "1")
        .env("WINEDEBUG", "-all")
        .arg("cmd.exe")
        .arg("/C")
        .arg(script_wine_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("start Wine launch pipe bridge: {e}"))?;

    wait_for_child(&mut child, Duration::from_secs(6))
}

#[cfg(target_os = "linux")]
fn linux_path_to_wine_z_path(path: &std::path::Path) -> String {
    let linux_path = path.as_os_str().to_string_lossy().replace('/', "\\");
    format!("Z:{linux_path}")
}

#[cfg(target_os = "linux")]
fn linux_launch_pipe_script(payload_path: &str) -> String {
    format!(
        "@echo off\r\ncopy /B \"{}\" \"\\\\.\\pipe\\VRChatURLLaunchPipe\" >NUL\r\nexit /B %ERRORLEVEL%\r\n",
        payload_path.replace('"', "\"\"")
    )
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub fn vrcipc_send(_message: &str) -> bool {
    false
}

#[cfg(test)]
#[cfg(target_os = "linux")]
mod linux_tests {
    use super::{linux_launch_pipe_script, linux_path_to_wine_z_path};

    #[test]
    fn converts_linux_path_to_wine_z_path() {
        assert_eq!(
            linux_path_to_wine_z_path(std::path::Path::new("/tmp/vrcx payload.txt")),
            r"Z:\tmp\vrcx payload.txt"
        );
    }

    #[test]
    fn builds_launch_pipe_script_with_quoted_payload_path() {
        assert_eq!(
            linux_launch_pipe_script(r#"Z:\tmp\vrcx payload.txt"#),
            "@echo off\r\ncopy /B \"Z:\\tmp\\vrcx payload.txt\" \"\\\\.\\pipe\\VRChatURLLaunchPipe\" >NUL\r\nexit /B %ERRORLEVEL%\r\n"
        );
    }
}
