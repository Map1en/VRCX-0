#[cfg(target_os = "windows")]
use std::path::Path;
use std::path::PathBuf;

use crate::vrchat_paths;
use vrcx_0_host::Error;

#[derive(Clone, Debug, Eq, PartialEq)]
struct SteamLaunchCommand {
    program: PathBuf,
    args: Vec<String>,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Debug, Eq, PartialEq)]
struct DirectLaunchCommand {
    program: PathBuf,
    current_dir: Option<PathBuf>,
    args: Vec<String>,
}

impl SteamLaunchCommand {
    fn spawn(self) -> Result<(), Error> {
        std::process::Command::new(self.program)
            .args(&self.args)
            .spawn()
            .map_err(|e| Error::Custom(format!("start game: {e}")))?;

        Ok(())
    }
}

#[cfg(target_os = "windows")]
impl DirectLaunchCommand {
    fn spawn(self) -> Result<(), Error> {
        let mut command = std::process::Command::new(self.program);
        if let Some(current_dir) = self.current_dir {
            command.current_dir(current_dir);
        }
        command.args(&self.args);
        command
            .spawn()
            .map_err(|e| Error::Custom(format!("start game: {e}")))?;

        Ok(())
    }
}

fn split_launch_arguments(arguments: &str) -> Vec<String> {
    if arguments.is_empty() {
        Vec::new()
    } else {
        arguments
            .split_whitespace()
            .map(|s| s.to_string())
            .collect()
    }
}

fn steam_launch_command(program: PathBuf, arguments: &str) -> SteamLaunchCommand {
    let mut args = vec!["-applaunch".to_string(), "438100".to_string()];
    args.extend(split_launch_arguments(arguments));

    SteamLaunchCommand { program, args }
}

#[cfg(target_os = "windows")]
fn direct_launch_command(program: PathBuf, arguments: &str) -> DirectLaunchCommand {
    DirectLaunchCommand {
        current_dir: program.parent().map(Path::to_path_buf),
        program,
        args: split_launch_arguments(arguments),
    }
}

pub fn quit_game() -> i32 {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut count = 0i32;
    for process in sys.processes().values() {
        if process
            .name()
            .to_string_lossy()
            .eq_ignore_ascii_case("VRChat.exe")
        {
            process.kill();
            count += 1;
        }
    }
    count
}

pub fn start_game(arguments: &str) -> Result<bool, Error> {
    #[cfg(target_os = "linux")]
    {
        start_game_linux(arguments)
    }

    #[cfg(target_os = "windows")]
    {
        start_game_windows(arguments)
    }

    #[cfg(target_os = "macos")]
    {
        Err(Error::Custom(
            "Game launch is not supported on macOS".into(),
        ))
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        Err(Error::Custom(format!(
            "Game launch is not supported on {}",
            crate::host_capabilities::current_platform()
        )))
    }
}

pub fn start_game_from_path(path: &str, arguments: &str) -> Result<bool, Error> {
    #[cfg(target_os = "linux")]
    {
        let steam_sh = PathBuf::from(path).join("steam.sh");
        if !steam_sh.is_file() {
            return Ok(false);
        }

        spawn_steam_app_launch(steam_sh, arguments)?;
        Ok(true)
    }

    #[cfg(target_os = "windows")]
    {
        let Some(command) = windows_vrchat_launch_command(Path::new(path), arguments) else {
            return Ok(false);
        };
        command.spawn()?;
        Ok(true)
    }

    #[cfg(target_os = "macos")]
    {
        Err(Error::Custom(
            "Game launch is not supported on macOS".into(),
        ))
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        Err(Error::Custom(format!(
            "Game launch is not supported on {}",
            crate::host_capabilities::current_platform()
        )))
    }
}

