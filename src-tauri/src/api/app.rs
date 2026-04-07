#![allow(non_snake_case)]

#[cfg(windows)]
use std::borrow::Cow;
use std::collections::HashMap;
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use fast_rsync::{Signature, SignatureOptions};
use tauri::{AppHandle, Emitter, State};

use crate::domain::ipc::IpcPacket;
use crate::domain::png::{self as png_mod, ChunkType};
use crate::domain::screenshot::{self, SearchType};
use crate::error::AppError;
use crate::state::AppState;

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
pub fn app__current_culture() -> String {
    sys_locale::get_locale().unwrap_or_else(|| "en-US".into())
}

#[tauri::command]
pub fn app__current_language() -> String {
    sys_locale::get_locale().unwrap_or_else(|| "en".into())
}

#[tauri::command]
pub fn app__set_user_agent() {}

#[tauri::command]
pub fn app__open_link(url: String) -> Result<(), AppError> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::Custom("Invalid URL scheme".into()));
    }
    open::that(&url).map_err(|e| AppError::Custom(format!("open link: {e}")))
}

#[tauri::command]
pub fn app__open_discord_profile(discord_id: String) -> Result<(), AppError> {
    let url = format!("discord://-/users/{discord_id}");
    open::that(&url).map_err(|e| AppError::Custom(format!("open discord: {e}")))
}

#[tauri::command]
pub fn app__get_file_base64(path: String) -> Result<String, AppError> {
    let bytes = std::fs::read(&path)?;
    Ok(B64.encode(&bytes))
}

#[tauri::command]
pub fn app__get_file_bytes(path: String) -> Result<Vec<u8>, AppError> {
    Ok(std::fs::read(&path)?)
}

fn vrchat_config_path() -> PathBuf {
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    PathBuf::from(local_app_data).join("..\\LocalLow\\VRChat\\VRChat\\config.json")
}

#[tauri::command]
pub fn app__read_config_file() -> Result<String, AppError> {
    let path = vrchat_config_path();
    if !path.exists() {
        return Ok(String::new());
    }
    Ok(std::fs::read_to_string(&path)?)
}

#[tauri::command]
pub fn app__read_config_file_safe() -> Result<String, AppError> {
    let path = vrchat_config_path();
    if !path.exists() {
        return Ok(String::new());
    }
    let content = std::fs::read_to_string(&path)?;

    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(v) => Ok(serde_json::to_string_pretty(&v).unwrap_or_default()),
        Err(_) => Ok(String::new()),
    }
}

#[tauri::command]
pub fn app__write_config_file(json: String) -> Result<(), AppError> {
    let path = vrchat_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, json)?;
    Ok(())
}

fn vrchat_app_data() -> PathBuf {
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    PathBuf::from(local_app_data).join("..\\LocalLow\\VRChat\\VRChat")
}

#[tauri::command]
pub fn app__get_vrchat_app_data_location() -> String {
    vrchat_app_data().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn app__get_vrchat_photos_location() -> String {
    if let Ok(content) = std::fs::read_to_string(vrchat_config_path()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(folder) = v.get("picture_output_folder").and_then(|v| v.as_str()) {
                if !folder.is_empty() {
                    return folder.to_string();
                }
            }
        }
    }

    dirs::picture_dir()
        .unwrap_or_default()
        .join("VRChat")
        .to_string_lossy()
        .into_owned()
}

#[tauri::command]
pub fn app__get_ugc_photo_location(path: Option<String>) -> String {
    match path {
        Some(p) if !p.is_empty() => p,
        _ => app__get_vrchat_photos_location(),
    }
}

#[tauri::command]
pub fn app__get_vrchat_cache_location() -> String {
    if let Ok(content) = std::fs::read_to_string(vrchat_config_path()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(folder) = v.get("cache_directory").and_then(|v| v.as_str()) {
                if !folder.is_empty() {
                    return folder.to_string();
                }
            }
        }
    }
    vrchat_app_data()
        .join("Cache-WindowsPlayer")
        .to_string_lossy()
        .into_owned()
}

#[tauri::command]
pub fn app__get_vrchat_screenshots_location() -> String {
    let steam_path = get_steam_path();
    if steam_path.is_empty() {
        return String::new();
    }
    let userdata = PathBuf::from(&steam_path).join("userdata");
    if !userdata.exists() {
        return String::new();
    }

    let mut best_path = String::new();
    let mut best_time = std::time::SystemTime::UNIX_EPOCH;

    if let Ok(entries) = std::fs::read_dir(&userdata) {
        for entry in entries.flatten() {
            let screenshots_dir = entry.path().join("760\\remote\\438100\\screenshots");
            if screenshots_dir.exists() {
                if let Ok(meta) = std::fs::metadata(&screenshots_dir) {
                    if let Ok(modified) = meta.modified() {
                        if modified > best_time {
                            best_time = modified;
                            best_path = screenshots_dir.to_string_lossy().into_owned();
                        }
                    }
                }
            }
        }
    }
    best_path
}

