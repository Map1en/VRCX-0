use std::ffi::{OsStr, OsString};
use std::io::Write;
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
    current_dir: impl AsRef<Path>,
) -> Result<AppDataDirValidation, Error> {
    let validation = validate_app_data_dir(path.as_ref(), false)?;
    ensure_distinct_data_directories(
        &validation.resolved_path(),
        &current_dir.as_ref().canonicalize()?,
    )?;
    Ok(validation)
}

pub fn prepare_app_data_dir_migration_target(
    path: impl AsRef<Path>,
    current_dir: impl AsRef<Path>,
) -> Result<AppDataDirValidation, Error> {
    let validation = validate_app_data_dir_for_mode(path.as_ref(), true)?;
    ensure_distinct_data_directories(
        &validation.resolved_path(),
        &current_dir.as_ref().canonicalize()?,
    )?;
    Ok(validation)
}

pub fn persist_app_data_dir(
    path: impl AsRef<Path>,
    current_dir: impl AsRef<Path>,
) -> Result<AppDataDirValidation, Error> {
    let default_dir = default_app_data_dir()?;
    let validation = validate_app_data_dir_selection(path.as_ref(), current_dir)?;
    let selected_path = PathBuf::from(&validation.path);
    commit_app_data_dir_pointer(&default_dir, &selected_path)?;
    Ok(validation)
}

pub fn clear_persisted_app_data_dir() -> Result<(), Error> {
    let default_dir = default_app_data_dir()?;
    clear_app_data_dir_pointer(&default_dir)
}

pub fn commit_app_data_dir_pointer(default_dir: &Path, path: &Path) -> Result<(), Error> {
    let resolved_path = path.canonicalize()?;
    if app_data_paths_match(&resolved_path, default_dir) {
        return clear_app_data_dir_pointer(default_dir);
    }
    let pointer = AppDataDirPointer {
        data_dir: path_string(&resolved_path),
    };
    let json = serde_json::to_string_pretty(&pointer)?;
    write_app_data_dir_pointer(default_dir, &json)
}

pub fn clear_app_data_dir_pointer(default_dir: &Path) -> Result<(), Error> {
    let pointer_path = app_data_dir_pointer_path(default_dir);
    match std::fs::remove_file(&pointer_path) {
        Ok(()) => sync_directory_after_pointer_update(default_dir),
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

fn write_app_data_dir_pointer(default_dir: &Path, json: &str) -> Result<(), Error> {
    std::fs::create_dir_all(default_dir)?;
    let pointer_path = app_data_dir_pointer_path(default_dir);
    let temporary_path = pointer_path.with_extension("json.tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut temporary = options.open(&temporary_path)?;
    temporary.write_all(json.as_bytes())?;
    temporary.sync_all()?;
    drop(temporary);
    replace_file_atomically(&temporary_path, &pointer_path)?;
    sync_directory_after_pointer_update(default_dir)
}

#[cfg(not(windows))]
fn replace_file_atomically(source: &Path, destination: &Path) -> Result<(), Error> {
    std::fs::rename(source, destination)?;
    Ok(())
}

#[cfg(windows)]
fn replace_file_atomically(source: &Path, destination: &Path) -> Result<(), Error> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

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
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        return Err(Error::Io(std::io::Error::last_os_error()));
    }
    Ok(())
}

#[cfg(not(windows))]
fn sync_directory_after_pointer_update(path: &Path) -> Result<(), Error> {
    std::fs::File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(windows)]
fn sync_directory_after_pointer_update(path: &Path) -> Result<(), Error> {
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    if let Err(error) = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .and_then(|directory| directory.sync_all())
    {
        tracing::warn!(error = %error, "failed to durably sync data directory pointer folder");
    }
    Ok(())
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

pub fn app_data_paths_match(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
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

fn ensure_distinct_data_directories(selected: &Path, current: &Path) -> Result<(), Error> {
    let selected_components = comparable_path_components(selected);
    let current_components = comparable_path_components(current);
    if selected_components == current_components {
        return Err(Error::Custom(
            "Selected data directory is the current data directory.".into(),
        ));
    }
    let shared_components = selected_components
        .iter()
        .zip(&current_components)
        .take_while(|(selected, current)| selected == current)
        .count();
    if shared_components == selected_components.len()
        || shared_components == current_components.len()
    {
        return Err(Error::Custom(
            "Selected and current data directories must not contain each other.".into(),
        ));
    }
    Ok(())
}

fn comparable_path_components(path: &Path) -> Vec<String> {
    path.components()
        .map(|component| {
            let component = component.as_os_str().to_string_lossy();
            #[cfg(windows)]
            {
                component.to_lowercase()
            }
            #[cfg(not(windows))]
            {
                component.into_owned()
            }
        })
        .collect()
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

    #[test]
    fn selection_rejects_same_and_nested_data_directories() {
        let dir = TestDir::new("selection-overlap");
        let current = dir.path.join("current");
        let child = current.join("child");
        let parent = dir.path.clone();
        let sibling = dir.path.join("sibling");
        for path in [&current, &child, &sibling] {
            std::fs::create_dir_all(path).unwrap();
        }

        assert!(validate_app_data_dir_selection(&current, &current).is_err());
        assert!(validate_app_data_dir_selection(&child, &current).is_err());
        assert!(validate_app_data_dir_selection(&parent, &current).is_err());
        assert!(validate_app_data_dir_selection(&sibling, &current).is_ok());

        #[cfg(windows)]
        {
            let case_changed = PathBuf::from(path_string(&current).to_uppercase());
            let extended = current.canonicalize().unwrap();
            assert!(validate_app_data_dir_selection(case_changed, &current).is_err());
            assert!(validate_app_data_dir_selection(extended, &current).is_err());
        }
    }

    #[test]
    fn migration_target_preparation_creates_a_missing_directory() {
        let dir = TestDir::new("migration-target-create");
        let current = dir.path.join("current");
        let target = dir.path.join("target");
        std::fs::create_dir(&current).unwrap();

        let validation = prepare_app_data_dir_migration_target(&target, &current).unwrap();

        assert!(!validation.exists);
        assert!(target.is_dir());
        assert_eq!(validation.resolved_path(), target.canonicalize().unwrap());
    }

    #[test]
    fn pointer_write_replaces_existing_file_and_ignores_stale_temporary_file() {
        let dir = TestDir::new("atomic-pointer");
        let first = serde_json::to_string_pretty(&AppDataDirPointer {
            data_dir: "first".into(),
        })
        .unwrap();
        write_app_data_dir_pointer(&dir.path, &first).unwrap();
        std::fs::write(
            app_data_dir_pointer_path(&dir.path).with_extension("json.tmp"),
            "stale temporary content",
        )
        .unwrap();
        assert_eq!(
            read_persisted_app_data_dir_from_default(&dir.path).unwrap(),
            Some(PathBuf::from("first"))
        );

        let second = serde_json::to_string_pretty(&AppDataDirPointer {
            data_dir: "second".into(),
        })
        .unwrap();
        write_app_data_dir_pointer(&dir.path, &second).unwrap();
        assert_eq!(
            read_persisted_app_data_dir_from_default(&dir.path).unwrap(),
            Some(PathBuf::from("second"))
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
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-app-paths-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}