#[cfg(target_os = "windows")]
fn start_game_windows(arguments: &str) -> Result<bool, Error> {
    let mut last_error = None;

    let steam_path = vrchat_paths::steam_path();
    if let Some(command) = windows_steam_launch_command(Path::new(&steam_path), arguments) {
        match command.spawn() {
            Ok(()) => return Ok(true),
            Err(error) => last_error = Some(error),
        }
    }

    if let Some(command_value) = windows_registry_command_value("steam\\shell\\open\\command") {
        if let Some(command) = windows_steam_registry_launch_command(&command_value, arguments) {
            match command.spawn() {
                Ok(()) => return Ok(true),
                Err(error) => last_error = Some(error),
            }
        }
    }

    if let Some(command_value) = windows_registry_command_value("VRChat\\shell\\open\\command") {
        if let Some(command) = windows_vrchat_registry_launch_command(&command_value, arguments) {
            match command.spawn() {
                Ok(()) => return Ok(true),
                Err(error) => last_error = Some(error),
            }
        }
    }

    if let Some(error) = last_error {
        return Err(error);
    }
    Ok(false)
}

#[cfg(target_os = "windows")]
fn windows_steam_launch_command(steam_path: &Path, arguments: &str) -> Option<SteamLaunchCommand> {
    if steam_path.as_os_str().is_empty() {
        return None;
    }

    let steam_exe = steam_path.join("steam.exe");
    if !steam_exe.exists() {
        return None;
    }

    Some(steam_launch_command(steam_exe, arguments))
}

#[cfg(target_os = "windows")]
fn windows_registry_command_value(subkey: &str) -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
    let key = hkcr.open_subkey(subkey).ok()?;
    key.get_value::<String, _>("").ok()
}

#[cfg(target_os = "windows")]
fn windows_steam_registry_launch_command(
    command_value: &str,
    arguments: &str,
) -> Option<SteamLaunchCommand> {
    let steam_exe = registry_command_executable_path(command_value, "steam.exe")?;
    if !steam_exe.is_file() {
        return None;
    }
    Some(steam_launch_command(steam_exe, arguments))
}

#[cfg(target_os = "windows")]
fn windows_vrchat_registry_launch_command(
    command_value: &str,
    arguments: &str,
) -> Option<DirectLaunchCommand> {
    let launch_exe = registry_command_executable_path(command_value, "launch.exe")?;
    if !launch_exe.is_file() {
        return None;
    }
    Some(direct_launch_command(launch_exe, arguments))
}

#[cfg(target_os = "windows")]
fn windows_vrchat_launch_command(path: &Path, arguments: &str) -> Option<DirectLaunchCommand> {
    let launch_exe = if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("launch.exe"))
    {
        path.to_path_buf()
    } else {
        path.join("launch.exe")
    };
    if !launch_exe.exists() {
        return None;
    }

    Some(direct_launch_command(launch_exe, arguments))
}

