use super::*;

pub fn picked_local_target(path: impl Into<PathBuf>) -> AppLauncherPickedTarget {
    let path = path.into();
    let target = path.to_string_lossy().to_string();
    AppLauncherPickedTarget {
        kind: AppLauncherEntryKind::LocalApp,
        name: display_name_for_path(&path),
        process_name: if is_windows_executable_path(&path) {
            path.file_stem()
                .map(|value| value.to_string_lossy().to_string())
                .filter(|value| !value.trim().is_empty())
        } else {
            None
        },
        working_directory: None,
        target,
    }
}

pub fn picked_app_launcher_target(
    path: impl Into<PathBuf>,
) -> Result<AppLauncherPickedTarget, String> {
    let path = path.into();
    if path_extension_eq(&path, "url") {
        let Some(app_id) = steam_app_id_from_url_shortcut(&path)? else {
            return Err("selected URL shortcut is not a Steam app shortcut".to_string());
        };
        return Ok(AppLauncherPickedTarget {
            kind: AppLauncherEntryKind::SteamApp,
            name: display_name_for_path(&path),
            target: app_id,
            process_name: None,
            working_directory: None,
        });
    }

    Ok(picked_local_target(path))
}

fn steam_app_id_from_url_shortcut(path: &Path) -> Result<Option<String>, String> {
    let bytes = std::fs::read(path).map_err(|error| {
        format!(
            "failed to read shortcut {}: {error}",
            path.to_string_lossy()
        )
    })?;
    let content = shortcut_bytes_to_string(&bytes);
    for line in content.lines() {
        let line = line.trim();
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if !key.eq_ignore_ascii_case("URL") {
            continue;
        }
        if let Some(app_id) = steam_app_id_from_url(value) {
            return Ok(Some(app_id));
        }
    }
    Ok(None)
}

fn shortcut_bytes_to_string(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&bytes[3..]).to_string();
    }
    String::from_utf8_lossy(bytes).to_string()
}

fn steam_app_id_from_url(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    for prefix in [
        "steam://rungameid/",
        "steam://launch/",
        "steam://run/",
        "steam://open/games/details/",
    ] {
        if !lower.starts_with(prefix) {
            continue;
        }
        let app_id: String = trimmed[prefix.len()..]
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .collect();
        if !app_id.is_empty() {
            return Some(app_id);
        }
    }
    None
}
