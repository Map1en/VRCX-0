#![allow(non_snake_case)]

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, State};

use crate::error::AppError;
use crate::state::AppState;

use super::paths::get_steam_path;

#[tauri::command]
pub fn app__check_game_running(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let _ = app_handle.emit(
        "updateIsGameRunning",
        serde_json::json!({
            "isGameRunning": state.process_monitor.is_game_running(),
            "isSteamVRRunning": state.process_monitor.is_steamvr_running(),
        }),
    );
    Ok(())
}

#[tauri::command]
pub fn app__is_game_running(state: State<'_, AppState>) -> bool {
    state.process_monitor.is_game_running()
}

#[tauri::command]
pub fn app__is_steamvr_running(state: State<'_, AppState>) -> bool {
    state.process_monitor.is_steamvr_running()
}

#[tauri::command]
pub fn app__quit_game() -> Result<i32, AppError> {
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
    Ok(count)
}

#[tauri::command]
pub fn app__start_game(arguments: String) -> Result<bool, AppError> {
    let steam_path = get_steam_path();
    if steam_path.is_empty() {
        return Ok(false);
    }
    let steam_exe = PathBuf::from(&steam_path).join("steam.exe");
    if !steam_exe.exists() {
        return Ok(false);
    }

    let mut args = vec!["-applaunch".to_string(), "438100".to_string()];
    if !arguments.is_empty() {
        args.extend(arguments.split_whitespace().map(|s| s.to_string()));
    }

    std::process::Command::new(steam_exe)
        .args(&args)
        .spawn()
        .map_err(|e| AppError::Custom(format!("start game: {e}")))?;

    Ok(true)
}

#[tauri::command]
pub fn app__start_game_from_path(path: String, arguments: String) -> Result<bool, AppError> {
    let launch_exe = PathBuf::from(&path).join("launch.exe");
    if !launch_exe.exists() {
        return Ok(false);
    }

    let mut cmd = std::process::Command::new(launch_exe);
    if !arguments.is_empty() {
        cmd.args(arguments.split_whitespace());
    }
    cmd.spawn()
        .map_err(|e| AppError::Custom(format!("start game: {e}")))?;

    Ok(true)
}
