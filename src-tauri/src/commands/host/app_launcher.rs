#![allow(non_snake_case)]

use std::path::PathBuf;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use vrcx_0_host::auto_launch::{
    picked_app_launcher_target, AppLauncherEntry, AppLauncherEntryKind, AppLauncherPickedTarget,
    AppLauncherSnapshot,
};
use vrcx_0_host::host_capabilities::{
    require_host_capability, require_host_capability_supported, HostCapability,
};

use crate::error::AppError;
use crate::state::AppState;

fn require_app_launcher_supported() -> Result<(), AppError> {
    require_host_capability_supported(HostCapability::GameProcessMonitor)?;
    require_host_capability_supported(HostCapability::GameLaunch)?;
    Ok(())
}

#[tauri::command]
pub fn app__app_launcher_snapshot_get(
    state: State<'_, AppState>,
) -> Result<AppLauncherSnapshot, AppError> {
    require_app_launcher_supported()?;
    Ok(state.app_launcher_snapshot())
}

#[tauri::command]
pub fn app__app_launcher_enabled_set(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<AppLauncherSnapshot, AppError> {
    require_app_launcher_supported()?;
    Ok(state.set_app_launcher_enabled(enabled)?)
}

#[tauri::command]
pub fn app__app_launcher_entries_set(
    state: State<'_, AppState>,
    entries: Vec<AppLauncherEntry>,
) -> Result<AppLauncherSnapshot, AppError> {
    require_app_launcher_supported()?;
    Ok(state.set_app_launcher_entries(entries)?)
}

#[tauri::command]
pub fn app__app_launcher_entry_test(
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<AppLauncherSnapshot, AppError> {
    require_host_capability(HostCapability::GameLaunch)?;
    Ok(state.test_app_launcher_entry(&entry_id)?)
}

#[tauri::command]
pub fn app__app_launcher_test_run_stop(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<AppLauncherSnapshot, AppError> {
    require_app_launcher_supported()?;
    Ok(state.stop_app_launcher_test_run(&run_id)?)
}

#[tauri::command]
pub async fn app__app_launcher_target_pick(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    kind: String,
) -> Result<Option<AppLauncherPickedTarget>, AppError> {
    require_app_launcher_supported()?;
    if kind != "auto" && kind != "localApp" {
        return Ok(None);
    }

    let builder = app_handle.dialog().file();
    #[cfg(target_os = "windows")]
    let builder = builder.add_filter("Applications and shortcuts", &["exe", "lnk", "url"]);

    let result = builder.blocking_pick_file();
    let Some(file_path) = result else {
        return Ok(None);
    };

    let path = match file_path {
        tauri_plugin_dialog::FilePath::Path(path) => path,
        other => PathBuf::from(other.to_string()),
    };
    let picked = picked_app_launcher_target(path).map_err(AppError::Custom)?;
    if matches!(picked.kind, AppLauncherEntryKind::LocalApp) {
        state
            .host_file_access
            .register_path(PathBuf::from(&picked.target));
    }
    Ok(Some(picked))
}

#[cfg(test)]
mod app_launcher_tests {
    use vrcx_0_host::auto_launch::{
        normalize_app_launcher_entries, AppLauncherEntry, AppLauncherEntryKind,
        AppLauncherRunPolicy, AppLauncherScope, AppLauncherStopPolicy,
    };

    fn steam_entry() -> AppLauncherEntry {
        AppLauncherEntry {
            id: "steam".to_string(),
            enabled: true,
            name: "VRChat".to_string(),
            kind: AppLauncherEntryKind::SteamApp,
            scope: AppLauncherScope::All,
            target: "438100".to_string(),
            args: String::new(),
            launch_delay_seconds: 0,
            run_policy: AppLauncherRunPolicy::Always,
            stop_policy: AppLauncherStopPolicy::CloseByVrcx,
            process_name: None,
            working_directory: None,
        }
    }

    #[test]
    fn app_launcher_command_contract_sanitizes_steam_close_policy() {
        let entries = normalize_app_launcher_entries(vec![steam_entry()]);
        assert_eq!(entries[0].stop_policy, AppLauncherStopPolicy::KeepRunning);
    }
}
