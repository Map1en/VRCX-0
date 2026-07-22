#![allow(non_snake_case)]

use crate::commands::host::host_capabilities::{require_host_capability, HostCapability};
use crate::error::AppError;
use vrcx_0_host_desktop::asset_bundle_cache::{self, CacheCheckResult};

#[tauri::command]
#[specta::specta]
pub fn asset_bundle__get_vrchat_cache_full_location(
    file_id: String,
    file_version: i32,
    variant: String,
    variant_version: i32,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(asset_bundle_cache::get_vrchat_cache_full_location(
        &file_id,
        file_version,
        &variant,
        variant_version,
    ))
}

#[tauri::command]
#[specta::specta]
pub fn asset_bundle__check_vrchat_cache(
    file_id: String,
    file_version: i32,
    variant: String,
    variant_version: i32,
) -> Result<CacheCheckResult, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(asset_bundle_cache::check_vrchat_cache(
        &file_id,
        file_version,
        &variant,
        variant_version,
    ))
}

#[tauri::command]
#[specta::specta]
pub fn asset_bundle__delete_cache(
    file_id: String,
    file_version: i32,
    variant: String,
    variant_version: i32,
) -> Result<(), AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    asset_bundle_cache::delete_cache(&file_id, file_version, &variant, variant_version);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn asset_bundle__delete_all_cache() -> Result<(), AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    asset_bundle_cache::delete_all_cache()?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn asset_bundle__sweep_cache() -> Result<Vec<String>, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(asset_bundle_cache::sweep_cache())
}

#[tauri::command]
#[specta::specta]
pub fn asset_bundle__sweep_cache_to_size(max_size_bytes: i64) -> Result<Vec<String>, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(asset_bundle_cache::sweep_cache_to_size(max_size_bytes))
}

#[tauri::command]
#[specta::specta]
pub fn asset_bundle__get_cache_size() -> Result<i64, AppError> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    Ok(asset_bundle_cache::cache_size())
}
