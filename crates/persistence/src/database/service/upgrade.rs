use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;

use crate::database::online_backup::backup_connection_to_path;
use crate::database::sidecar::{remove_sidecars, sidecar_path};
use crate::Error;
use vrcx_0_platform::path_utils::replace_file_atomically;

use super::{
    checkpoint, checkpoint_status, ensure_upgrade_version_written, open_configured_connection,
    open_main_database, DatabaseMode, DatabaseService, DatabaseUpgradeStatus, EnsuredSchemas,
    MainDatabase, UpgradeSession, WalCheckpointMode,
};

impl DatabaseService {
    #[cfg(test)]
    pub fn begin_upgrade(&self, from_version: i64, to_version: i64) -> Result<(), Error> {
        self.begin_upgrade_with_progress(from_version, to_version, None, None, None, |_, _| {})
    }

    pub fn begin_upgrade_with_progress(
        &self,
        from_version: i64,
        to_version: i64,
        app_version: Option<&str>,
        stage: Option<&str>,
        operation: Option<&str>,
        mut on_progress: impl FnMut(u64, u64),
    ) -> Result<(), Error> {
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
            let status = checkpoint_status(&writer, WalCheckpointMode::Truncate)?;
            if status.busy {
                tracing::warn!(
                    log_frames = status.log_frames,
                    checkpointed_frames = status.checkpointed_frames,
                    "Source database WAL checkpoint remained busy; continuing with SQLite online backup"
                );
            }
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
            backup_connection_to_path(&writer, &work_db_path, &mut on_progress)?;
        }

        let conn = open_configured_connection(&work_db_path)?;
        let status = DatabaseUpgradeStatus {
            from_version,
            to_version,
            work_db_path: work_db_path.to_string_lossy().into_owned(),
            started_at: Utc::now().to_rfc3339(),
            app_version: app_version.map(str::to_owned),
            stage: stage.map(str::to_owned),
            operation: operation.map(str::to_owned),
            failed_at: None,
            reason: None,
        };

