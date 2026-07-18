use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::{Error, Result};
use vrcx_0_host::app_paths::AppPaths;

#[derive(Clone, Default)]
pub struct HostFileAccess {
    registered_paths: Arc<Mutex<HashSet<PathBuf>>>,
}

impl HostFileAccess {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_path(&self, path: impl AsRef<Path>) {
        let path = path.as_ref();
        if path.as_os_str().is_empty() {
            return;
        }

        match normalize_existing_or_creatable(path) {
            Ok(path) => {
                if let Ok(mut registered) = self.registered_paths.lock() {
                    registered.insert(path);
                }
            }
            Err(error) => {
                tracing::warn!(path = %path.display(), "skipping inaccessible file access grant: {error}");
            }
        }
    }

    pub fn ensure_read_allowed(&self, path: impl AsRef<Path>, app_paths: &AppPaths) -> Result<()> {
        let requested = path.as_ref();
        let requested = canonicalize_existing(requested).map_err(|error| {
            Error::Custom(format!(
                "File access denied for '{}': {error}",
                requested.display()
            ))
        })?;

        if self.is_registered(&requested) || is_under_known_root(&requested, app_paths) {
            return Ok(());
        }

        Err(Error::Custom(format!(
            "File access denied for '{}'. Select the file first or use an application/VRChat data path.",
            requested.display()
        )))
    }

    pub fn ensure_write_allowed(&self, path: impl AsRef<Path>, app_paths: &AppPaths) -> Result<()> {
        let requested = path.as_ref();
        let requested = normalize_existing_or_creatable(requested).map_err(|error| {
            Error::Custom(format!(
                "File access denied for '{}': {error}",
                requested.display()
            ))
        })?;

        if self.is_registered(&requested) || is_under_known_root(&requested, app_paths) {
            return Ok(());
        }

        Err(Error::Custom(format!(
            "File access denied for '{}'. Select the folder first or use an application/VRChat data path.",
            requested.display()
        )))
    }

    fn is_registered(&self, requested: &Path) -> bool {
        let Ok(registered) = self.registered_paths.lock() else {
            return false;
        };

        registered
            .iter()
            .any(|allowed| requested == allowed || requested.starts_with(allowed))
    }
}

pub fn ensure_vrchat_launch_path_allowed(
    _file_access: &HostFileAccess,
    _app_paths: &AppPaths,
    path: &str,
) -> Result<String> {
    let root = normalize_vrchat_launch_root(path)?;
    let launch_file = if cfg!(target_os = "linux") {
        root.join("steam.sh")
    } else {
        root.join("launch.exe")
    };
    if !launch_file.is_file() {
        return Err(Error::Custom(
            "VRChat launch path does not contain a supported launcher.".into(),
        ));
    }

    Ok(root.to_string_lossy().into_owned())
}

fn normalize_vrchat_launch_root(path: &str) -> Result<PathBuf> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err(Error::Custom("VRChat launch path is empty.".into()));
    }
    let root = if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("launch.exe") || name == "steam.sh")
    {
        path.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| Error::Custom("VRChat launch path has no parent.".into()))?
    } else {
        path
    };
    root.canonicalize()
        .map_err(|error| Error::Custom(format!("VRChat launch path is not accessible: {error}")))
}

fn canonicalize_existing(path: &Path) -> std::io::Result<PathBuf> {
    path.canonicalize()
}

fn is_under_known_root(requested: &Path, app_paths: &AppPaths) -> bool {
    known_roots(app_paths)
        .into_iter()
        .filter_map(|root| normalize_existing_or_creatable(&root).ok())
        .any(|root| requested == root || requested.starts_with(root))
}

pub fn is_known_root_path(path: impl AsRef<Path>, app_paths: &AppPaths) -> bool {
    let Ok(requested) = canonicalize_existing(path.as_ref()) else {
        return false;
    };
    is_under_known_root(&requested, app_paths)
}

fn known_roots(app_paths: &AppPaths) -> Vec<PathBuf> {
    let mut roots = vec![
        app_paths.app_data.clone(),
        app_paths.image_cache.clone(),
        app_paths.screenshot_thumbs.clone(),
        vrcx_0_host_desktop::vrchat_paths::vrchat_app_data(),
        PathBuf::from(vrcx_0_host_desktop::vrchat_paths::vrchat_photos_location()),
        PathBuf::from(vrcx_0_host_desktop::vrchat_paths::vrchat_cache_location()),
        PathBuf::from(vrcx_0_host_desktop::vrchat_paths::vrchat_screenshots_location()),
    ];

    roots.retain(|path| !path.as_os_str().is_empty());
    roots
}

fn normalize_existing_or_creatable(path: &Path) -> std::io::Result<PathBuf> {
    if path.exists() {
        return path.canonicalize();
    }

    if path.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::Prefix(_)
                | std::path::Component::RootDir
        )
    }) && !path.is_absolute()
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "relative parent paths are not allowed",
        ));
    }

    let mut suffix = Vec::new();
    let mut current = path;
    while !current.exists() {
        let Some(name) = current.file_name() else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "no existing parent directory",
            ));
        };
        suffix.push(name.to_owned());
        current = current.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "no existing parent directory")
        })?;
    }

    let mut normalized = current.canonicalize()?;
    for component in suffix.into_iter().rev() {
        normalized.push(component);
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    #[cfg(target_os = "windows")]
    fn persisted_launch_exe_path_does_not_require_registered_file_access() {
        let dir = TestDir::new("host-file-access-launch-path");
        let app_data = dir.path.join("app-data");
        let vrchat_root = dir.path.join("steamapps").join("common").join("VRChat");
        std::fs::create_dir_all(&app_data).unwrap();
        std::fs::create_dir_all(&vrchat_root).unwrap();
        std::fs::write(vrchat_root.join("launch.exe"), b"").unwrap();

        let path = ensure_vrchat_launch_path_allowed(
            &HostFileAccess::new(),
            &AppPaths::from_app_data(app_data),
            &vrchat_root.join("launch.exe").to_string_lossy(),
        )
        .unwrap();

        assert_eq!(PathBuf::from(path), vrchat_root.canonicalize().unwrap());
    }
}
