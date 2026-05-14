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

pub fn vrcipc_send(message: &str) -> bool {
    match linux_vrcipc_send(message) {
        Ok(result) => result,
        Err(error) => {
            tracing::warn!(%error, "Linux VRChat launch pipe bridge failed");
            false
        }
    }
}

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

    let context = crate::domain::linux_registry::discover_linux_registry_context()
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

fn linux_path_to_wine_z_path(path: &std::path::Path) -> String {
    let linux_path = path.as_os_str().to_string_lossy().replace('/', "\\");
    format!("Z:{linux_path}")
}

fn linux_launch_pipe_script(payload_path: &str) -> String {
    format!(
        "@echo off\r\ncopy /B \"{}\" \"\\\\.\\pipe\\VRChatURLLaunchPipe\" >NUL\r\nexit /B %ERRORLEVEL%\r\n",
        payload_path.replace('"', "\"\"")
    )
}

#[cfg(test)]
mod tests {
    use super::{linux_launch_pipe_script, linux_path_to_wine_z_path};

    #[test]
    fn converts_linux_path_to_wine_z_path() {
        assert_eq!(
            linux_path_to_wine_z_path(std::path::Path::new("/tmp/vrcx payload.txt")),
            r"Z:\tmp\vrcx payload.txt"
        );
    }

    #[test]
    fn writes_launch_pipe_script_without_embedding_launch_url() {
        let script = linux_launch_pipe_script(r"Z:\tmp\vrcx payload.txt");
        assert!(
            script.contains(r#"copy /B "Z:\tmp\vrcx payload.txt" "\\.\pipe\VRChatURLLaunchPipe""#)
        );
        assert!(!script.contains("vrchat://launch"));
    }

    #[test]
    fn escapes_quotes_in_launch_pipe_script_payload_path() {
        let script = linux_launch_pipe_script(r#"Z:\tmp\vrcx "quoted" payload.txt"#);
        assert!(script.contains(r#"Z:\tmp\vrcx ""quoted"" payload.txt"#));
    }
}
