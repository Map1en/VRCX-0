use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};

use crate::database::{backup_connection_to_path, remove_sidecars};
use crate::legacy_vrcx::{LegacyVrcxDiscovery, LegacyVrcxSource};
use crate::Error;
pub use vrcx_0_contracts::{LegacyMigrationPaths, LegacyMigrationProgress};

const PENDING_MIGRATION_FILE: &str = "pending_vrcx_migration";
const STAGED_FLAG_CONTENTS: &[u8] = b"staged-v1";
const STAGING_DIRECTORY: &str = "legacy-migration-staging";
const STAGED_DATABASE_FILE: &str = "VRCX-0.sqlite3";
const STAGED_CONFIG_FILE: &str = "VRCX-0.json";
const PRESERVED_CONFIG_KEYS: [&str; 1] = ["config:vrcx_telemetryinstallid"];

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
    let flag_path = paths.app_data.join(PENDING_MIGRATION_FILE);
    let temporary = paths.app_data.join(format!("{PENDING_MIGRATION_FILE}.tmp"));
    std::fs::write(&temporary, STAGED_FLAG_CONTENTS)?;
    std::fs::OpenOptions::new()
        .write(true)
        .open(&temporary)?
        .sync_all()?;
    crate::profile_backup::replace_file_atomically(&temporary, &flag_path)?;
    crate::profile_backup::sync_directory_durable(&paths.app_data)?;
    Ok(())
}

pub fn prepare_legacy_migration(
    paths: &LegacyMigrationPaths,
    source: &LegacyVrcxSource,
    mut on_progress: impl FnMut(LegacyMigrationProgress),
) -> Result<(), Error> {
    let staging_dir = paths.app_data.join(STAGING_DIRECTORY);
    let pending_flag = paths.app_data.join(PENDING_MIGRATION_FILE);
    let _ = std::fs::remove_file(&pending_flag);
    if staging_dir.exists() {
        std::fs::remove_dir_all(&staging_dir)?;
    }
    std::fs::create_dir_all(&staging_dir)?;

    let result = (|| {
        copy_database_snapshot(
            &source.db_path,
            &staging_dir.join(STAGED_DATABASE_FILE),
            |completed_pages, total_pages| {
                on_progress(LegacyMigrationProgress::DatabaseCopy {
                    completed_pages,
                    total_pages,
                });
            },
        )?;
        on_progress(LegacyMigrationProgress::Configuration);
        if let Some(config_path) = source.config_path.as_ref() {
            copy_replace(config_path.clone(), staging_dir.join(STAGED_CONFIG_FILE))?;
        }
        on_progress(LegacyMigrationProgress::Finalizing);
        request_legacy_migration(paths)
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&pending_flag);
        let _ = std::fs::remove_dir_all(&staging_dir);
    }
    result
}

