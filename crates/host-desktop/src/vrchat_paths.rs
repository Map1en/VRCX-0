#[cfg(any(target_os = "linux", test))]
use std::collections::HashSet;
use std::fs;
#[cfg(any(target_os = "linux", test))]
use std::path::Path;
use std::path::PathBuf;
use std::time::SystemTime;

#[cfg(any(target_os = "linux", test))]
pub(crate) fn quoted_tokens(line: &str) -> Vec<String> {
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

#[cfg(any(target_os = "linux", test))]
const VRCHAT_APP_ID: &str = "438100";
#[cfg(any(target_os = "linux", test))]
const OUTPUT_LOG_PREFIX: &str = "output_log_";
#[cfg(any(target_os = "linux", test))]
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
    pub install_path: PathBuf,
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
        windows_vrchat_app_data().unwrap_or_else(|| PathBuf::from(VRCHAT_LOCAL_LOW_DIR))
    }
}

#[cfg(not(target_os = "linux"))]
const VRCHAT_LOCAL_LOW_DIR: &str = "..\\LocalLow\\VRChat\\VRChat";

#[cfg(not(target_os = "linux"))]
pub fn windows_vrchat_app_data() -> Option<PathBuf> {
    windows_vrchat_app_data_under(std::env::var("LOCALAPPDATA").ok())
}

#[cfg(not(target_os = "linux"))]
fn windows_vrchat_app_data_under(local_app_data: Option<String>) -> Option<PathBuf> {
    local_app_data
        .filter(|path| !path.is_empty())
        .map(|path| PathBuf::from(path).join(VRCHAT_LOCAL_LOW_DIR))
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
            return vrchat_cache_location_for_directory(
                v.get("cache_directory").and_then(|value| value.as_str()),
            )
            .to_string_lossy()
            .into_owned();
        }
    }

    vrchat_cache_location_for_directory(None)
        .to_string_lossy()
        .into_owned()
}

