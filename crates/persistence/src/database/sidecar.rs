use std::fs;
use std::path::{Path, PathBuf};

use crate::Error;

pub(super) fn remove_sidecars(db_path: &Path) -> Result<(), Error> {
    for suffix in ["shm", "wal"] {
        let path = sidecar_path(db_path, suffix);
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

pub(super) fn sidecar_path(db_path: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}-{suffix}", db_path.to_string_lossy()))
}
