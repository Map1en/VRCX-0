use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::MAIN_DB;

use crate::database::sidecar::remove_sidecars;
use crate::Error;

use super::{
    checkpoint, ensure_upgrade_version_written, open_configured_connection, open_main_database,
    DatabaseMode, DatabaseService, DatabaseUpgradeStatus, MainDatabase, UpgradeSession,
};

impl DatabaseService {
    pub fn begin_upgrade(&self, from_version: i64, to_version: i64) -> Result<(), Error> {
        let mut inner = self
            .inner
            .write()
            .map_err(|e| Error::Database(e.to_string()))?;

        let main = match &*inner {
            DatabaseMode::Main(main) => main,
            DatabaseMode::Upgrade(_) => {
                return Err(Error::Database(
                    "A database upgrade is already running.".into(),
                ));
            }
            DatabaseMode::Closed => {
                return Err(Error::Database(
                    "Database connection is temporarily unavailable.".into(),
                ));
            }
        };

        {
            let writer = main
                .writer
                .lock()
                .map_err(|e| Error::Database(e.to_string()))?;
            checkpoint(&writer)?;
        }

        if let Some(status) = self.get_failed_upgrade()? {
            return Err(Error::Database(format!(
                "A previous database upgrade did not finish. Work database: {}",
                status.work_db_path
            )));
        }

        self.remove_upgrade_dir()?;
        fs::create_dir_all(&self.upgrade_dir)?;

        let work_db_path = self.work_db_path(from_version, to_version);
        {
            let writer = main
                .writer
                .lock()
                .map_err(|e| Error::Database(e.to_string()))?;
            writer
                .backup(MAIN_DB, &work_db_path, None)
                .map_err(|e| Error::Database(e.to_string()))?;
        }

        let conn = open_configured_connection(&work_db_path)?;
        let status = DatabaseUpgradeStatus {
            from_version,
            to_version,
            work_db_path: work_db_path.to_string_lossy().into_owned(),
            started_at: Utc::now().to_rfc3339(),
            failed_at: None,
            reason: None,
        };

        self.write_status(&self.active_status_path(), &status)?;
        *inner = DatabaseMode::Upgrade(UpgradeSession {
            conn: Mutex::new(conn),
            status,
        });
        Ok(())
    }

    pub fn commit_upgrade(&self) -> Result<(), Error> {
        self.commit_upgrade_with_reopen(open_main_database)
    }