        self.write_status(&self.active_status_path(), &status)?;
        *inner = DatabaseMode::Upgrade(UpgradeSession {
            conn: Mutex::new(conn),
            status,
            ensured: EnsuredSchemas::default(),
        });
        Ok(())
    }

    pub fn set_upgrade_context(&self, stage: &str, operation: &str) -> Result<(), Error> {
        let status = {
            let mut inner = self
                .inner
                .write()
                .map_err(|e| Error::Database(e.to_string()))?;
            let DatabaseMode::Upgrade(session) = &mut *inner else {
                return Err(Error::Database("No database upgrade is running.".into()));
            };
            session.status.stage = Some(stage.to_string());
            session.status.operation = Some(operation.to_string());
            session.status.clone()
        };
        self.write_status(&self.active_status_path(), &status)
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
                if self.db_path.exists() {
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
                } else {
                    tracing::warn!(
                        "Database file {} is missing after a failed upgrade replacement; it stays closed until the next start restores the pre-upgrade backup",
                        self.db_path.display()
                    );
                }
                return Err(error);
            }
        };

        match reopen(&self.db_path) {
            Ok(main) => {
                *inner = DatabaseMode::Main(main);
            }
            Err(error) => {
                let mut sqlite_category = error.sqlite_category();
                let mut reason = format!(
                    "Database upgrade replaced the main database, but reopening it failed: {error}"
                );
                match self.rollback_replaced_database(&work_db_path, &old_main_path) {
                    Ok(()) => match reopen(&self.db_path) {
                        Ok(main) => {
                            *inner = DatabaseMode::Main(main);
                        }
                        Err(reopen_error) => {
                            sqlite_category = sqlite_category.or(reopen_error.sqlite_category());
                            reason = format!(
                                "{reason} Restoring the original database succeeded, but reopening it failed: {reopen_error}"
                            );
                        }
                    },
                    Err(rollback_error) => {
                        sqlite_category = sqlite_category.or(rollback_error.sqlite_category());
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
                            sqlite_category = sqlite_category.or(status_error.sqlite_category());
                            reason = format!(
                                "{reason} Removing the active status failed: {status_error}"
                            );
                        }
                    }
                    Err(status_error) => {
                        sqlite_category = sqlite_category.or(status_error.sqlite_category());
                        reason =
                            format!("{reason} Writing the failure status failed: {status_error}");
                    }
                }
                return Err(Error::database_message(reason, sqlite_category));
            }
        }

        let pre_upgrade_path = pre_upgrade_database_path(&self.upgrade_dir);
        for path in [self.active_status_path(), pre_upgrade_path.clone()] {
            if let Err(error) = self.remove_file_if_exists(&path) {
                tracing::warn!(
                    "Failed to remove finished database upgrade artifact {}: {error}",
                    path.display()
                );
            }
        }
        if let Err(error) = remove_sidecars(&pre_upgrade_path) {
            tracing::warn!("Failed to remove pre-upgrade database sidecars: {error}");
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
                let UpgradeSession { conn, status, .. } = session;
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
                if let Some(status) = read_status_if_exists(&self.active_status_path())? {
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
        unfinished_upgrade_status(&self.upgrade_dir)
    }

    pub fn discard_failed_upgrade(&self) -> Result<(), Error> {
        let inner = self
            .inner
            .write()
            .map_err(|error| Error::Database(error.to_string()))?;
        if !matches!(&*inner, DatabaseMode::Main(_)) {
            return Err(Error::Database(
                "A failed database upgrade can only be discarded while the main database is open."
                    .into(),
            ));
        }

        self.remove_upgrade_dir()
    }

    pub fn archive_main_database_and_create_fresh_database(&self) -> Result<PathBuf, Error> {
        self.archive_main_database_with_open(open_main_database)
    }

    pub(super) fn archive_main_database_with_open(
        &self,
        mut open: impl FnMut(&Path) -> Result<MainDatabase, Error>,
    ) -> Result<PathBuf, Error> {
        let mut inner = self
            .inner
            .write()
            .map_err(|error| Error::Database(error.to_string()))?;
        if matches!(&*inner, DatabaseMode::Upgrade(_)) {
            return Err(Error::Database(
                "A fresh database cannot be created while an upgrade is running.".into(),
            ));
        }

        let recovery_dir = self.create_upgrade_recovery_dir()?;
        let database_file_name = self
            .db_path
            .file_name()
            .ok_or_else(|| Error::Database("Database path has no file name.".into()))?;
        let archived_db_path = recovery_dir.join(database_file_name);
        let archived_upgrade_dir = recovery_dir.join("db-upgrade");
        let database_files = [
            (self.db_path.clone(), archived_db_path.clone()),
            (
                sidecar_path(&self.db_path, "wal"),
                sidecar_path(&archived_db_path, "wal"),
            ),
            (
                sidecar_path(&self.db_path, "shm"),
                sidecar_path(&archived_db_path, "shm"),
            ),
        ];

        let previous = std::mem::replace(&mut *inner, DatabaseMode::Closed);
        drop(previous);
        let mut moved_files = Vec::new();
        let mut moved_upgrade_dir = false;
        let archive_result = (|| -> Result<MainDatabase, Error> {
            for (source, destination) in &database_files {
                if source.exists() {
                    fs::rename(source, destination)?;
                    moved_files.push((source.clone(), destination.clone()));
                }
            }
            if self.upgrade_dir.exists() {
                fs::rename(&self.upgrade_dir, &archived_upgrade_dir)?;
                moved_upgrade_dir = true;
            }
            open(&self.db_path)
        })();

        match archive_result {
            Ok(main) => {
                *inner = DatabaseMode::Main(main);
                Ok(recovery_dir)
            }
            Err(error) => {
                let rollback = self.restore_archived_upgrade(
                    &mut open,
                    &recovery_dir,
                    &archived_upgrade_dir,
                    moved_upgrade_dir,
                    &moved_files,
                );
                match rollback {
                    Ok(main) => {
                        *inner = DatabaseMode::Main(main);
                        Err(error)
                    }
                    Err(rollback_error) => {
                        let sqlite_category =
                            error.sqlite_category().or(rollback_error.sqlite_category());
                        Err(Error::database_message(
                            format!(
                                "{error} Restoring the original database after the fresh-start failure also failed: {rollback_error}"
                            ),
                            sqlite_category,
                        ))
                    }
                }
            }
        }
    }

    fn create_upgrade_recovery_dir(&self) -> Result<PathBuf, Error> {
        let app_data = self
            .db_path
            .parent()
            .ok_or_else(|| Error::Database("Database path has no parent directory.".into()))?;
        let root = app_data.join("database-upgrade-recovery");
        fs::create_dir_all(&root)?;
        let timestamp = Utc::now().format("%Y%m%d-%H%M%S");
        for suffix in 0..1000 {
            let name = if suffix == 0 {
                timestamp.to_string()
            } else {
                format!("{timestamp}-{suffix}")
            };
            let candidate = root.join(name);
            match fs::create_dir(&candidate) {
                Ok(()) => return Ok(candidate),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.into()),
            }
        }
        Err(Error::Database(
            "Could not allocate a database upgrade recovery directory.".into(),
        ))
    }

    fn restore_archived_upgrade(
        &self,
        open: &mut impl FnMut(&Path) -> Result<MainDatabase, Error>,
        recovery_dir: &Path,
        archived_upgrade_dir: &Path,
        moved_upgrade_dir: bool,
        moved_files: &[(PathBuf, PathBuf)],
    ) -> Result<MainDatabase, Error> {
        self.remove_file_if_exists(&self.db_path)?;
        remove_sidecars(&self.db_path)?;
        if moved_upgrade_dir {
            fs::rename(archived_upgrade_dir, &self.upgrade_dir)?;
        }
        for (source, destination) in moved_files.iter().rev() {
            if destination.exists() {
                fs::rename(destination, source)?;
            }
        }
        let main = open(&self.db_path)?;
        let _ = fs::remove_dir(recovery_dir);
        if let Some(root) = recovery_dir.parent() {
            let _ = fs::remove_dir(root);
        }
        Ok(main)
    }

    fn work_db_path(&self, from_version: i64, to_version: i64) -> PathBuf {
        self.upgrade_dir.join(format!(
            "VRCX-0-upgrade-{from_version}-to-{to_version}.sqlite3"
        ))
    }

    pub(super) fn active_status_path(&self) -> PathBuf {
        active_status_file(&self.upgrade_dir)
    }

    pub(super) fn failed_status_path(&self) -> PathBuf {
        failed_status_file(&self.upgrade_dir)
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
        let old_main_path = pre_upgrade_database_path(&self.upgrade_dir);
        self.remove_file_if_exists(&old_main_path)?;
        remove_sidecars(&old_main_path)?;
        remove_sidecars(&self.db_path)?;
        remove_sidecars(work_db_path)?;

        if self.db_path.exists() {
            replace_file_atomically(&self.db_path, &old_main_path)?;
        }

        if let Err(error) = replace_file_atomically(work_db_path, &self.db_path) {
            if let Err(restore_error) =
                restore_interrupted_replacement(&self.db_path, &self.upgrade_dir)
            {
                tracing::warn!(
                    "Failed to restore the pre-upgrade database after a failed replacement: {restore_error}"
                );
            }
            return Err(Error::Io(error));
        }
        Ok(old_main_path)
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
            replace_file_atomically(&self.db_path, work_db_path)?;
        }
        if !old_main_path.exists() {
            self.put_upgraded_database_back(work_db_path);
            return Err(Error::Database(
                "Original database backup is missing during upgrade rollback.".into(),
            ));
        }
        if let Err(error) = replace_file_atomically(old_main_path, &self.db_path) {
            self.put_upgraded_database_back(work_db_path);
            return Err(Error::Io(error));
        }
        Ok(())
    }

    fn put_upgraded_database_back(&self, work_db_path: &Path) {
        if !work_db_path.exists() || self.db_path.exists() {
            return;
        }
        if let Err(error) = replace_file_atomically(work_db_path, &self.db_path) {
            tracing::warn!(
                "Failed to move the upgraded database back to {} during rollback: {error}",
                self.db_path.display()
            );
        }
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

fn pre_upgrade_database_path(upgrade_dir: &Path) -> PathBuf {
    upgrade_dir.join("VRCX-0-before-upgrade.sqlite3")
}

fn active_status_file(upgrade_dir: &Path) -> PathBuf {
    upgrade_dir.join("upgrade-active.json")
}

fn failed_status_file(upgrade_dir: &Path) -> PathBuf {
    upgrade_dir.join("upgrade-failed.json")
}

fn read_status_if_exists(path: &Path) -> Result<Option<DatabaseUpgradeStatus>, Error> {
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

fn unfinished_upgrade_status(upgrade_dir: &Path) -> Result<Option<DatabaseUpgradeStatus>, Error> {
    if let Some(status) = read_status_if_exists(&failed_status_file(upgrade_dir))? {
        if Path::new(&status.work_db_path).exists() {
            return Ok(Some(status));
        }
    }

    if let Some(mut status) = read_status_if_exists(&active_status_file(upgrade_dir))? {
        if Path::new(&status.work_db_path).exists() {
            status.reason = Some(unfinished_upgrade_reason(&status));
            return Ok(Some(status));
        }
    }

    Ok(None)
}

pub(super) fn restore_interrupted_replacement(
    db_path: &Path,
    upgrade_dir: &Path,
) -> Result<(), Error> {
    let pre_upgrade_path = pre_upgrade_database_path(upgrade_dir);
    if !pre_upgrade_path.exists() || !upgrade_status_recorded(upgrade_dir)? {
        return Ok(());
    }
    if db_path.exists() && !matches!(unfinished_upgrade_status(upgrade_dir), Ok(Some(_))) {
        return Ok(());
    }
    remove_sidecars(db_path)?;
    replace_file_atomically(&pre_upgrade_path, db_path)?;
    tracing::warn!(
        "Restored the pre-upgrade database after an interrupted upgrade replacement: {}",
        db_path.display()
    );
    Ok(())
}

fn upgrade_status_recorded(upgrade_dir: &Path) -> Result<bool, Error> {
    for path in [
        active_status_file(upgrade_dir),
        failed_status_file(upgrade_dir),
    ] {
        if path.exists() || status_temporary_path(&path)?.exists() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn unfinished_upgrade_reason(status: &DatabaseUpgradeStatus) -> String {
    let stopped_at = match status.stage.as_deref() {
        Some(stage) => format!("during '{stage}'"),
        None => "before its first stage finished".to_owned(),
    };
    format!(
        "Upgrade stopped {stopped_at} (started {}); the app likely crashed, lost power, or was force-closed before it could finish.",
        status.started_at
    )
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