fn get_steam_path() -> String {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(key) = hklm.open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam") {
            if let Ok(val) = key.get_value::<String, _>("InstallPath") {
                return val;
            }
        }
        String::new()
    }
    #[cfg(not(target_os = "windows"))]
    {
        String::new()
    }
}

fn open_folder(path: &str) -> Result<bool, AppError> {
    let p = PathBuf::from(path);
    if !p.exists() {
        return Ok(false);
    }
    open::that(path).map_err(|e| AppError::Custom(format!("open folder: {e}")))?;
    Ok(true)
}

#[tauri::command]
pub fn app__open_vrcx_app_data_folder(state: State<'_, AppState>) -> Result<bool, AppError> {
    open_folder(&state.paths.app_data.to_string_lossy())
}

#[tauri::command]
pub fn app__open_vrc_app_data_folder() -> Result<bool, AppError> {
    open_folder(&vrchat_app_data().to_string_lossy())
}

#[tauri::command]
pub fn app__open_vrc_photos_folder() -> Result<bool, AppError> {
    let path = app__get_vrchat_photos_location();
    open_folder(&path)
}

#[tauri::command]
pub fn app__open_ugc_photos_folder(ugc_path: Option<String>) -> Result<bool, AppError> {
    let path = app__get_ugc_photo_location(ugc_path);
    open_folder(&path)
}

#[tauri::command]
pub fn app__open_vrc_screenshots_folder() -> Result<bool, AppError> {
    let path = app__get_vrchat_screenshots_location();
    if path.is_empty() {
        return Ok(false);
    }
    open_folder(&path)
}

#[tauri::command]
pub fn app__open_crash_vrc_crash_dumps() -> Result<bool, AppError> {
    let temp = std::env::temp_dir();
    let path = temp.join("VRChat\\VRChat\\Crashes");
    open_folder(&path.to_string_lossy())
}

#[tauri::command]
pub fn app__open_shortcut_folder(state: State<'_, AppState>) -> Result<(), AppError> {
    let shortcut_dir = state.paths.app_data.join("Shortcuts");
    std::fs::create_dir_all(&shortcut_dir)?;
    open::that(shortcut_dir.to_string_lossy().as_ref())
        .map_err(|e| AppError::Custom(format!("open shortcut folder: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn app__open_folder_and_select_item(
    path: String,
    _is_folder: Option<bool>,
) -> Result<(), AppError> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(AppError::Custom(format!("path not found: {path}")));
    }

    std::process::Command::new("explorer.exe")
        .arg("/select,")
        .arg(&path)
        .spawn()
        .map_err(|e| AppError::Custom(format!("explorer: {e}")))?;

    Ok(())
}

#[tauri::command]
pub async fn app__open_file_selector_dialog(
    app_handle: AppHandle,
    default_path: Option<String>,
    default_ext: Option<String>,
    default_filter: Option<String>,
) -> Result<String, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app_handle.dialog().file();

    if let Some(ref path) = default_path {
        let p = PathBuf::from(path);
        if p.is_dir() {
            builder = builder.set_directory(p);
        } else if let Some(parent) = p.parent() {
            if parent.is_dir() {
                builder = builder.set_directory(parent);
            }
        }
    }

    if let Some(ref filter) = default_filter {
        for pair in filter.split('|').collect::<Vec<_>>().chunks(2) {
            if pair.len() == 2 {
                let name = pair[0].trim();
                let exts: Vec<&str> = pair[1]
                    .split(';')
                    .map(|e| e.trim().trim_start_matches("*."))
                    .collect();
                builder = builder.add_filter(name, &exts);
            }
        }
    } else if let Some(ref ext) = default_ext {
        let ext_clean = ext.trim_start_matches('.');
        builder = builder.add_filter(ext_clean, &[ext_clean]);
    }

    let result = builder.blocking_pick_file();

    match result {
        Some(file_path) => {
            let path_str = match file_path {
                tauri_plugin_dialog::FilePath::Path(p) => p.to_string_lossy().to_string(),
                other => other.to_string(),
            };
            Ok(path_str)
        }
        None => Ok(String::new()),
    }
}

#[tauri::command]
pub async fn app__open_folder_selector_dialog(
    app_handle: AppHandle,
    default_path: Option<String>,
) -> Result<String, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app_handle.dialog().file();

    if let Some(ref path) = default_path {
        let p = PathBuf::from(path);
        if p.is_dir() {
            builder = builder.set_directory(p);
        } else if let Some(parent) = p.parent() {
            if parent.is_dir() {
                builder = builder.set_directory(parent);
            }
        }
    }

    let result = builder.blocking_pick_folder();

    match result {
        Some(folder_path) => Ok(match folder_path {
            tauri_plugin_dialog::FilePath::Path(p) => p.to_string_lossy().to_string(),
            other => other.to_string(),
        }),
        None => Ok(String::new()),
    }
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

