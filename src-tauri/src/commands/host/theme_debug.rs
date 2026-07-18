#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommunityThemeDebugLocalThemeOutput {
    folder_path: String,
    css_path: String,
    manifest_path: Option<String>,
    theme_name: String,
    version: String,
    dark_mode: bool,
    accent_mode: bool,
    css: String,
}

#[tauri::command]
#[specta::specta]
pub fn app__community_theme_debug_load_local_theme(
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<CommunityThemeDebugLocalThemeOutput, AppError> {
    #[cfg(not(feature = "devtools"))]
    {
        let _ = state;
        let _ = folder_path;
        Err(AppError::Custom(
            "Community theme debug tools are unavailable in this build.".into(),
        ))
    }

    #[cfg(feature = "devtools")]
    {
        use std::path::PathBuf;

        state
            .desktop
            .host_file_access
            .ensure_read_allowed(&folder_path, &state.paths)?;

        let folder = PathBuf::from(&folder_path);
        if !folder.is_dir() {
            return Err(AppError::Custom(format!(
                "Theme folder does not exist: {}",
                folder.display()
            )));
        }

        let css_path = folder.join("theme.css");
        if !css_path.is_file() {
            return Err(AppError::Custom(format!(
                "Theme folder must contain theme.css: {}",
                css_path.display()
            )));
        }

        let css_path_string = css_path.to_string_lossy().to_string();
        state
            .desktop
            .host_file_access
            .ensure_read_allowed(&css_path_string, &state.paths)?;
        let css = std::fs::read_to_string(&css_path)?;

        let manifest_path = folder.join("theme.json");
        let manifest = if manifest_path.is_file() {
            let manifest_path_string = manifest_path.to_string_lossy().to_string();
            state
                .desktop
                .host_file_access
                .ensure_read_allowed(&manifest_path_string, &state.paths)?;
            let json = std::fs::read_to_string(&manifest_path)?;
            serde_json::from_str::<serde_json::Value>(&json).ok()
        } else {
            None
        };

        let theme_name = manifest
            .as_ref()
            .and_then(|value| value.get("name"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .or_else(|| {
                folder
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(ToOwned::to_owned)
            })
            .unwrap_or_else(|| "Local theme preview".into());
        let version = manifest
            .as_ref()
            .and_then(|value| value.get("version"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string();
        let accent_mode = manifest
            .as_ref()
            .and_then(|value| value.get("accentMode"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let dark_mode = manifest
            .as_ref()
            .and_then(|value| value.get("darkMode"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true);

        Ok(CommunityThemeDebugLocalThemeOutput {
            folder_path,
            css_path: css_path_string,
            manifest_path: manifest_path
                .is_file()
                .then(|| manifest_path.to_string_lossy().to_string()),
            theme_name,
            version,
            dark_mode,
            accent_mode,
            css,
        })
    }
}
