use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{types::Value as SqlValue, Connection, OptionalExtension, MAIN_DB};
use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseUpgradeStatus {
    pub from_version: i64,
    pub to_version: i64,
    pub work_db_path: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

struct UpgradeSession {
    conn: Connection,
    status: DatabaseUpgradeStatus,
}

struct DatabaseInner {
    main: Option<Connection>,
    upgrade: Option<UpgradeSession>,
}

pub struct DatabaseService {
    db_path: PathBuf,
    upgrade_dir: PathBuf,
    inner: Mutex<DatabaseInner>,
}

impl DatabaseService {
    pub fn new(db_path: &Path) -> Result<Self, AppError> {
        let conn = open_configured_connection(db_path)?;
        let upgrade_dir = db_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("db-upgrade");

        Ok(Self {
            db_path: db_path.to_path_buf(),
            upgrade_dir,
            inner: Mutex::new(DatabaseInner {
                main: Some(conn),
                upgrade: None,
            }),
        })
    }

    pub fn execute(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<Vec<Vec<serde_json::Value>>, AppError> {
        let inner = self
            .inner
            .lock()
            .map_err(|e| AppError::Database(e.to_string()))?;
        let conn = inner.active_connection()?;
        execute_on_connection(conn, sql, args)
    }

    pub fn execute_non_query(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<i64, AppError> {
        let inner = self
            .inner
            .lock()
            .map_err(|e| AppError::Database(e.to_string()))?;
        let conn = inner.active_connection()?;
        execute_non_query_on_connection(conn, sql, args)
    }

    pub fn begin_upgrade(&self, from_version: i64, to_version: i64) -> Result<(), AppError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|e| AppError::Database(e.to_string()))?;

        if inner.upgrade.is_some() {
            return Err(AppError::Database(
                "A database upgrade is already running.".into(),
            ));
        }

        if let Some(status) = self.blocking_upgrade_status()? {
            return Err(AppError::Database(format!(
                "A previous database upgrade did not finish. Work database: {}",
                status.work_db_path
            )));
        }

        self.remove_upgrade_dir()?;
        fs::create_dir_all(&self.upgrade_dir)?;

        let work_db_path = self.work_db_path(from_version, to_version);
        let main = inner
            .main
            .as_ref()
            .ok_or_else(|| AppError::Database("Main database connection is not open.".into()))?;

        main.backup(MAIN_DB, &work_db_path, None)
            .map_err(|e| AppError::Database(e.to_string()))?;

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
        inner.upgrade = Some(UpgradeSession { conn, status });
        Ok(())
    }

    pub fn commit_upgrade(&self) -> Result<(), AppError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|e| AppError::Database(e.to_string()))?;

        let status = inner
            .upgrade
            .as_ref()
            .map(|session| session.status.clone())
            .ok_or_else(|| AppError::Database("No database upgrade is running.".into()))?;

        {
            let session = inner.upgrade.as_ref().unwrap();
            ensure_upgrade_version_written(&session.conn, status.to_version)?;
            checkpoint(&session.conn)?;
        }

        if let Some(main) = inner.main.as_ref() {
            checkpoint(main)?;
        }

        let session = inner.upgrade.take().unwrap();
        let work_db_path = PathBuf::from(&session.status.work_db_path);
        drop(session);
        let main = inner.main.take();
        drop(main);

        if let Err(error) = self.replace_main_database(&work_db_path) {
            match open_configured_connection(&self.db_path) {
                Ok(conn) => {
                    inner.main = Some(conn);
                }
                Err(reopen_error) => {
                    tracing::warn!("Failed to reopen database after upgrade rollback: {reopen_error}");
                }
            }
            return Err(error);
        }

        match open_configured_connection(&self.db_path) {
            Ok(conn) => {
                inner.main = Some(conn);
            }
            Err(error) => {
                let mut failed_status = status;
                failed_status.work_db_path = self.db_path.to_string_lossy().into_owned();
                failed_status.failed_at = Some(Utc::now().to_rfc3339());
                failed_status.reason = Some(format!(
                    "Database upgrade replaced the main database, but reopening it failed: {error}"
                ));
                if let Err(status_error) =
                    self.write_status(&self.failed_status_path(), &failed_status)
                {
                    tracing::warn!(
                        "Failed to write database upgrade failure status after replacement: {status_error}"
                    );
                }
                if let Err(status_error) = self.remove_file_if_exists(&self.active_status_path()) {
                    tracing::warn!(
                        "Failed to remove active database upgrade status after replacement failure: {status_error}"
                    );
                }
                return Err(error);
            }
        }

        if let Err(error) = self.remove_upgrade_dir() {
            tracing::warn!("Failed to clean database upgrade directory: {error}");
        }

        Ok(())
    }

    pub fn fail_upgrade(&self, reason: String) -> Result<(), AppError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut status = if let Some(session) = inner.upgrade.take() {
            let UpgradeSession { conn, status } = session;
            if let Err(error) = checkpoint(&conn) {
                tracing::warn!("Failed to checkpoint failed database upgrade copy: {error}");
            }
            drop(conn);
            status
        } else if let Some(status) = self.read_status_if_exists(&self.active_status_path())? {
            status
        } else {
            return Ok(());
        };

        status.failed_at = Some(Utc::now().to_rfc3339());
        status.reason = Some(reason);
        self.write_status(&self.failed_status_path(), &status)?;
        self.remove_file_if_exists(&self.active_status_path())?;
        Ok(())
    }

    pub fn get_failed_upgrade(&self) -> Result<Option<DatabaseUpgradeStatus>, AppError> {
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
        self.upgrade_dir
            .join(format!("VRCX-0-upgrade-{from_version}-to-{to_version}.sqlite3"))
    }

    fn active_status_path(&self) -> PathBuf {
        self.upgrade_dir.join("upgrade-active.json")
    }

    fn failed_status_path(&self) -> PathBuf {
        self.upgrade_dir.join("upgrade-failed.json")
    }

    fn blocking_upgrade_status(&self) -> Result<Option<DatabaseUpgradeStatus>, AppError> {
        if let Some(status) = self.read_status_if_exists(&self.failed_status_path())? {
            if Path::new(&status.work_db_path).exists() {
                return Ok(Some(status));
            }
        }

        if let Some(status) = self.read_status_if_exists(&self.active_status_path())? {
            if Path::new(&status.work_db_path).exists() {
                return Ok(Some(status));
            }
        }

        Ok(None)
    }

    fn read_status_if_exists(
        &self,
        path: &Path,
    ) -> Result<Option<DatabaseUpgradeStatus>, AppError> {
        if !path.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(path)?;
        Ok(Some(serde_json::from_str(&content)?))
    }

    fn write_status(&self, path: &Path, status: &DatabaseUpgradeStatus) -> Result<(), AppError> {
        fs::create_dir_all(&self.upgrade_dir)?;
        let json = serde_json::to_string_pretty(status)?;
        fs::write(path, json)?;
        Ok(())
    }

    fn replace_main_database(&self, work_db_path: &Path) -> Result<(), AppError> {
        let old_main_path = self.upgrade_dir.join("VRCX-0-before-upgrade.sqlite3");
        self.remove_file_if_exists(&old_main_path)?;
        remove_sidecars(&old_main_path)?;
        remove_sidecars(&self.db_path)?;
        remove_sidecars(work_db_path)?;

        if self.db_path.exists() {
            fs::rename(&self.db_path, &old_main_path)?;
        }

        match fs::rename(work_db_path, &self.db_path) {
            Ok(()) => {
                if let Err(error) = self.remove_file_if_exists(&old_main_path) {
                    tracing::warn!("Failed to remove old database after upgrade: {error}");
                }
                if let Err(error) = remove_sidecars(&old_main_path) {
                    tracing::warn!("Failed to remove old database sidecars after upgrade: {error}");
                }
                Ok(())
            }
            Err(error) => {
                if old_main_path.exists() && !self.db_path.exists() {
                    let _ = fs::rename(&old_main_path, &self.db_path);
                }
                Err(AppError::Io(error))
            }
        }
    }

    fn remove_upgrade_dir(&self) -> Result<(), AppError> {
        if self.upgrade_dir.exists() {
            fs::remove_dir_all(&self.upgrade_dir)?;
        }
        Ok(())
    }

    fn remove_file_if_exists(&self, path: &Path) -> Result<(), AppError> {
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }
}

