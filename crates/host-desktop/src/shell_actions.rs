use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;

use crate::{asset_bundle_cache, process_status, vrchat_paths};
use vrcx_0_host::Error;

static NEXT_ATOMIC_WRITE_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatConfigWriteResult {
    pub old_cache_cleanup_error: Option<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatRichPresenceDisableResult {
    pub changed: bool,
}

pub fn open_link(url: &str) -> Result<(), Error> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(Error::Custom("Invalid URL scheme".into()));
    }
    open::that(url).map_err(|e| Error::Custom(format!("open link: {e}")))
}

pub fn open_discord_profile(discord_id: &str) -> Result<(), Error> {
    let url = discord_profile_url(discord_id)?;
    open::that(&url).map_err(|e| Error::Custom(format!("open discord: {e}")))
}

fn discord_profile_url(discord_id: &str) -> Result<String, Error> {
    let discord_id = discord_id.trim();
    if discord_id.is_empty() || !discord_id.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(Error::Custom("Invalid Discord user ID".into()));
    }
    Ok(format!("https://discord.com/users/{discord_id}"))
}

pub fn file_base64(path: &str) -> Result<String, Error> {
    let bytes = std::fs::read(path)?;
    Ok(B64.encode(&bytes))
}

pub fn file_bytes(path: &str) -> Result<Vec<u8>, Error> {
    Ok(std::fs::read(path)?)
}

pub fn read_config_file() -> Result<String, Error> {
    let path = vrchat_paths::vrchat_config_path();
    if !path.exists() {
        return Ok(String::new());
    }
    Ok(std::fs::read_to_string(&path)?)
}

pub fn read_config_file_safe() -> Result<String, Error> {
    let content = read_config_file()?;

    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(v) => Ok(serde_json::to_string_pretty(&v).unwrap_or_default()),
        Err(_) => Ok(String::new()),
    }
}

pub fn normalize_config_file_json(json: &str) -> Result<String, Error> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| Error::Custom(format!("Invalid VRChat config JSON: {e}")))?;
    if !value.is_object() && !value.is_array() {
        return Err(Error::Custom(
            "VRChat config JSON must be an object or array.".into(),
        ));
    }
    serde_json::to_string_pretty(&value)
        .map_err(|e| Error::Custom(format!("Format VRChat config JSON: {e}")))
}

pub fn write_config_file(validated_json: &str) -> Result<(), Error> {
    let path = vrchat_paths::vrchat_config_path();
    write_string_file(&path, validated_json)
}

pub fn disable_vrchat_rich_presence() -> Result<VrchatRichPresenceDisableResult, Error> {
    disable_vrchat_rich_presence_at(&vrchat_paths::vrchat_config_path())
}

fn disable_vrchat_rich_presence_at(path: &Path) -> Result<VrchatRichPresenceDisableResult, Error> {
    let content = if path.exists() {
        std::fs::read_to_string(path)?
    } else {
        String::new()
    };
    let mut config = if content.trim().is_empty() {
        serde_json::Map::new()
    } else {
        serde_json::from_str::<serde_json::Value>(&content)?
            .as_object()
            .cloned()
            .ok_or_else(|| Error::Custom("VRChat config JSON must be an object.".into()))?
    };
    if config
        .get("disableRichPresence")
        .and_then(|value| value.as_bool())
        == Some(true)
    {
        return Ok(VrchatRichPresenceDisableResult { changed: false });
    }

    config.insert("disableRichPresence".into(), serde_json::Value::Bool(true));
    let json = serde_json::to_string_pretty(&serde_json::Value::Object(config))?;
    write_string_file_atomically(path, &json)?;
    Ok(VrchatRichPresenceDisableResult { changed: true })
}

pub fn vrchat_cache_location_would_change(validated_json: &str) -> Result<bool, Error> {
    let current_cache_path = PathBuf::from(vrchat_paths::vrchat_cache_location());
    let next_cache_path = vrchat_cache_location_from_config(validated_json)?;
    Ok(!cache_paths_equal(&current_cache_path, &next_cache_path))
}

