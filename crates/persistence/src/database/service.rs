use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex, RwLock,
};

use rusqlite::{
    types::{ToSql, Value as SqlValue},
    Connection, OpenFlags, OptionalExtension, Statement,
};
use serde::{Deserialize, Serialize};

use crate::Error;

use super::value::{json_to_sql, sqlite_value_to_json};

#[cfg(test)]
mod tests;
mod upgrade;

const READ_CONNECTION_COUNT: usize = 2;

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
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
    conn: Mutex<Connection>,
    status: DatabaseUpgradeStatus,
}

struct MainDatabase {
    writer: Mutex<Connection>,
    readers: Vec<Mutex<Connection>>,
    next_reader: AtomicUsize,
}

enum DatabaseMode {
    Main(MainDatabase),
    Upgrade(UpgradeSession),
    Closed,
}

pub struct DatabaseService {
    db_path: PathBuf,
    upgrade_dir: PathBuf,
    inner: RwLock<DatabaseMode>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FrozenDatabase {
    pub db_path: PathBuf,
    pub db_bytes: u64,
    pub wal_path: Option<PathBuf>,
    pub wal_bytes: Option<u64>,
}

pub(crate) struct DatabaseWriteTransaction<'conn> {
    tx: rusqlite::Transaction<'conn>,
}