    pub(super) fn commit_upgrade_with_reopen(
        &self,
        mut reopen: impl FnMut(&Path) -> Result<MainDatabase, Error>,
    ) -> Result<(), Error> {
        let mut inner = self
            .inner
            .write()
            .map_err(|e| Error::Database(e.to_string()))?;

        let status = match &*inner {
            DatabaseMode::Upgrade(session) => session.status.clone(),
            _ => return Err(Error::Database("No database upgrade is running.".into())),
        };

        {
            let session = match &*inner {
                DatabaseMode::Upgrade(session) => session,
                _ => unreachable!(),
            };
            let conn = session
                .conn
                .lock()
                .map_err(|e| Error::Database(e.to_string()))?;
            ensure_upgrade_version_written(&conn, status.to_version)?;
            checkpoint(&conn)?;
        }

        let session = match std::mem::replace(&mut *inner, DatabaseMode::Closed) {
            DatabaseMode::Upgrade(session) => session,
            _ => unreachable!(),
        };
        let work_db_path = PathBuf::from(&session.status.work_db_path);
        drop(session);

        let old_main_path = match self.replace_main_database(&work_db_path) {
            Ok(path) => path,
            Err(error) => {
                match reopen(&self.db_path) {
                    Ok(main) => {
                        *inner = DatabaseMode::Main(main);
                    }
                    Err(reopen_error) => {
                        tracing::warn!(
                            "Failed to reopen database after upgrade rollback: {reopen_error}"
                        );
                    }
                }
                return Err(error);
            }
        };

        match reopen(&self.db_path) {
            Ok(main) => {
                *inner = DatabaseMode::Main(main);
            }
            Err(error) => {
                let mut reason = format!(
                    "Database upgrade replaced the main database, but reopening it failed: {error}"
                );
                match self.rollback_replaced_database(&work_db_path, &old_main_path) {
                    Ok(()) => match reopen(&self.db_path) {
                        Ok(main) => {
                            *inner = DatabaseMode::Main(main);
                        }
                        Err(reopen_error) => {
                            reason = format!(
                                "{reason} Restoring the original database succeeded, but reopening it failed: {reopen_error}"
                            );
                        }
                    },
                    Err(rollback_error) => {
                        reason = format!(
                            "{reason} Restoring the original database failed: {rollback_error}"
                        );
                    }
                }

                let mut failed_status = status;
                failed_status.work_db_path = if work_db_path.exists() {
                    work_db_path.to_string_lossy().into_owned()
                } else {
                    self.db_path.to_string_lossy().into_owned()
                };
                failed_status.failed_at = Some(Utc::now().to_rfc3339());
                failed_status.reason = Some(reason.clone());
                match self.write_status(&self.failed_status_path(), &failed_status) {
                    Ok(()) => {
                        if let Err(status_error) =
                            self.remove_file_if_exists(&self.active_status_path())
                        {
                            reason = format!(
                                "{reason} Removing the active status failed: {status_error}"
                            );
                        }
                    }
                    Err(status_error) => {
                        reason =
                            format!("{reason} Writing the failure status failed: {status_error}");
                    }
                }
                return Err(Error::Database(reason));
            }
        }

        if let Err(error) = self.remove_upgrade_dir() {
            tracing::warn!("Failed to clean database upgrade directory: {error}");
        }

        Ok(())
    }

    pub fn fail_upgrade(&self, reason: String) -> Result<(), Error> {
        let mut inner = self
            .inner
            .write()
            .map_err(|e| Error::Database(e.to_string()))?;

        let reopen_main = matches!(&*inner, DatabaseMode::Upgrade(_));
        let mut status = match std::mem::replace(&mut *inner, DatabaseMode::Closed) {
            DatabaseMode::Upgrade(session) => {
                let UpgradeSession { conn, status } = session;
                match conn.into_inner() {
                    Ok(conn) => {
                        if let Err(error) = checkpoint(&conn) {
                            tracing::warn!(
                                "Failed to checkpoint failed database upgrade copy: {error}"
                            );
                        }
                        drop(conn);
                    }
                    Err(error) => {
                        tracing::warn!(
                            "Failed to close failed database upgrade connection cleanly: {error}"
                        );
                    }
                }
                status
            }
            other => {
                *inner = other;
                if let Some(status) = self.read_status_if_exists(&self.active_status_path())? {
                    status
                } else {
                    return Ok(());
                }
            }
        };

        status.failed_at = Some(Utc::now().to_rfc3339());
        status.reason = Some(reason);
        self.write_status(&self.failed_status_path(), &status)?;
        self.remove_file_if_exists(&self.active_status_path())?;

        if reopen_main {
            match open_main_database(&self.db_path) {
                Ok(main) => {
                    *inner = DatabaseMode::Main(main);
                }
                Err(error) => {
                    tracing::warn!("Failed to reopen database after upgrade failure: {error}");
                }
            }
        }
        Ok(())
    }

    pub fn get_failed_upgrade(&self) -> Result<Option<DatabaseUpgradeStatus>, Error> {
        if let Some(status) = self.read_status_if_exists(&self.failed_status_path())? {
            if Path::new(&status.work_db_path).exists() {
                return Ok(Some(status));
            }
        }

        if let Some(mut status) = self.read_status_if_exists(&self.active_status_path())? {
            if Path::new(&status.work_db_path).exists() {
                status.reason = Some("A previous database upgrade did not finish.".into());
                return Ok(Some(status));
            }
        }

        Ok(None)
    }

    fn work_db_path(&self, from_version: i64, to_version: i64) -> PathBuf {
        self.upgrade_dir.join(format!(
            "VRCX-0-upgrade-{from_version}-to-{to_version}.sqlite3"
        ))
    }