pub fn write_config_file_with_cache_cleanup(
    validated_json: &str,
) -> Result<VrchatConfigWriteResult, Error> {
    let old_cache_path = PathBuf::from(vrchat_paths::vrchat_cache_location());
    let next_cache_path = vrchat_cache_location_from_config(validated_json)?;
    write_config_file(validated_json)?;

    let old_cache_cleanup_error = if cache_paths_equal(&old_cache_path, &next_cache_path) {
        None
    } else if cache_paths_overlap(&old_cache_path, &next_cache_path) {
        Some("The old and new VRChat cache directories overlap.".to_string())
    } else if process_status::detect_game_running() {
        Some("VRChat is running. The old cache was not cleaned.".to_string())
    } else {
        asset_bundle_cache::delete_cache_root(&old_cache_path)
            .err()
            .map(|error| error.to_string())
    };

    Ok(VrchatConfigWriteResult {
        old_cache_cleanup_error,
    })
}

fn vrchat_cache_location_from_config(validated_json: &str) -> Result<PathBuf, Error> {
    let value: serde_json::Value = serde_json::from_str(validated_json)?;
    Ok(vrchat_paths::vrchat_cache_location_for_directory(
        value
            .get("cache_directory")
            .and_then(|directory| directory.as_str()),
    ))
}

fn comparable_cache_path(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| {
        path.parent()
            .and_then(|parent| std::fs::canonicalize(parent).ok())
            .and_then(|parent| path.file_name().map(|name| parent.join(name)))
            .unwrap_or_else(|| path.to_path_buf())
    })
}

fn cache_paths_equal(left: &Path, right: &Path) -> bool {
    let left = comparable_cache_path(left);
    let right = comparable_cache_path(right);

    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }

    #[cfg(not(windows))]
    {
        left == right
    }
}

fn cache_paths_overlap(left: &Path, right: &Path) -> bool {
    let left = comparable_cache_path(left);
    let right = comparable_cache_path(right);
    left.starts_with(&right) || right.starts_with(&left)
}

pub fn open_existing_folder(path: &Path) -> Result<bool, Error> {
    if !path.exists() {
        return Ok(false);
    }
    open::that(path.to_string_lossy().as_ref())
        .map_err(|e| Error::Custom(format!("open folder: {e}")))?;
    Ok(true)
}

pub fn open_vrc_app_data_folder() -> Result<bool, Error> {
    open_existing_folder(&vrchat_paths::vrchat_app_data())
}

pub fn open_vrc_photos_folder() -> Result<bool, Error> {
    let path = vrchat_paths::vrchat_photos_location();
    open_existing_folder(Path::new(&path))
}

pub fn open_ugc_photos_folder(ugc_path: Option<String>) -> Result<bool, Error> {
    let path = vrchat_paths::ugc_photo_location(ugc_path);
    open_existing_folder(Path::new(&path))
}

pub fn open_vrc_screenshots_folder() -> Result<bool, Error> {
    let path = vrchat_paths::vrchat_screenshots_location();
    if path.is_empty() {
        return Ok(false);
    }
    open_existing_folder(Path::new(&path))
}

pub fn open_crash_dumps_folder() -> Result<bool, Error> {
    open_existing_folder(&vrchat_paths::vrchat_crashes_location())
}

pub fn open_folder_and_select_item(path: &str, is_folder: bool) -> Result<(), Error> {
    let p = PathBuf::from(path);
    if !p.exists() {
        return Err(Error::Custom(format!("path not found: {path}")));
    }

    #[cfg(target_os = "linux")]
    {
        open_folder_and_select_item_linux(&p, is_folder)
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = is_folder;
        std::process::Command::new("explorer.exe")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map_err(|e| Error::Custom(format!("explorer: {e}")))?;

        Ok(())
    }
}

pub fn write_string_file(path: &Path, content: &str) -> Result<(), Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, content)?;
    Ok(())
}

fn write_string_file_atomically(path: &Path, content: &str) -> Result<(), Error> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::Custom("file path has no parent directory".into()))?;
    std::fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("config.json");
    let write_id = NEXT_ATOMIC_WRITE_ID.fetch_add(1, Ordering::Relaxed);
    let temporary_path = parent.join(format!(
        ".{file_name}.vrcx-0-{}-{write_id}.tmp",
        std::process::id()
    ));

    let result = (|| -> Result<(), Error> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        replace_file_atomically(&temporary_path, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary_path);
    }
    result
}

