#[cfg(target_os = "linux")]
use std::collections::HashSet;
use std::fs;
#[cfg(target_os = "linux")]
use std::path::Path;
use std::path::PathBuf;
use std::time::SystemTime;

#[cfg(target_os = "linux")]
const VRCHAT_APP_ID: &str = "438100";
#[cfg(target_os = "linux")]
const OUTPUT_LOG_PREFIX: &str = "output_log_";
#[cfg(target_os = "linux")]
const OUTPUT_LOG_SUFFIX: &str = ".txt";

#[cfg(target_os = "linux")]
#[derive(Clone, Debug)]
pub struct LinuxSteamLibraries {
    pub libraries: Vec<PathBuf>,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Debug)]
pub struct LinuxVrchatPaths {
    pub proton_prefix: PathBuf,
    pub app_data: PathBuf,
    pub latest_log: Option<PathBuf>,
}

pub fn vrchat_config_path() -> PathBuf {
    vrchat_app_data().join("config.json")
}

pub fn vrchat_app_data() -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        discover_linux_vrchat_paths()
            .map(|paths| paths.app_data)
            .unwrap_or_default()
    }

    #[cfg(not(target_os = "linux"))]
    {
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
        PathBuf::from(local_app_data).join("..\\LocalLow\\VRChat\\VRChat")
    }
}

pub fn vrchat_photos_location() -> String {
    if let Ok(content) = fs::read_to_string(vrchat_config_path()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(folder) = v.get("picture_output_folder").and_then(|v| v.as_str()) {
                if !folder.is_empty() {
                    return folder.to_string();
                }
            }
        }
    }

    default_vrchat_photos_location()
        .to_string_lossy()
        .into_owned()
}

pub fn ugc_photo_location(path: Option<String>) -> String {
    match path {
        Some(p) if !p.is_empty() => p,
        _ => vrchat_photos_location(),
    }
}

pub fn vrchat_cache_location() -> String {
    if let Ok(content) = fs::read_to_string(vrchat_config_path()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(folder) = v.get("cache_directory").and_then(|v| v.as_str()) {
                if !folder.is_empty() {
                    let base = PathBuf::from(folder);
                    if base.is_dir() {
                        return base
                            .join("Cache-WindowsPlayer")
                            .to_string_lossy()
                            .into_owned();
                    }
                }
            }
        }
    }

    vrchat_app_data()
        .join("Cache-WindowsPlayer")
        .to_string_lossy()
        .into_owned()
}

pub fn vrchat_screenshots_location() -> String {
    #[cfg(target_os = "linux")]
    {
        linux_vrchat_screenshots_location()
    }

    #[cfg(target_os = "windows")]
    {
        let steam_path = steam_path();
        if steam_path.is_empty() {
            return String::new();
        }
        let userdata = PathBuf::from(&steam_path).join("userdata");
        if !userdata.exists() {
            return String::new();
        }

        let mut best_path = String::new();
        let mut best_time = SystemTime::UNIX_EPOCH;

        if let Ok(entries) = fs::read_dir(&userdata) {
            for entry in entries.flatten() {
                let screenshots_dir = entry.path().join("760\\remote\\438100\\screenshots");
                if screenshots_dir.exists() {
                    if let Ok(meta) = fs::metadata(&screenshots_dir) {
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

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        String::new()
    }
}

#[cfg(target_os = "linux")]
fn linux_vrchat_screenshots_location() -> String {
    let mut best_path = String::new();
    let mut best_time = SystemTime::UNIX_EPOCH;

    for steam_root in discover_linux_steam_roots().unwrap_or_default() {
        let userdata = steam_root.join("userdata");
        if !userdata.is_dir() {
            continue;
        }

        let Ok(entries) = fs::read_dir(&userdata) else {
            continue;
        };

        for entry in entries.flatten() {
            let screenshots_dir = entry
                .path()
                .join("760")
                .join("remote")
                .join("438100")
                .join("screenshots");
            if !screenshots_dir.is_dir() {
                continue;
            }

            let modified = fs::metadata(&screenshots_dir)
                .and_then(|meta| meta.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            if modified > best_time {
                best_time = modified;
                best_path = screenshots_dir.to_string_lossy().into_owned();
            }
        }
    }

    best_path
}

#[cfg(target_os = "windows")]
pub fn steam_path() -> String {
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

pub fn vrchat_crashes_location() -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        if let Ok(paths) = discover_linux_vrchat_paths() {
            return paths
                .proton_prefix
                .join("drive_c")
                .join("users")
                .join("steamuser")
                .join("AppData")
                .join("Local")
                .join("Temp")
                .join("VRChat")
                .join("VRChat")
                .join("Crashes");
        }
    }

    std::env::temp_dir().join("VRChat\\VRChat\\Crashes")
}

fn default_vrchat_photos_location() -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        if let Ok(paths) = discover_linux_vrchat_paths() {
            return paths
                .proton_prefix
                .join("drive_c")
                .join("users")
                .join("steamuser")
                .join("Pictures")
                .join("VRChat");
        }
    }

    dirs::picture_dir().unwrap_or_default().join("VRChat")
}

#[cfg(target_os = "linux")]
pub fn discover_linux_steam_roots() -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Linux home directory not found".to_string())?;
    discover_linux_steam_roots_in(&home)
}

#[cfg(target_os = "linux")]
fn discover_linux_steam_roots_in(home: &Path) -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    let mut seen = HashSet::new();

    for steam_root in steam_root_candidates(home) {
        if steam_root
            .join("config")
            .join("libraryfolders.vdf")
            .is_file()
            || steam_root.join("steam.sh").is_file()
            || steam_root.join("userdata").is_dir()
        {
            push_unique_path(&mut roots, &mut seen, steam_root);
        }
    }

    if roots.is_empty() {
        return Err("Steam root not found".into());
    }

    Ok(roots)
}

