#[cfg(target_os = "windows")]
use std::path::Path;
use std::path::PathBuf;

use crate::error::Error;
use crate::vrchat_paths;

#[derive(Clone, Debug, Eq, PartialEq)]
struct SteamLaunchCommand {
    program: PathBuf,
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

fn steam_launch_command(program: PathBuf, arguments: &str) -> SteamLaunchCommand {
    let mut args = vec!["-applaunch".to_string(), "438100".to_string()];
    if !arguments.is_empty() {
        args.extend(arguments.split_whitespace().map(|s| s.to_string()));
    }

    SteamLaunchCommand { program, args }
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
        return start_game_linux(arguments);
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
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    {
        let launch_exe = PathBuf::from(path).join("launch.exe");
        if !launch_exe.exists() {
            return Ok(false);
        }

        let mut cmd = std::process::Command::new(launch_exe);
        if !arguments.is_empty() {
            cmd.args(arguments.split_whitespace());
        }
        cmd.spawn()
            .map_err(|e| Error::Custom(format!("start game: {e}")))?;

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
    let steam_path = vrchat_paths::steam_path();
    let Some(command) = windows_steam_launch_command(Path::new(&steam_path), arguments) else {
        return Ok(false);
    };
    command.spawn()?;

    Ok(true)
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