    pub(super) fn active_status_path(&self) -> PathBuf {
        self.upgrade_dir.join("upgrade-active.json")
    }

    pub(super) fn failed_status_path(&self) -> PathBuf {
        self.upgrade_dir.join("upgrade-failed.json")
    }

    fn read_status_if_exists(&self, path: &Path) -> Result<Option<DatabaseUpgradeStatus>, Error> {
        let temporary_path = status_temporary_path(path)?;
        if path.exists() {
            match read_upgrade_status(path) {
                Ok(status) => return Ok(Some(status)),
                Err(error) if !temporary_path.exists() => return Err(error),
                Err(_) => {}
            }
        }
        if temporary_path.exists() {
            return Ok(Some(read_upgrade_status(&temporary_path)?));
        }
        Ok(None)
    }

    fn write_status(&self, path: &Path, status: &DatabaseUpgradeStatus) -> Result<(), Error> {
        fs::create_dir_all(&self.upgrade_dir)?;
        let json = serde_json::to_string_pretty(status)?;
        let temporary_path = status_temporary_path(path)?;
        let result = (|| {
            let mut file = fs::OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(&temporary_path)?;
            file.write_all(json.as_bytes())?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary_path, path)?;
            sync_directory(&self.upgrade_dir)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary_path);
        }
        result
    }

    fn replace_main_database(&self, work_db_path: &Path) -> Result<PathBuf, Error> {
        let old_main_path = self.upgrade_dir.join("VRCX-0-before-upgrade.sqlite3");
        self.remove_file_if_exists(&old_main_path)?;
        remove_sidecars(&old_main_path)?;
        remove_sidecars(&self.db_path)?;
        remove_sidecars(work_db_path)?;

        if self.db_path.exists() {
            fs::rename(&self.db_path, &old_main_path)?;
        }

        match fs::rename(work_db_path, &self.db_path) {
            Ok(()) => Ok(old_main_path),
            Err(error) => {
                if old_main_path.exists() && !self.db_path.exists() {
                    let _ = fs::rename(&old_main_path, &self.db_path);
                }
                Err(Error::Io(error))
            }
        }
    }

    fn rollback_replaced_database(
        &self,
        work_db_path: &Path,
        old_main_path: &Path,
    ) -> Result<(), Error> {
        remove_sidecars(&self.db_path)?;
        remove_sidecars(work_db_path)?;
        if work_db_path.exists() {
            return Err(Error::Database(format!(
                "Database upgrade work path already exists: {}",
                work_db_path.display()
            )));
        }
        if self.db_path.exists() {
            fs::rename(&self.db_path, work_db_path)?;
        }
        if !old_main_path.exists() {
            if work_db_path.exists() && !self.db_path.exists() {
                let _ = fs::rename(work_db_path, &self.db_path);
            }
            return Err(Error::Database(
                "Original database backup is missing during upgrade rollback.".into(),
            ));
        }
        if let Err(error) = fs::rename(old_main_path, &self.db_path) {
            if work_db_path.exists() && !self.db_path.exists() {
                let _ = fs::rename(work_db_path, &self.db_path);
            }
            return Err(Error::Io(error));
        }
        Ok(())
    }

    fn remove_upgrade_dir(&self) -> Result<(), Error> {
        if self.upgrade_dir.exists() {
            fs::remove_dir_all(&self.upgrade_dir)?;
        }
        Ok(())
    }

    fn remove_file_if_exists(&self, path: &Path) -> Result<(), Error> {
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }
}

pub(super) fn status_temporary_path(path: &Path) -> Result<PathBuf, Error> {
    let file_name = path
        .file_name()
        .ok_or_else(|| Error::Database("Database upgrade status path has no file name.".into()))?
        .to_string_lossy();
    Ok(path.with_file_name(format!(".{file_name}.tmp")))
}

fn read_upgrade_status(path: &Path) -> Result<DatabaseUpgradeStatus, Error> {
    let content = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), Error> {
    fs::File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), Error> {
    Ok(())
}