#[cfg(target_os = "windows")]
fn registry_command_executable_path(command_value: &str, executable_name: &str) -> Option<PathBuf> {
    let trimmed = command_value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let path = if let Some(rest) = trimmed.strip_prefix('"') {
        let end = rest.find('"')?;
        &rest[..end]
    } else {
        let lower = trimmed.to_ascii_lowercase();
        let needle = executable_name.to_ascii_lowercase();
        let end = lower.find(&needle)? + executable_name.len();
        trimmed[..end].trim()
    };
    let path = PathBuf::from(path);
    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(executable_name))
    {
        Some(path)
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn start_game_linux(arguments: &str) -> Result<bool, Error> {
    if steam_launch_command(PathBuf::from("steam"), arguments)
        .spawn()
        .is_ok()
    {
        return Ok(true);
    }

    for command in linux_steam_sh_launch_commands(
        vrchat_paths::discover_linux_steam_roots().unwrap_or_default(),
        arguments,
    ) {
        if command.spawn().is_ok() {
            return Ok(true);
        }
    }

    Ok(false)
}

#[cfg(target_os = "linux")]
fn linux_steam_sh_launch_commands<I>(steam_roots: I, arguments: &str) -> Vec<SteamLaunchCommand>
where
    I: IntoIterator<Item = PathBuf>,
{
    steam_roots
        .into_iter()
        .map(|root| root.join("steam.sh"))
        .filter(|steam_sh| steam_sh.is_file())
        .map(|steam_sh| steam_launch_command(steam_sh, arguments))
        .collect()
}

#[cfg(target_os = "linux")]
fn spawn_steam_app_launch(program: PathBuf, arguments: &str) -> Result<(), Error> {
    steam_launch_command(program, arguments).spawn()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn steam_launch_command_targets_vrchat_app_id_with_extra_arguments() {
        let command = steam_launch_command(PathBuf::from("steam"), "--profile 0");

        assert_eq!(command.program, PathBuf::from("steam"));
        assert_eq!(command.args, ["-applaunch", "438100", "--profile", "0"]);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn windows_default_steam_path_uses_steam_exe_for_vrchat_launch() {
        let dir = TestDir::new("game-launch-windows-steam");
        std::fs::write(dir.path.join("steam.exe"), b"").unwrap();

        let command = windows_steam_launch_command(&dir.path, "").unwrap();

        assert_eq!(command.program, dir.path.join("steam.exe"));
        assert_eq!(command.args, ["-applaunch", "438100"]);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn windows_steam_registry_command_uses_steam_exe_for_vrchat_launch() {
        let dir = TestDir::new("game-launch-windows-steam-registry");
        let steam_exe = dir.path.join("steam.exe");
        std::fs::write(&steam_exe, b"").unwrap();

        let command = windows_steam_registry_launch_command(
            &format!(r#""{}" -- "%1""#, steam_exe.display()),
            "vrchat://launch?id=wrld_1:123",
        )
        .unwrap();

        assert_eq!(command.program, steam_exe);
        assert_eq!(
            command.args,
            ["-applaunch", "438100", "vrchat://launch?id=wrld_1:123"]
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn windows_steam_registry_command_ignores_missing_steam_exe() {
        let dir = TestDir::new("game-launch-windows-missing-steam-registry");
        let steam_exe = dir.path.join("steam.exe");

        let command = windows_steam_registry_launch_command(
            &format!(r#""{}" -- "%1""#, steam_exe.display()),
            "vrchat://launch?id=wrld_1:123",
        );

        assert_eq!(command, None);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn windows_vrchat_registry_command_uses_launch_exe_for_direct_launch() {
        let dir = TestDir::new("game-launch-windows-vrchat-registry");
        let launch_exe = dir.path.join("launch.exe");
        std::fs::write(&launch_exe, b"").unwrap();

        let command = windows_vrchat_registry_launch_command(
            &format!(r#""{}" "%1" %*"#, launch_exe.display()),
            "vrchat://launch?id=wrld_1:123 --no-vr",
        )
        .unwrap();

        assert_eq!(command.program, launch_exe);
        assert_eq!(command.current_dir, Some(dir.path.clone()));
        assert_eq!(command.args, ["vrchat://launch?id=wrld_1:123", "--no-vr"]);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn windows_vrchat_registry_command_ignores_missing_launch_exe() {
        let dir = TestDir::new("game-launch-windows-missing-vrchat-registry");
        let launch_exe = dir.path.join("launch.exe");

        let command = windows_vrchat_registry_launch_command(
            &format!(r#""{}" "%1" %*"#, launch_exe.display()),
            "vrchat://launch?id=wrld_1:123",
        );

        assert_eq!(command, None);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn windows_launch_path_command_accepts_directory_root() {
        let dir = TestDir::new("game-launch-windows-vrchat-root");
        std::fs::write(dir.path.join("launch.exe"), b"").unwrap();

        let command = windows_vrchat_launch_command(&dir.path, "--no-vr").unwrap();

        assert_eq!(command.program, dir.path.join("launch.exe"));
        assert_eq!(command.current_dir, Some(dir.path.clone()));
        assert_eq!(command.args, ["--no-vr"]);
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn fedora_default_steam_root_uses_steam_sh_for_vrchat_launch() {
        let dir = TestDir::new("game-launch-fedora-steam");
        let steam_root = dir.path.join(".local").join("share").join("Steam");
        std::fs::create_dir_all(&steam_root).unwrap();
        std::fs::write(steam_root.join("steam.sh"), b"").unwrap();

        let commands = linux_steam_sh_launch_commands([steam_root.clone()], "");

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].program, steam_root.join("steam.sh"));
        assert_eq!(commands[0].args, ["-applaunch", "438100"]);
    }
}