#[tauri::command]
pub fn app__focus_window(app_handle: AppHandle) -> Result<(), AppError> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn app__flash_window(app_handle: AppHandle) -> Result<(), AppError> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }
    Ok(())
}

#[tauri::command]
pub fn app__show_dev_tools(app_handle: AppHandle) -> Result<(), AppError> {
    #[cfg(debug_assertions)]
    {
        use tauri::Manager;
        if let Some(window) = app_handle.get_webview_window("main") {
            window.open_devtools();
        }
    }

    #[cfg(not(debug_assertions))]
    {
        let _ = app_handle;
    }

    Ok(())
}

#[tauri::command]
pub fn app__change_theme(app_handle: AppHandle, value: i32) -> Result<(), AppError> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("main") {
        let theme = match value {
            0 => Some(tauri::Theme::Light),
            1 => Some(tauri::Theme::Dark),
            _ => None,
        };
        let _ = window.set_theme(theme);
    }
    Ok(())
}

#[tauri::command]
pub fn app__do_funny() {}

#[tauri::command]
pub fn app__set_tray_icon_notification(app_handle: AppHandle, notify: Option<bool>) {
    let notify = notify.unwrap_or(false);
    if let Some(tray) = app_handle.tray_by_id("main") {
        let icon_path = if notify {
            "icons/icon_notify.png"
        } else {
            "icons/icon.png"
        };
        let icon_result = tauri::image::Image::from_path(icon_path).or_else(|_| {
            let base = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()));
            match base {
                Some(dir) => tauri::image::Image::from_path(dir.join(icon_path)),
                None => Err(tauri::Error::AssetNotFound(icon_path.into())),
            }
        });
        if let Ok(icon) = icon_result {
            let _ = tray.set_icon(Some(icon));
        }
        let tooltip = if notify {
            "VRCX-0 (new notification)"
        } else {
            "VRCX-0"
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

#[tauri::command]
pub fn app__restart_application(
    app_handle: AppHandle,
    is_upgrade: Option<bool>,
) -> Result<(), AppError> {
    #[cfg(debug_assertions)]
    {
        tracing::warn!(
            is_upgrade = is_upgrade.unwrap_or(false),
            "app__restart_application ignored in dev build; restart VRCX manually"
        );
        let _ = app_handle;
        return Ok(());
    }

    #[cfg(not(debug_assertions))]
    {
    let exe = std::env::current_exe().map_err(|e| AppError::Custom(format!("current exe: {e}")))?;
    let mut cmd = std::process::Command::new(&exe);
    if is_upgrade.unwrap_or(false) {
        cmd.arg("--upgrade");
    }
    cmd.spawn()
        .map_err(|e| AppError::Custom(format!("restart: {e}")))?;
    app_handle.exit(0);
    Ok(())
    }
}

#[tauri::command]
pub fn app__check_for_update_exe(state: State<'_, AppState>) -> bool {
    state.paths.app_data.join("update.exe").exists()
}

#[tauri::command]
pub fn app__get_clipboard() -> Result<String, AppError> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| AppError::Custom(format!("clipboard: {e}")))?;
    Ok(clipboard.get_text().unwrap_or_default())
}