fn consume_pending_legacy_migration_with_discovery<F>(
    paths: &LegacyMigrationPaths,
    discover_legacy_source: F,
) -> Result<(), Error>
where
    F: FnOnce() -> LegacyVrcxDiscovery,
{
    let migration_flag = paths.app_data.join(PENDING_MIGRATION_FILE);
    if !migration_flag.exists() {
        return Ok(());
    }

    let staging_dir = paths.app_data.join(STAGING_DIRECTORY);
    if staging_dir.join(STAGED_DATABASE_FILE).is_file() {
        install_staged_legacy_vrcx_data(paths, &staging_dir)?;
        remove_migration_flag_best_effort(&migration_flag);
        if let Err(error) = std::fs::remove_dir_all(&staging_dir) {
            tracing::warn!(error = %error, "failed to remove completed legacy migration staging directory");
        }
        tracing::info!("Legacy VRCX data migration completed from a consistent staged snapshot");
        return Ok(());
    }

    if std::fs::read(&migration_flag).is_ok_and(|contents| contents == STAGED_FLAG_CONTENTS) {
        tracing::warn!(
            "Legacy VRCX migration flag has no staged snapshot; discarding the stale flag"
        );
        remove_migration_flag_best_effort(&migration_flag);
        return Ok(());
    }

    let LegacyVrcxDiscovery {
        importable_source,
        status,
    } = discover_legacy_source();
    if let Some(source) = importable_source.as_ref() {
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
    remove_migration_flag_best_effort(&migration_flag);
    Ok(())
}

fn remove_migration_flag_best_effort(migration_flag: &Path) {
    if let Err(error) = std::fs::remove_file(migration_flag) {
        tracing::warn!(error = %error, "failed to remove the legacy migration flag");
    }
}

fn copy_legacy_vrcx_data(
    paths: &LegacyMigrationPaths,
    source: &LegacyVrcxSource,
) -> Result<(), Error> {
    let preserved = read_preserved_config(&paths.db_file);
    copy_database_snapshot(&source.db_path, &paths.db_file, |_, _| {})?;
    write_preserved_config(&paths.db_file, &preserved);

    if let Some(config_path) = source.config_path.as_ref() {
        copy_replace(config_path.clone(), paths.config_file.clone())?;
    } else if paths.config_file.exists() {
        std::fs::remove_file(&paths.config_file)?;
    }

    Ok(())
}

fn install_staged_legacy_vrcx_data(
    paths: &LegacyMigrationPaths,
    staging_dir: &Path,
) -> Result<(), Error> {
    let staged_config = staging_dir.join(STAGED_CONFIG_FILE);
    if staged_config.is_file() {
        copy_replace(staged_config, paths.config_file.clone())?;
    } else if paths.config_file.exists() {
        std::fs::remove_file(&paths.config_file)?;
    }

    let staged_database = staging_dir.join(STAGED_DATABASE_FILE);
    write_preserved_config(&staged_database, &read_preserved_config(&paths.db_file));
    remove_sidecars(&paths.db_file)?;
    crate::profile_backup::replace_file_atomically(&staged_database, &paths.db_file)?;
    crate::profile_backup::sync_directory_durable(&paths.app_data)?;
    Ok(())
}

fn read_preserved_config(db_file: &Path) -> Vec<(String, String)> {
    if !db_file.is_file() {
        return Vec::new();
    }
    let connection = match Connection::open(db_file) {
        Ok(connection) => connection,
        Err(error) => {
            tracing::warn!(error = %error, "failed to read config preserved across legacy migration");
            return Vec::new();
        }
    };
    PRESERVED_CONFIG_KEYS
        .iter()
        .filter_map(|key| {
            connection
                .query_row("SELECT value FROM configs WHERE key = ?1", [key], |row| {
                    row.get::<_, String>(0)
                })
                .ok()
                .map(|value| (key.to_string(), value))
        })
        .collect()
}

fn write_preserved_config(db_file: &Path, entries: &[(String, String)]) {
    if entries.is_empty() {
        return;
    }
    let result = Connection::open(db_file).and_then(|connection| {
        for (key, value) in entries {
            connection.execute(
                "INSERT OR REPLACE INTO configs (key, value) VALUES (?1, ?2)",
                [key, value],
            )?;
        }
        Ok(())
    });
    if let Err(error) = result {
        tracing::warn!(error = %error, "failed to carry config across legacy migration");
    }
}

pub fn copy_database_snapshot(
    from: &Path,
    to: &Path,
    on_progress: impl FnMut(u64, u64),
) -> Result<(), Error> {
    let source = Connection::open_with_flags(from, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(Error::sqlite)?;
    source
        .busy_timeout(Duration::from_secs(5))
        .map_err(Error::sqlite)?;
    let file_name = to.file_name().ok_or_else(|| {
        Error::InvalidData(format!(
            "Legacy migration destination has no file name: {}",
            to.display()
        ))
    })?;
    let temporary = to.with_file_name(format!(
        "{}.legacy-migration.tmp",
        file_name.to_string_lossy()
    ));
    if temporary.exists() {
        std::fs::remove_file(&temporary)?;
    }
    backup_connection_to_path(&source, &temporary, on_progress)?;
    remove_sidecars(to)?;
    let replace_result = crate::profile_backup::replace_file_atomically(&temporary, to);
    if replace_result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    replace_result?;
    if let Some(parent) = to.parent() {
        crate::profile_backup::sync_directory_durable(parent)?;
    }
    Ok(())
}

fn copy_replace(from: PathBuf, to: PathBuf) -> Result<(), Error> {
    if !from.exists() {
        return Ok(());
    }

    let file_name = to.file_name().ok_or_else(|| {
        Error::InvalidData(format!(
            "Legacy migration destination has no file name: {}",
            to.display()
        ))
    })?;
    let temporary = to.with_file_name(format!(
        "{}.legacy-migration.tmp",
        file_name.to_string_lossy()
    ));
    if temporary.exists() {
        std::fs::remove_file(&temporary)?;
    }
    let result = (|| {
        std::fs::copy(&from, &temporary)?;
        std::fs::OpenOptions::new()
            .write(true)
            .open(&temporary)?
            .sync_all()?;
        crate::profile_backup::replace_file_atomically(&temporary, &to)?;
        if let Some(parent) = to.parent() {
            crate::profile_backup::sync_directory_durable(parent)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests;