impl DatabaseInner {
    fn active_connection(&self) -> Result<&Connection, AppError> {
        if let Some(upgrade) = self.upgrade.as_ref() {
            return Ok(&upgrade.conn);
        }

        self.main
            .as_ref()
            .ok_or_else(|| AppError::Database("Main database connection is not open.".into()))
    }
}

fn open_configured_connection(db_path: &Path) -> Result<Connection, AppError> {
    let conn = Connection::open(db_path).map_err(|e| AppError::Database(e.to_string()))?;
    configure_connection(&conn)?;
    Ok(conn)
}

fn configure_connection(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "PRAGMA locking_mode=NORMAL;
         PRAGMA busy_timeout=5000;
         PRAGMA journal_mode=WAL;
         PRAGMA optimize=0x10002;",
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

fn checkpoint(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

fn ensure_upgrade_version_written(conn: &Connection, to_version: i64) -> Result<(), AppError> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM configs WHERE key = 'config:vrcx_databaseversion' LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| AppError::Database(e.to_string()))?;

    let expected = to_version.to_string();
    if value.as_deref() != Some(expected.as_str()) {
        return Err(AppError::Database(format!(
            "Database upgrade copy does not contain databaseVersion {to_version}."
        )));
    }

    Ok(())
}

fn execute_on_connection(
    conn: &Connection,
    sql: &str,
    args: &HashMap<String, serde_json::Value>,
) -> Result<Vec<Vec<serde_json::Value>>, AppError> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| AppError::Database(e.to_string()))?;

    let param_names: Vec<String> = (1..=stmt.parameter_count())
        .filter_map(|i| stmt.parameter_name(i).map(|s| s.to_owned()))
        .collect();

    let params: Vec<Box<dyn rusqlite::types::ToSql>> = param_names
        .iter()
        .map(|name| json_to_sql(args.get(name.as_str())))
        .collect();

    let param_refs: Vec<(&str, &dyn rusqlite::types::ToSql)> = param_names
        .iter()
        .zip(params.iter())
        .map(|(name, val)| (name.as_str(), val.as_ref()))
        .collect();

    let col_count = stmt.column_count();

    let rows = stmt
        .query_map(&*param_refs, |row| {
            let mut vals = Vec::with_capacity(col_count);
            for i in 0..col_count {
                let val: SqlValue = row.get(i)?;
                vals.push(sqlite_value_to_json(val));
            }
            Ok(vals)
        })
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| AppError::Database(e.to_string()))?);
    }
    Ok(result)
}