#[tauri::command]
pub fn app__copy_image_to_clipboard(path: String) -> Result<(), AppError> {
    let ext = PathBuf::from(&path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    if !matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "bmp" | "gif" | "webp"
    ) {
        return Err(AppError::Custom("unsupported image format".into()));
    }

    let data = std::fs::read(&path)?;
    let img =
        image::load_from_memory(&data).map_err(|e| AppError::Custom(format!("load image: {e}")))?;
    let rgba = img.to_rgba8();

    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| AppError::Custom(format!("clipboard: {e}")))?;
    clipboard
        .set_image(arboard::ImageData {
            width: rgba.width() as usize,
            height: rgba.height() as usize,
            bytes: std::borrow::Cow::Borrowed(rgba.as_raw()),
        })
        .map_err(|e| AppError::Custom(format!("set clipboard image: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn app__set_startup(_enabled: bool) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let enabled = _enabled;
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu
            .open_subkey_with_flags(
                "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
                KEY_SET_VALUE | KEY_READ,
            )
            .map_err(|e| AppError::Custom(format!("registry: {e}")))?;

        if enabled {
            let exe = std::env::current_exe()
                .map_err(|e| AppError::Custom(format!("current exe: {e}")))?;
            key.set_value("VRCX-0", &exe.to_string_lossy().as_ref())
                .map_err(|e| AppError::Custom(format!("set registry: {e}")))?;
        } else {
            let _ = key.delete_value("VRCX-0");
        }
    }
    Ok(())
}

#[tauri::command]
pub fn app__xs_notification(
    title: String,
    content: String,
    timeout: i32,
    opacity: f64,
    image: Option<String>,
) -> Result<(), AppError> {
    use std::net::UdpSocket;

    let height = (content.len() as f64 / 100.0 * 250.0).max(110.0);

    let msg = serde_json::json!({
        "messageType": 1,
        "title": title,
        "content": content,
        "height": height,
        "sourceApp": "VRCX-0",
        "timeout": timeout,
        "volume": 0.0,
        "audioPath": "",
        "icon": image.unwrap_or_default(),
        "opacity": opacity,
    });

    let payload = serde_json::to_vec(&msg)?;
    let socket =
        UdpSocket::bind("0.0.0.0:0").map_err(|e| AppError::Custom(format!("udp bind: {e}")))?;
    socket
        .send_to(&payload, "127.0.0.1:42069")
        .map_err(|e| AppError::Custom(format!("udp send: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn app__get_vrchat_moderations(
    current_user_id: String,
) -> Result<HashMap<String, i16>, AppError> {
    let path = vrchat_app_data()
        .join("LocalPlayerModerations")
        .join(format!("{current_user_id}-show-hide-user.vrcset"));

    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = std::fs::read_to_string(&path)?;
    let mut result = HashMap::new();
    for line in content.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            if let Ok(val) = parts[1].parse::<i16>() {
                result.insert(parts[0].to_string(), val);
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn app__get_vrchat_user_moderation(
    current_user_id: String,
    user_id: String,
) -> Result<i16, AppError> {
    let mods = app__get_vrchat_moderations(current_user_id)?;
    Ok(*mods.get(&user_id).unwrap_or(&0))
}

#[tauri::command]
pub fn app__set_vrchat_user_moderation(
    current_user_id: String,
    user_id: String,
    moderation_type: i32,
) -> Result<bool, AppError> {
    let dir = vrchat_app_data().join("LocalPlayerModerations");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{current_user_id}-show-hide-user.vrcset"));

    let mut lines: Vec<String> = if path.exists() {
        std::fs::read_to_string(&path)?
            .lines()
            .map(|l| l.to_string())
            .collect()
    } else {
        Vec::new()
    };

    lines.retain(|line| {
        let parts: Vec<&str> = line.split_whitespace().collect();
        parts.first().map(|&id| id != user_id).unwrap_or(true)
    });

    if moderation_type != 0 {
        lines.push(format!("{user_id} {moderation_type:03}"));
    }

    std::fs::write(&path, lines.join("\n"))?;
    Ok(true)
}

#[tauri::command]
pub fn app__ipc_announce_start(state: State<'_, AppState>) {
    let packet = IpcPacket {
        type_field: "N/A".into(),
        data: Some("Start".into()),
        msg_type: Some("N/A".into()),
    };
    state.ipc.send(&packet);
}

#[tauri::command]
pub fn app__send_ipc(state: State<'_, AppState>, type_name: String, data: String) {
    let packet = IpcPacket {
        type_field: type_name,
        data: Some(data),
        msg_type: None,
    };
    state.ipc.send(&packet);
}

#[tauri::command]
pub fn app__set_app_launcher_settings(
    state: State<'_, AppState>,
    enabled: bool,
    kill_on_exit: bool,
    run_process_once: bool,
) {
    state
        .auto_launch
        .set_settings(enabled, kill_on_exit, run_process_once);
}

#[tauri::command]
pub fn app__try_open_instance_in_vrc(launch_url: String) -> bool {
    crate::domain::ipc::vrcipc_send(&launch_url)
}

#[tauri::command]
pub fn app__open_calendar_file(ics_content: String) -> Result<(), AppError> {
    if !ics_content.starts_with("BEGIN:VCALENDAR") {
        return Err(AppError::Custom("invalid iCalendar content".into()));
    }

    let temp_dir = std::env::temp_dir().join("VRCX-0");
    std::fs::create_dir_all(&temp_dir)?;
    let ics_path = temp_dir.join("event.ics");
    std::fs::write(&ics_path, &ics_content)?;
    open::that(ics_path.to_string_lossy().as_ref())
        .map_err(|e| AppError::Custom(format!("open ics: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn app__populate_image_hosts(state: State<'_, AppState>, json: String) {
    let hosts: Vec<String> = serde_json::from_str(&json).unwrap_or_default();
    state.image_cache.populate_hosts(&hosts);
}

#[tauri::command]
pub async fn app__get_image(
    state: State<'_, AppState>,
    url: String,
    file_id: String,
    version: String,
) -> Result<String, AppError> {
    state.image_cache.get_image(&url, &file_id, &version).await
}

#[tauri::command]
pub fn app__resize_image_to_fit_limits(base64data: String) -> Result<String, AppError> {
    const MAX_WIDTH: u32 = 2000;
    const MAX_HEIGHT: u32 = 2000;
    const MAX_SIZE: usize = 10_000_000;

    let raw = B64
        .decode(&base64data)
        .map_err(|e| AppError::Custom(format!("base64 decode: {e}")))?;
    let mut img =
        image::load_from_memory(&raw).map_err(|e| AppError::Custom(format!("load image: {e}")))?;

    if img.width() > MAX_WIDTH {
        let factor = img.width() as f64 / MAX_WIDTH as f64;
        let new_h = (img.height() as f64 / factor).round() as u32;
        img = img.resize_exact(MAX_WIDTH, new_h, image::imageops::FilterType::Lanczos3);
    }
    if img.height() > MAX_HEIGHT {
        let factor = img.height() as f64 / MAX_HEIGHT as f64;
        let new_w = (img.width() as f64 / factor).round() as u32;
        img = img.resize_exact(new_w, MAX_HEIGHT, image::imageops::FilterType::Lanczos3);
    }

    let encode_png = |img: &image::DynamicImage| -> Result<Vec<u8>, AppError> {
        let mut buf = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut buf);
        img.write_with_encoder(encoder)
            .map_err(|e| AppError::Custom(format!("png encode: {e}")))?;
        Ok(buf)
    };

    let mut buf = encode_png(&img)?;

    for _ in 0..250 {
        if buf.len() < MAX_SIZE {
            break;
        }
        let (w, h) = (img.width(), img.height());
        let (new_w, new_h) = if w > h {
            let nw = w - 25;
            let nh = (h as f64 / (w as f64 / nw as f64)).round() as u32;
            (nw, nh)
        } else {
            let nh = h - 25;
            let nw = (w as f64 / (h as f64 / nh as f64)).round() as u32;
            (nw, nh)
        };
        img = img.resize_exact(new_w, new_h, image::imageops::FilterType::Lanczos3);
        buf = encode_png(&img)?;
        if buf.len() < MAX_SIZE {
            break;
        }
    }

    if buf.len() >= MAX_SIZE {
        return Err(AppError::Custom(
            "Failed to get image into target filesize.".into(),
        ));
    }

    Ok(B64.encode(&buf))
}

#[tauri::command]
pub fn app__sign_file(blob: String) -> Result<String, AppError> {
    let data = B64
        .decode(&blob)
        .map_err(|e| AppError::Custom(format!("base64 decode: {e}")))?;
    let sig = Signature::calculate(
        &data,
        SignatureOptions {
            block_size: 2048,
            crypto_hash_size: 8,
        },
    );
    Ok(B64.encode(sig.serialized()))
}

#[tauri::command]
pub fn app__get_extra_screenshot_data(
    path: String,
    _carousel_cache: bool,
) -> Result<String, AppError> {
    let p = std::path::Path::new(&path);
    let mut result = serde_json::Map::new();

    result.insert("filePath".into(), serde_json::json!(path));

    if let Ok(meta) = std::fs::metadata(p) {
        if let Ok(created) = meta.created() {
            let dt: chrono::DateTime<chrono::Utc> = created.into();
            result.insert("creationDate".into(), serde_json::json!(dt.to_rfc3339()));
        }
        result.insert("fileSizeBytes".into(), serde_json::json!(meta.len()));
    }
    if screenshot::is_png_file(&path) {
        let mut png = crate::domain::png::PngFile::open_read(&path);
        if let Ok(ref mut png) = png {
            let res = crate::domain::png::read_resolution(png);
            if !res.is_empty() {
                result.insert("resolution".into(), serde_json::json!(res));
            }
        }
    }
    let file_name = p
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default();
    result.insert("fileName".into(), serde_json::json!(file_name));

    if let Some(parent) = p.parent() {
        if let Ok(entries) = std::fs::read_dir(parent) {
            let mut pngs: Vec<String> = entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path()
                        .extension()
                        .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
                })
                .map(|e| e.path().to_string_lossy().into_owned())
                .collect();
            pngs.sort();
            if let Some(idx) = pngs.iter().position(|f| f == &path) {
                if idx > 0 {
                    result.insert("previousFilePath".into(), serde_json::json!(pngs[idx - 1]));
                }
                if idx + 1 < pngs.len() {
                    result.insert("nextFilePath".into(), serde_json::json!(pngs[idx + 1]));
                }
            }
        }
    }

    serde_json::to_string(&result).map_err(|e| AppError::Custom(format!("serialize: {e}")))
}

#[tauri::command]
pub fn app__get_screenshot_metadata(path: String) -> Result<String, AppError> {
    match screenshot::get_screenshot_metadata(&path) {
        Some(meta) => {
            serde_json::to_string(&meta).map_err(|e| AppError::Custom(format!("serialize: {e}")))
        }
        None => Ok(String::new()),
    }
}

#[tauri::command]
pub fn app__find_screenshots_by_search(
    state: State<'_, AppState>,
    search_query: String,
    search_type: Option<i32>,
) -> Result<String, AppError> {
    let st = SearchType::from_i32(search_type.unwrap_or(0));
    let photos_dir = app__get_vrchat_photos_location();
    if photos_dir.is_empty() {
        return Ok("[]".into());
    }
    let results =
        screenshot::find_screenshots(&search_query, &photos_dir, st, &state.screenshot_cache);
    serde_json::to_string(&results).map_err(|e| AppError::Custom(format!("serialize: {e}")))
}

#[tauri::command]
pub fn app__get_last_screenshot() -> Result<String, AppError> {
    let photos_dir = app__get_vrchat_photos_location();
    if photos_dir.is_empty() {
        return Ok(String::new());
    }
    let mut newest: Option<(String, std::time::SystemTime)> = None;
    if let Ok(entries) = walkdir::WalkDir::new(&photos_dir)
        .into_iter()
        .collect::<Result<Vec<_>, _>>()
    {
        for entry in entries {
            if entry.file_type().is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("png"))
            {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(modified) = meta.modified() {
                        if newest.as_ref().is_none_or(|(_, t)| modified > *t) {
                            newest = Some((entry.path().to_string_lossy().into_owned(), modified));
                        }
                    }
                }
            }
        }
    }
    Ok(newest.map(|(p, _)| p).unwrap_or_default())
}

#[tauri::command]
pub fn app__delete_screenshot_metadata(path: String) -> Result<bool, AppError> {
    screenshot::delete_text_metadata(&path, false);
    Ok(true)
}

#[tauri::command]
pub fn app__delete_all_screenshot_metadata(state: State<'_, AppState>) {
    let photos_dir = app__get_vrchat_photos_location();
    if photos_dir.is_empty() {
        return;
    }
    for entry in walkdir::WalkDir::new(&photos_dir).into_iter().flatten() {
        if entry.file_type().is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("png"))
        {
            screenshot::delete_text_metadata(&entry.path().to_string_lossy(), true);
        }
    }
    state.screenshot_cache.clear_all();
}

#[tauri::command]
pub fn app__add_screenshot_metadata(
    path: String,
    metadata_string: String,
    _world_id: String,
    _change_filename: Option<bool>,
) -> Result<String, AppError> {
    screenshot::write_vrcx_metadata(&metadata_string, &path);
    Ok(path)
}

#[tauri::command]
pub fn app__crop_all_prints(ugc_folder_path: String) -> Result<(), AppError> {
    let folder = PathBuf::from(&ugc_folder_path).join("Prints");
    if !folder.is_dir() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(&folder) {
        let entry = entry.map_err(|e| AppError::Custom(format!("walk dir: {e}")))?;
        let p = entry.path();
        if p.extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("png"))
        {
            crop_print_impl(p).map_err(|e| AppError::Custom(format!("{}: {e}", p.display())))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn app__crop_print_image(path: String) -> Result<bool, AppError> {
    crop_print_impl(std::path::Path::new(&path))
        .map_err(|e| AppError::Custom(format!("{path}: {e}")))
}

fn crop_print_impl(path: &std::path::Path) -> Result<bool, Box<dyn std::error::Error>> {
    let img = image::open(path)?;
    if img.width() != 2048 || img.height() != 1440 {
        return Ok(false);
    }
    let cropped = img.crop_imm(64, 69, 1920, 1080);

    let temp_path = {
        let mut t = path.as_os_str().to_owned();
        t.push(".temp");
        PathBuf::from(t)
    };
    cropped.save_with_format(&temp_path, image::ImageFormat::Png)?;

    {
        let old_path_str = path.to_string_lossy();
        let mut old_png = png_mod::PngFile::open_read(&old_path_str)?;
        let text_chunks = old_png.get_chunks_of_type(&ChunkType::ITXT);
        if !text_chunks.is_empty() {
            let temp_str = temp_path.to_string_lossy();
            let mut new_png = png_mod::PngFile::open_rw(&temp_str)?;
            for chunk in &text_chunks {
                new_png.write_chunk(chunk);
            }
        }
    }

    for _ in 0..10 {
        match std::fs::copy(&temp_path, path) {
            Ok(_) => {
                let _ = std::fs::remove_file(&temp_path);
                return Ok(true);
            }
            Err(_) => {
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }
    }
    let _ = std::fs::remove_file(&temp_path);
    Ok(false)
}

#[tauri::command]
pub async fn app__save_print_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    let dir = PathBuf::from(&ugc_folder_path).join(&month_folder);
    std::fs::create_dir_all(&dir)?;
    let out = dir.join(&file_name);
    let out_str = out.to_string_lossy().into_owned();
    state.image_cache.save_image_to_file(&url, &out_str).await?;
    Ok(out_str)
}

#[tauri::command]
pub async fn app__save_sticker_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    let dir = PathBuf::from(&ugc_folder_path).join(&month_folder);
    std::fs::create_dir_all(&dir)?;
    let out = dir.join(&file_name);
    let out_str = out.to_string_lossy().into_owned();
    state.image_cache.save_image_to_file(&url, &out_str).await?;
    Ok(out_str)
}

#[tauri::command]
pub async fn app__save_emoji_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    let dir = PathBuf::from(&ugc_folder_path).join(&month_folder);
    std::fs::create_dir_all(&dir)?;
    let out = dir.join(&file_name);
    let out_str = out.to_string_lossy().into_owned();
    state.image_cache.save_image_to_file(&url, &out_str).await?;
    Ok(out_str)
}

#[tauri::command]
pub fn app__download_update(
    state: State<'_, AppState>,
    file_url: String,
    hash_string: String,
    download_size: i32,
) {
    state
        .update_manager
        .start_download(file_url, hash_string, download_size);
}

#[tauri::command]
pub fn app__cancel_update(state: State<'_, AppState>) {
    state.update_manager.cancel_download();
}

#[tauri::command]
pub fn app__check_update_progress(state: State<'_, AppState>) -> i32 {
    state.update_manager.check_progress()
}

#[tauri::command]
#[allow(unused_variables)]
pub fn app__desktop_notification(
    app_handle: AppHandle,
    bold_text: String,
    text: Option<String>,
    image: Option<String>,
) -> Result<(), AppError> {
    use tauri_plugin_notification::NotificationExt;
    let mut notification = app_handle.notification().builder();
    notification = notification.title(&bold_text);
    if let Some(ref body) = text {
        notification = notification.body(body);
    }
    if let Some(icon) = image.as_deref().filter(|s| !s.trim().is_empty()) {
        notification = notification.icon(icon);
    }
    notification
        .show()
        .map_err(|e| AppError::Custom(format!("notification: {e}")))?;
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn app__ovrt_notification(
    state: State<'_, AppState>,
    hud_notification: bool,
    wrist_notification: bool,
    title: String,
    body: String,
    timeout: i32,
    opacity: f64,
    image: Option<String>,
) {
    state.ovrtoolkit.send_notification(
        hud_notification,
        wrist_notification,
        &title,
        &body,
        timeout,
        opacity,
        image.as_deref(),
    );
}

#[tauri::command]
pub fn app__get_vrchat_registry_key(key: String) -> Result<serde_json::Value, AppError> {
    #[cfg(not(target_os = "windows"))]
    let _ = &key;

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hashed_key = add_hash_to_key_name(&key);
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let vrc_key = match hkcu.open_subkey("SOFTWARE\\VRChat\\VRChat") {
            Ok(k) => k,
            Err(_) => return Ok(serde_json::Value::Null),
        };

        if let Ok(val) = vrc_key.get_raw_value(&hashed_key) {
            match val.vtype {
                REG_BINARY => {
                    let s = String::from_utf8_lossy(&val.bytes)
                        .trim_end_matches('\0')
                        .to_string();
                    return Ok(serde_json::Value::String(s));
                }
                REG_DWORD => {
                    if val.bytes.len() >= 4 {
                        let dword = u32::from_le_bytes([
                            val.bytes[0],
                            val.bytes[1],
                            val.bytes[2],
                            val.bytes[3],
                        ]);
                        return Ok(serde_json::json!(dword));
                    }
                }
                _ => {}
            }
        }
        Ok(serde_json::Value::Null)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(serde_json::Value::Null)
    }
}

#[tauri::command]
pub fn app__get_vrchat_registry_key_string(key: String) -> Result<String, AppError> {
    let val = app__get_vrchat_registry_key(key)?;
    Ok(val.as_str().unwrap_or("").to_string())
}

#[tauri::command]
pub fn app__has_vrchat_registry_folder() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        hkcu.open_subkey("SOFTWARE\\VRChat\\VRChat").is_ok()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[tauri::command]
pub fn app__delete_vrchat_registry_folder() -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey("SOFTWARE\\VRChat") {
            let _ = key.delete_subkey_all("VRChat");
        }
    }
    Ok(())
}

#[tauri::command]
pub fn app__set_vrchat_registry_key(
    _key: String,
    _value: serde_json::Value,
    _type_int: i32,
) -> Result<bool, AppError> {
    #[cfg(target_os = "windows")]
    {
        let key = _key;
        let value = _value;
        let type_int = _type_int;
        use winreg::enums::*;
        use winreg::RegKey;

        let hashed_key = add_hash_to_key_name(&key);
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (vrc_key, _) = hkcu
            .create_subkey("SOFTWARE\\VRChat\\VRChat")
            .map_err(|e| AppError::Custom(format!("registry create: {e}")))?;

        match type_int {
            4 => {
                let dword = value.as_u64().unwrap_or(0) as u32;
                vrc_key
                    .set_raw_value(
                        &hashed_key,
                        &winreg::RegValue {
                            vtype: REG_DWORD,
                            bytes: Cow::Owned(dword.to_le_bytes().to_vec()),
                        },
                    )
                    .map_err(|e| AppError::Custom(format!("set dword: {e}")))?;
            }

            3 => {
                let s = value.as_str().unwrap_or("");
                let mut bytes: Vec<u8> = s.as_bytes().to_vec();
                bytes.push(0);
                vrc_key
                    .set_raw_value(
                        &hashed_key,
                        &winreg::RegValue {
                            vtype: REG_BINARY,
                            bytes: Cow::Owned(bytes),
                        },
                    )
                    .map_err(|e| AppError::Custom(format!("set binary: {e}")))?;
            }

            100 => {
                let f = value.as_f64().unwrap_or(0.0);
                let bits = (f as f32).to_bits();
                vrc_key
                    .set_raw_value(
                        &hashed_key,
                        &winreg::RegValue {
                            vtype: REG_DWORD,
                            bytes: Cow::Owned(bits.to_le_bytes().to_vec()),
                        },
                    )
                    .map_err(|e| AppError::Custom(format!("set float-as-dword: {e}")))?;
            }
            _ => {
                return Err(AppError::Custom(format!(
                    "unknown registry type: {type_int}"
                )));
            }
        }
        return Ok(true);
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
pub fn app__get_vrchat_registry(
) -> Result<HashMap<String, HashMap<String, serde_json::Value>>, AppError> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let vrc_key = match hkcu.open_subkey("SOFTWARE\\VRChat\\VRChat") {
            Ok(k) => k,
            Err(_) => return Ok(HashMap::new()),
        };

        let mut result = HashMap::new();
        for name in vrc_key.enum_values().flatten().map(|(name, _)| name) {
            if let Ok(val) = vrc_key.get_raw_value(&name) {
                let mut entry = HashMap::new();
                match val.vtype {
                    REG_BINARY => {
                        let s = String::from_utf8_lossy(&val.bytes)
                            .trim_end_matches('\0')
                            .to_string();
                        entry.insert("type".to_string(), serde_json::json!("REG_BINARY"));
                        entry.insert("value".to_string(), serde_json::json!(s));
                    }
                    REG_DWORD => {
                        if val.bytes.len() >= 4 {
                            let dword = u32::from_le_bytes([
                                val.bytes[0],
                                val.bytes[1],
                                val.bytes[2],
                                val.bytes[3],
                            ]);
                            entry.insert("type".to_string(), serde_json::json!("REG_DWORD"));
                            entry.insert("value".to_string(), serde_json::json!(dword));
                        }
                    }
                    _ => continue,
                }
                result.insert(name, entry);
            }
        }
        return Ok(result);
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(HashMap::new())
    }
}

#[tauri::command]
pub fn app__set_vrchat_registry(_json: String) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let json = _json;
        use winreg::enums::*;
        use winreg::RegKey;

        let data: HashMap<String, HashMap<String, serde_json::Value>> =
            serde_json::from_str(&json)?;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (vrc_key, _) = hkcu
            .create_subkey("SOFTWARE\\VRChat\\VRChat")
            .map_err(|e| AppError::Custom(format!("registry create: {e}")))?;

        for (name, props) in data {
            let vtype_str = props.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let value = props.get("value");

            match vtype_str {
                "REG_BINARY" => {
                    let s = value.and_then(|v| v.as_str()).unwrap_or("");
                    let mut bytes: Vec<u8> = s.as_bytes().to_vec();
                    bytes.push(0);
                    let _ = vrc_key.set_raw_value(
                        &name,
                        &winreg::RegValue {
                            vtype: REG_BINARY,
                            bytes: Cow::Owned(bytes),
                        },
                    );
                }
                "REG_DWORD" => {
                    let dword = value.and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    let _ = vrc_key.set_raw_value(
                        &name,
                        &winreg::RegValue {
                            vtype: REG_DWORD,
                            bytes: Cow::Owned(dword.to_le_bytes().to_vec()),
                        },
                    );
                }
                _ => {}
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn app__read_vrc_reg_json_file(filepath: String) -> Result<String, AppError> {
    if !PathBuf::from(&filepath).exists() {
        return Ok(String::new());
    }
    Ok(std::fs::read_to_string(&filepath)?)
}

#[cfg(target_os = "windows")]
fn add_hash_to_key_name(key: &str) -> String {
    let mut hash: u32 = 5381;
    for byte in key.bytes() {
        hash = hash.wrapping_mul(33).wrapping_add(byte as u32);
    }
    format!("{key}_h{hash}")
}
