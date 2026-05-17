use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;

pub const SUPPORTED_LEGACY_DATABASE_VERSION: i64 = 16;

#[derive(Clone, Debug)]
pub struct LegacyVrcxSource {
    pub db_path: PathBuf,
    pub config_path: Option<PathBuf>,
    pub version: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyVrcxMigrationStatus {
    pub detected: bool,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub db_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl LegacyVrcxMigrationStatus {
    pub fn unavailable() -> Self {
        Self {
            detected: false,
            available: false,
            version: None,
            db_path: None,
            config_path: None,
            reason: None,
        }
    }

    fn from_source(source: &LegacyVrcxSource) -> Self {
        Self {
            detected: true,
            available: true,
            version: Some(source.version),
            db_path: Some(source.db_path.to_string_lossy().into_owned()),
            config_path: source
                .config_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            reason: None,
        }
    }

    fn blocked(source: Option<&LegacyVrcxSource>, reason: String) -> Self {
        Self {
            detected: true,
            available: false,
            version: source.map(|source| source.version),
            db_path: source.map(|source| source.db_path.to_string_lossy().into_owned()),
            config_path: source
                .and_then(|source| source.config_path.as_ref())
                .map(|path| path.to_string_lossy().into_owned()),
            reason: Some(reason),
        }
    }
}

pub fn discover_legacy_vrcx_migration(
    target_db: &Path,
    target_config: &Path,
) -> (Option<LegacyVrcxSource>, LegacyVrcxMigrationStatus) {
    if target_db.exists() || target_config.exists() {
        return (None, LegacyVrcxMigrationStatus::unavailable());
    }

    discover_supported_legacy_source()
}

pub fn discover_supported_legacy_source() -> (Option<LegacyVrcxSource>, LegacyVrcxMigrationStatus) {
    match discover_legacy_source() {
        Ok(Some(source)) => match validate_legacy_source(&source) {
            Ok(()) => {
                let status = LegacyVrcxMigrationStatus::from_source(&source);
                (Some(source), status)
            }
            Err(reason) => {
                let status = LegacyVrcxMigrationStatus::blocked(Some(&source), reason);
                (None, status)
            }
        },
        Ok(None) => (None, LegacyVrcxMigrationStatus::unavailable()),
        Err(reason) => (None, LegacyVrcxMigrationStatus::blocked(None, reason)),
    }
}

pub fn validate_legacy_source(source: &LegacyVrcxSource) -> Result<(), String> {
    let version = read_legacy_database_version(&source.db_path)?;
    if version != source.version {
        return Err(format!(
            "Legacy VRCX database version changed from {} to {}.",
            source.version, version
        ));
    }

    if version > SUPPORTED_LEGACY_DATABASE_VERSION {
        return Err(format!(
            "Legacy VRCX database version {version} is newer than supported version {SUPPORTED_LEGACY_DATABASE_VERSION}."
        ));
    }

    Ok(())
}

fn discover_legacy_source() -> Result<Option<LegacyVrcxSource>, String> {
    for legacy_dir in legacy_vrcx_dirs() {
        let config_path = resolve_legacy_config_path(&legacy_dir);
        let Some(db_path) = resolve_legacy_database_path(&legacy_dir, config_path.as_deref())
        else {
            continue;
        };
        let version = read_legacy_database_version(&db_path)?;
        return Ok(Some(LegacyVrcxSource {
            db_path,
            config_path,
            version,
        }));
    }

    Ok(None)
}

fn legacy_vrcx_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Some(path) = std::env::var_os("APPDATA").map(PathBuf::from) {
            dirs.push(path.join("VRCX"));
        }
        if let Some(path) = dirs::config_dir() {
            dirs.push(path.join("VRCX"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(path) = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from) {
            dirs.push(path.join("VRCX"));
        } else if let Some(home) = home_dir() {
            dirs.push(home.join(".config").join("VRCX"));
        }

        if let Some(home) = home_dir() {
            let user_name = std::env::var_os("USER").or_else(|| std::env::var_os("USERNAME"));
            if let Some(user_name) = user_name {
                dirs.push(
                    home.join(".local")
                        .join("share")
                        .join("vrcx")
                        .join("drive_c")
                        .join("users")
                        .join(PathBuf::from(user_name))
                        .join("AppData")
                        .join("Roaming")
                        .join("VRCX"),
                );
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = home_dir() {
            dirs.push(
                home.join("Library")
                    .join("Application Support")
                    .join("VRCX"),
            );
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        if let Some(path) = dirs::config_dir() {
            dirs.push(path.join("VRCX"));
        }
    }

    dedupe_paths(dirs)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = Vec::<PathBuf>::new();
    for path in paths {
        if !seen.iter().any(|item| item == &path) {
            seen.push(path);
        }
    }
    seen
}

fn resolve_legacy_config_path(legacy_dir: &Path) -> Option<PathBuf> {
    let json_path = legacy_dir.join("VRCX.json");
    if json_path.exists() {
        return Some(json_path);
    }

    let extensionless_path = legacy_dir.join("VRCX");
    extensionless_path.exists().then_some(extensionless_path)
}

fn resolve_legacy_database_path(legacy_dir: &Path, config_path: Option<&Path>) -> Option<PathBuf> {
    if let Some(config_path) = config_path {
        if let Some(config_db) = legacy_database_location(config_path).filter(|path| path.exists())
        {
            return Some(config_db);
        }
    }

    let default_db = legacy_dir.join("VRCX.sqlite3");
    default_db.exists().then_some(default_db)
}

fn legacy_database_location(config_path: &Path) -> Option<PathBuf> {
    let content = std::fs::read_to_string(config_path).ok()?;
    let data: HashMap<String, String> = serde_json::from_str(&content).ok()?;
    data.get("VRCX_DatabaseLocation")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn read_legacy_database_version(db_path: &Path) -> Result<i64, String> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open legacy VRCX database: {e}"))?;

    let has_configs: i64 = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'configs')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to inspect legacy VRCX database: {e}"))?;

    if has_configs == 0 {
        return Err("Legacy VRCX database does not contain a configs table.".to_string());
    }

    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM configs WHERE key = 'config:vrcx_databaseversion' LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read legacy VRCX database version: {e}"))?;

    let Some(value) = value else {
        return Ok(0);
    };

    value
        .trim()
        .parse::<i64>()
        .map_err(|_| format!("Legacy VRCX database version value is invalid: {value}."))
}