fn execute_non_query_on_connection(
    conn: &Connection,
    sql: &str,
    args: &HashMap<String, serde_json::Value>,
) -> Result<i64, AppError> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| AppError::Database(e.to_string()))?;

    let param_names: Vec<String> = (1..=stmt.parameter_count())
        .filter_map(|i| stmt.parameter_name(i).map(|s| s.to_owned()))
        .collect();

    let params: Vec<Box<dyn rusqlite::types::ToSql>> = param_names
        .iter()
        .map(|name| json_to_sql(args.get(name.as_str())))
        .collect();

    let param_refs: Vec<(&str, &dyn rusqlite::types::ToSql)> = param_names
        .iter()
        .zip(params.iter())
        .map(|(name, val)| (name.as_str(), val.as_ref()))
        .collect();

    let affected = stmt
        .execute(&*param_refs)
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(affected as i64)
}

fn json_to_sql(val: Option<&serde_json::Value>) -> Box<dyn rusqlite::types::ToSql> {
    match val {
        None | Some(serde_json::Value::Null) => Box::new(rusqlite::types::Null),
        Some(serde_json::Value::Bool(b)) => Box::new(if *b { 1i64 } else { 0i64 }),
        Some(serde_json::Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(n.to_string())
            }
        }
        Some(serde_json::Value::String(s)) => Box::new(s.clone()),
        Some(other) => Box::new(other.to_string()),
    }
}

fn sqlite_value_to_json(val: SqlValue) -> serde_json::Value {
    match val {
        SqlValue::Null => serde_json::Value::Null,
        SqlValue::Integer(i) => serde_json::json!(i),
        SqlValue::Real(f) => serde_json::json!(f),
        SqlValue::Text(s) => serde_json::json!(s),
        SqlValue::Blob(b) => serde_json::json!(base64_encode(&b)),
    }
}

fn remove_sidecars(db_path: &Path) -> Result<(), AppError> {
    for suffix in ["shm", "wal"] {
        let path = PathBuf::from(format!("{}-{suffix}", db_path.to_string_lossy()));
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

fn base64_encode(data: &[u8]) -> String {
    let mut s = String::with_capacity(data.len() * 4 / 3 + 4);

    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        s.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        s.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            s.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            s.push('=');
        }
        if chunk.len() > 2 {
            s.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            s.push('=');
        }
    }
    s
}