impl DatabaseService {
    pub fn new(db_path: &Path) -> Result<Self, Error> {
        let main = open_main_database(db_path)?;
        let upgrade_dir = db_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("db-upgrade");

        Ok(Self {
            db_path: db_path.to_path_buf(),
            upgrade_dir,
            inner: RwLock::new(DatabaseMode::Main(main)),
        })
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn is_main_mode(&self) -> bool {
        self.inner
            .read()
            .map(|inner| matches!(&*inner, DatabaseMode::Main(_)))
            .unwrap_or(false)
    }

    pub fn freeze_for_migration(&self) -> Result<FrozenDatabase, Error> {
        let mut inner = self
            .inner
            .write()
            .map_err(|error| Error::Database(error.to_string()))?;
        let main = match &*inner {
            DatabaseMode::Main(main) => main,
            DatabaseMode::Upgrade(_) => {
                return Err(Error::Database(
                    "Database migration is unavailable while an upgrade is running.".into(),
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
                .map_err(|error| Error::Database(error.to_string()))?;
            checkpoint(&writer)?;
        }
        let db_bytes = fs::metadata(&self.db_path)?.len();
        let wal_path = super::sidecar::sidecar_path(&self.db_path, "wal");
        let wal_bytes = fs::metadata(&wal_path)
            .ok()
            .map(|metadata| metadata.len())
            .filter(|bytes| *bytes > 0);
        let wal_path = wal_bytes.map(|_| wal_path);

        let main = match std::mem::replace(&mut *inner, DatabaseMode::Closed) {
            DatabaseMode::Main(main) => main,
            _ => unreachable!(),
        };
        drop(main);
        Ok(FrozenDatabase {
            db_path: self.db_path.clone(),
            db_bytes,
            wal_path,
            wal_bytes,
        })
    }

    pub fn reopen_after_migration_abort(&self) -> Result<(), Error> {
        let mut inner = self
            .inner
            .write()
            .map_err(|error| Error::Database(error.to_string()))?;
        if !matches!(&*inner, DatabaseMode::Closed) {
            return Err(Error::Database(
                "Database can only reopen after an aborted migration.".into(),
            ));
        }
        *inner = DatabaseMode::Main(open_main_database(&self.db_path)?);
        Ok(())
    }

    pub fn vacuum_into(&self, dest: &Path) -> Result<(), Error> {
        let inner = self
            .inner
            .read()
            .map_err(|error| Error::Database(error.to_string()))?;
        if !matches!(&*inner, DatabaseMode::Main(_)) {
            return Err(Error::Database(
                "Database snapshot is unavailable in the current mode.".into(),
            ));
        }

        if dest.exists() {
            fs::remove_file(dest)?;
        }

        let conn = Connection::open_with_flags(&self.db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| Error::Database(error.to_string()))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|error| Error::Database(error.to_string()))?;
        let dest = dest
            .to_str()
            .ok_or_else(|| {
                Error::Database("Database snapshot destination path is not valid UTF-8.".into())
            })?
            .to_owned();
        conn.execute("VACUUM INTO ?1", [&dest])
            .map_err(map_profile_backup_sqlite_error)?;
        Ok(())
    }

    pub(crate) fn execute(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<Vec<Vec<serde_json::Value>>, Error> {
        let inner = self
            .inner
            .read()
            .map_err(|e| Error::Database(e.to_string()))?;
        match &*inner {
            DatabaseMode::Main(main) => main.execute_read(sql, args),
            DatabaseMode::Upgrade(upgrade) => {
                let conn = upgrade
                    .conn
                    .lock()
                    .map_err(|e| Error::Database(e.to_string()))?;
                execute_on_connection(&conn, sql, args)
            }
            DatabaseMode::Closed => Err(Error::Database(
                "Database connection is temporarily unavailable.".into(),
            )),
        }
    }

    pub(crate) fn execute_non_query(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<i64, Error> {
        let inner = self
            .inner
            .read()
            .map_err(|e| Error::Database(e.to_string()))?;
        match &*inner {
            DatabaseMode::Main(main) => main.execute_non_query(sql, args),
            DatabaseMode::Upgrade(upgrade) => {
                let conn = upgrade
                    .conn
                    .lock()
                    .map_err(|e| Error::Database(e.to_string()))?;
                execute_non_query_on_connection(&conn, sql, args)
            }
            DatabaseMode::Closed => Err(Error::Database(
                "Database connection is temporarily unavailable.".into(),
            )),
        }
    }

    pub(crate) fn write_transaction<T, F>(&self, f: F) -> Result<T, Error>
    where
        F: FnOnce(&mut DatabaseWriteTransaction<'_>) -> Result<T, Error>,
    {
        let inner = self
            .inner
            .read()
            .map_err(|e| Error::Database(e.to_string()))?;
        match &*inner {
            DatabaseMode::Main(main) => main.write_transaction(f),
            DatabaseMode::Upgrade(upgrade) => {
                let mut conn = upgrade
                    .conn
                    .lock()
                    .map_err(|e| Error::Database(e.to_string()))?;
                execute_write_transaction(&mut conn, f)
            }
            DatabaseMode::Closed => Err(Error::Database(
                "Database connection is temporarily unavailable.".into(),
            )),
        }
    }

    pub(crate) fn checkpoint_and_vacuum(&self) -> Result<(), Error> {
        let inner = self
            .inner
            .read()
            .map_err(|e| Error::Database(e.to_string()))?;
        let conn = match &*inner {
            DatabaseMode::Main(main) => main
                .writer
                .lock()
                .map_err(|e| Error::Database(e.to_string()))?,
            DatabaseMode::Upgrade(upgrade) => upgrade
                .conn
                .lock()
                .map_err(|e| Error::Database(e.to_string()))?,
            DatabaseMode::Closed => {
                return Err(Error::Database(
                    "Database connection is temporarily unavailable.".into(),
                ));
            }
        };
        checkpoint(&conn)?;
        conn.execute_batch("VACUUM;")
            .map_err(|e| Error::Database(e.to_string()))?;
        checkpoint(&conn)?;
        Ok(())
    }
}

fn map_profile_backup_sqlite_error(error: rusqlite::Error) -> Error {
    if matches!(
        &error,
        rusqlite::Error::SqliteFailure(code, _) if code.code == rusqlite::ErrorCode::DiskFull
    ) {
        return Error::Io(io::Error::new(
            io::ErrorKind::StorageFull,
            error.to_string(),
        ));
    }
    Error::Database(error.to_string())
}

pub fn optimize_database(db: &DatabaseService) -> Result<(), Error> {
    db.execute_non_query("PRAGMA optimize", &Default::default())?;
    Ok(())
}

impl DatabaseWriteTransaction<'_> {
    pub(crate) fn execute(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<Vec<Vec<serde_json::Value>>, Error> {
        execute_on_connection(&self.tx, sql, args)
    }

    pub(crate) fn execute_non_query(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<i64, Error> {
        execute_non_query_on_connection(&self.tx, sql, args)
    }
}

impl MainDatabase {
    fn execute_read(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<Vec<Vec<serde_json::Value>>, Error> {
        if self.readers.is_empty() {
            return self.execute_on_writer(sql, args);
        }

        let index = self.next_reader.fetch_add(1, Ordering::Relaxed) % self.readers.len();
        let conn = self.readers[index]
            .lock()
            .map_err(|e| Error::Database(e.to_string()))?;
        execute_on_connection(&conn, sql, args)
    }

    fn execute_on_writer(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<Vec<Vec<serde_json::Value>>, Error> {
        let conn = self
            .writer
            .lock()
            .map_err(|e| Error::Database(e.to_string()))?;
        execute_on_connection(&conn, sql, args)
    }

    fn execute_non_query(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<i64, Error> {
        let conn = self
            .writer
            .lock()
            .map_err(|e| Error::Database(e.to_string()))?;
        execute_non_query_on_connection(&conn, sql, args)
    }

    fn write_transaction<T, F>(&self, f: F) -> Result<T, Error>
    where
        F: FnOnce(&mut DatabaseWriteTransaction<'_>) -> Result<T, Error>,
    {
        let mut conn = self
            .writer
            .lock()
            .map_err(|e| Error::Database(e.to_string()))?;
        execute_write_transaction(&mut conn, f)
    }
}

fn open_main_database(db_path: &Path) -> Result<MainDatabase, Error> {
    let writer = open_configured_connection(db_path)?;
    let mut readers = Vec::with_capacity(READ_CONNECTION_COUNT);
    for _ in 0..READ_CONNECTION_COUNT {
        readers.push(Mutex::new(open_read_connection(db_path)?));
    }
    Ok(MainDatabase {
        writer: Mutex::new(writer),
        readers,
        next_reader: AtomicUsize::new(0),
    })
}

fn open_configured_connection(db_path: &Path) -> Result<Connection, Error> {
    let conn = Connection::open(db_path).map_err(|e| Error::Database(e.to_string()))?;
    configure_connection(&conn)?;
    Ok(conn)
}

fn open_read_connection(db_path: &Path) -> Result<Connection, Error> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| Error::Database(e.to_string()))?;
    configure_read_connection(&conn)?;
    Ok(conn)
}

fn configure_connection(conn: &Connection) -> Result<(), Error> {
    conn.execute_batch(
        "PRAGMA locking_mode=NORMAL;
         PRAGMA busy_timeout=5000;
         PRAGMA journal_mode=WAL;
         PRAGMA secure_delete=ON;
         PRAGMA optimize=0x10002;",
    )
    .map_err(|e| Error::Database(e.to_string()))?;
    conn.set_prepared_statement_cache_capacity(64);
    Ok(())
}

fn configure_read_connection(conn: &Connection) -> Result<(), Error> {
    conn.execute_batch(
        "PRAGMA busy_timeout=5000;
         PRAGMA query_only=ON;",
    )
    .map_err(|e| Error::Database(e.to_string()))?;
    conn.set_prepared_statement_cache_capacity(64);
    Ok(())
}

fn checkpoint(conn: &Connection) -> Result<(), Error> {
    let busy = conn
        .query_row("PRAGMA wal_checkpoint(TRUNCATE);", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|e| Error::Database(e.to_string()))?;
    if busy != 0 {
        return Err(Error::Database("WAL checkpoint remained busy.".into()));
    }
    Ok(())
}

fn execute_write_transaction<T, F>(conn: &mut Connection, f: F) -> Result<T, Error>
where
    F: FnOnce(&mut DatabaseWriteTransaction<'_>) -> Result<T, Error>,
{
    let tx = conn
        .transaction()
        .map_err(|e| Error::Database(e.to_string()))?;
    let mut wrapped = DatabaseWriteTransaction { tx };
    let value = f(&mut wrapped)?;
    wrapped
        .tx
        .commit()
        .map_err(|e| Error::Database(e.to_string()))?;
    Ok(value)
}

fn ensure_upgrade_version_written(conn: &Connection, to_version: i64) -> Result<(), Error> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM configs WHERE key = 'config:vrcx_0_databaseversion' LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| Error::Database(e.to_string()))?;

    let expected = to_version.to_string();
    if value.as_deref() != Some(expected.as_str()) {
        return Err(Error::Database(format!(
            "Database upgrade copy does not contain VRCX-0 schema version {to_version}."
        )));
    }

    Ok(())
}

fn execute_on_connection(
    conn: &Connection,
    sql: &str,
    args: &HashMap<String, serde_json::Value>,
) -> Result<Vec<Vec<serde_json::Value>>, Error> {
    let mut stmt = conn
        .prepare_cached(sql)
        .map_err(|e| Error::Database(e.to_string()))?;

    let param_names = statement_param_names(&stmt);
    let params = statement_param_values(&param_names, args)?;

    let param_refs: Vec<(&str, &dyn ToSql)> = param_names
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
        .map_err(|e| Error::Database(e.to_string()))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| Error::Database(e.to_string()))?);
    }
    Ok(result)
}

fn execute_non_query_on_connection(
    conn: &Connection,
    sql: &str,
    args: &HashMap<String, serde_json::Value>,
) -> Result<i64, Error> {
    let mut stmt = conn
        .prepare_cached(sql)
        .map_err(|e| Error::Database(e.to_string()))?;

    let param_names = statement_param_names(&stmt);
    let params = statement_param_values(&param_names, args)?;

    let param_refs: Vec<(&str, &dyn ToSql)> = param_names
        .iter()
        .zip(params.iter())
        .map(|(name, val)| (name.as_str(), val.as_ref()))
        .collect();

    let affected = stmt
        .execute(&*param_refs)
        .map_err(|e| Error::Database(e.to_string()))?;

    Ok(affected as i64)
}

fn statement_param_names(stmt: &Statement<'_>) -> Vec<String> {
    (1..=stmt.parameter_count())
        .filter_map(|i| stmt.parameter_name(i).map(|s| s.to_owned()))
        .collect()
}

fn statement_param_values(
    param_names: &[String],
    args: &HashMap<String, serde_json::Value>,
) -> Result<Vec<Box<dyn ToSql>>, Error> {
    param_names
        .iter()
        .map(|name| {
            args.get(name.as_str())
                .map(json_to_sql)
                .ok_or_else(|| Error::Database(format!("Missing SQL parameter: {name}")))
        })
        .collect()
}
