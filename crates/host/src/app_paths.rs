use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use crate::error::Error;

const APP_DIR_NAME: &str = "VRCX-0";
const DATA_DIR_POINTER_FILE: &str = "VRCX-0.data-dir.json";
const DATA_DIR_ARG: &str = "--data-dir";
const PROFILE_DB_FILE: &str = "VRCX-0.sqlite3";
const PROFILE_CONFIG_FILE: &str = "VRCX-0.json";
const WRITE_PROBE_FILE: &str = ".vrcx-0-write-test";

#[derive(Clone)]
pub struct AppPaths {
    pub app_data: PathBuf,
    pub db_file: PathBuf,
    pub config_file: PathBuf,
    pub image_cache: PathBuf,
    pub screenshot_thumbs: PathBuf,
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppDataDirResolution {
    pub current_dir: PathBuf,
    pub default_dir: PathBuf,
    pub persisted_dir: Option<PathBuf>,
    pub cli_dir: Option<PathBuf>,
    pub source: AppDataDirSource,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AppDataDirSource {
    Cli,
    Persisted,
    Default,
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppDataDirState {
    pub current_dir: String,
    pub default_dir: String,
    pub persisted_dir: Option<String>,
    pub cli_dir: Option<String>,
    pub source: AppDataDirSource,
    pub cli_override: bool,
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppDataDirValidation {
    pub path: String,
    pub exists: bool,
    pub is_empty: bool,
    pub has_database: bool,
    pub has_config: bool,
    pub warning_kind: Option<String>,
    pub warning: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct AppDataDirPointer {
    data_dir: String,
}

impl AppPaths {
    pub fn resolve() -> Result<Self, Error> {
        Ok(Self::from_app_data(resolve_app_data_dir()?.current_dir))
    }

    pub fn from_app_data(app_data: PathBuf) -> Self {
        Self {
            db_file: app_data.join(PROFILE_DB_FILE),
            config_file: app_data.join(PROFILE_CONFIG_FILE),
            image_cache: app_data.join("ImageCache"),
            screenshot_thumbs: app_data.join("ScreenshotThumbs"),
            app_data,
        }
    }
}

pub fn default_app_data_dir() -> Result<PathBuf, Error> {
    Ok(dirs::config_dir()
        .ok_or_else(|| Error::Custom("cannot resolve AppData".into()))?
        .join(APP_DIR_NAME))
}

pub fn resolve_app_data_dir() -> Result<AppDataDirResolution, Error> {
    resolve_app_data_dir_from_args(std::env::args_os().skip(1))
}

pub fn resolve_app_data_dir_from_args(
    args: impl IntoIterator<Item = OsString>,
) -> Result<AppDataDirResolution, Error> {
    let default_dir = default_app_data_dir()?;
    let cli_dir = parse_data_dir_arg(args)?;
    if let Some(cli_dir) = cli_dir.clone() {
        let current_dir = validate_startup_app_data_dir(&cli_dir, true)?.resolved_path();
        let persisted_dir = read_persisted_app_data_dir_from_default(&default_dir)
            .ok()
            .flatten();
        return Ok(AppDataDirResolution {
            current_dir,
            default_dir,
            persisted_dir,
            cli_dir: Some(cli_dir),
            source: AppDataDirSource::Cli,
        });
    }

    let persisted_dir = read_persisted_app_data_dir_from_default(&default_dir)?;
    let (current_dir, source) = if let Some(persisted_dir) = persisted_dir.clone() {
        (
            validate_startup_app_data_dir(&persisted_dir, false)?.resolved_path(),
            AppDataDirSource::Persisted,
        )
    } else {
        (
            validate_startup_app_data_dir(&default_dir, true)?.resolved_path(),
            AppDataDirSource::Default,
        )
    };

    Ok(AppDataDirResolution {
        current_dir,
        default_dir,
        persisted_dir,
        cli_dir,
        source,
    })
}

pub fn app_data_dir_state(resolution: &AppDataDirResolution) -> Result<AppDataDirState, Error> {
    let persisted_dir = match read_persisted_app_data_dir_from_default(&resolution.default_dir) {
        Ok(persisted_dir) => persisted_dir,
        Err(error) if resolution.source == AppDataDirSource::Cli => {
            tracing::warn!(
                error = %error,
                "ignored invalid persisted data directory pointer while --data-dir is active"
            );
            resolution.persisted_dir.clone()
        }
        Err(error) => return Err(error),
    };
    Ok(AppDataDirState {
        current_dir: path_string(&resolution.current_dir),
        default_dir: path_string(&resolution.default_dir),
        persisted_dir: persisted_dir.as_ref().map(|path| path_string(path)),
        cli_dir: resolution.cli_dir.as_ref().map(|path| path_string(path)),
        source: resolution.source,
        cli_override: resolution.source == AppDataDirSource::Cli,
    })
}

pub fn validate_app_data_dir_selection(
    path: impl AsRef<Path>,
) -> Result<AppDataDirValidation, Error> {
    validate_app_data_dir(path.as_ref(), false)
}

pub fn persist_app_data_dir(path: impl AsRef<Path>) -> Result<AppDataDirValidation, Error> {
    let default_dir = default_app_data_dir()?;
    let validation = validate_app_data_dir_selection(path.as_ref())?;
    let selected_path = PathBuf::from(&validation.path);
    if paths_match(&selected_path, &default_dir) {
        clear_persisted_app_data_dir()?;
        return Ok(validation);
    }

    std::fs::create_dir_all(&default_dir)?;
    let pointer = AppDataDirPointer {
        data_dir: validation.path.clone(),
    };
    let json = serde_json::to_string_pretty(&pointer)?;
    std::fs::write(app_data_dir_pointer_path(&default_dir), json)?;
    Ok(validation)
}

pub fn clear_persisted_app_data_dir() -> Result<(), Error> {
    let default_dir = default_app_data_dir()?;
    let pointer_path = app_data_dir_pointer_path(&default_dir);
    match std::fs::remove_file(&pointer_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(Error::Io(error)),
    }
}

fn parse_data_dir_arg(args: impl IntoIterator<Item = OsString>) -> Result<Option<PathBuf>, Error> {
    let mut data_dir = None;
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg.as_os_str() == OsStr::new(DATA_DIR_ARG) {
            let Some(value) = args.next() else {
                return Err(Error::Custom("--data-dir requires a path".into()));
            };
            if value.as_os_str().is_empty() {
                return Err(Error::Custom("--data-dir requires a path".into()));
            }
            data_dir = Some(PathBuf::from(value));
            continue;
        }

        let text = arg.to_string_lossy();
        if let Some(value) = text.strip_prefix("--data-dir=") {
            if value.trim().is_empty() {
                return Err(Error::Custom("--data-dir requires a path".into()));
            }
            data_dir = Some(PathBuf::from(value));
        }
    }
    Ok(data_dir)
}

fn read_persisted_app_data_dir_from_default(default_dir: &Path) -> Result<Option<PathBuf>, Error> {
    let pointer_path = app_data_dir_pointer_path(default_dir);
    if !pointer_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&pointer_path)?;
    let pointer: AppDataDirPointer = serde_json::from_str(&content)?;
    let data_dir = pointer.data_dir.trim();
    if data_dir.is_empty() {
        Ok(None)
    } else {
        Ok(Some(PathBuf::from(data_dir)))
    }
}

fn validate_startup_app_data_dir(
    path: &Path,
    allow_create: bool,
) -> Result<AppDataDirValidation, Error> {
    validate_app_data_dir_for_mode(path, allow_create)
}

fn validate_app_data_dir(path: &Path, allow_create: bool) -> Result<AppDataDirValidation, Error> {
    validate_app_data_dir_for_mode(path, allow_create)
}

fn validate_app_data_dir_for_mode(
    path: &Path,
    allow_create: bool,
) -> Result<AppDataDirValidation, Error> {
    if path.as_os_str().is_empty() {
        return Err(Error::Custom("Data directory path is empty.".into()));
    }

    let existed = path.exists();
    if existed && !path.is_dir() {
        return Err(Error::Custom(format!(
            "Data directory is not a folder: {}",
            path.display()
        )));
    }
    if !existed {
        if allow_create {
            std::fs::create_dir_all(path)?;
        } else {
            return Err(Error::Custom(format!(
                "Data directory does not exist: {}",
                path.display()
            )));
        }
    }

    let resolved_path = path.canonicalize()?;
    let is_empty = directory_is_empty(&resolved_path)?;
    ensure_directory_writable(&resolved_path)?;
    let has_database = resolved_path.join(PROFILE_DB_FILE).is_file();
    let has_config = resolved_path.join(PROFILE_CONFIG_FILE).is_file();
    let (warning_kind, warning) = if is_empty {
        (
            Some("empty".to_string()),
            Some("Data directory is empty and will start as a new profile unless data is copied manually.".to_string()),
        )
    } else if !has_database || !has_config {
        (
            Some("missingProfileFiles".to_string()),
            Some("Data directory does not contain a complete VRCX-0 profile.".to_string()),
        )
    } else {
        (None, None)
    };

    Ok(AppDataDirValidation {
        path: path_string(&resolved_path),
        exists: existed,
        is_empty,
        has_database,
        has_config,
        warning_kind,
        warning,
    })
}

impl AppDataDirValidation {
    fn resolved_path(&self) -> PathBuf {
        PathBuf::from(&self.path)
    }
}

fn app_data_dir_pointer_path(default_dir: &Path) -> PathBuf {
    default_dir.join(DATA_DIR_POINTER_FILE)
}

fn directory_is_empty(path: &Path) -> Result<bool, Error> {
    let mut entries = std::fs::read_dir(path)?;
    Ok(entries.next().transpose()?.is_none())
}

fn ensure_directory_writable(path: &Path) -> Result<(), Error> {
    let probe = path.join(format!("{}-{}", WRITE_PROBE_FILE, std::process::id()));
    std::fs::write(&probe, b"vrcx-0")?;
    match std::fs::remove_file(&probe) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(Error::Io(error)),
    }
}

fn paths_match(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    left == right
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_validation_warns_but_accepts_a_database_only_profile_dir() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "vrcx-0-app-paths-db-only-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(PROFILE_DB_FILE), b"restored database").unwrap();

        let validation = validate_startup_app_data_dir(&dir, false).unwrap();
        assert!(validation.has_database);
        assert!(!validation.has_config);
        assert_eq!(
            validation.warning_kind.as_deref(),
            Some("missingProfileFiles")
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