#[cfg(windows)]
fn replace_file_atomically(source: &Path, destination: &Path) -> Result<(), Error> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file_atomically(source: &Path, destination: &Path) -> Result<(), Error> {
    std::fs::rename(source, destination)?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn open_folder_and_select_item_linux(path: &Path, is_folder: bool) -> Result<(), Error> {
    let directory = if is_folder {
        path
    } else {
        path.parent().unwrap_or(path)
    };

    let path_arg = path.as_os_str().to_os_string();
    let directory_arg = directory.as_os_str().to_os_string();
    let attempts: Vec<(&str, Vec<std::ffi::OsString>)> = vec![
        ("nautilus", vec![path_arg.clone()]),
        ("nemo", vec![path_arg.clone()]),
        ("thunar", vec![path_arg.clone()]),
        ("caja", vec!["--select".into(), path_arg.clone()]),
        ("pcmanfm-qt", vec![directory_arg.clone()]),
        ("pcmanfm", vec![directory_arg.clone()]),
        ("dolphin", vec!["--select".into(), path_arg.clone()]),
        ("konqueror", vec!["--select".into(), path_arg.clone()]),
        ("xdg-open", vec![directory_arg]),
    ];

    for (command, args) in attempts {
        if !vrchat_paths::linux_command_in_path(command) {
            continue;
        }

        if std::process::Command::new(command)
            .args(args)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }

    Err(Error::Custom(
        "No supported Linux file manager was found".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        cache_paths_equal, cache_paths_overlap, disable_vrchat_rich_presence_at,
        discord_profile_url, normalize_config_file_json,
    };
    use std::{path::Path, time::SystemTime};

    #[test]
    fn builds_discord_profile_web_url() {
        assert_eq!(
            discord_profile_url(" 123456789012345678 ").unwrap(),
            "https://discord.com/users/123456789012345678"
        );
    }

    #[test]
    fn rejects_invalid_discord_profile_ids() {
        for discord_id in ["", "discord-user", "123/../../channels"] {
            assert!(discord_profile_url(discord_id).is_err());
        }
    }

    #[test]
    fn normalizes_object_vrchat_config_json() {
        let json = normalize_config_file_json(r#"{"cache_directory":"C:/VRChat"}"#).unwrap();

        assert!(json.contains("cache_directory"));
    }

    #[test]
    fn rejects_scalar_vrchat_config_json() {
        assert!(normalize_config_file_json(r#""not a config""#).is_err());
    }

    #[test]
    fn rejects_invalid_vrchat_config_json() {
        assert!(normalize_config_file_json("{").is_err());
    }

    #[test]
    fn compares_equivalent_cache_paths_after_normalizing_their_parent() {
        let cache_path = std::env::temp_dir();
        let equivalent_path = cache_path.join(".");

        assert!(cache_paths_equal(&cache_path, &equivalent_path));
    }

    #[test]
    fn detects_overlapping_cache_paths() {
        let cache_path = Path::new("cache");

        assert!(cache_paths_overlap(cache_path, &cache_path.join("nested")));
    }

    #[test]
    fn disables_vrchat_rich_presence_atomically_and_preserves_config() {
        let directory = temporary_test_directory("disable-rich-presence");
        let path = directory.join("config.json");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(&path, r#"{"existing":true}"#).unwrap();

        let first = disable_vrchat_rich_presence_at(&path).unwrap();
        let second = disable_vrchat_rich_presence_at(&path).unwrap();
        let config: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();

        assert!(first.changed);
        assert!(!second.changed);
        assert_eq!(config.get("existing"), Some(&serde_json::Value::Bool(true)));
        assert_eq!(
            config.get("disableRichPresence"),
            Some(&serde_json::Value::Bool(true))
        );
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn invalid_vrchat_config_is_not_overwritten() {
        let directory = temporary_test_directory("invalid-rich-presence-config");
        let path = directory.join("config.json");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(&path, r#"["not","an","object"]"#).unwrap();

        assert!(disable_vrchat_rich_presence_at(&path).is_err());
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            r#"["not","an","object"]"#
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    fn temporary_test_directory(label: &str) -> std::path::PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("vrcx-0-{label}-{}-{timestamp}", std::process::id()))
    }
}
