#![allow(non_snake_case)]

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::api::app::app__get_vrchat_cache_location;
use crate::error::AppError;

#[derive(Serialize)]
pub struct CacheCheckResult {
    #[serde(rename = "Item1")]
    item1: i64,
    #[serde(rename = "Item2")]
    item2: bool,
    #[serde(rename = "Item3")]
    item3: String,
}

fn get_asset_id(id: &str, variant: &str) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(id.as_bytes());
    hasher.update(variant.as_bytes());
    let hash = hasher.finalize();
    let hex = hex::encode_upper(hash);
    hex[..16].to_string()
}

fn get_asset_version(version: i32, variant_version: i32) -> String {
    let mut bytes = Vec::with_capacity(8);
    bytes.extend_from_slice(&variant_version.to_le_bytes());
    bytes.extend_from_slice(&version.to_le_bytes());

    let mut out = String::with_capacity(32);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    format!("{out:0>32}")
}

fn reverse_hex_to_decimal(hex_string: &str) -> (i32, i32) {
    if hex_string.len() != 32 {
        return (0, 0);
    }

    let variant_hex = &hex_string[..8];
    let version_hex = &hex_string[24..32];

    let parse_part = |s: &str| -> Option<[u8; 4]> {
        let mut out = [0u8; 4];
        for (i, slot) in out.iter_mut().enumerate() {
            let start = i * 2;
            *slot = u8::from_str_radix(&s[start..start + 2], 16).ok()?;
        }
        Some(out)
    };

    let Some(version_bytes) = parse_part(version_hex) else {
        return (0, 0);
    };
    let Some(variant_bytes) = parse_part(variant_hex) else {
        return (0, 0);
    };

    (
        i32::from_le_bytes(version_bytes),
        i32::from_le_bytes(variant_bytes),
    )
}

fn get_vrchat_cache_full_location_impl(
    file_id: &str,
    file_version: i32,
    variant: &str,
    variant_version: i32,
) -> String {
    let cache_path = PathBuf::from(app__get_vrchat_cache_location());
    let id_hash = get_asset_id(file_id, variant);
    let top_dir = cache_path.join(id_hash);
    let version_location = get_asset_version(file_version, variant_version);

    if !top_dir.exists() {
        return top_dir
            .join(version_location)
            .to_string_lossy()
            .into_owned();
    }

    let suffix = &version_location[16..];
    let mut matches: Vec<PathBuf> = match fs::read_dir(&top_dir) {
        Ok(entries) => entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|name| name.ends_with(suffix))
                    .unwrap_or(false)
            })
            .collect(),
        Err(_) => Vec::new(),
    };

    if !matches.is_empty() {
        matches.sort_by(|a, b| {
            let a_name = a.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            let b_name = b.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            reverse_hex_to_decimal(b_name)
                .1
                .cmp(&reverse_hex_to_decimal(a_name).1)
        });
        return matches[0].to_string_lossy().into_owned();
    }

    top_dir
        .join(version_location)
        .to_string_lossy()
        .into_owned()
}

fn dir_size(path: &Path) -> i64 {
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len() as i64)
        .sum()
}

#[tauri::command]
pub fn asset_bundle__get_vrchat_cache_full_location(
    file_id: String,
    file_version: i32,
    variant: String,
    variant_version: i32,
) -> String {
    get_vrchat_cache_full_location_impl(&file_id, file_version, &variant, variant_version)
}

#[tauri::command]
pub fn asset_bundle__check_vrchat_cache(
    file_id: String,
    file_version: i32,
    variant: String,
    variant_version: i32,
) -> CacheCheckResult {
    let mut file_size = -1i64;
    let mut is_locked = false;

    let mut full_location = get_vrchat_cache_full_location_impl(&file_id, file_version, "", 0);
    if !Path::new(&full_location).exists() {
        full_location =
            get_vrchat_cache_full_location_impl(&file_id, file_version, &variant, variant_version);
    }

    let file_location = PathBuf::from(&full_location).join("__data");
    let mut cache_path = String::new();
    if file_location.exists() {
        cache_path = full_location.clone();
        if let Ok(meta) = fs::metadata(&file_location) {
            file_size = meta.len() as i64;
        }
    }
    if PathBuf::from(&full_location).join("__lock").exists() {
        is_locked = true;
    }

    CacheCheckResult {
        item1: file_size,
        item2: is_locked,
        item3: cache_path,
    }
}

#[tauri::command]
pub fn asset_bundle__delete_cache(
    file_id: String,
    file_version: i32,
    variant: String,
    variant_version: i32,
) {
    let path = get_vrchat_cache_full_location_impl(&file_id, file_version, "", 0);
    if Path::new(&path).exists() {
        let _ = fs::remove_dir_all(&path);
    }

    let path =
        get_vrchat_cache_full_location_impl(&file_id, file_version, &variant, variant_version);
    if Path::new(&path).exists() {
        let _ = fs::remove_dir_all(&path);
    }
}

#[tauri::command]
pub fn asset_bundle__delete_all_cache() {
    let cache_path = PathBuf::from(app__get_vrchat_cache_location());
    if cache_path.exists() {
        let _ = fs::remove_dir_all(&cache_path);
        let _ = fs::create_dir_all(&cache_path);
    }
}

#[tauri::command]
pub fn asset_bundle__sweep_cache() -> Vec<String> {
    let cache_path = PathBuf::from(app__get_vrchat_cache_location());
    let mut output = Vec::new();

    if !cache_path.exists() {
        return output;
    }

    let Ok(entries) = fs::read_dir(&cache_path) else {
        return output;
    };

    for entry in entries.flatten() {
        let cache_dir = entry.path();
        if !cache_dir.is_dir() {
            continue;
        }

        let Ok(version_entries) = fs::read_dir(&cache_dir) else {
            continue;
        };

        let mut version_dirs: Vec<PathBuf> = version_entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();

        version_dirs.sort_by_key(|p| {
            fs::metadata(p)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        });

        for index in 0..version_dirs.len() {
            let version_dir = &version_dirs[index];
            let Ok(mut children) = fs::read_dir(version_dir) else {
                continue;
            };
            if children.next().is_none() {
                let _ = fs::remove_dir(version_dir);
                continue;
            }

            if index == version_dirs.len() - 1 {
                continue;
            }

            if version_dir.join("__lock").exists() {
                continue;
            }

            let rel = format!(
                "{}\\{}",
                cache_dir
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default(),
                version_dir
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default()
            );
            if fs::remove_dir_all(version_dir).is_ok() {
                output.push(rel);
            }
        }

        let is_empty = fs::read_dir(&cache_dir)
            .ok()
            .and_then(|mut it| it.next())
            .is_none();
        if is_empty {
            let _ = fs::remove_dir(&cache_dir);
        }
    }

    output
}

#[tauri::command]
pub fn asset_bundle__get_cache_size() -> Result<i64, AppError> {
    let cache_path = PathBuf::from(app__get_vrchat_cache_location());
    if !cache_path.exists() {
        return Ok(0);
    }
    Ok(dir_size(&cache_path))
}
