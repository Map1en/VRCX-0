#![allow(non_snake_case)]

use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn app__check_for_update_exe(state: State<'_, AppState>) -> bool {
    state.paths.app_data.join("update.exe").exists()
}

#[tauri::command]
pub fn app__check_legacy_vrcx_available(state: State<'_, AppState>) -> bool {
    state.legacy_vrcx_available
}

#[tauri::command]
pub fn app__request_legacy_migration(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    #[cfg(debug_assertions)]
    {
        tracing::warn!("app__request_legacy_migration: dev mode does not auto-restart or persist migration flag");
        let _ = (app_handle, state);
        Ok(false)
    }

    #[cfg(not(debug_assertions))]
    {
        let flag_path = state.paths.app_data.join("pending_vrcx_migration");
        std::fs::write(&flag_path, b"1")?;
        app_handle.request_restart();
        Ok(true)
    }
}

fn validate_update_download(
    file_url: &str,
    hash_string: &str,
    download_size: i32,
) -> Result<(), AppError> {
    if download_size < 0 {
        return Err(AppError::Custom("update download size is invalid".into()));
    }

    if (download_size as u64) > crate::domain::update::MAX_UPDATE_INSTALLER_SIZE_BYTES {
        return Err(AppError::Custom("update installer is too large".into()));
    }

    let url = reqwest::Url::parse(file_url)
        .map_err(|e| AppError::Custom(format!("invalid update URL: {e}")))?;
    if url.scheme() != "https" {
        return Err(AppError::Custom("update URL must use https".into()));
    }
    if url.host_str() != Some("github.com") {
        return Err(AppError::Custom("update URL host is not allowed".into()));
    }
    let path = url.path();
    if !path.starts_with("/Map1en/VRCX-0/releases/download/")
        || !path.to_ascii_lowercase().ends_with(".exe")
    {
        return Err(AppError::Custom("update URL path is not allowed".into()));
    }

    if hash_string.len() != 64 || !hash_string.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::Custom(
            "update SHA-256 hash must be 64 hex characters".into(),
        ));
    }

    Ok(())
}

#[tauri::command]
pub fn app__download_update(
    state: State<'_, AppState>,
    file_url: String,
    hash_string: String,
    download_size: i32,
) -> Result<(), AppError> {
    let hash_string = hash_string.trim().to_string();
    validate_update_download(&file_url, &hash_string, download_size)?;
    state
        .update_manager
        .start_download(file_url, hash_string, download_size);
    Ok(())
}

#[tauri::command]
pub fn app__cancel_update(state: State<'_, AppState>) {
    state.update_manager.cancel_download();
}

#[tauri::command]
pub fn app__check_update_progress(state: State<'_, AppState>) -> i32 {
    state.update_manager.check_progress()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_update_hash() -> String {
        "a".repeat(64)
    }

    #[test]
    fn validates_update_download_inputs() {
        let hash = valid_update_hash();
        let valid_url =
            "https://github.com/Map1en/VRCX-0/releases/download/v2026.04.0/VRCX-0_Setup.exe";

        assert!(validate_update_download(valid_url, &hash, 0).is_ok());
        assert!(validate_update_download(
            valid_url,
            &hash,
            crate::domain::update::MAX_UPDATE_INSTALLER_SIZE_BYTES as i32
        )
        .is_ok());

        assert!(validate_update_download(valid_url, &hash, -1).is_err());
        assert!(validate_update_download(
            valid_url,
            &hash,
            crate::domain::update::MAX_UPDATE_INSTALLER_SIZE_BYTES as i32 + 1
        )
        .is_err());
        assert!(validate_update_download(
            "http://github.com/Map1en/VRCX-0/releases/download/v2026.04.0/VRCX-0_Setup.exe",
            &hash,
            0
        )
        .is_err());
        assert!(validate_update_download(
            "https://example.com/Map1en/VRCX-0/releases/download/v2026.04.0/VRCX-0_Setup.exe",
            &hash,
            0
        )
        .is_err());
        assert!(validate_update_download(
            "https://github.com/Map1en/VRCX-0/archive/refs/tags/v2026.04.0.zip",
            &hash,
            0
        )
        .is_err());
        assert!(validate_update_download(valid_url, "abc", 0).is_err());
    }
}
