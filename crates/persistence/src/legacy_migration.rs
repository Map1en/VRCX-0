use std::path::{Path, PathBuf};

use crate::legacy_vrcx::{LegacyVrcxMigrationStatus, LegacyVrcxSource};
use crate::Error;

#[derive(Clone, Debug)]
pub struct LegacyMigrationPaths {
    pub app_data: PathBuf,
    pub db_file: PathBuf,
    pub config_file: PathBuf,
}

impl LegacyMigrationPaths {
    pub fn from_app_data(app_data: PathBuf) -> Self {
        Self {
            db_file: app_data.join("VRCX-0.sqlite3"),
            config_file: app_data.join("VRCX-0.json"),
            app_data,
        }
    }
}

pub fn cleanup_legacy_updater_files(app_data: &Path) {
    for file_name in ["update.exe", "VRCX-0_Setup.exe", "tempDownload"] {
        let _ = std::fs::remove_file(app_data.join(file_name));
    }

    if let Ok(entries) = std::fs::read_dir(app_data) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().and_then(|name| name.to_str());
            if file_name.is_some_and(|name| name.starts_with("tempDownload-")) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

pub fn consume_pending_legacy_migration(paths: &LegacyMigrationPaths) -> Result<(), Error> {
    consume_pending_legacy_migration_with_discovery(
        paths,
        crate::legacy_vrcx::discover_supported_legacy_source,
    )
}

pub fn request_legacy_migration(paths: &LegacyMigrationPaths) -> Result<(), Error> {
    let flag_path = paths.app_data.join("pending_vrcx_migration");
    std::fs::write(&flag_path, b"1")?;
    Ok(())
}

fn consume_pending_legacy_migration_with_discovery<F>(
    paths: &LegacyMigrationPaths,
    discover_legacy_source: F,
) -> Result<(), Error>
where
    F: FnOnce() -> (Option<LegacyVrcxSource>, LegacyVrcxMigrationStatus),
{
    let migration_flag = paths.app_data.join("pending_vrcx_migration");
    if !migration_flag.exists() {
        return Ok(());
    }

    let (source, status) = discover_legacy_source();
    if let Some(source) = source.as_ref() {
        if paths.db_file.exists() || paths.config_file.exists() {
            tracing::warn!(
                "Legacy VRCX data migration replacing pre-created VRCX-0 database or config"
            );
        }
        copy_legacy_vrcx_data(paths, source)?;
        tracing::info!("Legacy VRCX data migration completed");
    } else if let Some(reason) = status.reason {
        tracing::warn!(reason, "Legacy VRCX data migration skipped");
    } else {
        tracing::warn!("Legacy VRCX data migration skipped: no legacy source found");
    }
    let _ = std::fs::remove_file(&migration_flag);
    Ok(())
}

fn copy_legacy_vrcx_data(
    paths: &LegacyMigrationPaths,
    source: &LegacyVrcxSource,
) -> Result<(), Error> {
    copy_replace(source.db_path.clone(), paths.db_file.clone())?;
    sync_sidecar(
        sidecar_path(&source.db_path, "shm"),
        paths.app_data.join("VRCX-0.sqlite3-shm"),
    )?;
    sync_sidecar(
        sidecar_path(&source.db_path, "wal"),
        paths.app_data.join("VRCX-0.sqlite3-wal"),
    )?;

    if let Some(config_path) = source.config_path.as_ref() {
        copy_replace(config_path.clone(), paths.config_file.clone())?;
    } else if paths.config_file.exists() {
        std::fs::remove_file(&paths.config_file)?;
    }

    Ok(())
}

fn copy_replace(from: PathBuf, to: PathBuf) -> Result<(), Error> {
    if !from.exists() {
        return Ok(());
    }

    if to.exists() {
        std::fs::remove_file(&to)?;
    }
    std::fs::copy(&from, &to)?;
    Ok(())
}

fn sidecar_path(db_path: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}-{suffix}", db_path.to_string_lossy()))
}

fn sync_sidecar(from: PathBuf, to: PathBuf) -> Result<(), Error> {
    if from.exists() {
        copy_replace(from, to)?;
    } else if to.exists() {
        std::fs::remove_file(to)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