#[cfg(target_os = "linux")]
pub fn discover_linux_steam_libraries() -> Result<LinuxSteamLibraries, String> {
    let home = dirs::home_dir().ok_or_else(|| "Linux home directory not found".to_string())?;
    let mut libraries = Vec::new();
    let mut seen = HashSet::new();
    let mut found_libraryfolders = false;

    for steam_root in steam_root_candidates(&home) {
        let libraryfolders = steam_root.join("config").join("libraryfolders.vdf");
        if !libraryfolders.is_file() {
            continue;
        }

        found_libraryfolders = true;
        push_unique_path(&mut libraries, &mut seen, steam_root.clone());
        let discovered = read_steam_libraries_from_vdf(&libraryfolders);
        for library in discovered
            .app_libraries
            .into_iter()
            .chain(discovered.all_libraries)
        {
            push_unique_path(&mut libraries, &mut seen, library);
        }
    }

    if !found_libraryfolders {
        return Err("Steam libraryfolders.vdf not found".into());
    }

    if libraries.is_empty() {
        return Err("Steam library path not found".into());
    }

    Ok(LinuxSteamLibraries { libraries })
}

#[cfg(target_os = "linux")]
pub fn discover_linux_vrchat_paths() -> Result<LinuxVrchatPaths, String> {
    let steam_libraries = discover_linux_steam_libraries()?;
    let mut saw_prefix = false;
    let mut newest: Option<(SystemTime, LinuxVrchatPaths)> = None;
    let mut fallback: Option<LinuxVrchatPaths> = None;

    for library in steam_libraries.libraries {
        let prefix = library
            .join("steamapps")
            .join("compatdata")
            .join(VRCHAT_APP_ID)
            .join("pfx");
        if !prefix.is_dir() {
            continue;
        }
        saw_prefix = true;

        let app_data = prefix
            .join("drive_c")
            .join("users")
            .join("steamuser")
            .join("AppData")
            .join("LocalLow")
            .join("VRChat")
            .join("VRChat");

        let Some((modified, latest_log)) = newest_output_log(&app_data) else {
            if fallback.is_none() {
                fallback = Some(LinuxVrchatPaths {
                    proton_prefix: prefix.clone(),
                    app_data: app_data.clone(),
                    latest_log: None,
                });
            }
            continue;
        };

        if newest
            .as_ref()
            .is_none_or(|(newest_modified, _)| modified > *newest_modified)
        {
            newest = Some((
                modified,
                LinuxVrchatPaths {
                    proton_prefix: prefix.clone(),
                    app_data: app_data.clone(),
                    latest_log: Some(latest_log),
                },
            ));
        }
    }

    if let Some((_, paths)) = newest {
        return Ok(paths);
    }

    if let Some(paths) = fallback {
        return Ok(paths);
    }

    if saw_prefix {
        return Err("VRChat output log path not found".into());
    }

    Err("VRChat Proton prefix not found".into())
}

#[cfg(target_os = "linux")]
pub fn discover_linux_vrchat_log_paths() -> Result<LinuxVrchatPaths, String> {
    let paths = discover_linux_vrchat_paths()?;
    if paths.latest_log.is_some() {
        Ok(paths)
    } else {
        Err("VRChat output log path not found".into())
    }
}

