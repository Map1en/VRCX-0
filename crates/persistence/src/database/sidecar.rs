use std::fs;
use std::path::{Path, PathBuf};

use crate::Error;

pub fn sidecar_paths(db_path: &Path) -> [PathBuf; 2] {
    ["wal", "shm"].map(|suffix| PathBuf::from(format!("{}-{suffix}", db_path.to_string_lossy())))
}

pub fn remove_sidecars(db_path: &Path) -> Result<(), Error> {
    for path in sidecar_paths(db_path) {
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}