pub fn vrchat_cache_location_for_directory(cache_directory: Option<&str>) -> PathBuf {
    if let Some(folder) = cache_directory.filter(|folder| !folder.is_empty()) {
        let base = PathBuf::from(folder);
        if base.is_dir() {
            return base.join("Cache-WindowsPlayer");
        }
    }

    vrchat_app_data().join("Cache-WindowsPlayer")
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

#[cfg(any(target_os = "linux", test))]
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
        let install_path = library.join("steamapps").join("common").join("VRChat");

        let Some((modified, latest_log)) = newest_output_log(&app_data) else {
            if fallback.is_none() {
                fallback = Some(LinuxVrchatPaths {
                    proton_prefix: prefix.clone(),
                    install_path: install_path.clone(),
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
                    install_path,
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

/// Under Proton the log holds Wine paths such as `C:\users\steamuser\Pictures\...`,
/// which only exist inside the VRChat prefix.
#[cfg(target_os = "linux")]
pub fn linux_path_from_vrchat_path(path: &str) -> String {
    if !is_wine_drive_path(path) {
        return path.to_string();
    }
    match discover_linux_vrchat_paths() {
        Ok(paths) => wine_path_in_prefix(&paths.proton_prefix, path)
            .map(|resolved| resolved.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string()),
        Err(error) => {
            tracing::warn!(%error, path, "could not map VRChat Wine path onto Linux");
            path.to_string()
        }
    }
}

#[cfg(any(target_os = "linux", test))]
fn is_wine_drive_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && bytes
            .get(2)
            .is_some_and(|separator| matches!(separator, b'\\' | b'/'))
}

/// `C:` is the prefix's `drive_c`, `Z:` is Wine's default mapping of `/`, and any other
/// drive goes through the prefix's `dosdevices` links.
#[cfg(any(target_os = "linux", test))]
fn wine_path_in_prefix(prefix: &Path, path: &str) -> Option<PathBuf> {
    if !is_wine_drive_path(path) {
        return None;
    }
    let drive = path.as_bytes()[0].to_ascii_lowercase() as char;
    let mut resolved = match drive {
        'c' => prefix.join("drive_c"),
        'z' => PathBuf::from("/"),
        // One component, so Windows test builds don't read `d:` as a drive prefix.
        other => prefix.join(format!("dosdevices/{other}:")),
    };
    resolved.extend(
        path[2..]
            .split(['\\', '/'])
            .filter(|component| !component.is_empty()),
    );
    Some(resolved)
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
pub fn discover_linux_instance_launch() -> Result<(), String> {
    if !linux_command_in_path("nsenter") {
        return Err("nsenter not found".into());
    }

    let launch_exe = discover_linux_vrchat_paths()?
        .install_path
        .join("launch.exe");
    if launch_exe.is_file() {
        Ok(())
    } else {
        Err(format!(
            "VRChat launch.exe not found at {}",
            launch_exe.display()
        ))
    }
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

#[cfg(any(target_os = "linux", test))]
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

#[cfg(any(target_os = "linux", test))]
#[derive(Default)]
struct ParsedSteamLibraries {
    app_libraries: Vec<PathBuf>,
    all_libraries: Vec<PathBuf>,
}

#[cfg(any(target_os = "linux", test))]
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

#[cfg(any(target_os = "linux", test))]
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

#[cfg(any(target_os = "linux", test))]
fn push_unique_path(paths: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>, path: PathBuf) {
    if seen.insert(path.clone()) {
        paths.push(path);
    }
}

#[cfg(test)]
mod tests {
    use std::fs::{File, FileTimes};
    use std::time::Duration;

    use super::*;

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn windows_app_data_is_unknown_without_local_app_data() {
        assert_eq!(windows_vrchat_app_data_under(None), None);
        assert_eq!(windows_vrchat_app_data_under(Some(String::new())), None);
        assert_eq!(
            windows_vrchat_app_data_under(Some(r"C:\Users\me\AppData\Local".into())),
            Some(PathBuf::from(r"C:\Users\me\AppData\Local").join(VRCHAT_LOCAL_LOW_DIR))
        );
    }

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
    fn discovers_traditional_steam_roots_from_home() {
        let dir = TestDir::new("traditional-steam-roots");
        let local_root = dir.path.join(".local").join("share").join("Steam");
        let legacy_root = dir.path.join(".steam").join("steam");
        std::fs::create_dir_all(&local_root).unwrap();
        std::fs::create_dir_all(legacy_root.join("userdata")).unwrap();
        std::fs::write(local_root.join("steam.sh"), b"").unwrap();

        let roots = discover_linux_steam_roots_in(&dir.path).unwrap();

        assert_eq!(roots, [local_root, legacy_root]);
    }

    #[test]
    fn maps_vrchat_wine_paths_into_the_proton_prefix() {
        let prefix = Path::new("/steam/steamapps/compatdata/438100/pfx");

        assert_eq!(
            wine_path_in_prefix(
                prefix,
                r"C:\users\steamuser\Pictures\VRChat\2026-11\VRChat_2026-11-16_03-09-10.568_3840x2160.png",
            ),
            Some(prefix.join(
                "drive_c/users/steamuser/Pictures/VRChat/2026-11/VRChat_2026-11-16_03-09-10.568_3840x2160.png"
            ))
        );
        assert_eq!(
            wine_path_in_prefix(prefix, r"z:\home\example\Pictures\VRChat_1.png"),
            Some(PathBuf::from("/home/example/Pictures/VRChat_1.png"))
        );
        assert_eq!(
            wine_path_in_prefix(prefix, r"D:\Photos\VRChat_1.png"),
            Some(prefix.join("dosdevices/d:/Photos/VRChat_1.png"))
        );
    }

    #[test]
    fn leaves_non_wine_paths_unmapped() {
        let prefix = Path::new("/pfx");

        assert_eq!(
            wine_path_in_prefix(prefix, "/home/example/VRChat_1.png"),
            None
        );
        assert_eq!(wine_path_in_prefix(prefix, "VRChat_1.png"), None);
        assert_eq!(wine_path_in_prefix(prefix, "C:VRChat_1.png"), None);
        assert_eq!(wine_path_in_prefix(prefix, "C:"), None);
        assert_eq!(
            wine_path_in_prefix(prefix, r"\\server\share\VRChat_1.png"),
            None
        );
    }

    #[test]
    fn steam_library_parser_identifies_the_library_containing_vrchat() {
        let dir = TestDir::new("steam-library-vdf");
        let path = dir.path.join("libraryfolders.vdf");
        std::fs::write(
            &path,
            r#"
"libraryfolders"
{
    "0"
    {
        "path" "/steam/main"
        "apps"
        {
            "123" "1"
        }
    }
    "1"
    {
        "path" "/games/vr"
        "apps"
        {
            "438100" "1"
        }
    }
}
"#,
        )
        .unwrap();

        let libraries = read_steam_libraries_from_vdf(&path);

        assert_eq!(libraries.app_libraries, [PathBuf::from("/games/vr")]);
        assert_eq!(
            libraries.all_libraries,
            [PathBuf::from("/steam/main"), PathBuf::from("/games/vr")]
        );
    }

    #[test]
    fn newest_output_log_ignores_non_vrchat_files() {
        let dir = TestDir::new("newest-output-log");
        let older = dir.path.join("output_log_2026-01-01_00-00-00.txt");
        let newer = dir.path.join("output_log_2026-01-02_00-00-00.txt");
        let similar = dir.path.join("output_log_2026-01-03_00-00-00.log");
        std::fs::write(&older, b"older").unwrap();
        std::fs::write(&newer, b"newer").unwrap();
        std::fs::write(&similar, b"not a VRChat output log").unwrap();
        std::fs::create_dir(dir.path.join("output_log_directory.txt")).unwrap();

        File::options()
            .write(true)
            .open(&older)
            .unwrap()
            .set_times(
                FileTimes::new().set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1)),
            )
            .unwrap();
        File::options()
            .write(true)
            .open(&newer)
            .unwrap()
            .set_times(
                FileTimes::new().set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(2)),
            )
            .unwrap();
        File::options()
            .write(true)
            .open(&similar)
            .unwrap()
            .set_times(
                FileTimes::new().set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(3)),
            )
            .unwrap();

        let (_, selected) = newest_output_log(&dir.path).unwrap();

        assert_eq!(selected, newer);
    }
}