#[cfg(target_os = "linux")]
pub fn discover_linux_game_launch() -> Result<(), String> {
    if linux_command_in_path("steam") {
        return Ok(());
    }

    if !linux_steam_sh_candidates().is_empty() {
        return Ok(());
    }

    Err("Steam launcher not found".into())
}

#[cfg(target_os = "linux")]
pub fn discover_linux_screenshot_cache() -> Result<(), String> {
    discover_linux_vrchat_paths()
        .map_err(|reason| format!("VRChat photos path discovery failed: {reason}"))?;

    let roots = discover_linux_steam_roots()
        .map_err(|reason| format!("Steam userdata discovery failed: {reason}"))?;
    if roots.iter().any(|root| root.join("userdata").is_dir()) {
        return Ok(());
    }

    Err("Steam userdata path not found".into())
}

#[cfg(target_os = "linux")]
pub fn linux_command_in_path(command: &str) -> bool {
    let Some(path_var) = std::env::var_os("PATH") else {
        return false;
    };

    std::env::split_paths(&path_var).any(|dir| dir.join(command).is_file())
}

#[cfg(target_os = "linux")]
pub fn linux_steam_sh_candidates() -> Vec<PathBuf> {
    discover_linux_steam_roots()
        .unwrap_or_default()
        .into_iter()
        .map(|root| root.join("steam.sh"))
        .filter(|path| path.is_file())
        .collect()
}

#[cfg(target_os = "linux")]
fn steam_root_candidates(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".local").join("share").join("Steam"),
        home.join(".var")
            .join("app")
            .join("com.valvesoftware.Steam")
            .join(".local")
            .join("share")
            .join("Steam"),
        home.join(".steam").join("steam"),
    ]
}

#[cfg(target_os = "linux")]
#[derive(Default)]
struct ParsedSteamLibraries {
    app_libraries: Vec<PathBuf>,
    all_libraries: Vec<PathBuf>,
}

#[cfg(target_os = "linux")]
fn read_steam_libraries_from_vdf(path: &Path) -> ParsedSteamLibraries {
    let Ok(content) = fs::read_to_string(path) else {
        return ParsedSteamLibraries::default();
    };

    let mut parsed = ParsedSteamLibraries::default();
    let mut current_library: Option<PathBuf> = None;

    for line in content.lines() {
        let tokens = quoted_tokens(line);
        if tokens.len() >= 2 && tokens[0] == "path" {
            let library = PathBuf::from(&tokens[1]);
            parsed.all_libraries.push(library.clone());
            current_library = Some(library);
            continue;
        }

        if tokens.first().is_some_and(|token| token == VRCHAT_APP_ID) {
            if let Some(library) = &current_library {
                parsed.app_libraries.push(library.clone());
            }
        }
    }

    parsed
}

#[cfg(target_os = "linux")]
fn quoted_tokens(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;
    let mut escaped = false;

    for ch in line.chars() {
        if !in_quote {
            if ch == '"' {
                in_quote = true;
                current.clear();
            }
            continue;
        }

        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }

        match ch {
            '\\' => escaped = true,
            '"' => {
                in_quote = false;
                tokens.push(current.clone());
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    tokens
}

#[cfg(target_os = "linux")]
fn newest_output_log(log_dir: &Path) -> Option<(SystemTime, PathBuf)> {
    let entries = fs::read_dir(log_dir).ok()?;
    let mut newest: Option<(SystemTime, PathBuf)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if !file_name.starts_with(OUTPUT_LOG_PREFIX) || !file_name.ends_with(OUTPUT_LOG_SUFFIX) {
            continue;
        }

        let modified = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);

        if newest
            .as_ref()
            .is_none_or(|(newest_modified, _)| modified > *newest_modified)
        {
            newest = Some((modified, path));
        }
    }

    newest
}

#[cfg(target_os = "linux")]
fn push_unique_path(paths: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>, path: PathBuf) {
    if seen.insert(path.clone()) {
        paths.push(path);
    }
}

#[cfg(test)]
#[cfg(target_os = "linux")]
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
    fn discovers_fedora_default_steam_root_from_home() {
        let dir = TestDir::new("fedora-steam-root");
        let steam_root = dir.path.join(".local").join("share").join("Steam");
        std::fs::create_dir_all(&steam_root).unwrap();
        std::fs::write(steam_root.join("steam.sh"), b"").unwrap();

        let roots = discover_linux_steam_roots_in(&dir.path).unwrap();

        assert_eq!(roots, [steam_root]);
    }
}
